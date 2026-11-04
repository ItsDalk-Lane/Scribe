import { t } from "@/lib/i18n";
import type { ChatBookmarkState } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { useApp } from "@/context";
import { openBookmarksPluginSettings } from "@/utils/obsidianBookmarks";
import { Bookmark, BookmarkMinus, Info } from "lucide-react";
import React, { useEffect, useState } from "react";

export interface ChatBookmarkMenuItemProps {
  getBookmarkState: () => Promise<ChatBookmarkState>;
  onSetBookmarked: (bookmarked: boolean) => void;
}

export function ChatBookmarkMenuItem({
  getBookmarkState,
  onSetBookmarked,
}: ChatBookmarkMenuItemProps): React.ReactElement | null {
  const app = useApp();
  const [state, setState] = useState<ChatBookmarkState | null>(null);
  useEffect(() => {
    let current = true;
    void getBookmarkState().then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, [getBookmarkState]);

  if (state === "off") {
    return (
      <DropdownMenuItem
        className="tw-text-faint focus:tw-text-faint"
        onSelect={() => openBookmarksPluginSettings(app)}
      >
        <Bookmark />

        {t("Add to bookmarks")}
        <span className="tw-ml-auto">
          <HelpTooltip
            side="bottom"
            contentClassName="tw-max-w-60"
            content={t(
              "Turn on the Bookmarks core plugin to bookmark chats. Select to open it in Settings."
            )}
          >
            <Info className="tw-size-3.5" aria-label={t("Bookmarks is turned off")} />
          </HelpTooltip>
        </span>
      </DropdownMenuItem>
    );
  }
  if (state !== "bookmarked" && state !== "not-bookmarked") return null;
  const bookmarked = state === "bookmarked";
  return (
    <DropdownMenuItem onSelect={() => onSetBookmarked(!bookmarked)}>
      {bookmarked ? <BookmarkMinus /> : <Bookmark />}
      {bookmarked ? t("Remove from bookmarks") : t("Add to bookmarks")}
    </DropdownMenuItem>
  );
}
