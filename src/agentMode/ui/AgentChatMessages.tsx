import { t } from "@/lib/i18n";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { AskUserQuestionCard } from "@/agentMode/ui/AskUserQuestionCard";
import { PlanProposalCard } from "@/agentMode/ui/PlanProposalCard";
import { ToolPermissionCard } from "@/agentMode/ui/ToolPermissionCard";
import { useAgentTasks } from "@/agentMode/ui/AgentTasksContext";
import { permissionRequesterName } from "@/agentMode/ui/taskDisplay";
import { openTurnDiff } from "@/agentMode/ui/TurnDiffView";
import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { ChatTranscriptViewport } from "@/components/chat-components/ui/ChatTranscriptViewport";
import { USER_SENDER } from "@/constants";
import { Button } from "@/components/ui/button";
import { useChatScrolling } from "@/hooks/useChatScrolling";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  AskUserQuestionPrompt,
  CurrentPlan,
  PermissionPrompt,
} from "@/agentMode/session/types";
import type { ChatMessage } from "@/types/message";
import { logError } from "@/logger";
import { App, Notice, Plugin } from "obsidian";
import React, { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

interface AgentChatMessagesProps {
  messages: AgentChatMessage[];
  plugin: Pick<Plugin, "app" | "manifest">;
  sourcePath?: string;
  currentPlan: CurrentPlan | null;
  pendingToolPermissions: PermissionPrompt[];
  pendingAskUserQuestions: AskUserQuestionPrompt[];
  chatBackend: AgentChatBackend;
  isLoading: boolean;
  onForkMessage?: (messageId: string) => Promise<void>;
}

function toChatMessageView(m: AgentChatMessage): ChatMessage {
  return {
    id: m.id,
    sender: m.sender,
    message: m.message,
    timestamp: m.timestamp,
    isVisible: m.isVisible,
    isErrorMessage: m.isErrorMessage,
    content: m.content,
    context: m.context,
  };
}

function messageFailureText(message: AgentChatMessage): string | undefined {
  if (!message.isErrorMessage) return undefined;
  if (typeof message.errorText === "string") return message.errorText;
  const body = (message.parts ?? [])
    .flatMap((part) => (part.kind === "text" ? [part.text] : []))
    .join("");
  const prefix = `${body}\n\n`;
  return body && message.message.startsWith(prefix)
    ? message.message.slice(prefix.length)
    : message.message;
}

function findToolCallTitle(messages: AgentChatMessage[], toolCallId: string): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const part = messages[i].parts?.find((p) => p.kind === "tool_call" && p.id === toolCallId);
    if (part?.kind === "tool_call") return part.title;
  }
  return undefined;
}

function lastAssistant(visible: AgentChatMessage[]): AgentChatMessage | undefined {
  for (let i = visible.length - 1; i >= 0; i--) {
    if (visible[i].sender !== USER_SENDER) return visible[i];
  }
  return undefined;
}

interface AgentMessageRowProps {
  message: AgentChatMessage;
  app: App;
  sourcePath: string;
  isLatestAssistant: boolean;
  isStreaming: boolean;
  onForkMessage?: (messageId: string) => void;
  forkDisabled?: boolean;
}

const AgentMessageRow = memo(function AgentMessageRow({
  message,
  app,
  sourcePath,
  isLatestAssistant,
  isStreaming,
  onForkMessage,
  forkDisabled,
}: AgentMessageRowProps) {
  const adaptedMessage = toChatMessageView(message);
  const isAssistant = message.sender !== USER_SENDER;
  const hasParts = (message.parts?.length ?? 0) > 0;
  const renderTrail = isAssistant && hasParts;
  const completedTurnDurationMs = message.turnDurationMs;
  const runningTurnStartedAtMs =
    isLatestAssistant && isStreaming ? message.timestamp?.epoch : undefined;
  const completedTurnDuration =
    completedTurnDurationMs !== undefined ? (
      <AgentTurnDurationIndicator status="complete" durationMs={completedTurnDurationMs} inline />
    ) : null;
  const runningTurnDuration =
    runningTurnStartedAtMs !== undefined ? (
      <AgentTurnDurationIndicator status="running" startedAtMs={runningTurnStartedAtMs} />
    ) : null;
  const onFork =
    isAssistant && !isStreaming && onForkMessage ? () => onForkMessage(message.id) : undefined;
  const isStreamingPlaceholder = isAssistant && isStreaming && !hasParts && !message.message;

  return (
    <div className="tw-w-full">
      {isStreamingPlaceholder ? (
        <div className="tw-px-3 tw-pt-2">{runningTurnDuration}</div>
      ) : renderTrail ? (
        <div className="tw-px-3 tw-pt-2">
          <AgentTrail
            parts={message.parts!}
            onFork={onFork}
            forkDisabled={forkDisabled}
            isStreaming={isStreaming}
            turnStartedAtMs={runningTurnStartedAtMs}
            turnDurationMs={completedTurnDurationMs}
            timestamp={message.timestamp?.display}
            app={app}
            turnStopReason={message.turnStopReason}
            errorText={messageFailureText(message)}
            fileChanges={message.fileChanges}
            onOpenFileChange={(change) =>
              void openTurnDiff(app, change, message.id).catch((error: unknown) =>
                logError("[AgentChatMessages] failed to open the turn diff", error)
              )
            }
          />
        </div>
      ) : (
        <>
          {isAssistant && completedTurnDuration ? (
            <div className="tw-px-3 tw-pt-2">{completedTurnDuration}</div>
          ) : null}
          <ChatSingleMessage
            sourcePath={sourcePath}
            message={adaptedMessage}
            app={app}
            isStreaming={false}
            onFork={onFork}
            forkDisabled={forkDisabled}
          />
          {runningTurnDuration ? <div className="tw-px-3">{runningTurnDuration}</div> : null}
        </>
      )}
    </div>
  );
});

const AgentChatMessages = memo(
  ({
    messages,
    plugin,
    sourcePath = "",
    currentPlan,
    pendingToolPermissions,
    pendingAskUserQuestions,
    chatBackend,
    isLoading,
    onForkMessage,
  }: AgentChatMessagesProps) => {
    const { app } = plugin;
    const forkingRef = useRef(false);
    const [forkDisabled, setForkDisabled] = useState(false);
    const forkMessage = useCallback(
      (messageId: string) => {
        if (!onForkMessage || forkingRef.current) return;
        forkingRef.current = true;
        setForkDisabled(true);
        void onForkMessage(messageId)
          .catch((error: unknown) => {
            logError("[AgentChatMessages] failed to fork conversation", error);
            new Notice(t("Failed to fork conversation. Please try again."));
          })
          .finally(() => {
            forkingRef.current = false;
            setForkDisabled(false);
          });
      },
      [onForkMessage]
    );

    const allVisible = useMemo(() => messages.filter((m) => m.isVisible), [messages]);
    const [paging, setPaging] = useState({ backend: chatBackend, rounds: 30 });
    const roundLimit = paging.backend === chatBackend ? paging.rounds : 30;
    const start = useMemo(() => {
      const turns = allVisible.flatMap((message, index) =>
        message.sender === USER_SENDER ? [index] : []
      );
      return turns.length > roundLimit ? turns[turns.length - roundLimit] : 0;
    }, [allVisible, roundLimit]);
    const visible = useMemo(() => allVisible.slice(start), [allVisible, start]);
    const adapted = useMemo(() => allVisible.map(toChatMessageView), [allVisible]);
    const scrollNode = useRef<HTMLDivElement | null>(null);
    const scrollAnchor = useRef<{ height: number; top: number } | null>(null);
    const {
      scrollContainerCallbackRef,
      contentCallbackRef,
      onScroll,
      isScrollPaused,
      scrollToEnd,
    } = useChatScrolling({ chatHistory: adapted });
    const attachScrollNode = useCallback(
      (node: HTMLDivElement | null) => {
        scrollNode.current = node;
        scrollContainerCallbackRef(node);
      },
      [scrollContainerCallbackRef]
    );
    const loadEarlier = useCallback(() => {
      const node = scrollNode.current;
      if (node) scrollAnchor.current = { height: node.scrollHeight, top: node.scrollTop };
      setPaging({ backend: chatBackend, rounds: roundLimit + 30 });
    }, [chatBackend, roundLimit]);
    useLayoutEffect(() => {
      const anchor = scrollAnchor.current;
      const node = scrollNode.current;
      if (!anchor || !node) return;
      node.scrollTop = anchor.top + node.scrollHeight - anchor.height;
      scrollAnchor.current = null;
    }, [visible]);

    const showPlanCard = currentPlan != null && currentPlan.decision === "pending";
    const inlinePlanCard = showPlanCard ? (
      <PlanProposalCard plan={currentPlan} app={app} chatBackend={chatBackend} />
    ) : null;
    const pendingQuestion = pendingAskUserQuestions[0];
    const pendingPermission = pendingQuestion ? undefined : pendingToolPermissions[0];
    const pendingToolName = useMemo(
      () =>
        pendingPermission
          ? findToolCallTitle(messages, pendingPermission.toolCall.toolCallId)
          : undefined,
      [messages, pendingPermission]
    );
    const tasks = useAgentTasks();
    const pendingRequester =
      pendingPermission && tasks
        ? permissionRequesterName(pendingPermission, tasks.tasks)
        : undefined;
    const pendingActionId = pendingQuestion
      ? `question:${pendingQuestion.requestId}`
      : pendingPermission
        ? `permission:${pendingPermission.toolCall.toolCallId}`
        : null;

    const latestAssistant = useMemo(() => lastAssistant(visible), [visible]);
    const streamingMessageId =
      isLoading && !latestAssistant?.turnStopReason ? latestAssistant?.id : undefined;

    return (
      <div className="tw-flex tw-h-full tw-flex-1 tw-flex-col tw-overflow-hidden">
        <ChatTranscriptViewport
          scrollContainerRef={attachScrollNode}
          contentRef={contentCallbackRef}
          onScroll={onScroll}
          isScrollPaused={isScrollPaused}
          scrollToEnd={scrollToEnd}
        >
          {start > 0 ? (
            <div className="tw-flex tw-justify-center tw-py-2">
              <Button type="button" variant="ghost" onClick={loadEarlier}>
                {t("Load 30 earlier turns")}
              </Button>
            </div>
          ) : null}
          {visible.map((message) => {
            return (
              <AgentMessageRow
                key={message.seq ?? message.id}
                message={message}
                onForkMessage={onForkMessage ? forkMessage : undefined}
                forkDisabled={forkDisabled}
                app={app}
                sourcePath={sourcePath}
                isLatestAssistant={
                  message.sender !== USER_SENDER && message.id === latestAssistant?.id
                }
                isStreaming={message.id === streamingMessageId}
              />
            );
          })}
          {inlinePlanCard}
        </ChatTranscriptViewport>
        {pendingActionId ? (
          <div
            role="region"
            aria-label={t("Pending agent actions")}
            data-testid="agent-action-rail"
            className="tw-max-h-full tw-w-full tw-overflow-y-auto tw-bg-primary"
          >
            <div key={pendingActionId} data-action-id={pendingActionId}>
              {pendingQuestion ? (
                <AskUserQuestionCard
                  request={pendingQuestion}
                  onResolve={chatBackend.resolveAskUserQuestion.bind(chatBackend)}
                />
              ) : pendingPermission ? (
                <ToolPermissionCard
                  request={pendingPermission}
                  toolName={pendingToolName}
                  requester={pendingRequester}
                  onResolve={chatBackend.resolveToolPermission.bind(chatBackend)}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  }
);

AgentChatMessages.displayName = "AgentChatMessages";

export default AgentChatMessages;
