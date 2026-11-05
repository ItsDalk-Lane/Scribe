import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { ArrowUp } from "lucide-react";
import React from "react";

interface ChatSendButtonProps {
  inputMessage: string;
  imageCount: number;
  onSend: () => void;
  disabled?: boolean;
}

export function ChatSendButton({
  inputMessage,
  imageCount,
  onSend,
  disabled,
}: ChatSendButtonProps) {
  return (
    <Button
      size="icon"
      className="tw-rounded-full tw-bg-interactive-accent tw-text-on-accent hover:tw-bg-interactive-accent-hover"
      aria-label={t("Send")}
      onClick={onSend}
      disabled={disabled || (!inputMessage.trim() && imageCount === 0)}
    >
      <ArrowUp className="tw-size-4" />
    </Button>
  );
}
