import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { LayoutGrid } from "lucide-react";
import React from "react";

export const EmptyPlaceholder: React.FC = () => {
  return (
    <div
      className={cn(
        "tw-flex tw-min-h-36 tw-flex-col tw-items-center tw-justify-center tw-gap-2 tw-rounded-md tw-border tw-border-dashed tw-border-border tw-p-6 tw-text-muted"
      )}
    >
      <LayoutGrid className="tw-size-6" aria-hidden="true" />
      <div className="tw-text-smaller tw-font-medium">{t("No skills yet")}</div>
    </div>
  );
};
