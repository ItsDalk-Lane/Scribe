import { t } from "@/lib/i18n";
import { formatChatDeleteNotice } from "@/lib/chatDeleteText";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { GLOBAL_SCOPE, type ProjectScopeId } from "@/agentMode/session/scope";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { logError } from "@/logger";
import type ScribePlugin from "@/main";
import { buildChatDeepLink } from "@/utils/chatDeepLink";
import { getUrlBookmarks, isBookmarksPluginDisabled } from "@/utils/obsidianBookmarks";
import { Notice } from "obsidian";
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
  copyChatLink: (id: string) => Promise<void>;
  getChatBookmarkState: (id: string) => Promise<ChatBookmarkState>;
  setChatBookmarked: (id: string, title: string, bookmarked: boolean) => Promise<void>;
  setActiveChatBookmarked: (bookmarked: boolean) => Promise<void>;
}

export type ChatBookmarkState = "unavailable" | "off" | "bookmarked" | "not-bookmarked";
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
            const link = await manager
              .getChatLinkId(id)
              .then((key) => key && buildChatDeepLink(plugin.app.vault.getName(), key));
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

  const copyChatLink = useCallback((id: string) => plugin.copyChatLink(async () => id), [plugin]);

  const getChatBookmarkState = useCallback(
    async (id: string): Promise<ChatBookmarkState> => {
      const state = await runWithNotice(t("read bookmarks"), async () => {
        const bookmarks = getUrlBookmarks(plugin.app);
        if (!bookmarks) return isBookmarksPluginDisabled(plugin.app) ? "off" : "unavailable";
        const link = await manager
          .getChatLinkId(id)
          .then((key) => key && buildChatDeepLink(plugin.app.vault.getName(), key));
        return link && bookmarks.has(link) ? "bookmarked" : "not-bookmarked";
      });
      return state ?? "unavailable";
    },
    [manager, plugin, runWithNotice]
  );

  const setChatBookmarked = useCallback(
    async (id: string, title: string, bookmarked: boolean) => {
      await runWithNotice(bookmarked ? t("bookmark chat") : t("remove bookmark"), async () => {
        const bookmarks = getUrlBookmarks(plugin.app);
        if (!bookmarks) throw new Error(t("The Bookmarks core plugin is not enabled."));
        const key = await manager.getChatLinkId(id);
        const link = key && buildChatDeepLink(plugin.app.vault.getName(), key);
        if (!link) throw new Error(t('No chat link for "{p0}".', { p0: id }));
        if (bookmarked) {
          bookmarks.add(link, title);
          new Notice(t("Bookmarked."));
        } else {
          bookmarks.remove(link);
          new Notice(t("Removed from bookmarks."));
        }
      });
    },
    [manager, plugin, runWithNotice]
  );

  const setActiveChatBookmarked = useCallback(
    async (bookmarked: boolean) => {
      await runWithNotice(bookmarked ? t("bookmark chat") : t("remove bookmark"), async () => {
        const session = manager.getActiveSession();
        if (!session) return;
        await setChatBookmarked(
          manager.getSessionHistoryId(session.internalId),
          session.getLabel() ?? t("Chat"),
          bookmarked
        );
      });
    },
    [manager, runWithNotice, setChatBookmarked]
  );

  return {
    chatHistoryItems: visibleChatHistoryItems,
    chatHistorySettled,
    loadChatHistory,
    loadChat,
    updateChatTitle,
    deleteChat,
    setChatPinned,
    copyChatLink,
    getChatBookmarkState,
    setChatBookmarked,
    setActiveChatBookmarked,
  };
}
