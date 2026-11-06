import React from "react";
import { cn } from "@/lib/utils";

interface SettingSectionProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingSection({ children, className }: SettingSectionProps) {
  return (
    <div className={cn("tw-divide-y tw-divide-border [&>*]:tw-px-4", className)}>{children}</div>
  );
}
