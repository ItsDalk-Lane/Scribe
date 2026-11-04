import { t } from "@/lib/i18n";
import { formatChatDeleteNotice } from "@/lib/chatDeleteText";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { GLOBAL_SCOPE, type ProjectScopeId } from "@/agentMode/session/scope";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { logError } from "@/logger";
import type ScribePlugin from "@/main";
import { buildChatDeepLink, getSavedChatDeepLinkId } from "@/utils/chatDeepLink";
import { extractChatTitle } from "@/utils/chatHistoryUtils";
import { getUrlBookmarks, isBookmarksPluginDisabled } from "@/utils/obsidianBookmarks";
import { type App, Notice, TFile } from "obsidian";
import { useCallback, useEffect, useRef, useState } from "react";

const EMPTY_CHAT_HISTORY_ITEMS = Object.freeze([]) as unknown as ChatHistoryItem[];

export interface AgentHistoryControls {
  chatHistoryItems: ChatHistoryItem[];
  chatHistorySettled: boolean;
  loadChatHistory: () => Promise<void>;
  loadChat: (id: string) => Promise<void>;
  updateChatTitle: (id: string, newTitle: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  setChatPinned: (id: string, pinned: boolean) => Promise<void>;
  openSourceFile: (id: string) => Promise<void>;
  copyChatLink: (id: string) => Promise<void>;
  getChatBookmarkState: (id: string) => Promise<ChatBookmarkState>;
  setChatBookmarked: (id: string, title: string, bookmarked: boolean) => Promise<void>;
  setActiveChatBookmarked: (bookmarked: boolean) => Promise<void>;
}

export type ChatBookmarkState = "unavailable" | "off" | "bookmarked" | "not-bookmarked";
async function getChatLink(app: App, notePath: string): Promise<string | null> {
  const id = await getSavedChatDeepLinkId(app, notePath);
  return id && buildChatDeepLink(app.vault.getName(), id);
}

export function useAgentHistoryControls(
  manager: AgentSessionManager,
  plugin: ScribePlugin,
  scope?: ProjectScopeId
): AgentHistoryControls {
  const [chatHistoryItems, setChatHistoryItems] = useState<ChatHistoryItem[]>([]);
  const effectiveScope = scope ?? GLOBAL_SCOPE;
  const [loadedScope, setLoadedScope] = useState<ProjectScopeId>(effectiveScope);
  const visibleChatHistoryItems =
    loadedScope === effectiveScope ? chatHistoryItems : EMPTY_CHAT_HISTORY_ITEMS;
  const [settledScope, setSettledScope] = useState<ProjectScopeId | null>(null);
  const chatHistorySettled = settledScope === effectiveScope;

  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const latestScopeRef = useRef(effectiveScope);
  useEffect(() => {
    latestScopeRef.current = effectiveScope;
  }, [effectiveScope]);

  const runWithNotice = useCallback(
    async <T>(label: string, action: () => Promise<T>, rethrow = false): Promise<T | void> => {
      try {
        return await action();
      } catch (error) {
        logError(`[AgentMode] ${label} failed`, error);
        new Notice(t("Failed to {p0}.", { p0: t(label) }));
        if (rethrow) throw error;
      }
    },
    []
  );

  const historyRequestRef = useRef(0);

  const loadChatHistory = useCallback(async () => {
    const requestScope = scope ?? GLOBAL_SCOPE;
    const request = ++historyRequestRef.current;
    const isCurrent = () =>
      isMountedRef.current &&
      latestScopeRef.current === requestScope &&
      historyRequestRef.current === request;
    await runWithNotice(t("load chat history"), async () => {
      const items = await manager.getChatHistoryItems(scope);
      if (isCurrent()) {
        setLoadedScope(requestScope);
        setChatHistoryItems(items);
      }
    });
    if (isCurrent()) {
      setSettledScope(requestScope);
    }
  }, [manager, runWithNotice, scope]);

  const loadChat = useCallback(
    async (id: string) => {
      await runWithNotice(t("load chat"), () => plugin.loadChatById(id));
    },
    [plugin, runWithNotice]
  );

  const updateChatTitle = useCallback(
    async (id: string, newTitle: string) => {
      await runWithNotice(
        t("update chat title"),
        async () => {
          await manager.updateChatTitle(id, newTitle);
          await loadChatHistory();
        },
        true
      );
    },
    [manager, loadChatHistory, runWithNotice]
  );

  const deleteChat = useCallback(
    async (id: string) => {
      try {
        await runWithNotice(
          t("delete chat"),
          async () => {
            const link = await getChatLink(plugin.app, id);
            await manager.deleteChatHistory(id);
            new Notice(formatChatDeleteNotice());
            if (link) {
              await runWithNotice(t("remove chat bookmark"), async () =>
                getUrlBookmarks(plugin.app)?.remove(link)
              );
            }
          },
          true
        );
      } finally {
        await loadChatHistory();
      }
    },
    [manager, loadChatHistory, plugin, runWithNotice]
  );

  const setChatPinned = useCallback(
    async (id: string, pinned: boolean) => {
      await runWithNotice(pinned ? t("pin chat") : t("unpin chat"), async () => {
        const chat = await manager.setChatPinned(id, pinned);
        if (!isMountedRef.current) return;
        historyRequestRef.current++;
        setChatHistoryItems((items) =>
          items.map((item) =>
            item.id === id ? { ...item, id: chat.id, pinnedAt: chat.pinnedAt } : item
          )
        );
      });
    },
    [manager, runWithNotice]
  );

  const openSourceFile = useCallback(
    async (id: string) => {
      await runWithNotice(t("open chat source"), () => plugin.openChatSourceFile(id));
    },
    [plugin, runWithNotice]
  );

  const replaceChatRowId = useCallback((id: string, notePath: string) => {
    if (notePath === id || !isMountedRef.current) return;
    setChatHistoryItems((items) =>
      items.map((item) => (item.id === id ? { ...item, id: notePath } : item))
    );
  }, []);

  const copyChatLink = useCallback(
    (id: string) =>
      plugin.copyChatLink(async () => {
        const notePath = await manager.ensureChatNote(id);
        replaceChatRowId(id, notePath);
        return notePath;
      }),
    [manager, plugin, replaceChatRowId]
  );

  const getChatBookmarkState = useCallback(
    async (id: string): Promise<ChatBookmarkState> => {
      const state = await runWithNotice(t("read bookmarks"), async () => {
        const bookmarks = getUrlBookmarks(plugin.app);
        if (!bookmarks) return isBookmarksPluginDisabled(plugin.app) ? "off" : "unavailable";
        const link = await getChatLink(plugin.app, id);
        return link && bookmarks.has(link) ? "bookmarked" : "not-bookmarked";
      });
      return state ?? "unavailable";
    },
    [plugin, runWithNotice]
  );

  const setChatBookmarked = useCallback(
    async (id: string, title: string, bookmarked: boolean) => {
      await runWithNotice(bookmarked ? t("bookmark chat") : t("remove bookmark"), async () => {
        const bookmarks = getUrlBookmarks(plugin.app);
        if (!bookmarks) throw new Error(t("The Bookmarks core plugin is not enabled."));
        const notePath = bookmarked ? await manager.ensureChatNote(id) : id;
        const link = await getChatLink(plugin.app, notePath);
        if (!link) throw new Error(t('No chat link for "{p0}".', { p0: notePath }));
        if (bookmarked) {
          bookmarks.add(link, title);
          new Notice(t("Bookmarked."));
        } else {
          bookmarks.remove(link);
          new Notice(t("Removed from bookmarks."));
        }
        replaceChatRowId(id, notePath);
      });
    },
    [manager, plugin, runWithNotice, replaceChatRowId]
  );

  const setActiveChatBookmarked = useCallback(
    async (bookmarked: boolean) => {
      await runWithNotice(bookmarked ? t("bookmark chat") : t("remove bookmark"), async () => {
        const session = manager.getActiveSession();
        const label = session?.getLabel();
        const path = bookmarked
          ? (await manager.saveActiveSession())?.path
          : session && manager.getSessionSourcePath(session.internalId);
        const file = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
        if (!(file instanceof TFile)) throw new Error(t("The active chat has no saved note."));
        await setChatBookmarked(file.path, label ?? extractChatTitle(plugin.app, file), bookmarked);
      });
    },
    [manager, plugin, runWithNotice, setChatBookmarked]
  );

  return {
    chatHistoryItems: visibleChatHistoryItems,
    chatHistorySettled,
    loadChatHistory,
    loadChat,
    updateChatTitle,
    deleteChat,
    setChatPinned,
    openSourceFile,
    copyChatLink,
    getChatBookmarkState,
    setChatBookmarked,
    setActiveChatBookmarked,
  };
}
