import { t } from "@/lib/i18n";
import { CopyButton } from "@/components/chat-components/CopyButton";
import { MessageActionButton } from "@/components/chat-components/MessageActionButton";
import { USER_SENDER } from "@/constants";
import { cn } from "@/lib/utils";
import { ChatMessage } from "@/types/message";
import { cleanMessageForCopy } from "@/utils";
import { GitFork, TextCursorInput } from "lucide-react";
import { Platform } from "obsidian";
import React from "react";

interface ChatButtonsProps {
  message: ChatMessage;
  onInsertIntoEditor?: () => void;
  onFork?: () => void;
  forkDisabled?: boolean;
}

export const ChatButtons: React.FC<ChatButtonsProps> = ({
  message,
  onInsertIntoEditor,
  onFork,
  forkDisabled,
}) => {
  return (
    <div
      className={cn("tw-flex tw-gap-1", {
        "group-hover:opacity-100 opacity-0": !Platform.isMobile,
      })}
    >
      {message.sender !== USER_SENDER && (
        <MessageActionButton
          label={t("Insert / Replace at cursor")}
          icon={TextCursorInput}
          onClick={onInsertIntoEditor}
        />
      )}
      {message.sender !== USER_SENDER && onFork ? (
        <MessageActionButton
          label={t("Fork conversation")}
          icon={GitFork}
          onClick={onFork}
          disabled={forkDisabled}
        />
      ) : null}
      <CopyButton text={cleanMessageForCopy(message.message)} />
    </div>
  );
};
