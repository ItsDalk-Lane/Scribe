import type { FileSystemAdapter } from "obsidian";
import { requireNodeModule } from "@/utils/desktopRuntime";

const WRITE_LOCKS = new Map<string, Promise<void>>();

export async function withNativeWriteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = WRITE_LOCKS.get(key);
  let unlock!: () => void;
  const current = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  WRITE_LOCKS.set(key, current);
  try {
    if (previous) await previous;
    return await operation();
  } finally {
    unlock();
    if (WRITE_LOCKS.get(key) === current) WRITE_LOCKS.delete(key);
  }
}

function insideVault(root: string, absolute: string): boolean {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const relative = path.relative(root, absolute);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

// 区分普通缺失路径与悬空符号链接：悬空链接一旦写入会落到不可预测的链接目标，必须整体拒绝。
// https://github.com/ItsDalk-Lane/Scribe/issues/11
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

// 最终写入绑定到已验证的目标：新文件用 O_EXCL 创建（批准期间被替换为链接时直接失败），
// 覆盖已存在文件时用 O_NOFOLLOW 打开（最终段被换成链接时报错而不是跟随）。
// https://github.com/ItsDalk-Lane/Scribe/issues/11
export async function writeNativeVaultTarget(
  vaultBase: string,
  vaultPath: string,
  content: string,
  creating: boolean
): Promise<void> {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const absolute = path.join(vaultBase, vaultPath);
  const nofollow = (fs.constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
  const flags = creating
    ? fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | nofollow
    : fs.constants.O_WRONLY | fs.constants.O_TRUNC | nofollow;
  let fd: number;
  try {
    fd = fs.openSync(absolute, flags);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ELOOP")
      throw new Error(
        "The file changed while approval was pending; read it and request approval again."
      );
    throw error;
  }
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}
