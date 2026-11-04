import { getEffectiveConversationsFolder } from "@/settings/scribeFolder";
import { listMarkdownFiles, readFrontmatterViaAdapter } from "@/utils/vaultAdapterUtils";
import { App, TFile } from "obsidian";

const EPOCH_ID = /^epoch:(\d+)$/;

async function readEpoch(app: App, path: string): Promise<number | null> {
  let epoch: unknown = app.metadataCache.getCache(path)?.frontmatter?.epoch;
  if (epoch === undefined) {
    try {
      epoch = (await readFrontmatterViaAdapter(app, path))?.epoch;
    } catch {
      return null;
    }
  }
  const value = Number(epoch);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function buildChatDeepLink(vault: string, id: string): string {
  return `obsidian://scribe-chat?vault=${encodeURIComponent(vault)}&id=${encodeURIComponent(id)}`;
}

export function buildChatMarkdownLink(title: string, url: string): string {
  return `[${title.replace(/[[\]\\]/g, "\\$&")}](${url})`;
}

export async function getSavedChatDeepLinkId(app: App, path: string): Promise<string | null> {
  const epoch = await readEpoch(app, path);
  return epoch === null ? null : `epoch:${epoch}`;
}

export async function findChatFileByDeepLinkId(app: App, id: string): Promise<TFile | null> {
  const epoch = Number(EPOCH_ID.exec(id)?.[1]);
  if (!epoch) return null;
  const folder = getEffectiveConversationsFolder();
  let found: TFile | null = null;
  for (const file of listMarkdownFiles(app, folder)) {
    if (!file.path.startsWith(`${folder}/`)) continue;
    if ((await readEpoch(app, file.path)) !== epoch) continue;
    if (found) return null;
    found = file;
  }
  return found;
}
