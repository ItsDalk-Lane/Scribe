import type { App } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import { requireNodeModule } from "@/utils/desktopRuntime";

export function normalizeProjectWorkspace(requested: string, configDir: string): string {
  if (requested.startsWith("/") || requested.startsWith("\\"))
    throw new Error("项目工作位置必须在当前库内。");
  const value = requested.replace(/\\/g, "/").replace(/\/+$/, "");
  if (value === "/") throw new Error("项目工作位置必须在当前库内。");
  const segments = value.split("/").filter((segment) => segment && segment !== ".");
  if (value.startsWith("/") || /^[a-z]:/i.test(value) || segments.includes(".."))
    throw new Error("项目工作位置必须在当前库内。");
  const normalized = segments.join("/");
  const reserved = [".scribe", configDir.replace(/\\/g, "/").replace(/\/+$/, "")];
  if (
    reserved.some(
      (root) =>
        normalized.toLowerCase() === root.toLowerCase() ||
        normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)
    )
  )
    throw new Error("不能将插件数据目录或 Obsidian 配置目录用作项目工作位置。");
  return normalized;
}

export async function validateProjectWorkspace(
  app: App,
  requested: string,
  allowMissing = false
): Promise<string> {
  const normalized = normalizeProjectWorkspace(requested, app.vault.configDir);
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) throw new Error("项目工作位置需要桌面版文件库。");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const root = await fs.realpath(adapter.getBasePath());
  const absolute = path.resolve(adapter.getBasePath(), normalized);
  let current = absolute;
  for (;;) {
    try {
      const real = await fs.realpath(current);
      const relative = path.relative(root, real);
      if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`))
        throw new Error("项目工作位置不能通过链接指向库外。");
      normalizeProjectWorkspace(relative.split(path.sep).join("/"), app.vault.configDir);
      if (!(await fs.stat(real)).isDirectory()) throw new Error("项目工作位置必须是文件夹。");
      if (current !== absolute && !allowMissing) throw new Error("选择的项目工作文件夹不存在。");
      return normalized;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !allowMissing) throw error;
      const stat = await fs.lstat(current).catch((failure: NodeJS.ErrnoException) => {
        if (failure.code !== "ENOENT") throw failure;
        return null;
      });
      if (stat?.isSymbolicLink()) throw new Error("项目工作位置包含失效的文件夹链接。");
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}
