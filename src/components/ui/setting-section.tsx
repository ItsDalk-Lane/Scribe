import React from "react";
import { cn } from "@/lib/utils";

interface SettingSectionProps {
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function SettingSection({ label, children, className }: SettingSectionProps) {
  return (
    <div className={cn("tw-space-y-2", className)}>
      {label && (
        <div className="tw-space-y-1">
          <div className="tw-text-sm tw-font-semibold tw-text-normal">{label}</div>
        </div>
      )}
      <div className="tw-overflow-hidden tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-transparent">
        <div className="tw-divide-y tw-divide-border [&>*]:tw-px-4">{children}</div>
      </div>
    </div>
  );
}
