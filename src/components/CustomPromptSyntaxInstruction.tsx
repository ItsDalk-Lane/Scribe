import { t } from "@/lib/i18n";
import React from "react";

export function CustomPromptSyntaxInstruction() {
  return (
    <ul className="tw-m-0 tw-px-4 tw-text-sm">
      <li>
        <span className="tw-font-medium tw-text-accent">{"{}"}</span>{" "}
        {t("represents the selected text.")}
      </li>
      <li>
        <span className="tw-font-medium tw-text-accent">{`{[[Note Title]]}`}</span>{" "}
        {t("represents a note.")}
      </li>
      <li>
        <span className="tw-font-medium tw-text-accent">{`{activeNote}`}</span>{" "}
        {t("represents the active note.")}
      </li>
      <li>
        <span className="tw-font-medium tw-text-accent">{`{#tag1, #tag2}`}</span>{" "}
        {t(
          "represents ALL notes with ANY of the specified tags in their property (an OR operation)."
        )}
      </li>
    </ul>
  );
}
