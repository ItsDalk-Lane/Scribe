import { t } from "@/lib/i18n";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import { filterSkillsForScope } from "@/agentMode/session/scopedSkills";
import { useManagedSkills } from "@/agentMode/skills/SkillManager";
import { expandCustomCommandPrefix } from "@/agentMode/session/expandCustomCommandPrefix";
import { resolveActiveNoteToken } from "@/agentMode/session/resolveActiveNoteToken";
import type { QueuedAgentMessage } from "@/agentMode/session/AgentInputDraftStore";
import type { AgentInputDraftControls } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { isCompactCommand } from "@/commands/compactCommand";
import {
  clearSelection,
  dismissSelection,
  useSelectedTextContexts,
} from "@/selection/selectionStore";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { getCachedCustomCommands } from "@/commands/state";
import ChatInput, {
  type ChatInputHandle,
  type ChatInputProps,
} from "@/components/chat-components/ChatInput";
import { useActiveWebTabState } from "@/components/chat-components/hooks/useActiveWebTabState";
import { ACTIVE_WEB_TAB_MARKER, EVENT_NAMES } from "@/constants";
import { EventTargetContext } from "@/context";
import { logError, logWarn } from "@/logger";
import type { PromptContent, QueuedPrompt } from "@/agentMode/session/types";
import type CopilotPlugin from "@/main";
import { buildWebTabsWithActiveSnapshot } from "@/services/webViewerService/activeWebTabSnapshot";
import {
  isNoteSelectedTextContext,
  type MessageContext,
  type SelectedTextContext,
  type WebTabContext,
} from "@/types/message";
import { getModelKeyFromModel } from "@/settings/model";
import { modelSupportsVision } from "@/utils";
import { arrayBufferToBase64, base64ToArrayBuffer } from "@/utils/base64";
import { mergeWebTabContexts } from "@/utils/urlNormalization";
import { App, Notice, TFile } from "obsidian";
import React, { memo, useCallback, useContext, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

interface AgentChatInputProps {
  backend: AgentChatBackend;
  plugin: CopilotPlugin;
  chatInputId: string;
  skillScope?: { cwd: string | null; projectDirectory: string };
  draft: AgentInputDraftControls;
  app: App;
  updateUserMessageHistory: (newMessage: string) => void;
  isStarting: boolean;
  isLoading: boolean;
  isReplyRunning: boolean;
  queuedPrompts: readonly QueuedPrompt[];
  acceptsMidTurnMessages: boolean;
  hasPendingPlanPermission: boolean;
  modelPickerOverride: ChatInputProps["modelPickerOverride"];
  modePickerOverride: ChatInputProps["modePickerOverride"];
  onCycleMode: () => void;
  disabled?: boolean;
}

interface MessagePreparationQueue {
  tail: Promise<void>;
  pending: Map<QueuedAgentMessage, File[]>;
  cancelled: boolean;
}

const dedupeBy = <T,>(items: Iterable<T>, key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
};

const buildMessageContext = (
  notes: TFile[],
  selected: readonly SelectedTextContext[],
  webTabs: readonly WebTabContext[] = []
): MessageContext | undefined => {
  if (notes.length === 0 && selected.length === 0 && webTabs.length === 0) return undefined;
  return {
    notes,
    selectedTextContexts: selected.length > 0 ? [...selected] : undefined,
    webTabs: webTabs.length > 0 ? [...webTabs] : undefined,
  };
};

const combineQueuedMessages = (items: QueuedAgentMessage[]): QueuedAgentMessage => {
  if (items.length === 1) return items[0];

  const allNotes = items.flatMap((i) => i.context?.notes ?? []);
  const allSelected = items.flatMap((i) => i.context?.selectedTextContexts ?? []);
  const allWebTabs = items.flatMap((i) => i.context?.webTabs ?? []);
  const allPromptContent = items.flatMap((i) => i.promptContent ?? []);

  return {
    id: `queued-combined-${uuidv4()}`,
    text: items.map((i) => i.text).join("\n\n"),
    rawInput: items.map((i) => i.rawInput).join("\n\n"),
    context: buildMessageContext(
      dedupeBy(allNotes, (n) => n.path),
      dedupeBy(allSelected, (s) => s.id),
      mergeWebTabContexts(allWebTabs)
    ),
    promptContent: allPromptContent.length > 0 ? allPromptContent : undefined,
  };
};

// Agents only compact when /compact is the whole prompt, so a queued one never merges with neighbours.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/634
const takeNextQueuedBatch = (
  items: QueuedAgentMessage[]
): { batch: QueuedAgentMessage[]; rest: QueuedAgentMessage[] } => {
  const nextCompact = items.findIndex((item) => isCompactCommand(item.text));
  const end = nextCompact === 0 ? 1 : nextCompact === -1 ? items.length : nextCompact;
  return { batch: items.slice(0, end), rest: items.slice(end) };
};

async function fileToImageBlock(file: File): Promise<PromptContent | null> {
  try {
    const buf = await file.arrayBuffer();
    if (buf.byteLength === 0) return null;
    return { type: "image", mimeType: file.type || "image/png", data: arrayBufferToBase64(buf) };
  } catch (e) {
    logWarn("[AgentMode] failed to read attached image", e);
    return null;
  }
}

function imageBlockToFile(block: PromptContent, index: number): File | null {
  if (block.type !== "image") return null;
  const extension = block.mimeType.split("/")[1] || "png";
  return new File([base64ToArrayBuffer(block.data)], `queued-image-${index + 1}.${extension}`, {
    type: block.mimeType,
  });
}

export const AgentChatInput = memo(function AgentChatInput({
  backend,
  plugin,
  chatInputId,
  skillScope,
  draft,
  app,
  updateUserMessageHistory,
  isStarting,
  isLoading: loading,
  isReplyRunning,
  queuedPrompts,
  acceptsMidTurnMessages,
  hasPendingPlanPermission,
  modelPickerOverride,
  modePickerOverride,
  onCycleMode,
  disabled = false,
}: AgentChatInputProps) {
  const eventTarget = useContext(EventTargetContext);
  const managedSkills = useManagedSkills();
  const scopeCwd = skillScope?.cwd;
  const scopeProjectDirectory = skillScope?.projectDirectory;
  const slashSkills = React.useMemo(
    () =>
      scopeCwd !== undefined && scopeProjectDirectory !== undefined
        ? filterSkillsForScope(managedSkills, scopeCwd, scopeProjectDirectory)
        : undefined,
    [managedSkills, scopeCwd, scopeProjectDirectory]
  );
  const chatInputRef = useRef<ChatInputHandle>(null);
  const preparationQueues = useRef(new WeakMap<AgentChatBackend, MessagePreparationQueue>());
  const activeChatInputId = useRef(chatInputId);
  activeChatInputId.current = chatInputId;

  const selectedTextContexts = useSelectedTextContexts();
  const { activeWebTabForMentions } = useActiveWebTabState();

  const previousChatInputIdRef = useRef(chatInputId);

  const {
    input: inputMessage,
    images: selectedImages,
    contextNotes,
    webTabs: draftWebTabs,
    includeActiveNote,
    includeActiveWebTab,
    queue: queuedMessages,
    setInput: setInputMessage,
    setContextNotes,
    setWebTabs,
    setSelectedImages,
    addImages,
    setIncludeActiveNote,
    setIncludeActiveWebTab,
    setLoading,
    setQueue: setQueuedMessages,
    resetCompose,
  } = draft;
  const activeModelEntry = modelPickerOverride?.models.find(
    (model) => getModelKeyFromModel(model) === modelPickerOverride.value
  );
  const unsupportedImageModelLabel =
    Array.isArray(activeModelEntry?.capabilities) && !modelSupportsVision(activeModelEntry)
      ? activeModelEntry.displayName || activeModelEntry.name
      : null;

  useEffect(() => {
    if (previousChatInputIdRef.current === chatInputId) return;
    previousChatInputIdRef.current = chatInputId;
    clearSelection();
  }, [chatInputId]);

  // Selected text remains ephemeral and is deliberately not restored.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/365
  const restoreToComposer = useCallback(
    (items: QueuedAgentMessage[], originalImages: File[] = []) => {
      // Merged into one draft, /compact would swallow the queued messages as compaction input.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/634
      const nonCompact = items.filter((item) => !isCompactCommand(item.text));
      const restored = combineQueuedMessages(nonCompact.length > 0 ? nonCompact : items);
      // A fixed copy of the current page would duplicate its Active Web Tab badge and outlive
      // that badge's removal. https://github.com/Brevilabs/obsidian-copilot-private/issues/667
      const currentInput = activeChatInputId.current === chatInputId ? chatInputRef.current : null;
      const activeUrl = currentInput ? activeWebTabForMentions?.url : undefined;
      const restoredWebTabs = restored.context?.webTabs ?? [];
      if (restoredWebTabs.some((tab) => tab.url === activeUrl)) setIncludeActiveWebTab(true);
      setWebTabs((previous) =>
        mergeWebTabContexts([
          ...restoredWebTabs.filter((tab) => tab.url !== activeUrl),
          ...previous,
        ])
      );
      if (currentInput) currentInput.prependContent(restored.text, []);
      else
        setInputMessage((previous) =>
          [restored.text, previous].filter((text) => text.trim()).join("\n\n")
        );
      // A fixed copy of the active note would duplicate its Active Note badge and outlive that
      // badge's removal. https://github.com/Brevilabs/obsidian-copilot-private/issues/670
      const activePath = currentInput ? app.workspace.getActiveFile()?.path : undefined;
      const restoredNotes = restored.context?.notes ?? [];
      if (restoredNotes.some((note) => note.path === activePath)) setIncludeActiveNote(true);
      const notes = restoredNotes.filter((note) => note.path !== activePath);
      if (notes.length > 0) {
        setContextNotes((previous) => dedupeBy([...notes, ...previous], (note) => note.path));
      }
      const images = [
        ...(restored.promptContent ?? [])
          .map(imageBlockToFile)
          .filter((file): file is File => file !== null),
        ...originalImages,
      ];
      if (images.length > 0) setSelectedImages((previous) => [...images, ...previous]);
    },
    [
      activeWebTabForMentions,
      app,
      chatInputId,
      setContextNotes,
      setInputMessage,
      setWebTabs,
      setIncludeActiveNote,
      setIncludeActiveWebTab,
      setSelectedImages,
    ]
  );

  const handleStopGenerating = useCallback(async () => {
    // Restore before cancellation can finish the turn and flush the queue.
    // Only runSend owns loading; a late cancel must not mark a newer turn idle.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/485
    setQueuedMessages([]);
    const preparation = preparationQueues.current.get(backend);
    const pending = preparation ? [...preparation.pending.entries()] : [];
    if (preparation) {
      preparation.cancelled = true;
      preparation.pending.clear();
      preparationQueues.current.delete(backend);
    }
    const waiting = [...queuedMessages, ...pending.map(([item]) => item)];
    if (waiting.length > 0)
      restoreToComposer(
        waiting,
        pending.flatMap(([, images]) => images)
      );
    try {
      await backend.cancel();
    } catch (e) {
      logError("[AgentMode] cancel failed", e);
    }
  }, [backend, queuedMessages, restoreToComposer, setQueuedMessages]);

  // A message withdrawn before the agent read it returns to the composer ahead of the draft. https://github.com/Brevilabs/obsidian-copilot-private/issues/747
  useEffect(() => {
    const withdrawn = backend.takeWithdrawnPrompts();
    if (withdrawn.length === 0) return;
    restoreToComposer(withdrawn.map((p) => ({ ...p, rawInput: p.text })));
  }, [backend, queuedPrompts, restoreToComposer]);

  const runSend = useCallback(
    async (item: QueuedAgentMessage) => {
      setLoading(true);
      let accepted = false;
      try {
        const { turn } = backend.sendMessage(item.text, item.context, item.promptContent);
        accepted = true;
        if (item.rawInput) updateUserMessageHistory(item.rawInput);
        await turn;
      } catch (error) {
        logError("Error sending agent message:", error);
        new Notice(t("Failed to send message. Please try again."));
        if (!accepted) restoreToComposer([item]);
      } finally {
        setLoading(false);
      }
    },
    [backend, restoreToComposer, setLoading, updateUserMessageHistory]
  );

  // The session shows the message once it reaches the agent, so the composer neither waits nor holds it. https://github.com/Brevilabs/obsidian-copilot-private/issues/509
  const sendMidTurn = useCallback(
    (item: QueuedAgentMessage) => {
      try {
        backend.sendMessage(item.text, item.context, item.promptContent);
        if (item.rawInput) updateUserMessageHistory(item.rawInput);
      } catch (error) {
        logError("Error sending agent message:", error);
        new Notice(t("Failed to send message. Please try again."));
        restoreToComposer([item]);
      }
    },
    [backend, restoreToComposer, updateUserMessageHistory]
  );

  const handleSendMessage = useCallback(
    async (webTabs?: WebTabContext[]) => {
      if (disabled) return;
      const text = inputMessage.trim();
      if (!text && selectedImages.length === 0) return;
      const rawInput = inputMessage;

      const activeFile = app.workspace.getActiveFile();

      const candidateNotes: TFile[] = [];
      if (includeActiveNote && activeFile) {
        candidateNotes.push(activeFile);
      }
      candidateNotes.push(...contextNotes);
      const notes = dedupeBy(candidateNotes, (n) => n.path);

      const noteSelection = selectedTextContexts.find(isNoteSelectedTextContext);
      const expanded = await expandCustomCommandPrefix(
        text,
        getCachedCustomCommands(),
        noteSelection?.content ?? "",
        activeFile
      );
      if (expanded.matched) {
        void CustomCommandManager.getInstance().recordUsage(expanded.matched);
      }
      const resolvedText = resolveActiveNoteToken(expanded.text, activeFile);

      const shouldIncludeActiveWebTab =
        includeActiveWebTab || resolvedText.includes(ACTIVE_WEB_TAB_MARKER);
      const resolvedWebTabs = buildWebTabsWithActiveSnapshot(
        app,
        webTabs ?? [],
        shouldIncludeActiveWebTab
      );

      // /compact drops attachments, so an image the model can't read must not block it.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/634
      const images = isCompactCommand(resolvedText) ? [] : selectedImages;
      if (images.length > 0 && unsupportedImageModelLabel) {
        new Notice(
          t("{p0} doesn't support images. Switch to a vision-capable model to send images.", {
            p0: unsupportedImageModelLabel,
          })
        );
        return;
      }

      resetCompose();
      clearSelection();

      const item: QueuedAgentMessage = {
        id: `queued-${uuidv4()}`,
        text: resolvedText,
        rawInput,
        context: buildMessageContext(notes, selectedTextContexts, resolvedWebTabs),
      };
      let preparation = preparationQueues.current.get(backend);
      if (!preparation) {
        preparation = { tail: Promise.resolve(), pending: new Map(), cancelled: false };
        preparationQueues.current.set(backend, preparation);
      }
      preparation.pending.set(item, images);
      const previousPreparation = preparation.tail;
      let finishPreparation!: () => void;
      preparation.tail = new Promise<void>((resolve) => {
        finishPreparation = resolve;
      });
      let turn: Promise<void> | undefined;
      try {
        await previousPreparation;
        if (preparation.cancelled) return;
        const content: PromptContent[] = [];
        for (const image of images) {
          const block = await fileToImageBlock(image);
          if (preparation.cancelled) return;
          if (block) content.push(block);
        }

        if (content.length !== images.length) {
          restoreToComposer([item], images);
          new Notice(t("Could not read the attached images. Please attach them again."));
          return;
        }
        item.promptContent = content.length > 0 ? content : undefined;
        preparation.pending.delete(item);

        const starting = backend.isStarting();
        if (starting || backend.isTurnInFlight() || backend.getQueuedPrompts().length > 0) {
          // Compaction waits until the agent finishes. https://github.com/Brevilabs/obsidian-copilot-private/issues/509
          if (!starting && acceptsMidTurnMessages && !isCompactCommand(item.text)) {
            sendMidTurn(item);
            return;
          }
          setQueuedMessages((q) => [...q, item]);
          return;
        }
        turn = runSend(item);
      } finally {
        preparation.pending.delete(item);
        finishPreparation();
      }
      await turn;
    },
    [
      app,
      backend,
      inputMessage,
      selectedImages,
      contextNotes,
      includeActiveNote,
      includeActiveWebTab,
      selectedTextContexts,
      acceptsMidTurnMessages,
      sendMidTurn,
      unsupportedImageModelLabel,
      disabled,
      resetCompose,
      restoreToComposer,
      runSend,
      setQueuedMessages,
    ]
  );

  useEffect(() => {
    // Held messages go after every message already handed to the agent. https://github.com/Brevilabs/obsidian-copilot-private/issues/509
    if (
      disabled ||
      loading ||
      isStarting ||
      queuedPrompts.length > 0 ||
      queuedMessages.length === 0
    ) {
      return;
    }
    const { batch, rest } = takeNextQueuedBatch(queuedMessages);
    const combined = combineQueuedMessages(batch);
    if (
      combined.promptContent?.some((content) => content.type === "image") &&
      unsupportedImageModelLabel
    ) {
      new Notice(
        t("{p0} doesn't support images. Switch to a vision-capable model to send images.", {
          p0: unsupportedImageModelLabel,
        })
      );
      return;
    }
    setQueuedMessages(rest);
    void runSend(combined);
  }, [
    disabled,
    loading,
    isStarting,
    queuedPrompts.length,
    queuedMessages,
    runSend,
    setQueuedMessages,
    unsupportedImageModelLabel,
  ]);

  useEffect(() => {
    const handleAbortStream = () => {
      void handleStopGenerating();
    };
    eventTarget?.addEventListener(EVENT_NAMES.ABORT_STREAM, handleAbortStream);
    return () => {
      eventTarget?.removeEventListener(EVENT_NAMES.ABORT_STREAM, handleAbortStream);
    };
  }, [eventTarget, handleStopGenerating]);

  return (
    <>
      <div
        className={
          hasPendingPlanPermission || disabled ? "tw-pointer-events-none tw-opacity-50" : undefined
        }
        aria-disabled={hasPendingPlanPermission || disabled || undefined}
      >
        <ChatInput
          ref={chatInputRef}
          key={chatInputId}
          slashSkills={slashSkills}
          placeholder={t("Ask anything • @ to add context • / for commands")}
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          handleSendMessage={safeAsyncHandler((meta) => handleSendMessage(meta?.webTabs))}
          isGenerating={isReplyRunning}
          onStopGenerating={safeAsyncHandler(handleStopGenerating)}
          onEscape={isReplyRunning ? safeAsyncHandler(handleStopGenerating) : undefined}
          onShiftTab={modePickerOverride ? onCycleMode : undefined}
          app={app}
          contextNotes={contextNotes}
          setContextNotes={setContextNotes}
          contextWebTabs={draftWebTabs}
          setContextWebTabs={setWebTabs}
          includeActiveNote={includeActiveNote}
          setIncludeActiveNote={setIncludeActiveNote}
          includeActiveWebTab={includeActiveWebTab}
          setIncludeActiveWebTab={setIncludeActiveWebTab}
          activeWebTab={activeWebTabForMentions}
          selectedImages={selectedImages}
          onAddImage={addImages}
          setSelectedImages={setSelectedImages}
          disableModelSwitch={!modelPickerOverride}
          modelPickerOverride={modelPickerOverride ?? undefined}
          modePickerOverride={modePickerOverride ?? undefined}
          selectedTextContexts={selectedTextContexts}
          onRemoveSelectedText={dismissSelection}
        />
      </div>
    </>
  );
});
