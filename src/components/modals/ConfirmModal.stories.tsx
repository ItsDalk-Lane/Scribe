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
      "Scribe startup report.\n\nCustom commands — Failed\nCustom commands could not be loaded or migrated. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs.",
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
      "Scribe 启动报告。\n\n自定义指令 — 失败\n无法加载或迁移自定义指令。请先备份现有文件，再停用 Scribe，直到文件安全问题修复。请查看可用日志。",
    onConfirm: () => undefined,
    onCancel: () => undefined,
    confirmButtonText: "完成",
    cancelButtonText: "",
  },
};

export const PromptRecoveryFile: StoryObj<ConfirmModalContentProps> = {
  name: "Prompt recovery file (example)",
  args: {
    content:
      "Scribe startup report.\n\nSystem prompt — Action required\nThe migrated prompt could not be verified. A recovery file was created, but the old settings value was cleared from memory during this run. The setting on disk has not been verified.\n• Recovery file: scribe/system-prompts/unsupported/example.md. Its contents were not verified and may not be the prompt currently used; review it after disabling Scribe.\n• Securely back up your existing files, including the recovery file, and keep the backups safe before disabling Scribe.\n• Disable Scribe until file safety issues are fixed. Saves already queued may still finish while disabling.",
    onConfirm: () => undefined,
    onCancel: () => undefined,
    confirmButtonText: "Done",
    cancelButtonText: "",
  },
};

export const PromptRecoveryUnavailable: StoryObj<ConfirmModalContentProps> = {
  name: "Prompt recovery unavailable (example)",
  args: {
    content:
      "Scribe startup report.\n\nSystem prompt — Failed\nThe prompt could not be migrated and no recovery file could be confirmed. The setting on disk has not been verified.\n• Synthetic recovery error: the example storage location is temporarily unavailable, so the recovery file could not be created during this attempt.\n• Do not restart yet. Securely back up your existing files, including Scribe settings and prompt files, and keep the backups safe; they may contain private content.\n• Disable Scribe until file safety issues are fixed. Saves already queued may still finish while disabling.\n• Check folder permissions and available disk space for scribe/system-prompts.",
    onConfirm: () => undefined,
    onCancel: () => undefined,
    confirmButtonText: "Done",
    cancelButtonText: "",
  },
};

export const PromptRecoveryFileChinese: StoryObj<ConfirmModalContentProps> = {
  name: "Prompt recovery file (Chinese example)",
  args: {
    content:
      "Scribe 启动报告。\n\n系统提示词 — 需要处理\n无法核实迁移后的提示词。已创建恢复文件，但本次运行中，旧设置值已从内存中清空。尚未核实磁盘上的设置。\n• 恢复文件：scribe/system-prompts/unsupported/example.md。内容尚未核实，不一定是当前生效的提示词；请停用 Scribe 后再检查。\n• 请先安全备份现有文件，包括恢复文件，并妥善保管，然后再停用 Scribe。\n• 请停用 Scribe，直到文件安全问题修复。停用期间，已排队的保存可能仍会完成。",
    onConfirm: () => undefined,
    onCancel: () => undefined,
    confirmButtonText: "完成",
    cancelButtonText: "",
  },
};

export const PromptRecoveryUnavailableChinese: StoryObj<ConfirmModalContentProps> = {
  name: "Prompt recovery unavailable (Chinese example)",
  args: {
    content:
      "Scribe 启动报告。\n\n系统提示词 — 失败\n提示词无法迁移，无法确认已创建恢复文件。尚未核实磁盘上的设置。\n• 合成恢复错误：示例存储位置暂时不可用，因此本次尝试无法创建恢复文件。该错误仅用于展示较长的系统错误信息。\n• 请暂时不要重新启动。请安全备份现有文件，包括 Scribe 设置和提示词文件，并妥善保管；这些文件可能包含私人内容。\n• 请停用 Scribe，直到文件安全问题修复。停用期间，已排队的保存可能仍会完成。\n• 请检查 scribe/system-prompts 的文件夹权限和可用磁盘空间。",
    onConfirm: () => undefined,
    onCancel: () => undefined,
    confirmButtonText: "完成",
    cancelButtonText: "",
  },
};
