import { t } from "@/lib/i18n";
import { backendRegistry } from "@/agentMode/backends/registry";
import { ChatBookmarkMenuItem } from "@/agentMode/ui/ChatBookmarkMenuItem";
import type { ChatBookmarkState } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { describeChatDelete } from "@/lib/chatDeleteText";
import {
  ChatHistoryItem,
  ChatHistoryPopover,
} from "@/components/chat-components/ChatHistoryPopover";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettingsValue } from "@/settings/model";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";
import {
  Bookmark,
  Bug,
  Download,
  History,
  Link,
  MessageCirclePlus,
  MoreHorizontal,
} from "lucide-react";
import React, { useCallback, useState } from "react";

const resolveDeleteSummary = describeChatDelete;

const resolveHistoryIcon = (item: ChatHistoryItem) =>
  item.backendId ? backendRegistry[item.backendId]?.Icon : undefined;

const NeedsMessageMenuItem: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <div>
        <DropdownMenuItem disabled>{children}</DropdownMenuItem>
      </div>
    </TooltipTrigger>
    <TooltipContent side="left">{t("Send a message to the chat first.")}</TooltipContent>
  </Tooltip>
);

interface AgentChatControlsProps {
  onNewChat?: () => void;
  onSaveAsNote?: () => void | Promise<void>;
  chatHistoryItems?: ChatHistoryItem[];
  onLoadHistory?: () => void | Promise<void>;
  onLoadChat?: (id: string) => Promise<void>;
  onUpdateChatTitle?: (id: string, newTitle: string) => Promise<void>;
  onDeleteChat?: (id: string) => Promise<void>;
  onCloseSession?: (id: string) => Promise<void>;
  openChatIds?: ReadonlySet<string>;
  runningChatIds?: ReadonlySet<string>;
  onOpenSourceFile?: (id: string) => Promise<void>;
  onCopyChatLink?: () => void | Promise<void>;
  getChatBookmarkState?: () => Promise<ChatBookmarkState>;
  onSetChatBookmarked?: (bookmarked: boolean) => Promise<void>;
  onReportError?: () => void;
  usageMeter?: React.ReactNode;
  tasksIndicator?: React.ReactNode;
}

export const AgentChatControls: React.FC<AgentChatControlsProps> = ({
  onNewChat,
  onSaveAsNote,
  chatHistoryItems,
  onLoadHistory,
  onLoadChat,
  onUpdateChatTitle,
  onDeleteChat,
  onCloseSession,
  openChatIds,
  runningChatIds,
  onOpenSourceFile,
  onCopyChatLink,
  getChatBookmarkState,
  onSetChatBookmarked,
  onReportError,
  usageMeter,
  tasksIndicator,
}) => {
  const settings = useSettingsValue();
  const historyAvailable = Boolean(
    chatHistoryItems && onLoadChat && onUpdateChatTitle && onDeleteChat
  );
  const [moreActionsBody, setMoreActionsBody] = useState<HTMLElement | null>(null);
  const trackMoreActionsBody = useCallback(
    (node: HTMLButtonElement | null) => setMoreActionsBody(node?.ownerDocument.body ?? null),
    []
  );

  return (
    <div className="tw-flex tw-w-full tw-items-center tw-justify-between tw-p-1">
      <div className="tw-ml-1 tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-1">
        {tasksIndicator}
      </div>
      <div className="tw-flex tw-items-center tw-gap-1">
        {usageMeter}
        {onNewChat && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost2" size="icon" title={t("New chat")} onClick={onNewChat}>
                <MessageCirclePlus className="tw-size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("New chat")}</TooltipContent>
          </Tooltip>
        )}
        {!settings.autosaveChat && onSaveAsNote && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost2"
                size="icon"
                title={t("Save chat as note")}
                onClick={() => void onSaveAsNote()}
              >
                <Download className="tw-size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("Save chat as note")}</TooltipContent>
          </Tooltip>
        )}
        {historyAvailable && (
          <Tooltip>
            <ChatHistoryPopover
              chatHistory={chatHistoryItems!}
              onUpdateTitle={onUpdateChatTitle!}
              onDeleteChat={onDeleteChat!}
              onCloseSession={onCloseSession}
              openChatIds={openChatIds}
              runningChatIds={runningChatIds}
              onLoadChat={onLoadChat}
              onOpenSourceFile={onOpenSourceFile}
              getIcon={resolveHistoryIcon}
              getDeleteSummary={resolveDeleteSummary}
            >
              <TooltipTrigger asChild>
                <Button
                  variant="ghost2"
                  size="icon"
                  title={t("Chat history")}
                  onClick={() => {
                    void onLoadHistory?.();
                  }}
                >
                  <History className="tw-size-4" />
                </Button>
              </TooltipTrigger>
            </ChatHistoryPopover>
            <TooltipContent>{t("Chat history")}</TooltipContent>
          </Tooltip>
        )}
        {onNewChat && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost2"
                size="icon"
                title={t("More actions")}
                ref={trackMoreActionsBody}
              >
                <MoreHorizontal className="tw-size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" container={moreActionsBody}>
              {onCopyChatLink ? (
                <DropdownMenuItem onSelect={() => void onCopyChatLink()}>
                  <Link />

                  {t("Copy chat link")}
                </DropdownMenuItem>
              ) : (
                <NeedsMessageMenuItem>
                  <Link />

                  {t("Copy chat link")}
                </NeedsMessageMenuItem>
              )}
              {onSetChatBookmarked &&
                (getChatBookmarkState ? (
                  <ChatBookmarkMenuItem
                    getBookmarkState={getChatBookmarkState}
                    onSetBookmarked={safeAsyncHandler(onSetChatBookmarked)}
                  />
                ) : (
                  <NeedsMessageMenuItem>
                    <Bookmark />

                    {t("Add to bookmarks")}
                  </NeedsMessageMenuItem>
                ))}

              {onReportError && (
                <DropdownMenuItem onSelect={onReportError}>
                  <Bug />

                  {t("Report an issue")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
};
