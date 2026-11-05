import React from "react";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { render, screen, cleanup } from "@testing-library/react";
import { App, TFile, TFolder } from "obsidian";
import { DEFAULT_SETTINGS } from "@/constants";
import { setInterfaceLocale } from "@/lib/i18n";
import { getSettings, settingsAtom, settingsStore } from "@/settings/model";
import { migrateSystemPromptsFromSettings } from "@/system-prompts/migration";
import { getSystemPromptsFolder } from "@/system-prompts/systemPromptUtils";
import { formatStartupMigrationSummary } from "@/services/startupMigration";
import {
  ConfirmModalContent,
  type ConfirmModalContentProps,
} from "@/components/modals/ConfirmModal";
import {
  PromptRecoveryFile,
  PromptRecoveryFileChinese,
  PromptRecoveryUnavailable,
  PromptRecoveryUnavailableChinese,
} from "@/components/modals/ConfirmModal.stories";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const prompt = "Synthetic private instructions\nKeep this sentence exactly.\n";
const recoveryErrors = {
  en: "Synthetic recovery error: the example storage location is temporarily unavailable, so the recovery file could not be created during this attempt.",
  "zh-CN":
    "合成恢复错误：示例存储位置暂时不可用，因此本次尝试无法创建恢复文件。该错误仅用于展示较长的系统错误信息。",
} as const;
type Failure = "mismatch" | "read-error" | "write-error" | "recovery-fails";

async function makeApp(root: string, failure: Failure, recoveryError: string) {
  const absolute = (path: string) => join(root, path);
  const recoveryAttempts: string[] = [];
  const adapter = {
    mkdir: async (path: string) => {
      await mkdir(absolute(path), { recursive: true });
    },
  };
  const vault = {
    adapter,
    getAbstractFileByPath: (path: string) => {
      if (!existsSync(absolute(path))) return null;
      const Ctor = (statSync(absolute(path)).isDirectory() ? TFolder : TFile) as unknown as new (
        path: string
      ) => TFile | TFolder;
      return new Ctor(path);
    },
    create: async (path: string, content: string) => {
      const recovery = path.includes("/unsupported/");
      if (recovery) recoveryAttempts.push(path);
      if (failure === "write-error" && !recovery) throw new Error("Synthetic write error");
      if (failure === "recovery-fails" && recovery) throw new Error(recoveryError);
      await writeFile(absolute(path), content, { flag: "wx" });
      return new (TFile as unknown as new (path: string) => TFile)(path);
    },
    read: async (file: TFile) => {
      if (failure === "read-error" || failure === "recovery-fails")
        throw new Error("Synthetic read error");
      return readFile(absolute(file.path), "utf8");
    },
  };
  const app = {
    vault,
    fileManager: {
      processFrontMatter: async (
        file: TFile,
        apply: (frontmatter: Record<string, unknown>) => void
      ) => {
        const frontmatter: Record<string, unknown> = {};
        apply(frontmatter);
        const body = await readFile(absolute(file.path), "utf8");
        await writeFile(
          absolute(file.path),
          `---\nfixture: true\n---\n${failure === "mismatch" ? "Changed fixture content" : body}`
        );
      },
    },
  } as unknown as App;
  return { app, recoveryAttempts };
}

describe("migration", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "scribe-prompt-report-"));
    settingsStore.set(settingsAtom, {
      ...DEFAULT_SETTINGS,
      scribeFolder: "fixture",
      userSystemPrompt: prompt,
      defaultSystemPromptTitle: "Previously selected",
    });
  });
  afterEach(async () => {
    cleanup();
    setInterfaceLocale("en");
    await rm(root, { recursive: true, force: true });
  });

  describe("migrateSystemPromptsFromSettings()", () => {
    it.each([
      {
        locale: "en",
        failure: "mismatch",
        expected: "explains the recovery file when the migrated content differs",
      },
      {
        locale: "zh-CN",
        failure: "mismatch",
        expected: "explains the recovery file when the migrated content differs",
      },
      {
        locale: "en",
        failure: "read-error",
        expected: "explains the recovery file when the migrated file cannot be read",
      },
      {
        locale: "zh-CN",
        failure: "read-error",
        expected: "explains the recovery file when the migrated file cannot be read",
      },
      {
        locale: "en",
        failure: "write-error",
        expected: "explains the recovery file when the migrated file cannot be written",
      },
      {
        locale: "zh-CN",
        failure: "write-error",
        expected: "explains the recovery file when the migrated file cannot be written",
      },
      {
        locale: "en",
        failure: "recovery-fails",
        expected: "explains the unconfirmed recovery when both recovery writes fail",
      },
      {
        locale: "zh-CN",
        failure: "recovery-fails",
        expected: "explains the unconfirmed recovery when both recovery writes fail",
      },
    ] as const)("$expected ($locale)", async ({ locale, failure }) => {
      setInterfaceLocale(locale);
      const recoveryError = recoveryErrors[locale];
      const { app, recoveryAttempts } = await makeApp(root, failure, recoveryError);
      const item = await migrateSystemPromptsFromSettings(app);
      expect(item).not.toBeNull();
      expect(getSettings().defaultSystemPromptTitle).toBe("Previously selected");
      if (failure === "recovery-fails") {
        expect(recoveryAttempts).toHaveLength(2);
        expect(getSettings().userSystemPrompt).toBe(prompt);
        expect(item?.status).toBe("error");
        expect(item?.details?.[0]).toBe(recoveryError);
      } else {
        expect(recoveryAttempts).toHaveLength(1);
        const saved = await readFile(join(root, recoveryAttempts[0]), "utf8");
        expect(saved).toContain(prompt);
        expect(getSettings().userSystemPrompt).toBe("");
        expect(item?.status).toBe("action-required");
      }
      const report = formatStartupMigrationSummary([item!]);
      render(
        <ConfirmModalContent
          content={report}
          onConfirm={() => {}}
          onCancel={() => {}}
          confirmButtonText="Done"
          cancelButtonText=""
        />
      );
      const text = screen.getByText(/Scribe startup report|Scribe 启动报告/).textContent ?? "";
      if (failure === "recovery-fails") {
        expect(text).toContain(
          locale === "en" ? "no recovery file could be confirmed" : "无法确认已创建恢复文件"
        );
        expect(text).toContain(
          locale === "en" ? "setting on disk has not been verified" : "尚未核实磁盘上的设置"
        );
        expect(text).toContain(locale === "en" ? "Do not restart yet." : "请暂时不要重新启动。");
      } else {
        expect(text).toContain(
          locale === "en"
            ? "old settings value was cleared from memory during this run"
            : "本次运行中，旧设置值已从内存中清空"
        );
        expect(text).toContain(
          locale === "en" ? "setting on disk has not been verified" : "尚未核实磁盘上的设置"
        );
        expect(text).toContain(locale === "en" ? "contents were not verified" : "内容尚未核实");
        expect(text).toContain(
          locale === "en"
            ? `Recovery file: ${recoveryAttempts[0]}.`
            : `恢复文件：${recoveryAttempts[0]}。`
        );
        expect(text).toContain(
          locale === "en" ? "review it after disabling Scribe" : "请停用 Scribe 后再检查"
        );
        expect(text).toContain(
          locale === "en" ? "may not be the prompt currently used" : "不一定是当前生效的提示词"
        );
      }
      const backupText =
        failure === "recovery-fails"
          ? locale === "en"
            ? "Securely back up your existing files, including Scribe settings and prompt files"
            : "请安全备份现有文件，包括 Scribe 设置和提示词文件"
          : locale === "en"
            ? "Securely back up your existing files, including the recovery file"
            : "请先安全备份现有文件，包括恢复文件";
      const disableText =
        locale === "en"
          ? "Disable Scribe until file safety issues are fixed"
          : "请停用 Scribe，直到文件安全问题修复";
      if (failure === "recovery-fails") {
        expect(text).toContain(recoveryError);
        expect(text.indexOf(item!.summary)).toBeLessThan(text.indexOf(recoveryError));
        expect(text.indexOf(recoveryError)).toBeLessThan(text.indexOf(backupText));
      }
      expect(text).toContain(backupText);
      expect(text).toContain(locale === "en" ? "keep the backups safe" : "妥善保管");
      expect(text).toContain(disableText);
      expect(text.indexOf(backupText)).toBeLessThan(text.indexOf(disableText));
      expect(text).toContain(
        locale === "en"
          ? "Saves already queued may still finish while disabling"
          : "停用期间，已排队的保存可能仍会完成"
      );
      if (failure === "mismatch" || failure === "recovery-fails") {
        const story =
          failure === "mismatch"
            ? locale === "en"
              ? PromptRecoveryFile
              : PromptRecoveryFileChinese
            : locale === "en"
              ? PromptRecoveryUnavailable
              : PromptRecoveryUnavailableChinese;
        cleanup();
        render(<ConfirmModalContent {...(story.args as ConfirmModalContentProps)} />);
        const storyText = screen.getByText(item!.summary, { exact: false }).textContent ?? "";
        expect(storyText).toContain(
          locale === "en" ? "setting on disk has not been verified" : "尚未核实磁盘上的设置"
        );
        if (failure === "mismatch") {
          expect(storyText).toContain(locale === "en" ? "Recovery file:" : "恢复文件：");
          expect(storyText).toContain(
            locale === "en" ? "review it after disabling Scribe" : "请停用 Scribe 后再检查"
          );
        }
        if (failure === "recovery-fails") {
          expect(storyText).toContain(recoveryError);
          expect(storyText.indexOf(item!.summary)).toBeLessThan(storyText.indexOf(recoveryError));
          expect(storyText.indexOf(recoveryError)).toBeLessThan(storyText.indexOf(backupText));
        }
        expect(storyText).toContain(backupText);
        expect(storyText).toContain(locale === "en" ? "keep the backups safe" : "妥善保管");
        expect(storyText).toContain(disableText);
        expect(storyText.indexOf(backupText)).toBeLessThan(storyText.indexOf(disableText));
        expect(storyText).toContain(
          locale === "en"
            ? "Saves already queued may still finish while disabling"
            : "停用期间，已排队的保存可能仍会完成"
        );
      }
      expect(getSystemPromptsFolder()).toBe("fixture/system-prompts");
    });
  });
});
