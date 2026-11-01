import {
  extractContentFromBlock,
  extractSourceFromBlock,
  getSourceType,
  isRecoverable,
} from "./contextBlockRegistry";
import {
  CompactionConfig,
  DEFAULT_COMPACTION_CONFIG,
  compactBySection,
  escapeXmlAttr,
} from "./compactionUtils";

function buildToolResultPatterns(): Array<{ pattern: RegExp; tag: string }> {
  const toolResultTags = ["note_context", "active_note", "youtube_video_context"];

  return toolResultTags.map((tag) => ({
    pattern: new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, "g"),
    tag,
  }));
}

const TOOL_RESULT_PATTERNS = buildToolResultPatterns();

export function compactAssistantOutput(
  output: string | unknown[],
  config: Partial<CompactionConfig> = {}
): string | unknown[] {
  if (Array.isArray(output)) {
    return output.map((item: { type?: string; text?: unknown }) => {
      if (item.type === "text" && typeof item.text === "string") {
        return { ...item, text: compactOutputString(item.text, config) };
      }
      return item;
    });
  }

  if (typeof output === "string") {
    return compactOutputString(output, config);
  }

  return output;
}

function compactOutputString(content: string, config: Partial<CompactionConfig> = {}): string {
  const threshold = config.verbatimThreshold ?? DEFAULT_COMPACTION_CONFIG.verbatimThreshold;
  let result = content;

  for (const { pattern, tag } of TOOL_RESULT_PATTERNS) {
    pattern.lastIndex = 0;

    result = result.replace(pattern, (match) => {
      if (match.length < threshold) {
        return match;
      }
      return compactToolResultBlock(match, tag, config);
    });
  }

  return result;
}

function compactToolResultBlock(
  xmlBlock: string,
  tag: string,
  config: Partial<CompactionConfig> = {}
): string {
  if (!isRecoverable(tag)) {
    return xmlBlock;
  }

  const source = extractSourceFromBlock(xmlBlock, tag);
  const content = extractContentFromBlock(xmlBlock);
  const sourceType = getSourceType(tag);

  const previewChars =
    config.previewCharsPerSection ?? DEFAULT_COMPACTION_CONFIG.previewCharsPerSection;
  const maxSections = config.maxSections ?? DEFAULT_COMPACTION_CONFIG.maxSections;
  const compactedContent = compactBySection(content, previewChars, maxSections);

  return `<prior_context source="${escapeXmlAttr(source)}" type="${sourceType}">
${compactedContent}
</prior_context>`;
}
