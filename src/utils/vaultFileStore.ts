import { FileSystemAdapter, type Vault } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { requireNodeModule } from "@/utils/desktopRuntime";

export async function assertScribePath(vault: Vault, path: string): Promise<void> {
  const segments = path.split("/");
  if (
    segments[0] !== ".scribe" ||
    segments.some(
      (segment) => !segment || segment === "." || segment === ".." || segment.includes("\\")
    )
  ) {
    throw new Error("插件资料只能保存在当前库的 .scribe 文件夹内。");
  }
  if (!(vault.adapter instanceof FileSystemAdapter)) return;
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const nodePath = requireNodeModule<typeof import("node:path")>("path");
  let current = await fs.promises.realpath(vault.adapter.getBasePath());
  for (const segment of segments) {
    current = nodePath.join(current, segment);
    try {
      const stat = await fs.promises.lstat(current);
      if (stat.isSymbolicLink()) throw new Error("插件资料路径不能使用快捷链接。");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

export async function writeVaultFile(
  vault: Vault,
  path: string,
  contents: string,
  expectedContent?: string | null
): Promise<void> {
  await assertScribePath(vault, path);
  const adapter = vault.adapter;
  const checkPrevious = async (): Promise<void> => {
    if (expectedContent === undefined) return;
    const exists = await adapter.exists(path);
    if (
      expectedContent === null ? exists : !exists || (await adapter.read(path)) !== expectedContent
    ) {
      throw new Error("文件已被其他操作修改，未覆盖现有内容。请刷新后重试。");
    }
  };
  await checkPrevious();
  const staging = `${path}.${uuidv4()}.writing`;
  try {
    await adapter.write(staging, contents);
    await assertScribePath(vault, staging);
    await checkPrevious();
    if (adapter instanceof FileSystemAdapter) {
      const fs = requireNodeModule<typeof import("node:fs")>("fs");
      const nodePath = requireNodeModule<typeof import("node:path")>("path");
      const source = nodePath.join(adapter.getBasePath(), staging);
      const destination = nodePath.join(adapter.getBasePath(), path);
      if (expectedContent === null) {
        await fs.promises.link(source, destination);
      } else {
        await fs.promises.rename(source, destination);
      }
    } else {
      await adapter.rename(staging, path);
    }
  } finally {
    if (await adapter.exists(staging)) await adapter.remove(staging);
  }
}
