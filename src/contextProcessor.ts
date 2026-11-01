import { logWarn, logError } from "@/logger";
import { escapeXml } from "@/LLMProviders/chainRunner/utils/xmlParsing";
import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";
import { WebViewerTimeoutError } from "@/services/webViewerService/webViewerServiceTypes";
import { normalizeUrlString } from "@/utils/urlNormalization";
import type { App } from "obsidian";
import {
  WEB_TAB_CONTEXT_TAG,
  ACTIVE_WEB_TAB_CONTEXT_TAG,
  YOUTUBE_VIDEO_CONTEXT_TAG,
} from "@/constants";

export class ContextProcessor {
  private static instance: ContextProcessor;
  private app: App;

  private constructor(app: App) {
    this.app = app;
  }

  static getInstance(app?: App): ContextProcessor {
    if (!ContextProcessor.instance) {
      if (!app) {
        throw new Error(
          "ContextProcessor.getInstance() requires `app` on first call (seed it at plugin load)."
        );
      }
      ContextProcessor.instance = new ContextProcessor(app);
    }
    return ContextProcessor.instance;
  }

  async processContextWebTabs(
    webTabs: Array<{ url: string; title?: string; faviconUrl?: string; isActive?: boolean }>
  ): Promise<string> {
    if (!webTabs || webTabs.length === 0) {
      return "";
    }

    const WEBVIEW_READY_TIMEOUT_MS = 2_500;
    const READER_MODE_CONTENT_TIMEOUT_MS = 8_000;
    const YOUTUBE_TRANSCRIPT_TIMEOUT_MS = 15_000;
    const MAX_CONCURRENCY = 2;

    const buildWebTabBlock = (
      tagName: string,
      options: {
        title: string;
        url: string;
        mode?: string;
        content?: string;
        error?: string;
      }
    ): string => {
      const parts = [
        `\n\n<${tagName}>`,
        `\n<title>${escapeXml(options.title)}</title>`,
        `\n<url>${escapeXml(options.url)}</url>`,
      ];

      if (options.mode) {
        parts.push(`\n<mode>${escapeXml(options.mode)}</mode>`);
      }

      if (options.error) {
        parts.push(`\n<error>${escapeXml(options.error)}</error>`);
      } else if (options.content !== undefined) {
        parts.push(`\n<content>\n${escapeXml(options.content)}\n</content>`);
      }

      parts.push(`\n</${tagName}>`);
      return parts.join("");
    };

    const buildYouTubeBlock = (options: {
      title: string;
      url: string;
      videoId: string;
      channel?: string;
      description?: string;
      uploadDate?: string;
      duration?: string;
      genre?: string;
      transcript?: string;
      error?: string;
      isActive?: boolean;
    }): string => {
      const parts = [
        `\n\n<${YOUTUBE_VIDEO_CONTEXT_TAG}>`,
        `\n<title>${escapeXml(options.title)}</title>`,
        `\n<url>${escapeXml(options.url)}</url>`,
        `\n<video_id>${escapeXml(options.videoId)}</video_id>`,
      ];

      if (options.isActive) {
        parts.push(`\n<is_active>true</is_active>`);
      }

      if (options.channel) {
        parts.push(`\n<channel>${escapeXml(options.channel)}</channel>`);
      }

      if (options.uploadDate) {
        parts.push(`\n<upload_date>${escapeXml(options.uploadDate)}</upload_date>`);
      }

      if (options.duration) {
        parts.push(`\n<duration>${escapeXml(options.duration)}</duration>`);
      }

      if (options.genre) {
        parts.push(`\n<genre>${escapeXml(options.genre)}</genre>`);
      }

      if (options.description) {
        parts.push(`\n<description>${escapeXml(options.description)}</description>`);
      }

      if (options.error) {
        parts.push(`\n<error>${escapeXml(options.error)}</error>`);
      }

      const content = options.transcript || "No transcript available for this video";
      parts.push(`\n<content>\n${escapeXml(content)}\n</content>`);

      parts.push(`\n</${YOUTUBE_VIDEO_CONTEXT_TAG}>`);
      return parts.join("");
    };

    let activeTab: { url: string; title?: string; faviconUrl?: string } | null = null;
    const normalTabs: Array<{ url: string; title?: string; faviconUrl?: string }> = [];
    const seenUrls = new Set<string>();
    const seenVideoIds = new Set<string>();
    const service = getWebViewerService(this.app);

    const isDuplicate = (url: string): boolean => {
      const videoId = service.getYouTubeVideoId(url);
      if (videoId) {
        if (seenVideoIds.has(videoId)) return true;
        seenVideoIds.add(videoId);
        return false;
      }
      if (seenUrls.has(url)) return true;
      seenUrls.add(url);
      return false;
    };

    for (const tab of webTabs) {
      const url = normalizeUrlString(tab.url);
      if (!url) continue;

      if (tab.isActive && !activeTab) {
        activeTab = { ...tab, url };
        isDuplicate(url);
      }
    }

    for (const tab of webTabs) {
      const url = normalizeUrlString(tab.url);
      if (!url || isDuplicate(url)) continue;

      normalTabs.push({ ...tab, url });
    }

    if (!activeTab && normalTabs.length === 0) {
      return "";
    }

    const availability = service.getAvailability();
    if (!availability.supported || !availability.available) {
      const reason =
        availability.reason ??
        (availability.supported
          ? "Web Viewer is not available."
          : "Web Viewer is not supported on this platform.");

      const blocks: string[] = [];
      if (activeTab) {
        blocks.push(
          buildWebTabBlock(ACTIVE_WEB_TAB_CONTEXT_TAG, {
            title: activeTab.title || "Unknown",
            url: activeTab.url,
            error: reason,
          })
        );
      }
      for (const tab of normalTabs) {
        blocks.push(
          buildWebTabBlock(WEB_TAB_CONTEXT_TAG, {
            title: tab.title || "Unknown",
            url: tab.url,
            error: reason,
          })
        );
      }
      return blocks.join("");
    }

    const processTab = async (
      tab: { url: string; title?: string; faviconUrl?: string },
      tagName: string
    ): Promise<string> => {
      try {
        const url = tab.url;

        const videoId = service.getYouTubeVideoId(url);
        if (videoId) {
          const isActive = tagName === ACTIVE_WEB_TAB_CONTEXT_TAG;
          return await processYouTubeTab(tab, videoId, isActive);
        }

        const leaf = service.findLeafByUrl(url, { title: tab.title });
        if (!leaf) {
          return buildWebTabBlock(tagName, {
            title: tab.title || "Unknown",
            url,
            error: "Web tab not found or closed",
          });
        }

        let pageInfo = service.getPageInfo(leaf);

        const view = leaf.view as { webviewMounted?: boolean; webviewFirstLoadFinished?: boolean };
        const webviewReady =
          view.webviewMounted === undefined || view.webviewFirstLoadFinished === undefined
            ? true
            : Boolean(view.webviewMounted && view.webviewFirstLoadFinished);
        if (!webviewReady) {
          try {
            await service.waitForWebviewReady(leaf, WEBVIEW_READY_TIMEOUT_MS);
            pageInfo = service.getPageInfo(leaf);
          } catch (err) {
            logWarn(`Web tab content not loaded yet for ${url}:`, err);
            return buildWebTabBlock(tagName, {
              title: pageInfo.title || tab.title || "Untitled",
              url: pageInfo.url || url,
              mode: pageInfo.mode,
              error: "Web tab content not loaded yet",
            });
          }
        }

        const abortController = new AbortController();
        const timeoutId = window.setTimeout(() => {
          abortController.abort();
        }, READER_MODE_CONTENT_TIMEOUT_MS);

        try {
          const content = await service.getReaderModeMarkdown(leaf, {
            signal: abortController.signal,
          });
          pageInfo = service.getPageInfo(leaf);

          return buildWebTabBlock(tagName, {
            title: pageInfo.title || tab.title || "Untitled",
            url: pageInfo.url || url,
            mode: pageInfo.mode,
            content,
          });
        } finally {
          window.clearTimeout(timeoutId);
        }
      } catch (error) {
        logError(`Error processing web tab ${tab.url}:`, error);
        return buildWebTabBlock(tagName, {
          title: tab.title || "Unknown",
          url: tab.url,
          error:
            error instanceof WebViewerTimeoutError
              ? "Web tab content extraction timed out"
              : "Could not process web tab",
        });
      }
    };

    const processYouTubeTab = async (
      tab: { url: string; title?: string; faviconUrl?: string },
      videoId: string,
      isActive: boolean
    ): Promise<string> => {
      try {
        let leaf = null;
        let actualUrl = tab.url;

        for (const l of service.getLeaves()) {
          const leafUrl = service.getPageInfo(l).url;
          if (service.getYouTubeVideoId(leafUrl) === videoId) {
            leaf = l;
            actualUrl = leafUrl;
            break;
          }
        }

        if (!leaf) {
          return buildYouTubeBlock({
            title: tab.title || "YouTube Video",
            url: tab.url,
            videoId,
            isActive,
            error: "Web tab not found or closed",
          });
        }

        const view = leaf.view as { webviewMounted?: boolean; webviewFirstLoadFinished?: boolean };
        const webviewReady =
          view.webviewMounted === undefined || view.webviewFirstLoadFinished === undefined
            ? true
            : Boolean(view.webviewMounted && view.webviewFirstLoadFinished);
        if (!webviewReady) {
          try {
            await service.waitForWebviewReady(leaf, WEBVIEW_READY_TIMEOUT_MS);
          } catch (err) {
            logWarn(`YouTube tab content not loaded yet for ${actualUrl}:`, err);
            return buildYouTubeBlock({
              title: tab.title || "YouTube Video",
              url: actualUrl,
              videoId,
              isActive,
              error: "Web tab content not loaded yet",
            });
          }
        }

        const result = await service.getYouTubeTranscript(leaf, {
          timeoutMs: YOUTUBE_TRANSCRIPT_TIMEOUT_MS,
        });

        const transcriptText =
          result.transcript.length > 0
            ? result.transcript.map((seg) => `${seg.timestamp}: ${seg.text}`).join("\n")
            : undefined;

        return buildYouTubeBlock({
          title: result.title || tab.title || "YouTube Video",
          url: actualUrl,
          videoId: result.videoId,
          channel: result.channel,
          description: result.description,
          uploadDate: result.uploadDate,
          duration: result.duration,
          genre: result.genre,
          transcript: transcriptText,
          isActive,
        });
      } catch (err) {
        logWarn(`YouTube transcript extraction failed for ${tab.url}:`, err);

        return buildYouTubeBlock({
          title: tab.title || "YouTube Video",
          url: tab.url,
          videoId,
          isActive,
          error: err instanceof Error ? err.message : "Failed to extract video info",
        });
      }
    };

    const blocks: string[] = [];
    if (activeTab) {
      const activeBlock = await processTab(activeTab, ACTIVE_WEB_TAB_CONTEXT_TAG);
      blocks.push(activeBlock);
    }

    for (let i = 0; i < normalTabs.length; i += MAX_CONCURRENCY) {
      const chunk = normalTabs.slice(i, i + MAX_CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map((tab) => processTab(tab, WEB_TAB_CONTEXT_TAG))
      );
      blocks.push(...chunkResults);
    }

    return blocks.join("");
  }
}
