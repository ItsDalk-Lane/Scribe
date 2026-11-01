import { t } from "@/lib/i18n";
import * as React from "react";
import { Platform } from "obsidian";
import { ArrowBigUp, Command, CornerDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

type ActionState = "idle" | "loading" | "result";

const ICON_CLS = "tw-size-3";

const ReplaceShortcutHint = () =>
  Platform.isMacOS ? (
    <span className="tw-ml-1 tw-hidden tw-items-center tw-gap-0.5 tw-opacity-80 @lg/command-footer:tw-inline-flex">
      <Command className={ICON_CLS} />
      <CornerDownLeft className={ICON_CLS} />
    </span>
  ) : (
    <span className="tw-ml-1 tw-hidden tw-items-center tw-gap-0.5 tw-text-xs tw-opacity-80 @lg/command-footer:tw-inline-flex">
      Ctrl
      <CornerDownLeft className={ICON_CLS} />
    </span>
  );

const InsertShortcutHint = () =>
  Platform.isMacOS ? (
    <span className="tw-ml-1 tw-hidden tw-items-center tw-gap-0.5 tw-opacity-80 @lg/command-footer:tw-inline-flex">
      <Command className={ICON_CLS} />
      <ArrowBigUp className={ICON_CLS} />
      <CornerDownLeft className={ICON_CLS} />
    </span>
  ) : (
    <span className="tw-ml-1 tw-hidden tw-items-center tw-gap-0.5 tw-text-xs tw-opacity-80 @lg/command-footer:tw-inline-flex">
      Ctrl
      <ArrowBigUp className={ICON_CLS} />
      <CornerDownLeft className={ICON_CLS} />
    </span>
  );

interface ActionButtonsProps {
  state: ActionState;
  onStop?: () => void;
  onRunAgain?: () => void;
  onInsert?: () => void;
  onReplace?: () => void;
}

export function ActionButtons({
  state,
  onStop,
  onRunAgain,
  onInsert,
  onReplace,
}: ActionButtonsProps) {
  return (
    <div className="tw-flex tw-items-center tw-gap-2">
      {state === "loading" && (
        <Button variant="secondary" size="sm" onClick={onStop}>
          {t("Stop")}
        </Button>
      )}

      {state !== "loading" && onRunAgain && (
        <Button
          size="sm"
          variant="secondary"
          onClick={onRunAgain}
          title={t("Run the prompt again")}
        >
          {t("Run again")}
        </Button>
      )}

      {state === "result" && (
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={onInsert}
            title={t("Insert below selection ({value0}+Shift+Enter)", {
              value0: Platform.isMacOS ? "⌘" : "Ctrl",
            })}
          >
            {t("Insert")}
            <InsertShortcutHint />
          </Button>
          <Button
            size="sm"
            onClick={onReplace}
            title={t("Replace selection ({value0}+Enter)", {
              value0: Platform.isMacOS ? "⌘" : "Ctrl",
            })}
          >
            {t("Replace")}
            <ReplaceShortcutHint />
          </Button>
        </>
      )}
    </div>
  );
}
