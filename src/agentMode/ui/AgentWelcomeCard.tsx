import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FolderPlus, Sparkles, X } from "lucide-react";
import React, { memo } from "react";

interface AgentWelcomeCardProps {
  onCreate: (anchor: HTMLElement) => void;
  onDismiss: () => void;
  className?: string;
}

export const AgentWelcomeCard = memo(
  ({ onCreate, onDismiss, className }: AgentWelcomeCardProps): React.ReactElement => (
    <div
      className={cn(
        "tw-relative tw-flex tw-flex-col tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-3",
        className
      )}
    >
      <Button
        variant="ghost2"
        size="icon"
        onClick={onDismiss}
        aria-label={t("Dismiss")}
        className="tw-absolute tw-right-1 tw-top-1 tw-size-6 tw-text-muted hover:tw-text-normal"
      >
        <X className="tw-size-4" />
      </Button>

      <div className="tw-flex tw-items-center tw-gap-1.5 tw-pr-6 tw-text-ui-small tw-font-semibold tw-text-normal">
        <Sparkles className="tw-size-4 tw-shrink-0 tw-text-accent" />
        <span>{t("Try a project")}</span>
      </div>

      <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
        {t(
          "Save references to notes, URLs, PDFs, and folders in a project. Each project keeps its own chat history."
        )}
      </p>

      <Button
        variant="default"
        size="sm"
        onClick={(e) => onCreate(e.currentTarget)}
        className="tw-mt-1 tw-w-full tw-gap-2"
      >
        <FolderPlus className="tw-size-4" />

        {t("New project")}
      </Button>
    </div>
  )
);

AgentWelcomeCard.displayName = "AgentWelcomeCard";
