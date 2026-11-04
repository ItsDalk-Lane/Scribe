import { t } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import { Loader2 } from "lucide-react";
import React from "react";

export interface ProviderVerificationStatusProps {
  result?: VerificationResult;
  purpose?: "catalog" | "chat";
}

export function ProviderVerificationStatus({
  result,
  purpose = "catalog",
}: ProviderVerificationStatusProps) {
  const label = !result
    ? "Checking…"
    : result.ok
      ? purpose === "chat"
        ? "Chat connection verified"
        : "Endpoint accessible"
      : result.code === "missing_api_key"
        ? "No key"
        : result.code === "invalid_api_key"
          ? "Invalid key"
          : result.code === "permission_denied"
            ? "Access restricted"
            : result.code === "invalid_response"
              ? "Unexpected response"
              : result.code === "verification_unavailable"
                ? "Not verified"
                : "Check failed";
  return (
    <Badge
      variant={
        result &&
        !result.ok &&
        result.code !== "verification_unavailable" &&
        result.code !== "permission_denied"
          ? "destructive"
          : "secondary"
      }
      title={result?.message}
      className={cn("tw-shrink-0 tw-rounded-full", result?.ok && "tw-bg-success tw-text-normal")}
    >
      {t(label)}
    </Badge>
  );
}

export interface ProviderVerificationProgressProps {
  pending: number;
}

export function ProviderVerificationProgress({ pending }: ProviderVerificationProgressProps) {
  if (pending === 0) return null;
  return (
    <div
      role="status"
      className="tw-pointer-events-none tw-absolute tw-right-0 tw-top-0 tw-flex -tw-translate-y-1/2 tw-items-center tw-gap-1.5 tw-rounded-full tw-bg-primary tw-px-2 tw-py-1 tw-text-xs tw-text-muted tw-shadow-sm"
    >
      <Loader2 className="tw-size-3 tw-animate-spin" aria-hidden="true" />
      {t("Verifying providers…")}
    </div>
  );
}
