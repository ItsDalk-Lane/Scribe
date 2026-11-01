import type { Meta, StoryObj } from "@/lib/story";
import { Cog, Cpu, Sparkle } from "lucide-react";
import * as React from "react";
import { TabContent, TabItem, type TabVariant } from "./setting-tabs";

const TABS = [
  { id: "basic", label: "Basic", icon: <Cog className="tw-size-5" /> },
  { id: "models", label: "Models", icon: <Cpu className="tw-size-5" /> },
  { id: "skills", label: "Skills", icon: <Sparkle className="tw-size-5" /> },
];

type TabItemProps = React.ComponentProps<typeof TabItem>;

const Strip: React.FC<{ variant: TabVariant; labels?: string[] }> = ({ variant, labels }) => {
  const tabs = labels ? labels.map((label, i) => ({ id: `t${i}`, label, icon: null })) : TABS;
  const [selected, setSelected] = React.useState(tabs[0].id);
  return (
    <div className="tw-group/settings tw-flex tw-flex-col">
      <div
        className="tw-flex tw-flex-wrap tw-gap-0.5 tw-border-0 tw-border-b tw-border-solid tw-border-border"
        role="tablist"
      >
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isSelected={selected === tab.id}
            onClick={() => setSelected(tab.id)}
            variant={variant}
          />
        ))}
      </div>
      <TabContent id={selected} isSelected variant={variant}>
        <div className="tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-4 tw-text-sm">
          Panel for {selected}
        </div>
      </TabContent>
    </div>
  );
};

const meta = {
  title: "UI/Setting Tabs",
  component: TabItem,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<TabItemProps>;
export default meta;

export const PageVariant: StoryObj<TabItemProps> = {
  render: () => <Strip variant="page" />,
};

export const InlineVariant: StoryObj<TabItemProps> = {
  render: () => <Strip variant="inline" />,
};

export const WarningDot: StoryObj<TabItemProps> = {
  render: () => (
    <div className="tw-flex tw-gap-2">
      <TabItem
        tab={{
          id: "skills-idle",
          label: "Skills",
          icon: <Sparkle className="tw-size-5" />,
          warningLabel: "Some skills failed to load",
        }}
        isSelected={false}
        onClick={() => undefined}
      />
      <TabItem
        tab={{
          id: "skills-selected",
          label: "Skills",
          icon: <Sparkle className="tw-size-5" />,
          warningLabel: "Some skills failed to load",
        }}
        isSelected
        onClick={() => undefined}
      />
    </div>
  ),
};

export const LongLabels: StoryObj<TabItemProps> = {
  render: () => (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <Strip variant="page" labels={["OpenCode", "Claude", "Codex", "Quick tools"]} />
      <Strip variant="inline" labels={["OpenCode", "Claude", "Codex", "Quick tools"]} />
    </div>
  ),
};

export const TextOnlySettings: StoryObj<TabItemProps> = {
  render: () => (
    <Strip
      variant="page"
      labels={["通用", "模型", "代理", "插件", "技能", "命令", "钩子", "MCP", "子Agent"]}
    />
  ),
};
