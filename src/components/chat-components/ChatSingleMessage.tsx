import { t } from "@/lib/i18n";
import { Markdown } from "@/components/Markdown";
import { ChatButtons } from "@/components/chat-components/ChatButtons";
import { AssistantResponseFooter } from "@/components/ui/AssistantResponseFooter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextFolderBadge,
  ContextNoteBadge,
  ContextSelectedTextBadge,
  ContextTagBadge,
  ContextWebTabBadge,
} from "@/components/chat-components/ContextBadges";
import { ClampedContent } from "@/components/ui/clamped-content";
import { USER_SENDER } from "@/constants";
import { cn } from "@/lib/utils";
import { processInlineCitations } from "@/LLMProviders/chainRunner/utils/citationUtils";
import { logError } from "@/logger";
import { ChatMessage } from "@/types/message";
import { extractYoutubeVideoId, insertAtCursor } from "@/utils";
import { preprocessAIResponse } from "@/utils/markdownPreprocess";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { App, Component, TFile } from "obsidian";
import React, { useCallback, useEffect, useRef } from "react";
import { useSettingsValue } from "@/settings/model";
import {
  buildCopilotCollapsibleDomId,
  captureCopilotCollapsibleOpenStates,
  getCopilotCollapsibleDetailsFromEvent,
  getMessageCollapsibleStates,
  isEventWithinDetailsSummary,
} from "@/components/chat-components/collapsibleStateUtils";

const FOOTNOTE_SUFFIX_PATTERN = /^\d+-\d+$/;

// Tall pasted user messages collapse behind a Show more control.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/151
const COLLAPSED_USER_MESSAGE_CLASS_NAME = cn("tw-max-h-[12lh]");

export const normalizeFootnoteRendering = (root: HTMLElement): void => {
  const footnoteSection = root.querySelector(".footnotes");

  if (footnoteSection) {
    footnoteSection.querySelectorAll("hr, hr.footnotes-sep").forEach((el) => el.remove());
    footnoteSection
      .querySelectorAll("a.footnote-backref, a.footnote-link.footnote-backref")
      .forEach((el) => el.remove());
  } else {
    root
      .querySelectorAll("a.footnote-backref, a.footnote-link.footnote-backref")
      .forEach((el) => el.remove());
  }

  root
    .querySelectorAll(
      'a.footnote-ref, sup a[href^="#fn"], sup a[href^="#fn-"], a[href^="#fn"], a[href^="#fn-"]'
    )
    .forEach((anchor) => {
      const text = anchor.textContent?.trim() ?? "";
      if (!text || !FOOTNOTE_SUFFIX_PATTERN.test(text)) {
        return;
      }

      const [primary] = text.split("-");
      if (primary && primary !== text) {
        anchor.textContent = primary;
      }
    });
};

const INLINE_CITATION_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

const linkInlineCitations = (root: HTMLElement): void => {
  const sourceItems = root.querySelectorAll(".copilot-sources__item");
  if (sourceItems.length === 0) return;

  const citationAnchors = new Map<number, HTMLAnchorElement>();
  sourceItems.forEach((item) => {
    const indexEl = item.querySelector(".copilot-sources__index");
    const textEl = item.querySelector(".copilot-sources__text");
    if (!indexEl || !textEl) return;

    const indexMatch = indexEl.textContent?.match(/\[(\d+)\]/);
    if (!indexMatch) return;
    const num = parseInt(indexMatch[1], 10);

    const link = textEl.querySelector("a");
    if (link) {
      citationAnchors.set(num, link);
    }
  });

  if (citationAnchors.size === 0) return;

  const doc = root.doc;

  const sourcesEl = root.querySelector(".copilot-sources");
  const textNodes: Text[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (sourcesEl?.contains(node)) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest("code, pre")) return NodeFilter.FILTER_REJECT;
      INLINE_CITATION_RE.lastIndex = 0;
      if (INLINE_CITATION_RE.test(node.textContent || "")) {
        INLINE_CITATION_RE.lastIndex = 0;
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_REJECT;
    },
  });

  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) textNodes.push(n);

  textNodes.forEach((node) => {
    const text = node.textContent || "";
    INLINE_CITATION_RE.lastIndex = 0;

    const fragment = doc.win.createFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = INLINE_CITATION_RE.exec(text)) !== null) {
      if (match.index > lastIndex) {
        fragment.appendChild(doc.createTextNode(text.slice(lastIndex, match.index)));
      }

      const nums = match[1].split(/\s*,\s*/).map((s) => parseInt(s.trim(), 10));
      const allResolved = nums.every((num) => citationAnchors.has(num));

      if (allResolved) {
        const span = doc.win.createSpan("copilot-citation-group");
        span.appendChild(doc.createTextNode("["));
        nums.forEach((num, i) => {
          if (i > 0) span.appendChild(doc.createTextNode(", "));
          const sourceAnchor = citationAnchors.get(num)!;
          const link = doc.win.createEl("a");
          for (const attr of Array.from(sourceAnchor.attributes)) {
            link.setAttribute(attr.name, attr.value);
          }
          link.className = `copilot-citation-link${sourceAnchor.className ? ` ${sourceAnchor.className}` : ""}`;
          link.textContent = String(num);
          link.setAttribute("aria-label", `Source ${num}`);
          span.appendChild(link);
        });
        span.appendChild(doc.createTextNode("]"));
        fragment.appendChild(span);
      } else {
        fragment.appendChild(doc.createTextNode(match[0]));
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(doc.createTextNode(text.slice(lastIndex)));
    }

    const replaceTarget = node.parentElement?.classList.contains("copilot-citation-ref")
      ? node.parentElement
      : node;
    replaceTarget.parentNode?.replaceChild(fragment, replaceTarget);
  });
};

function MessageContext({ context }: { context: ChatMessage["context"] }) {
  if (
    !context ||
    (!context.notes?.length &&
      !context.webTabs?.length &&
      !context.tags?.length &&
      !context.folders?.length &&
      !context.selectedTextContexts?.length)
  ) {
    return null;
  }

  return (
    <div className="tw-flex tw-flex-wrap tw-gap-2">
      {context.notes.map((note, index) => (
        // eslint-disable-next-line @eslint-react/no-array-index-key -- context arrays may contain duplicate notes (see MessageContext.test.tsx duplicate-handling cases)
        <Tooltip key={`note-${index}-${note.path}`}>
          <TooltipTrigger asChild>
            <div>
              <ContextNoteBadge note={note} />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tw-max-w-sm tw-break-words">{note.path}</TooltipContent>
        </Tooltip>
      ))}
      {context.webTabs?.map((webTab, index) => (
        // eslint-disable-next-line @eslint-react/no-array-index-key -- context arrays may contain duplicates; index disambiguates same-url entries
        <Tooltip key={`webTab-${index}-${webTab.url}`}>
          <TooltipTrigger asChild>
            <div>
              <ContextWebTabBadge webTab={webTab} />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tw-max-w-sm tw-break-words">
            {webTab.title ? (
              <div className="tw-text-left">
                <div className="tw-font-medium">{webTab.title}</div>
                <div>{webTab.url}</div>
              </div>
            ) : (
              webTab.url
            )}
          </TooltipContent>
        </Tooltip>
      ))}
      {context.tags?.map((tag, index) => (
        // eslint-disable-next-line @eslint-react/no-array-index-key -- context arrays may contain duplicates; index disambiguates same-value entries
        <Tooltip key={`tag-${index}-${tag}`}>
          <TooltipTrigger asChild>
            <div>
              <ContextTagBadge tag={tag} />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tw-max-w-sm tw-break-words">{tag}</TooltipContent>
        </Tooltip>
      ))}
      {context.folders?.map((folder, index) => (
        // eslint-disable-next-line @eslint-react/no-array-index-key -- context arrays may contain duplicates; index disambiguates same-value entries
        <Tooltip key={`folder-${index}-${folder}`}>
          <TooltipTrigger asChild>
            <div>
              <ContextFolderBadge folder={folder} />
            </div>
          </TooltipTrigger>
          <TooltipContent className="tw-max-w-sm tw-break-words">{folder}</TooltipContent>
        </Tooltip>
      ))}
      {context.selectedTextContexts?.map((selectedText, index) => (
        <ContextSelectedTextBadge
          // eslint-disable-next-line @eslint-react/no-array-index-key -- context arrays may contain duplicates; index disambiguates same-id entries
          key={`selectedText-${index}-${selectedText.id}`}
          selectedText={selectedText}
        />
      ))}
    </div>
  );
}

interface ChatSingleMessageProps {
  message: ChatMessage;
  app: App;
  sourcePath?: string;
  isStreaming: boolean;
  footerStart?: React.ReactNode;
  onFork?: () => void;
  forkDisabled?: boolean;
}

const ChatSingleMessage: React.FC<ChatSingleMessageProps> = ({
  message,
  app,
  sourcePath = "",
  isStreaming,
  footerStart,
  onFork,
  forkDisabled,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const messageId = useRef(
    message.id ||
      (message.timestamp?.epoch
        ? String(message.timestamp.epoch)
        : `temp-${Date.now()}-${Math.random()}`)
  );

  const collapsibleOpenStateMapRef = useRef(getMessageCollapsibleStates(messageId.current));
  const collapsibleOpenStateMap = collapsibleOpenStateMapRef.current;

  const settings = useSettingsValue();

  const preprocess = useCallback(
    (content: string): string => {
      const activeFile = app.workspace.getActiveFile();
      const sourcePath = activeFile ? activeFile.path : "";

      const processCollapsibleSection = (
        content: string,
        tagName: string,
        summaryText: string,
        streamingSummaryText: string
      ): string => {
        const detailsStyle = `margin: 0.5rem 0 1.5rem; padding: 0.75rem; border: 1px solid var(--background-modifier-border); border-radius: 4px; background-color: var(--background-secondary)`;
        const summaryStyle = `cursor: pointer; color: var(--text-muted); font-size: 0.8em; margin-bottom: 0.5rem; user-select: none`;
        const contentStyle = `margin-top: 0.75rem; padding: 0.75rem; border-radius: 4px; background-color: var(--background-primary)`;

        const openTag = `<${tagName}>`;
        let sectionIndex = 0;

        const ensureClosingTagOnNewLine = (text: string) => text.trim() + "\n";

        const buildDetails = (sectionContent: string, openAttr: string, domId: string) =>
          `<details id="${domId}"${openAttr} style="${detailsStyle}">` +
          `<summary style="${summaryStyle}">${summaryText}</summary>` +
          `<div class="tw-text-muted" style="${contentStyle}">${ensureClosingTagOnNewLine(sectionContent)}</div>` +
          `</details>\n\n`;

        if (isStreaming && content.includes(openTag)) {
          const completeRegex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "g");
          content = content.replace(completeRegex, (_match, sectionContent: string) => {
            const sectionKey = `${tagName}-${sectionIndex}`;
            sectionIndex += 1;
            const domId = buildCopilotCollapsibleDomId(messageId.current, sectionKey);
            const openAttribute = collapsibleOpenStateMap.get(domId) ? " open" : "";
            return buildDetails(sectionContent, openAttribute, domId);
          });

          const unClosedRegex = new RegExp(`<${tagName}>([\\s\\S]*)$`);
          content = content.replace(
            unClosedRegex,
            (_match, partialContent: string) =>
              `<div style="${detailsStyle}">` +
              `<div style="${summaryStyle}">${streamingSummaryText}</div>` +
              `<div class="tw-text-muted" style="${contentStyle}">${ensureClosingTagOnNewLine(partialContent)}</div>` +
              `</div>`
          );
          return content;
        }

        const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "g");
        return content.replace(regex, (_match, sectionContent: string) => {
          const sectionKey = `${tagName}-${sectionIndex}`;
          sectionIndex += 1;
          const domId = buildCopilotCollapsibleDomId(messageId.current, sectionKey);
          const openAttribute = collapsibleOpenStateMap.get(domId) ? " open" : "";
          return buildDetails(sectionContent, openAttribute, domId);
        });
      };

      const processThinkSection = (content: string): string => {
        return processCollapsibleSection(
          content,
          "think",
          t("Thought for a while"),
          t("Thinking...")
        );
      };

      const replaceLinks = (text: string, regex: RegExp, template: (file: TFile) => string) => {
        const parts = text.split(/(```[\s\S]*?```|`[^`]*`)/g);

        return parts
          .map((part, index) => {
            if (index % 2 === 0) {
              return part.replace(regex, (match: string, selection: string) => {
                const file = app.metadataCache.getFirstLinkpathDest(selection, sourcePath);
                return file ? template(file) : match;
              });
            }
            return part;
          })
          .join("");
      };

      const commonProcessed = preprocessAIResponse(content);

      const noteImageProcessed = replaceLinks(
        commonProcessed,
        /!\[\[(.*?)]]/g,
        (file) => `![](${app.vault.getResourcePath(file)})`
      );

      const thinkSectionProcessed = processThinkSection(noteImageProcessed);

      const sourcesSectionProcessed = processInlineCitations(
        thinkSectionProcessed,
        settings.enableInlineCitations
      );

      const citationPlaceholderProcessed = sourcesSectionProcessed.replace(
        /\[\^(\d+)\](?!:)/g,
        '<span class="copilot-citation-ref">[$1]</span>'
      );

      const processYouTubeEmbed = (content: string): string => {
        if (!isStreaming) {
          return content;
        }

        const imageEmbedRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;

        return content.replace(imageEmbedRegex, (match, title: string, url: string) => {
          const videoId = extractYoutubeVideoId(url);
          if (!videoId) {
            return match;
          }
          const displayTitle = title || t("YouTube Video");
          const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
          return `[![${displayTitle}](${thumbnail})](${url})`;
        });
      };

      return processYouTubeEmbed(citationPlaceholderProcessed);
    },
    [app, isStreaming, settings.enableInlineCitations, collapsibleOpenStateMap]
  );

  useEffect(() => {
    const root = contentRef.current;
    if (!root || message.sender === USER_SENDER || !isStreaming) {
      return;
    }

    const handleSummaryPointerDown = (event: Event): void => {
      if (event instanceof PointerEvent && (event.button !== 0 || !event.isPrimary)) {
        return;
      }

      const details = getCopilotCollapsibleDetailsFromEvent(event, root);
      if (!details || !isEventWithinDetailsSummary(event, details)) {
        return;
      }

      const nextOpen = !details.open;
      details.open = nextOpen;
      collapsibleOpenStateMap.set(details.id, nextOpen);
    };

    const handleSummaryClick = (event: Event): void => {
      const details = getCopilotCollapsibleDetailsFromEvent(event, root);
      if (!details || !isEventWithinDetailsSummary(event, details)) {
        return;
      }
      event.preventDefault();
    };

    const handleDetailsToggle = (event: Event): void => {
      const details = getCopilotCollapsibleDetailsFromEvent(event, root);
      if (!details) {
        return;
      }
      collapsibleOpenStateMap.set(details.id, details.open);
    };

    root.addEventListener("pointerdown", handleSummaryPointerDown, true);
    root.addEventListener("click", handleSummaryClick, true);
    root.addEventListener("toggle", handleDetailsToggle, true);
    return () => {
      root.removeEventListener("pointerdown", handleSummaryPointerDown, true);
      root.removeEventListener("click", handleSummaryClick, true);
      root.removeEventListener("toggle", handleDetailsToggle, true);
    };
  }, [isStreaming, message.sender, collapsibleOpenStateMap]);

  useEffect(() => {
    const target = contentRef.current;
    if (!target || message.sender === USER_SENDER) return;

    captureCopilotCollapsibleOpenStates(target, collapsibleOpenStateMap, {
      overwriteExisting: !isStreaming,
    });

    const component = new Component();
    component.load();
    let cancelled = false;
    const textDiv = target.doc.win.createDiv("message-segment markdown-rendered");
    target.replaceChildren(textDiv);

    void renderMarkdown(
      app,
      preprocess(message.message),
      textDiv,
      app.workspace.getActiveFile()?.path ?? "",
      component
    )
      .then(() => {
        if (cancelled) return;
        normalizeFootnoteRendering(textDiv);
        if (!isStreaming) linkInlineCitations(target);
      })
      .catch((error: unknown) => logError("renderMarkdown failed", error));

    return () => {
      cancelled = true;
      component.unload();
    };
  }, [message, app, isStreaming, preprocess, collapsibleOpenStateMap]);

  const handleInsertIntoEditor = () => {
    void insertAtCursor(app, message.message);
  };

  const renderMessageContent = () => {
    if (message.content) {
      return (
        <div className="tw-flex tw-flex-col tw-gap-3">
          {(message.content as Array<{ type: string; image_url?: { url: string } }>).map(
            (item, index) => {
              if (item.type === "text") {
                return (
                  // eslint-disable-next-line @eslint-react/no-array-index-key -- content array is fixed once message is rendered; items not reordered
                  <div key={index}>
                    {message.sender === USER_SENDER ? (
                      <Markdown
                        text={message.message}
                        sourcePath={sourcePath}
                        className="tw-break-words tw-text-[calc(var(--font-text-size)_-_2px)] tw-font-normal"
                      />
                    ) : (
                      <div
                        ref={contentRef}
                        className={message.isErrorMessage ? "tw-text-error" : ""}
                      ></div>
                    )}
                  </div>
                );
              } else if (item.type === "image_url") {
                return (
                  // eslint-disable-next-line @eslint-react/no-array-index-key -- content array is fixed once message is rendered; items not reordered
                  <div key={index} className="message-image-content">
                    <img
                      src={item.image_url!.url}
                      alt={t("User uploaded image")}
                      className="chat-message-image"
                    />
                  </div>
                );
              }
              return null;
            }
          )}
        </div>
      );
    }

    return message.sender === USER_SENDER ? (
      <Markdown
        text={message.message}
        sourcePath={sourcePath}
        className="tw-break-words tw-text-[calc(var(--font-text-size)_-_2px)] tw-font-normal"
      />
    ) : (
      <div ref={contentRef} className={message.isErrorMessage ? "tw-text-error" : ""}></div>
    );
  };

  return (
    <div className="tw-my-1 tw-flex tw-w-full tw-flex-col">
      <div
        className={cn(
          "tw-group tw-mx-2 tw-rounded-md tw-p-2",
          message.sender === USER_SENDER && "tw-border tw-border-solid tw-border-border"
        )}
        style={
          message.sender === USER_SENDER
            ? { backgroundColor: "var(--background-modifier-hover)" }
            : undefined
        }
      >
        <div className="tw-flex tw-max-w-full tw-flex-col tw-gap-2 tw-overflow-hidden">
          <MessageContext context={message.context} />

          <div className="message-content tw-break-words !tw-leading-[1.6]">
            {message.sender === USER_SENDER ? (
              <ClampedContent collapsedClassName={COLLAPSED_USER_MESSAGE_CLASS_NAME}>
                {renderMessageContent()}
              </ClampedContent>
            ) : (
              renderMessageContent()
            )}
          </div>

          {!isStreaming && (
            <AssistantResponseFooter
              leading={footerStart}
              timestamp={message.timestamp?.display}
              actions={
                <ChatButtons
                  message={message}
                  onInsertIntoEditor={handleInsertIntoEditor}
                  onFork={onFork}
                  forkDisabled={forkDisabled}
                />
              }
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatSingleMessage;
