import { USER_SENDER } from "@/constants";
import { ChatMessage } from "@/types/message";
import { useCallback, useRef, useState, useEffect, useLayoutEffect } from "react";

const END_THRESHOLD_PX = 24;

const isNearEnd = (node: HTMLElement): boolean =>
  node.scrollHeight - node.clientHeight - node.scrollTop <= END_THRESHOLD_PX;

interface UseChatScrollingOptions {
  chatHistory: ChatMessage[];
}

interface UseChatScrollingReturn {
  scrollContainerCallbackRef: (node: HTMLDivElement | null) => void;
  contentCallbackRef: (node: HTMLDivElement | null) => void;
  onScroll: () => void;
  isScrollPaused: boolean;
  scrollToEnd: () => void;
  getMessageKey: (message: ChatMessage, index: number) => string;
}

export const useChatScrolling = ({
  chatHistory,
}: UseChatScrollingOptions): UseChatScrollingReturn => {
  const [isScrollPaused, setIsScrollPaused] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const isFollowingRef = useRef(true);
  const resizeFrameRef = useRef<{ win: Window; id: number } | null>(null);
  const lastScrollTopRef = useRef(0);

  const getMessageKey = useCallback((message: ChatMessage, index: number): string => {
    return `message-${message.id || message.timestamp?.epoch || index}`;
  }, []);

  const alignToEnd = useCallback(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    lastScrollTopRef.current = node.scrollTop;
  }, []);

  const scrollToEnd = useCallback(() => {
    isFollowingRef.current = true;
    setIsScrollPaused(false);
    alignToEnd();
  }, [alignToEnd]);

  const onScroll = useCallback(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    if (isNearEnd(node)) {
      isFollowingRef.current = true;
      setIsScrollPaused(false);
    } else if (node.scrollTop < lastScrollTopRef.current) {
      isFollowingRef.current = false;
      setIsScrollPaused(true);
    }
    lastScrollTopRef.current = node.scrollTop;
  }, []);

  const scrollContainerCallbackRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === scrollContainerRef.current) return;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      if (resizeFrameRef.current) {
        resizeFrameRef.current.win.cancelAnimationFrame(resizeFrameRef.current.id);
        resizeFrameRef.current = null;
      }
      scrollContainerRef.current = node;

      if (node) {
        let viewportHeight = node.clientHeight;
        const Observer = (node.win as Window & typeof window).ResizeObserver;
        const resizeObserver = new Observer(() => {
          if (resizeFrameRef.current) return;
          const win = node.win;
          const id = win.requestAnimationFrame(() => {
            resizeFrameRef.current = null;
            const viewportChanged = node.clientHeight !== viewportHeight;
            viewportHeight = node.clientHeight;
            // 内容收缩不代表用户愿意返回底部；只保留原有窗口变高的跟随规则。https://github.com/ItsDalk-Lane/Scribe/issues/72
            if (isFollowingRef.current || (viewportChanged && isNearEnd(node))) scrollToEnd();
          });
          resizeFrameRef.current = { win, id };
        });
        resizeObserver.observe(node);
        if (contentRef.current) resizeObserver.observe(contentRef.current);
        resizeObserverRef.current = resizeObserver;
      }
    },
    [scrollToEnd]
  );

  const contentCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (node === contentRef.current) return;
    if (contentRef.current) resizeObserverRef.current?.unobserve(contentRef.current);
    contentRef.current = node;
    if (node) resizeObserverRef.current?.observe(node);
  }, []);

  useLayoutEffect(() => {
    if (isFollowingRef.current) alignToEnd();
  }, [chatHistory, alignToEnd]);

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
      if (resizeFrameRef.current) {
        resizeFrameRef.current.win.cancelAnimationFrame(resizeFrameRef.current.id);
        resizeFrameRef.current = null;
      }
    };
  }, []);

  const lastSeenUserMessageIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    let latestUserMessage: ChatMessage | undefined;
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const m = chatHistory[i];
      if (m.isVisible && m.sender === USER_SENDER) {
        latestUserMessage = m;
        break;
      }
    }
    const latestId = latestUserMessage
      ? `${latestUserMessage.id ?? latestUserMessage.timestamp?.epoch ?? ""}`
      : undefined;

    if (lastSeenUserMessageIdRef.current === undefined) {
      lastSeenUserMessageIdRef.current = latestId;
      return;
    }
    if (latestId && latestId !== lastSeenUserMessageIdRef.current) {
      lastSeenUserMessageIdRef.current = latestId;
      scrollToEnd();
    }
  }, [chatHistory, scrollToEnd]);

  return {
    scrollContainerCallbackRef,
    contentCallbackRef,
    onScroll,
    isScrollPaused,
    scrollToEnd,
    getMessageKey,
  };
};
