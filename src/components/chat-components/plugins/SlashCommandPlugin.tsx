import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection } from "lexical";

import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { TypeaheadMenuPortal } from "@/components/chat-components/TypeaheadMenuPortal";
import {
  SlashSourceBadge,
  TypeaheadOption,
} from "@/components/chat-components/TypeaheadMenuContent";
import {
  useTypeaheadPlugin,
  TypeaheadState,
} from "@/components/chat-components/hooks/useTypeaheadPlugin";
import { $applyLeadingCommandChip } from "@/components/chat-components/pills/CommandPillNode";
import {
  $replaceTriggeredTextWithPill,
  $replaceTriggeredTextWithText,
} from "@/components/chat-components/utils/lexicalTextUtils";
import { VALUE_SYNC_TAG } from "@/components/chat-components/plugins/ValueSyncPlugin";
import { subagentCommandToken } from "@/commands/subagentCommand";
import type { SubagentDefinition } from "@/agentMode/subagents/SubagentManager";
import type { AgentCommandDefinition, BackendId, Skill } from "@/agentMode";

import {
  $slashStartsPrompt,
  composeSlashMenuItems,
  filterSlashMenuOptions,
  slashMenuItemGroup,
  slashMenuItemSourceLabel,
  type SlashMenuItem,
} from "./slashMenuItems";

interface SlashCommandOption extends TypeaheadOption {
  item: SlashMenuItem;
}

interface AgentSlashData {
  enabled: boolean;
  skills: Skill[];
  agentCommands: readonly AgentCommandDefinition[];
  subagents: readonly SubagentDefinition[];
  backendIds: ReadonlySet<BackendId> | null;
}

const EMPTY_SKILLS = Object.freeze([]) as unknown as Skill[];
const EMPTY_AGENT_COMMANDS = Object.freeze([]) as readonly AgentCommandDefinition[];
const EMPTY_SUBAGENTS = Object.freeze([]) as readonly SubagentDefinition[];
const EMPTY_AGENT_SLASH_DATA: AgentSlashData = Object.freeze({
  enabled: false,
  skills: EMPTY_SKILLS,
  agentCommands: EMPTY_AGENT_COMMANDS,
  subagents: EMPTY_SUBAGENTS,
  backendIds: null,
});

function useAgentSlashData(): AgentSlashData {
  const [data, setData] = useState<AgentSlashData>(EMPTY_AGENT_SLASH_DATA);

  useEffect(() => {
    if (!isDesktopRuntime()) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeCommands: (() => void) | undefined;
    let unsubscribeSubagents: (() => void) | undefined;

    async function loadAgentSlashData(): Promise<void> {
      const [
        {
          getManagedSkills,
          SkillManager,
          listBackendDescriptors,
          getAgentCommands,
          subscribeAgentCommands,
        },
        { getSubagents, subscribeSubagents },
      ] = await Promise.all([
        import("@/agentMode"),
        import("@/agentMode/subagents/SubagentManager"),
      ]);

      const update = () => {
        if (cancelled) return;
        setData({
          enabled: true,
          skills: getManagedSkills(),
          agentCommands: getAgentCommands(),
          subagents: getSubagents(),
          backendIds: new Set(listBackendDescriptors().map((descriptor) => descriptor.id)),
        });
      };

      update();

      if (SkillManager.hasInstance()) {
        unsubscribe = SkillManager.getInstance().subscribeToSkillSetChange(update);
      }
      unsubscribeCommands = subscribeAgentCommands(update);
      unsubscribeSubagents = subscribeSubagents(update);
    }

    void loadAgentSlashData().catch((error) => {
      if (!cancelled) {
        logError("Failed to load Agent Mode slash commands.", error);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
      unsubscribeCommands?.();
      unsubscribeSubagents?.();
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
  const settings = useSettingsValue();
  const disabledBuiltinCommands = settings.agentMode?.disabledBuiltinCommands;
  const [currentQuery, setCurrentQuery] = useState("");
  const [slashStartsPrompt, setSlashStartsPrompt] = useState(false);

  const allOptions = useMemo<SlashCommandOption[]>(() => {
    const items = composeSlashMenuItems(
      skills ?? agentSlashData.skills,
      activeBackend,
      slashStartsPrompt,
      {
        agentCommands: agentSlashData.agentCommands,
        disabledBuiltinCommands,
        subagents: agentSlashData.subagents,
      }
    );
    return items.map((item) => ({
      key: item.key,
      title: item.name,
      subtitle: item.description || undefined,
      content: item.body,
      group: slashMenuItemGroup(item),
      trailingContent: <SlashSourceBadge label={slashMenuItemSourceLabel(item)} />,
      item,
    }));
  }, [
    skills,
    agentSlashData.skills,
    agentSlashData.agentCommands,
    agentSlashData.subagents,
    activeBackend,
    slashStartsPrompt,
    disabledBuiltinCommands,
  ]);

  const filteredOptions = useMemo(
    () => filterSlashMenuOptions(allOptions, currentQuery),
    [allOptions, currentQuery]
  );

  const insertCommandChip = useCallback(
    (item: SlashMenuItem, chipTitle?: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        $replaceTriggeredTextWithPill("/", {
          type: "command",
          title: chipTitle ?? item.name,
          data: item.kind,
        });
      });
    },
    [editor]
  );

  const handleSelect = useCallback(
    (option: SlashCommandOption) => {
      if (option.item.kind === "agentCommand") {
        // 自定义 Agent 命令把内容以可编辑文字填入输入框，而不是留下一枚命令芯片。https://github.com/ItsDalk-Lane/Scribe/issues/53
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          $replaceTriggeredTextWithText("/", option.item.body);
        });
        return;
      }
      // 子代理芯片的命令词必须是发送侧可识别的单个 token，显示名含空白时回退到 id。https://github.com/ItsDalk-Lane/Scribe/issues/54
      if (option.item.kind === "subagent") {
        insertCommandChip(option.item, subagentCommandToken(option.item.subagent));
        return;
      }
      insertCommandChip(option.item);
    },
    [editor, insertCommandChip]
  );

  const commandKinds = useMemo(() => {
    const kinds = new Map<string, string>();
    for (const item of composeSlashMenuItems(skills ?? agentSlashData.skills, activeBackend, true, {
      agentCommands: agentSlashData.agentCommands,
      disabledBuiltinCommands,
      subagents: agentSlashData.subagents,
    })) {
      if (item.kind === "agentCommand") continue;
      // 子代理命令词与芯片一致用 token，种子草稿才能被还原成同一种芯片。https://github.com/ItsDalk-Lane/Scribe/issues/54
      kinds.set(
        item.kind === "subagent" ? subagentCommandToken(item.subagent) : item.name,
        item.kind
      );
    }
    return kinds;
  }, [
    skills,
    agentSlashData.skills,
    agentSlashData.agentCommands,
    agentSlashData.subagents,
    activeBackend,
    disabledBuiltinCommands,
  ]);

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
