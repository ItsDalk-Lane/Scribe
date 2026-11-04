interface SourcesSection {
  mainContent: string;
  sourcesBlock: string;
}

function extractSourcesSection(content: string): SourcesSection | null {
  const sourcesRegex = /([\s\S]*?)\n+(?:####\s*)?Sources\s*:?\s*\n+([\s\S]*)$/i;
  const match = content.match(sourcesRegex);
  if (match) {
    return {
      mainContent: match[1],
      sourcesBlock: (match[2] || "").trim(),
    };
  }

  const hrMatch = content.match(/([\s\S]*?)\n+---+\s*\n+([\s\S]*)$/);
  if (hrMatch) {
    const afterHr = (hrMatch[2] || "").trim();
    const allFootnotes =
      afterHr.length > 0 &&
      afterHr.split("\n").every((line) => !line.trim() || /^\[\^\d+\]:/.test(line.trim()));
    if (allFootnotes) {
      return {
        mainContent: hrMatch[1],
        sourcesBlock: afterHr,
      };
    }
  }

  const trailingMatch = content.match(/([\s\S]*?)\n{2,}(\[\^\d+\]:[\s\S]*)$/);
  if (trailingMatch) {
    const footnotesBlock = (trailingMatch[2] || "").trim();
    const allFootnotes = footnotesBlock
      .split("\n")
      .every((line) => !line.trim() || /^\[\^\d+\]:/.test(line.trim()));
    if (allFootnotes) {
      return {
        mainContent: trailingMatch[1],
        sourcesBlock: footnotesBlock,
      };
    }
  }

  return null;
}

function normalizeSourcesBlock(sourcesBlock: string): string {
  if (!sourcesBlock.includes("\n")) {
    sourcesBlock = sourcesBlock.replace(/\s*\[(\d+)\]\s*/g, "\n[$1] ");
    sourcesBlock = sourcesBlock.replace(/\s+(\d+)\.\s/g, "\n$1. ");
    sourcesBlock = sourcesBlock.trim();
  }
  return sourcesBlock;
}

function parseFootnoteDefinitions(sourcesBlock: string): string[] {
  return sourcesBlock
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\[\^\d+\]:/.test(l));
}

function buildCitationMap(mainContent: string, footnoteLines: string[]): Map<number, number> {
  const map = new Map<number, number>();
  const seen = new Set<number>();
  const firstMention: number[] = [];

  const refRe = /\[\^(\d+)\]/g;
  let mref: RegExpExecArray | null;
  while ((mref = refRe.exec(mainContent)) !== null) {
    const n = parseInt(mref[1], 10);
    if (!seen.has(n)) {
      seen.add(n);
      firstMention.push(n);
    }
  }

  if (firstMention.length > 0) {
    firstMention.forEach((n, i) => map.set(n, i + 1));
  } else {
    let idx = 1;
    for (const line of footnoteLines) {
      const m = line.match(/^\[\^(\d+)\]:/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!map.has(n)) map.set(n, idx++);
      }
    }
  }

  return map;
}

function normalizeCitations(content: string, map: Map<number, number>): string {
  let result = content;
  let changed;
  do {
    changed = false;

    result = result.replace(/\[\^(\d+)\]/g, (match, n: string) => {
      const oldN = parseInt(n, 10);
      const newN = map.get(oldN) ?? oldN;
      const replacement = `[${newN}]`;
      if (replacement !== match) {
        changed = true;
      }
      return replacement;
    });

    result = result.replace(/\[\^(\d+(?:\s*,\s*\^?\d+)*)\]/g, (match, citationList: string) => {
      const processedNumbers = citationList
        .split(",")
        .map((part: string) => {
          const cleanPart = part.trim().replace(/^\^/, "");
          const oldN = parseInt(cleanPart, 10);
          const newN = map.get(oldN) ?? oldN;
          return newN;
        })
        .sort((a: number, b: number) => a - b)
        .map((n: number) => n.toString())
        .join(", ");

      const replacement = `[${processedNumbers}]`;
      if (replacement !== match) {
        changed = true;
      }
      return replacement;
    });
  } while (changed);

  result = result.replace(/\[(\d+)\]\./g, "[$1]");

  return result;
}

function convertFootnoteDefinitions(sourcesBlock: string, map: Map<number, number>): string[] {
  const items: string[] = [];
  sourcesBlock.split("\n").forEach((line) => {
    const m = line.match(/^\[\^(\d+)\]:\s*(.*)$/);
    if (!m) return;
    const oldN = parseInt(m[1], 10);
    const newN = map.get(oldN) ?? oldN;
    const markdownLink = m[2].match(/\[([^\]]+)\]\(([^)]+)\)/);
    const wl = m[2].match(/\[\[(.*?)\]\]/);

    let display: string;
    if (markdownLink) {
      display = `<a href="${markdownLink[2]}">${markdownLink[1]}</a>`;
    } else if (wl) {
      display = `[[${wl[1]}]]`;
    } else {
      const malformedLink = m[2].match(/^(.*?)\]\s*\(([^)]+)\)\s*$/);
      if (malformedLink) {
        const text = malformedLink[1].trim();
        const url = malformedLink[2].trim();
        display = `<a href="${url}">${text}</a>`;
      } else {
        display = m[2].replace(/\s*\([^)]*\)\s*$/, "");
      }
    }
    items[newN - 1] = display;
  });
  return items;
}

function consolidateDuplicateSources(items: string[]): {
  uniqueItems: string[];
  consolidationMap: Map<number, number>;
} {
  const uniqueItems: string[] = [];
  const seenTitles = new Set<string>();
  const consolidationMap = new Map<number, number>();

  items.forEach((item, originalIndex) => {
    if (!item) return;

    const titleMatch = item.match(/\[\[(.*?)\]\]/);
    const title = titleMatch ? titleMatch[1].toLowerCase() : item.toLowerCase();

    if (!seenTitles.has(title)) {
      seenTitles.add(title);
      uniqueItems.push(item);
      consolidationMap.set(originalIndex + 1, uniqueItems.length);
    } else {
      const firstOccurrenceIndex = uniqueItems.findIndex((existing) => {
        const existingTitleMatch = existing.match(/\[\[(.*?)\]\]/);
        const existingTitle = existingTitleMatch
          ? existingTitleMatch[1].toLowerCase()
          : existing.toLowerCase();
        return existingTitle === title;
      });
      if (firstOccurrenceIndex >= 0) {
        consolidationMap.set(originalIndex + 1, firstOccurrenceIndex + 1);
      }
    }
  });

  return { uniqueItems, consolidationMap };
}

function updateCitationsForConsolidation(
  content: string,
  consolidationMap: Map<number, number>
): string {
  if (consolidationMap.size === 0) return content;

  return content.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_match, nums: string) => {
    const parts = nums.split(/\s*,\s*/);
    const seen = new Set<number>();
    const unique: number[] = [];
    for (const n of parts) {
      const remapped = consolidationMap.get(parseInt(n, 10)) || parseInt(n, 10);
      if (!seen.has(remapped)) {
        seen.add(remapped);
        unique.push(remapped);
      }
    }
    return `[${unique.join(", ")}]`;
  });
}

function deduplicateAdjacentCitations(content: string): string {
  let result = content;
  let prev;
  do {
    prev = result;
    result = result.replace(
      /\[(\d+(?:\s*,\s*\d+)*)\](?:\s*(?:and|,)\s*|\s*)\[(\d+(?:\s*,\s*\d+)*)\]/g,
      (match, first: string, second: string) => {
        const firstNums = new Set(first.split(/\s*,\s*/).map((s: string) => s.trim()));
        const secondNums = second.split(/\s*,\s*/).map((s: string) => s.trim());
        if (secondNums.every((n: string) => firstNums.has(n))) {
          return `[${[...firstNums].join(", ")}]`;
        }
        return match;
      }
    );
  } while (result !== prev);
  return result;
}

interface SourcesDisplayItem {
  index: number;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isNonNull<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function parseSimpleSources(sourcesBlock: string): SourcesDisplayItem[] {
  const lines = sourcesBlock.split("\n");
  const items: SourcesDisplayItem[] = [];

  lines.forEach((rawLine) => {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      return;
    }

    const content = trimmed
      .replace(/^<li>/i, "")
      .replace(/<\/li>$/i, "")
      .replace(/^[-*]\s*/, "")
      .trim();

    if (!content) {
      return;
    }

    const markdownLink = content.match(/\[([^\]]+)\]\(([^)]+)\)/);
    const wikiLink = content.match(/\[\[(.*?)\]\]/);

    let html: string;
    if (markdownLink) {
      html = `<a href="${markdownLink[2]}">${markdownLink[1]}</a>`;
    } else if (wikiLink) {
      html = `[[${wikiLink[1]}]]`;
    } else {
      html = escapeHtml(content);
    }

    items.push({ index: items.length + 1, html });
  });

  return items;
}

function buildSourcesDetails(mainContent: string, items: SourcesDisplayItem[]): string {
  const nonEmptyItems = items.filter((item) => item.html.trim().length > 0);
  if (nonEmptyItems.length === 0) {
    return mainContent;
  }

  const listItems = nonEmptyItems
    .map(
      ({ index, html }) =>
        `<li class="scribe-sources__item"><span class="scribe-sources__index">[${index}]</span><span class="scribe-sources__text">${html}</span></li>`
    )
    .join("\n");

  return (
    `${mainContent}\n\n<br/>\n` +
    `<details class="scribe-sources"><summary class="scribe-sources__summary">Sources</summary>\n` +
    `<ul class="scribe-sources__list">\n${listItems}\n</ul>\n</details>`
  );
}

function wrapCitationPlaceholders(content: string): string {
  return content.replace(
    /\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g,
    '<span class="scribe-citation-ref">[$1]</span>'
  );
}

export function processInlineCitations(
  content: string,
  enableInlineCitations: boolean = true
): string {
  if (!enableInlineCitations) {
    return content;
  }

  const sourcesSection = extractSourcesSection(content);
  if (!sourcesSection) return content;

  let { mainContent, sourcesBlock } = sourcesSection;
  sourcesBlock = normalizeSourcesBlock(sourcesBlock);

  const footnoteLines = parseFootnoteDefinitions(sourcesBlock);
  if (footnoteLines.length === 0) {
    const simpleItems = parseSimpleSources(sourcesBlock);
    return buildSourcesDetails(mainContent, simpleItems);
  }

  const citationMap = buildCitationMap(mainContent, footnoteLines);
  mainContent = normalizeCitations(mainContent, citationMap);

  let items = convertFootnoteDefinitions(sourcesBlock, citationMap);
  const { uniqueItems, consolidationMap } = consolidateDuplicateSources(items);

  if (consolidationMap.size > 0) {
    mainContent = updateCitationsForConsolidation(mainContent, consolidationMap);
    mainContent = deduplicateAdjacentCitations(mainContent);
    items = uniqueItems;
  }

  mainContent = wrapCitationPlaceholders(mainContent);

  const detailedItems = items
    .map<SourcesDisplayItem | null>((item, index) => {
      if (!item) {
        return null;
      }
      return { index: index + 1, html: item };
    })
    .filter(isNonNull);

  return buildSourcesDetails(mainContent, detailedItems);
}
