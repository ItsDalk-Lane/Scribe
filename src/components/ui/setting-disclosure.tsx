import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import React from "react";

interface SettingDisclosureProps extends React.ComponentPropsWithoutRef<"button"> {
  open: boolean;
  label?: string;
}

export const SettingDisclosure = React.forwardRef<HTMLButtonElement, SettingDisclosureProps>(
  ({ open, label, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      className={cn(
        "tw-flex tw-w-full tw-cursor-pointer tw-items-center !tw-justify-start tw-gap-1.5",
        "!tw-border-none !tw-bg-transparent !tw-px-0 !tw-py-3 !tw-shadow-none",
        "tw-text-left tw-text-sm tw-font-medium tw-text-muted hover:tw-text-normal focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring",
        className
      )}
      {...props}
    >
      <ChevronRight
        className={cn("tw-size-4 tw-shrink-0 tw-transition-transform", open && "tw-rotate-90")}
      />
      {label ?? t("Advanced")}
    </button>
  )
);
SettingDisclosure.displayName = "SettingDisclosure";
