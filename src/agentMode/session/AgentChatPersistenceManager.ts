import { unescapeYamlString } from "./agentChatYaml";
import { listMarkdownFiles, patchFrontmatter, trashFile } from "@/utils/vaultAdapterUtils";
import { stripChatImageReceipts } from "@/utils/chatImagePersistence";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { logInfo } from "@/logger";
import { getEffectiveConversationsFolder } from "@/settings/scribeFolder";
import { FormattedDateTime } from "@/types/message";
import { TFile, type App } from "obsidian";
import { GLOBAL_SCOPE } from "./scope";
import type { AgentChatMessage, BackendId, SessionUsage } from "./types";

const AGENT_FILENAME_PREFIX = "agent__";
const TRANSCRIPT_ESCAPE = String.fromCharCode(0x200b);
const ESCAPED_SENDER = new RegExp(`\\*\\*(user|ai)${TRANSCRIPT_ESCAPE}\\*\\*: `, "g");
const ESCAPED_TIMESTAMP = new RegExp(`^\\[Timestamp:${TRANSCRIPT_ESCAPE} `, "gm");

function unescapeTranscriptBody(body: string): string {
  return body.replace(ESCAPED_SENDER, "**$1**: ").replace(ESCAPED_TIMESTAMP, "[Timestamp: ");
}

function parseLinkableEpoch(raw: string | undefined): number | undefined {
  const epoch = Number(raw);
  return Number.isSafeInteger(epoch) && epoch > 0 ? epoch : undefined;
}

function parseUsageJson(raw: unknown): SessionUsage | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as SessionUsage).usedTokens === "number" &&
      typeof (parsed as SessionUsage).updatedAt === "number"
    ) {
      return parsed as SessionUsage;
    }
  } catch {
    return undefined;
  }
}

export interface LoadedAgentChat {
  messages: AgentChatMessage[];
  backendId: BackendId;
  topic?: string;
  label?: string;
  sessionId?: string;
  projectId: string;
  usage?: SessionUsage;
}

export class AgentChatPersistenceManager {
  constructor(private readonly app: App) {}

  async loadFile(file: TFile): Promise<LoadedAgentChat> {
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.splitFrontmatter(content);
    const backendId = (frontmatter.backendId ?? "").trim();
    if (!backendId) {
      throw new Error(`Missing backendId in agent chat frontmatter: ${file.path}`);
    }
    const topic = frontmatter.topic?.trim() || undefined;
    const label = frontmatter.agentLabel?.trim() || undefined;
    const sessionId = frontmatter.sessionId?.trim() || undefined;
    const projectId = frontmatter.projectId?.trim() || GLOBAL_SCOPE;
    const usage = parseUsageJson(frontmatter.usage);
    const messages = this.parseChatBody(body, parseLinkableEpoch(frontmatter.epoch));

    logInfo(
      `[AgentChatPersistenceManager] Loaded ${messages.length} messages from ${file.path} (backend=${backendId}, sessionId=${sessionId ?? "none"}, projectId=${projectId})`
    );
    return { messages, backendId, topic, label, sessionId, projectId, usage };
  }

  async getAgentChatHistoryFiles(): Promise<TFile[]> {
    const files = listMarkdownFiles(this.app, getEffectiveConversationsFolder());
    return files.filter((file) => file.basename.startsWith(AGENT_FILENAME_PREFIX));
  }

  async updateTopic(fileId: string, newTopic: string): Promise<void> {
    await patchFrontmatter(this.app, fileId, { topic: newTopic.trim() });
  }

  async deleteFile(fileId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (!file) throw new Error("Chat file not found.");
    await trashFile(this.app, file);
  }

  private parseChatBody(body: string, conversationEpoch?: number): AgentChatMessage[] {
    const messages: AgentChatMessage[] = [];
    const pattern = /\*\*(user|ai)\*\*: ([\s\S]*?)(?=(?:\n\*\*(?:user|ai)\*\*: )|$)/g;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const sender = match[1] === "user" ? USER_SENDER : AI_SENDER;
      const fullContent = unescapeTranscriptBody(match[2].trim());

      const lines = fullContent.split("\n");
      let endIndex = lines.length;
      let timestampStr = "Unknown time";

      if (lines[endIndex - 1]?.startsWith("[Timestamp: ")) {
        const tsMatch = lines[endIndex - 1].match(/\[Timestamp: (.*?)\]/);
        if (tsMatch) {
          timestampStr = tsMatch[1];
          endIndex--;
        }
      }

      const messageText = lines.slice(0, endIndex).join("\n").trim();

      let timestamp: FormattedDateTime | null = null;
      if (timestampStr !== "Unknown time") {
        const date = new Date(timestampStr);
        if (!isNaN(date.getTime())) {
          timestamp = {
            epoch: date.getTime(),
            display: timestampStr,
            fileName: "",
          };
        }
      }
      if (messages.length === 0 && conversationEpoch !== undefined) {
        timestamp = { epoch: conversationEpoch, display: timestampStr, fileName: "" };
      }

      const id = timestamp
        ? `loaded-${messages.length}-${timestamp.epoch}`
        : `loaded-${messages.length}`;
      messages.push({
        id,
        message: stripChatImageReceipts(messageText),
        sender,
        isVisible: true,
        timestamp,
      });
    }
    return messages;
  }

  private splitFrontmatter(content: string): {
    frontmatter: Record<string, string>;
    body: string;
  } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return { frontmatter: {}, body: content };
    const frontmatter: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const m = line.match(/^(\w+):\s*(.+)/);
      if (!m) continue;
      const raw = m[2].trim();
      let value: string;
      if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
        value = unescapeYamlString(raw.slice(1, -1));
      } else if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
        value = raw.slice(1, -1);
      } else {
        value = raw;
      }
      frontmatter[m[1]] = value;
    }
    return { frontmatter, body: content.slice(match[0].length).trim() };
  }
}
