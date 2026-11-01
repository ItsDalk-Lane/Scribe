import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { LayoutGrid } from "lucide-react";
import React from "react";

interface EmptyPlaceholderProps {
  folder: string;
}

export const EmptyPlaceholder: React.FC<EmptyPlaceholderProps> = ({ folder }) => {
  return (
    <div
      className={cn(
        "tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-2",
        "tw-min-h-[320px] tw-rounded-md tw-border tw-border-dashed tw-border-border",
        "tw-p-6 tw-text-muted"
      )}
    >
      <div
        className={cn(
          "tw-flex tw-items-center tw-justify-center",
          "tw-rounded-md tw-border tw-border-dashed tw-border-border tw-p-3"
        )}
      >
        <LayoutGrid className="tw-size-6 tw-text-muted" aria-hidden="true" />
      </div>
      <div className="tw-text-smaller tw-font-medium tw-text-muted">{t("No skills yet")}</div>
      <div className="tw-max-w-[420px] tw-break-words tw-text-center tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
        {t("Skills you create or save into your shared folder show up here. Skills under")}{" "}
        <code>.claude/skills/</code> {t("show up here automatically too.")}
      </div>
      <div className="tw-mt-3 tw-max-w-full tw-break-all tw-text-center tw-font-mono tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
        {t("shared home ·")}
        <code>&lt;vault&gt;/{folder}/</code>
      </div>
    </div>
  );
};
