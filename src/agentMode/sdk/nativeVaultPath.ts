import { raceWithAbortSignal } from "@earendil-works/pi-ai/utils/abort";
import type { FileSystemAdapter } from "obsidian";
import { requireNodeModule } from "@/utils/desktopRuntime";

const WRITE_LOCKS = new Map<string, Promise<void>>();

export async function withNativeWriteLock<T>(
  key: string,
  operation: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const previous = WRITE_LOCKS.get(key);
  let unlock!: () => void;
  const current = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  WRITE_LOCKS.set(key, current);
  let acquired = !previous;
  const release = () => {
    unlock();
    if (WRITE_LOCKS.get(key) === current) WRITE_LOCKS.delete(key);
  };
  try {
    if (previous) await (signal ? raceWithAbortSignal(previous, signal) : previous);
    acquired = true;
    signal?.throwIfAborted();
    return await operation();
  } finally {
    // 取消等待不能放行前一个写入尚未结束的后继者。https://github.com/ItsDalk-Lane/Scribe/issues/70
    if (acquired) release();
    else void previous!.then(release, release);
  }
}

function insideVault(root: string, absolute: string): boolean {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const relative = path.relative(root, absolute);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

export function getNativeVaultIdentity(adapter: FileSystemAdapter): string {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  return fs.realpathSync(adapter.getBasePath());
}

export async function resolveNativeVaultPath(
  adapter: FileSystemAdapter,
  requested: string,
  allowMissing = false
): Promise<string> {
  const vaultBase = adapter.getBasePath();
  const path = requireNodeModule<typeof import("node:path")>("path");
  const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const root = await fs.realpath(vaultBase);
  const absolute = path.resolve(vaultBase, requested.replace(/\\/g, "/"));
  const lexical = path.relative(vaultBase, absolute);
  if (path.isAbsolute(lexical) || lexical === ".." || lexical.startsWith(`..${path.sep}`)) {
    throw new Error("The path must stay inside the current vault.");
  }
  try {
    const real = await fs.realpath(absolute);
    if (!insideVault(root, real))
      throw new Error("The path must stay inside the current vault, including symbolic links.");
    return path.relative(root, real).split(path.sep).join("/");
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const segments = lexical.split(path.sep).filter((segment) => segment && segment !== ".");
  let current = root;
  for (const segment of segments) {
    const next = path.join(current, segment);
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      current = next;
      continue;
    }
    if (stat.isSymbolicLink()) {
      let target: string;
      try {
        target = await fs.realpath(next);
      } catch {
        throw new Error(
          `The path must stay inside the current vault; ${segment} is a dangling symbolic link.`
        );
      }
      if (!insideVault(root, target))
        throw new Error("The path must stay inside the current vault, including symbolic links.");
      current = target;
      continue;
    }
    current = next;
  }
  const relative = path.relative(root, current);
  if (!insideVault(root, current))
    throw new Error("The path must stay inside the current vault, including symbolic links.");
  return relative.split(path.sep).join("/");
}

export function readNativeVaultTarget(vaultBase: string, vaultPath: string): string | null {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const root = fs.realpathSync(vaultBase);
  const absolute = path.resolve(root, vaultPath);
  const parent = fs.realpathSync(path.dirname(absolute));
  if (
    !insideVault(root, absolute) ||
    !insideVault(root, parent) ||
    parent !== path.dirname(absolute)
  )
    throw new Error("The path must stay inside the current vault without changed symbolic links.");
  try {
    const target = fs.lstatSync(absolute);
    if (target.isSymbolicLink())
      throw new Error("The file changed into a symbolic link; read it again before saving.");
    // 文本替换不能改动共享同一文件的其他入口，也不能把无效编码静默改写。https://github.com/ItsDalk-Lane/Scribe/issues/71
    if (!target.isFile()) throw new Error("The target must be a regular file.");
    if (target.nlink > 1)
      throw new Error("The target has multiple hard links. Save a separate copy before editing.");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      fs.readFileSync(absolute)
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeNativeVaultTarget(
  vaultBase: string,
  vaultPath: string,
  content: string,
  expectedContent: string | null
): Promise<void> {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const crypto = requireNodeModule<typeof import("node:crypto")>("crypto");
  const root = fs.realpathSync(vaultBase);
  const absolute = path.join(root, vaultPath);
  const stagingDirectory = path.join(root, ".scribe", "write-staging");
  for (const directory of [path.join(root, ".scribe"), stagingDirectory]) {
    try {
      fs.mkdirSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory())
      throw new Error(
        "Write staging must stay inside the vault's .scribe directory without symbolic links."
      );
  }
  const staging = path.join(stagingDirectory, `${crypto.randomUUID()}.writing`);
  try {
    // 完整暂存成功后才替换原件；失败输入保留在资料库中，不退回原地截断。https://github.com/ItsDalk-Lane/Scribe/issues/70
    const fd = fs.openSync(
      staging,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600
    );
    try {
      fs.writeFileSync(fd, content);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const current = readNativeVaultTarget(vaultBase, vaultPath);
    if (current !== expectedContent)
      throw new Error("The file changed; read it and request approval again.");
    // 同进程检查和提交之间不让出执行权；跨进程仍依赖系统的原子替换保证。https://github.com/ItsDalk-Lane/Scribe/issues/70
    if (expectedContent === null) {
      fs.linkSync(staging, absolute);
      fs.unlinkSync(staging);
    } else {
      // 原子替换不能悄悄改变用户原文件的常规访问权限。https://github.com/ItsDalk-Lane/Scribe/issues/70
      fs.chmodSync(staging, fs.statSync(absolute).mode & 0o777);
      fs.renameSync(staging, absolute);
    }
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} Staging file: ${path.relative(root, staging).split(path.sep).join("/")}. Inspect the target before retrying; no automatic recovery was attempted.`
    );
  }
}
