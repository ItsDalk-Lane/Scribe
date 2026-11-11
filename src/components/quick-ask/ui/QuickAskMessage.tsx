import { t } from "@/lib/i18n";
import React from "react";
import { Markdown } from "@/components/Markdown";
import { Copy, ClipboardPaste, Replace } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getErrorMessage, type ReplaceInvalidReason } from "@/editor/replaceGuard";
import type { QuickAskMessage } from "@/components/quick-ask/types";

interface QuickAskMessageProps {
  message: QuickAskMessage;
  isStreaming: boolean;
  isLastAssistantMessage: boolean;
  onCopy: (messageId: string) => void;
  onInsert: (messageId: string) => void;
  onReplace: (messageId: string) => void;
  hasSelection: boolean;
  isReplaceValid: boolean;
  replaceInvalidReason: ReplaceInvalidReason | null;
  isDisabledDueToStreaming?: boolean;
  filePathSnapshot: string | null;
}

export const QuickAskMessageComponent = React.memo(function QuickAskMessageComponent({
  message,
  isStreaming,
  isLastAssistantMessage,
  onCopy,
  onInsert,
  onReplace,
  hasSelection,
  isReplaceValid,
  replaceInvalidReason,
  isDisabledDueToStreaming,
  filePathSnapshot,
}: QuickAskMessageProps) {
  if (message.role === "user") {
    return (
      <div className="tw-max-w-[85%] tw-self-end tw-rounded-lg tw-rounded-br-sm tw-bg-interactive-accent tw-px-3 tw-py-2 tw-text-on-accent">
        <div data-quick-ask-selectable className="tw-whitespace-pre-wrap tw-break-words tw-text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  if (isStreaming) {
    return (
      <div className="tw-max-w-[95%] tw-self-start tw-rounded-lg tw-rounded-bl-sm tw-bg-secondary tw-px-3 tw-py-2">
        <div
          data-quick-ask-selectable
          className="tw-whitespace-pre-wrap tw-break-words tw-text-sm tw-text-normal"
        >
          {message.content}
          <span className="tw-animate-pulse tw-text-accent">▊</span>
        </div>
      </div>
    );
  }

  const actionBarVisibility = isLastAssistantMessage
    ? "tw-opacity-100"
    : "tw-opacity-0 group-hover/message:tw-opacity-100";

  return (
    <div className="tw-group/message tw-max-w-[95%] tw-self-start">
      <div className="tw-rounded-lg tw-rounded-bl-sm tw-bg-secondary tw-px-3 tw-py-2">
        <div data-quick-ask-selectable>
          <Markdown
            text={message.content}
            sourcePath={filePathSnapshot ?? ""}
            renderIdentity={`quick-ask:${message.id}`}
            contentPolicy="model"
            className="tw-text-sm [&.markdown-rendered]:tw-text-sm [&_code]:tw-text-xs [&_p]:tw-my-1 [&_pre]:tw-my-2"
          />
        </div>
      </div>
      {message.content && (
        <div
          className={`tw-mt-1 tw-flex tw-items-center tw-gap-0.5 tw-transition-opacity ${actionBarVisibility}`}
        >
          <Button
            variant="ghost2"
            size="icon"
            className="tw-size-5 hover:tw-bg-modifier-hover"
            onClick={() => onCopy(message.id)}
            title={t("Copy to clipboard")}
          >
            <Copy className="tw-size-3" />
          </Button>
          <Button
            variant="ghost2"
            size="icon"
            className="tw-size-5 hover:tw-bg-modifier-hover"
            onClick={() => onInsert(message.id)}
            title={t("Insert at cursor")}
          >
            <ClipboardPaste className="tw-size-3" />
          </Button>
          {hasSelection && (
            <Button
              variant="ghost2"
              size="icon"
              className="tw-size-5 hover:tw-bg-modifier-hover"
              onClick={() => onReplace(message.id)}
              disabled={!isReplaceValid}
              title={
                isDisabledDueToStreaming
                  ? t("Stop generating to replace")
                  : !isReplaceValid
                    ? getErrorMessage(replaceInvalidReason)
                    : t("Replace selection")
              }
            >
              <Replace className="tw-size-3" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
});
