import { WebSearchOutcomeUnknown } from "@/agentMode/sdk/webSearchRouter";
import { FileSystemAdapter, type App } from "obsidian";
import type { NativeToolContext } from "@/agentMode/sdk/NativeBackendProcess";
import { NATIVE_PERMISSION_OPTIONS } from "@/agentMode/sdk/nativeToolDefinition";
import { getNativeVaultIdentity, resolveNativeVaultPath } from "@/agentMode/sdk/nativeVaultPath";
import type { Skill } from "@/agentMode/skills/types";
import { getEffectiveSkillsFolder } from "@/settings/scribeFolder";
import { augmentPathForDetection } from "@/utils/binaryPath";
import { requireNodeModule } from "@/utils/desktopRuntime";

export async function searchWithSkill(
  app: App,
  context: NativeToolContext,
  skill: Skill | undefined,
  id: string,
  query: string,
  signal: AbortSignal
): Promise<{ text: string } | { failure: string }> {
  signal.throwIfAborted();
  const adapter = app.vault.adapter;
  if (
    !(adapter instanceof FileSystemAdapter) ||
    !skill?.webSearchCommand ||
    skill.location.kind !== "canonical" ||
    !skill.enabledAgents.includes("native") ||
    skill.disableModelInvocation
  )
    return { failure: "The selected search skill is unavailable." };

  const assertAllowed = () => {
    signal.throwIfAborted();
    if (context.getMode() === "plan")
      throw new Error("Plan approval is required before running a search skill script.");
    context.assertCanExecute?.("web_search");
    context.assertCanExecute?.("run_command");
  };
  assertAllowed();

  const path = requireNodeModule<typeof import("node:path")>("path");
  const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const relativeDirectory = `${getEffectiveSkillsFolder()}/${skill.name}`;
  const relativeScript = `${relativeDirectory}/${skill.webSearchCommand}`;
  const vault = getNativeVaultIdentity(adapter);
  const script = path.join(vault, relativeScript);
  const isAvailable = async () => {
    try {
      // 拒绝重定向到其他文件的路径，防止技能执行范围扩展到资料库中的任意脚本。https://github.com/ItsDalk-Lane/Scribe/issues/70
      if ((await resolveNativeVaultPath(adapter, relativeScript)) !== relativeScript) return false;
      const stat = await fs.stat(script);
      return stat.isFile() && stat.nlink === 1;
    } catch {
      return false;
    }
  };
  const available = await isAvailable();
  assertAllowed();
  if (!available) return { failure: "The search skill script is unavailable." };
  const decision = await context.requestPermission({
    sessionId: context.sessionId,
    requester: context.requester,
    toolCall: {
      toolCallId: id,
      title: `Run web search skill: ${skill.name}`,
      kind: "search",
      rawInput: { script: skill.webSearchCommand, query },
    },
    options: [...NATIVE_PERMISSION_OPTIONS],
    signal,
  });
  signal.throwIfAborted();
  if (decision.outcome.outcome !== "selected" || decision.outcome.optionId !== "allow_once")
    throw new Error("Permission denied for the selected search skill.");

  const { execFile } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const { promisify } = requireNodeModule<typeof import("node:util")>("util");
  const python = process.platform === "win32" ? "python" : "python3";
  const env = { ...process.env, PATH: augmentPathForDetection(process.env.PATH) };
  const stillAvailable = await isAvailable();
  // 等待批准时权限和模式可能变化，真正启动前重新检查。https://github.com/ItsDalk-Lane/Scribe/issues/70
  assertAllowed();
  if (!stillAvailable) return { failure: "The search skill script is unavailable." };
  try {
    const { stdout } = await promisify(execFile)(python, ["-B", "-X", "utf8", script, query], {
      cwd: path.join(vault, relativeDirectory),
      env,
      shell: false,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 256 * 1024,
      signal,
    });
    signal.throwIfAborted();
    const text = stdout.trim();
    return text ? { text } : { failure: "The search skill returned no results." };
  } catch (error) {
    signal.throwIfAborted();
    const { code, killed } = error as { code?: unknown; killed?: boolean };
    if (code === "ENOENT")
      return { failure: "Python is unavailable for the selected search skill." };
    if (typeof code === "number" && !killed)
      return { failure: `The search skill exited with code ${code}.` };
    // 超时或进程被中止无法证明搜索失败，不能据此调用备用服务。https://github.com/ItsDalk-Lane/Scribe/issues/70
    throw new WebSearchOutcomeUnknown("The search skill stopped without a confirmed result.");
  }
}
