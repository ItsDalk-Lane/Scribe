import { t } from "@/lib/i18n";
import type { BackendAuthStatus } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import React from "react";

export interface SignInActionProps {
  status: BackendAuthStatus | null;
  onSignIn: () => void;
  signingIn: boolean;
  url: string | null;
  onCancel?: () => void;
  failed?: boolean;
  signInLabel?: string;
}

export const SignInAction: React.FC<SignInActionProps> = (auth) => (
  <div className="tw-flex tw-flex-col tw-items-start tw-gap-2" aria-live="polite">
    {auth.status?.signedIn ? (
      <span>
        {t("Signed in")}
        {auth.status.label ? t(" as {p0}", { p0: auth.status.label }) : ""}.
      </span>
    ) : (
      <>
        {auth.signingIn && (
          <p className="tw-my-0 tw-text-sm tw-text-muted">
            {t("Finish signing in in your browser.")}
          </p>
        )}
        {auth.failed && (
          <p className="tw-my-0 tw-text-sm tw-text-muted">
            {t("Sign-in didn't complete. Try again.")}
          </p>
        )}
        <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
          {auth.signingIn && auth.url ? (
            <Button asChild variant="default" size="sm">
              <a href={auth.url} target="_blank" rel="noopener noreferrer">
                {t("Open sign-in page")}
              </a>
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={auth.onSignIn}
              disabled={auth.signingIn || auth.status === null}
            >
              {auth.signingIn
                ? t("Signing in…")
                : auth.failed
                  ? t("Try again")
                  : auth.status === null
                    ? t("Checking sign-in…")
                    : (auth.signInLabel ?? t("Sign in"))}
            </Button>
          )}
          {auth.signingIn && auth.onCancel && (
            <Button variant="ghost" size="sm" onClick={auth.onCancel}>
              {t("Cancel sign-in")}
            </Button>
          )}
        </div>
      </>
    )}
  </div>
);
