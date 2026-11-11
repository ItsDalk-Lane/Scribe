import React from "react";
import {
  $getRoot,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  TextNode,
} from "lexical";
import { BasePillNode, getEditorDocument, SerializedBasePillNode } from "./BasePillNode";
import { Badge } from "@/components/ui/badge";
import { Bot, Sparkles, Terminal } from "lucide-react";

export type CommandChipKind = "builtin" | "skill" | "subagent";

const COMMAND_CHIP_ICONS: Record<CommandChipKind, React.ComponentType<{ className?: string }>> = {
  builtin: Terminal,
  skill: Sparkles,
  subagent: Bot,
};

export function getCommandChipIcon(kind: string): React.ComponentType<{ className?: string }> {
  return COMMAND_CHIP_ICONS[kind as CommandChipKind] ?? Terminal;
}

export interface CommandBadgeProps {
  name: string;
  kind: string;
}

export function CommandBadge({ name, kind }: CommandBadgeProps) {
  const Icon = getCommandChipIcon(kind);
  return (
    <Badge className="tw-mx-0.5 tw-inline-flex tw-items-center tw-gap-1 tw-border-none tw-bg-interactive-accent-hsl/15 tw-px-2 tw-py-0 tw-align-middle tw-font-medium tw-text-accent">
      <Icon className="tw-size-3" aria-hidden="true" />
      {name}
    </Badge>
  );
}

export interface SerializedCommandPillNode extends SerializedBasePillNode {
  commandName: string;
  commandKind: string;
}

export class CommandPillNode extends BasePillNode {
  __commandName: string;
  __commandKind: string;

  static getType(): string {
    return "command-pill";
  }

  static clone(node: CommandPillNode): CommandPillNode {
    return new CommandPillNode(node.__commandName, node.__commandKind, node.__key);
  }

  constructor(commandName: string, commandKind: string, key?: NodeKey) {
    super(`/${commandName}`, key);
    this.__commandName = commandName;
    this.__commandKind = commandKind;
  }

  getClassName(): string {
    return "command-pill-wrapper";
  }

  getDataAttribute(): string {
    return "data-lexical-command-pill";
  }

  getCommandName(): string {
    return this.__commandName;
  }

  getCommandKind(): string {
    return this.__commandKind;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (node: HTMLElement) => {
        if (node.hasAttribute("data-lexical-command-pill")) {
          return {
            conversion: convertCommandPillElement,
            priority: 1,
          };
        }
        return null;
      },
    };
  }

  static importJSON(serializedNode: SerializedCommandPillNode): CommandPillNode {
    return $createCommandPillNode(serializedNode.commandName, serializedNode.commandKind);
  }

  exportJSON(): SerializedCommandPillNode {
    return {
      ...super.exportJSON(),
      commandName: this.__commandName,
      commandKind: this.__commandKind,
      type: "command-pill",
      version: 1,
    };
  }

  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const element = getEditorDocument(editor).win.createSpan({
      text: this.__value,
      attr: {
        [this.getDataAttribute()]: "",
        "data-pill-value": this.__value,
        "data-command-name": this.__commandName,
        "data-command-kind": this.__commandKind,
      },
    });
    return { element };
  }

  decorate(): JSX.Element {
    return <CommandBadge name={this.__commandName} kind={this.__commandKind} />;
  }
}

function convertCommandPillElement(domNode: HTMLElement): DOMConversionOutput | null {
  const commandName = domNode.getAttribute("data-command-name");
  const commandKind = domNode.getAttribute("data-command-kind");
  if (commandName && commandKind) {
    return { node: $createCommandPillNode(commandName, commandKind) };
  }
  return null;
}

export function $createCommandPillNode(commandName: string, commandKind: string): CommandPillNode {
  return new CommandPillNode(commandName, commandKind);
}

export function $isCommandPillNode(node: LexicalNode | null | undefined): node is CommandPillNode {
  return node instanceof CommandPillNode;
}

export function $applyLeadingCommandChip(kinds: ReadonlyMap<string, string>): boolean {
  const root = $getRoot();
  const first = root.getFirstDescendant();
  if ($isCommandPillNode(first) || !(first instanceof TextNode)) return false;
  const text = first.getTextContent();
  const match = text.match(/^\/([^\s/]+)(?=\s|$)/);
  if (!match) return false;
  const kind = kinds.get(match[1]);
  if (kind === undefined) return false;
  const rest = text.slice(match[0].length);
  first.insertBefore($createCommandPillNode(match[1], kind));
  if (rest) first.setTextContent(rest);
  else first.remove();
  return true;
}
