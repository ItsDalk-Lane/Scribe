import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection } from "lexical";

import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { TypeaheadMenuPortal } from "@/components/chat-components/TypeaheadMenuPortal";
import { TypeaheadOption } from "@/components/chat-components/TypeaheadMenuContent";
import {
  useTypeaheadPlugin,
  TypeaheadState,
} from "@/components/chat-components/hooks/useTypeaheadPlugin";
import { $applyLeadingCommandChip } from "@/components/chat-components/pills/CommandPillNode";
import { $replaceTriggeredTextWithPill } from "@/components/chat-components/utils/lexicalTextUtils";
import { VALUE_SYNC_TAG } from "@/components/chat-components/plugins/ValueSyncPlugin";
import type { BackendId, Skill } from "@/agentMode";

import {
  $slashStartsPrompt,
  composeSlashMenuItems,
  filterSlashMenuOptions,
  type SlashMenuItem,
} from "./slashMenuItems";

interface SlashCommandOption extends TypeaheadOption {
  item: SlashMenuItem;
}

interface AgentSlashData {
  enabled: boolean;
  skills: Skill[];
  backendIds: ReadonlySet<BackendId> | null;
}

const EMPTY_SKILLS = Object.freeze([]) as unknown as Skill[];
const EMPTY_AGENT_SLASH_DATA: AgentSlashData = Object.freeze({
  enabled: false,
  skills: EMPTY_SKILLS,
  backendIds: null,
});

function useAgentSlashData(): AgentSlashData {
  const [data, setData] = useState<AgentSlashData>(EMPTY_AGENT_SLASH_DATA);

  useEffect(() => {
    if (!isDesktopRuntime()) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    async function loadAgentSlashData(): Promise<void> {
      const { getManagedSkills, SkillManager, listBackendDescriptors } =
        await import("@/agentMode");

      const update = () => {
        if (cancelled) return;
        setData({
          enabled: true,
          skills: getManagedSkills(),
          backendIds: new Set(listBackendDescriptors().map((descriptor) => descriptor.id)),
        });
      };

      update();

      if (SkillManager.hasInstance()) {
        unsubscribe = SkillManager.getInstance().subscribeToSkillSetChange(update);
      }
    }

    void loadAgentSlashData().catch((error) => {
      if (!cancelled) {
        logError("Failed to load Agent Mode slash commands.", error);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return data;
}

function useActiveSlashBackend(
  agentModeEnabled: boolean,
  backendIds: ReadonlySet<BackendId> | null
): BackendId | null {
  const settings = useSettingsValue();
  if (!agentModeEnabled) return null;
  const activeBackend = settings.agentMode?.activeBackend;
  if (typeof activeBackend !== "string" || activeBackend.length === 0) return null;
  if (!backendIds?.has(activeBackend)) return null;
  return activeBackend;
}

interface SlashCommandPluginProps {
  skills?: readonly Skill[];
}

export function SlashCommandPlugin({ skills }: SlashCommandPluginProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const agentSlashData = useAgentSlashData();
  const activeBackend = useActiveSlashBackend(agentSlashData.enabled, agentSlashData.backendIds);
  const [currentQuery, setCurrentQuery] = useState("");
  const [slashStartsPrompt, setSlashStartsPrompt] = useState(false);

  const allOptions = useMemo<SlashCommandOption[]>(() => {
    const items = composeSlashMenuItems(
      skills ?? agentSlashData.skills,
      activeBackend,
      slashStartsPrompt
    );
    return items.map((item) => ({
      key: item.key,
      title: item.name,
      subtitle: item.description || undefined,
      content: item.body,
      item,
    }));
  }, [skills, agentSlashData.skills, activeBackend, slashStartsPrompt]);

  const filteredOptions = useMemo(
    () => filterSlashMenuOptions(allOptions, currentQuery),
    [allOptions, currentQuery]
  );

  const insertCommandChip = useCallback(
    (item: SlashMenuItem) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        $replaceTriggeredTextWithPill("/", {
          type: "command",
          title: item.name,
          data: item.kind,
        });
      });
    },
    [editor]
  );

  const handleSelect = useCallback(
    (option: SlashCommandOption) => {
      insertCommandChip(option.item);
    },
    [insertCommandChip]
  );

  const commandKinds = useMemo(() => {
    const kinds = new Map<string, string>();
    for (const item of composeSlashMenuItems(
      skills ?? agentSlashData.skills,
      activeBackend,
      true
    )) {
      kinds.set(item.name, item.kind);
    }
    return kinds;
  }, [skills, agentSlashData.skills, activeBackend]);

  useEffect(() => {
    // Chips form only for seeded drafts: on value sync, and once when the command table arrives
    // after the mount sync already fired. Hand-typed text is never chipped while typing.
    // https://github.com/ItsDalk-Lane/Scribe/issues/35
    const applyToCurrent = () =>
      editor.update(() => {
        $applyLeadingCommandChip(commandKinds);
      });
    applyToCurrent();
    return editor.registerUpdateListener(({ tags }) => {
      if (!tags.has(VALUE_SYNC_TAG)) return;
      applyToCurrent();
    });
  }, [editor, commandKinds]);

  const { state, handleHighlight } = useTypeaheadPlugin({
    triggerConfig: {
      char: "/",
      allowWhitespace: false,
    },
    options: filteredOptions,
    onSelect: handleSelect,
    onStateChange: (newState: TypeaheadState) => {
      setCurrentQuery(newState.query);
      if (newState.isOpen) setSlashStartsPrompt(editor.getEditorState().read($slashStartsPrompt));
    },
  });

  if (!state.isOpen) return <></>;

  return (
    <TypeaheadMenuPortal
      options={filteredOptions}
      selectedIndex={state.selectedIndex}
      onSelect={handleSelect}
      onHighlight={handleHighlight}
      range={state.range}
      query={state.query}
      showPreview={true}
    />
  );
}
