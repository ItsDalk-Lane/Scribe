import type { Meta, StoryObj } from "@/lib/story";
import { ConfirmModalContent, type ConfirmModalContentProps } from "./ConfirmModal";

const meta = {
  title: "Modal/Confirm",
  component: ConfirmModalContent,
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ConfirmModalContentProps>;
export default meta;

export const StartupFailure: StoryObj<ConfirmModalContentProps> = {
  name: "Startup failure report (example)",
  args: {
    content:
      "Scribe startup report.\n\nCustom commands — Failed\nCustom commands could not be loaded. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs.",
    onConfirm: () => undefined,
    onCancel: () => undefined,
    confirmButtonText: "Done",
    cancelButtonText: "",
  },
};

export const StartupFailureChinese: StoryObj<ConfirmModalContentProps> = {
  name: "Startup failure report (Chinese example)",
  args: {
    content:
      "Scribe 启动报告。\n\n自定义指令 — 失败\n无法加载自定义指令。请先备份现有文件，再停用 Scribe，直到文件安全问题修复。请查看可用日志。",
    onConfirm: () => undefined,
    onCancel: () => undefined,
    confirmButtonText: "完成",
    cancelButtonText: "",
  },
};
