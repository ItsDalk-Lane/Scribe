import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import type { Meta, StoryObj } from "@/lib/story";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import React, { useState } from "react";

const meta = {
  title: "Settings/Appearance",
  component: SettingSection,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<React.ComponentProps<typeof SettingSection>>;
export default meta;

const Controls = ({ disabled = false }: { disabled?: boolean }) => {
  const [enabled, setEnabled] = useState(true);
  return (
    <div className="tw-group/settings tw-space-y-5">
      <SettingSection label="常规">
        <SettingItem
          type="switch"
          title="显示聊天入口"
          description="在侧栏显示聊天入口，随时开始新的对话。"
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={disabled}
        />
        <SettingItem
          type="select"
          title="界面语言"
          value="zh"
          options={[{ label: "简体中文", value: "zh" }]}
          disabled={disabled}
        />
        <SettingItem type="text" title="聊天保存位置" value="Scribe/聊天记录" disabled={disabled} />
        <SettingItem
          type="textarea"
          title="自定义说明"
          description="这是较长的说明，用于确认窄窗口中标题、说明和输入框依然清晰，并保留原有排列方式。"
          value="请使用简体中文，回答简洁清楚。"
          disabled={disabled}
        />
        <SettingItem type="custom" title="包含当前笔记">
          <Checkbox
            aria-label="包含当前笔记"
            checked={enabled}
            disabled={disabled}
            onCheckedChange={(value) => setEnabled(value === true)}
          />
        </SettingItem>
      </SettingSection>
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
        <Button variant="secondary" disabled={disabled}>
          普通操作
        </Button>
        <Button variant="ghost" size="icon" aria-label="刷新" disabled={disabled}>
          <RefreshCw className="tw-size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="编辑" disabled={disabled}>
          <Pencil className="tw-size-4" />
        </Button>
        <Button variant="destructive" size="icon" aria-label="删除" disabled={disabled}>
          <Trash2 className="tw-size-4" />
        </Button>
        <Button disabled={disabled}>保存</Button>
      </div>
    </div>
  );
};

export const ControlsAndLongDescription: StoryObj<React.ComponentProps<typeof SettingSection>> = {
  render: () => <Controls />,
};

export const Disabled: StoryObj<React.ComponentProps<typeof SettingSection>> = {
  render: () => <Controls disabled />,
};
