import { ModelEnableList, type ModelEnableGroup } from "@/components/ui/ModelEnableList";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

type ModelEnableListProps = React.ComponentProps<typeof ModelEnableList>;

const LONG_GROUP: ModelEnableGroup = {
  key: "byok",
  label: "OpenAI",
  badge: "BYOK",
  rows: Array.from({ length: 18 }, (_, i) => ({
    id: `openai/model-${i}`,
    label: `gpt-nova-${i}`,
    enabled: i < 3,
  })),
};

const FREE_GROUP: ModelEnableGroup = {
  key: "agent",
  label: "OpenCode",
  badge: "Agent Provided",
  rows: [{ id: "opencode/grok-code", label: "grok-code-fast-1", enabled: true, isFree: true }],
};

const Controlled: React.FC<{ groups: ModelEnableGroup[]; defaultOpenGroupKey?: string }> = ({
  groups,
  defaultOpenGroupKey,
}) => {
  const [query, setQuery] = React.useState("");
  return (
    <ModelEnableList
      groups={groups}
      query={query}
      onQueryChange={setQuery}
      onToggle={() => undefined}
      defaultOpenGroupKey={defaultOpenGroupKey}
    />
  );
};

const meta = {
  title: "Agent Mode/Model Enable List",
  component: ModelEnableList,
  args: {
    groups: [],
    query: "",
    onQueryChange: () => undefined,
    onToggle: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ModelEnableListProps>;
export default meta;

export const OverflowingCatalog: StoryObj<ModelEnableListProps> = {
  render: () => <Controlled groups={[LONG_GROUP, FREE_GROUP]} />,
};

export const ShortCatalog: StoryObj<ModelEnableListProps> = {
  render: () => (
    <Controlled groups={[{ ...LONG_GROUP, rows: LONG_GROUP.rows.slice(0, 3) }, FREE_GROUP]} />
  ),
};

export const CollapsedWithSelections: StoryObj<ModelEnableListProps> = {
  render: () => (
    <Controlled
      groups={[
        FREE_GROUP,
        LONG_GROUP,
        {
          ...LONG_GROUP,
          key: "none",
          label: "Groq",
          rows: LONG_GROUP.rows.map((row) => ({ ...row, enabled: false })),
        },
      ]}
      defaultOpenGroupKey={LONG_GROUP.key}
    />
  ),
};

export const Empty: StoryObj<ModelEnableListProps> = {
  render: () => <Controlled groups={[]} />,
};
