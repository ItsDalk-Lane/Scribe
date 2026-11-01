import { t } from "@/lib/i18n";
import { CopyButton } from "@/components/chat-components/CopyButton";
import { MessageActionButton } from "@/components/chat-components/MessageActionButton";
import { AssistantResponseFooter } from "@/components/ui/AssistantResponseFooter";
import { cn } from "@/lib/utils";
import { insertAtCursor } from "@/utils";
import { GitFork, TextCursorInput } from "lucide-react";
import { App, Platform } from "obsidian";
import React from "react";

interface AgentMessageActionsProps {
  text: string;
  app: App;
  onFork?: () => void;
  forkDisabled?: boolean;
  timestamp?: string;
}

export const AgentMessageActions: React.FC<AgentMessageActionsProps> = ({
  text,
  app,
  onFork,
  forkDisabled,
  timestamp,
}) => (
  <AssistantResponseFooter
    timestamp={timestamp}
    actions={
      <div
        className={cn("tw-flex tw-items-center tw-gap-1", {
          "group-hover:opacity-100 opacity-0": !Platform.isMobile,
        })}
      >
        <MessageActionButton
          label={t("Insert / Replace at cursor")}
          icon={TextCursorInput}
          onClick={() => void insertAtCursor(app, text)}
        />
        {onFork ? (
          <MessageActionButton
            label={t("Fork conversation")}
            icon={GitFork}
            onClick={onFork}
            disabled={forkDisabled}
          />
        ) : null}
        <CopyButton text={text} />
      </div>
    }
  />
);
