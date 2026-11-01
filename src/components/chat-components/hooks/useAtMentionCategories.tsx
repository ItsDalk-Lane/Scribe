import { t } from "@/lib/i18n";
import React, { useMemo } from "react";
import { TFile, TFolder } from "obsidian";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { FileText, Folder, Globe, Image } from "lucide-react";
import { TypeaheadOption } from "@/components/chat-components/TypeaheadMenuContent";
import type { WebTabContext } from "@/types/message";

export type AtMentionCategory =
  | "notes"
  | "folders"
  | "activeNote"
  | "webTabs"
  | "activeWebTab"
  | "images";

export interface AtMentionOption extends TypeaheadOption {
  category: AtMentionCategory;
  data: TFile | string | TFolder | WebTabContext;
  isAction?: boolean;
}

export interface CategoryOption extends TypeaheadOption {
  category: AtMentionCategory;
  icon: React.ReactNode;
  isAction?: boolean;
}

const CATEGORY_OPTIONS: CategoryOption[] = [
  {
    key: "notes",
    title: "Notes",
    subtitle: "Reference notes in your vault",
    category: "notes",
    icon: <FileText className="tw-size-4" />,
  },
  {
    key: "webTabs",
    title: "Web tabs",
    subtitle: "Reference open browser tabs",
    category: "webTabs",
    icon: <Globe className="tw-size-4" />,
  },
  {
    key: "folders",
    title: "Folders",
    subtitle: "Reference vault folders",
    category: "folders",
    icon: <Folder className="tw-size-4" />,
  },
  {
    key: "images",
    title: "Images",
    subtitle: "Attach image files",
    category: "images",
    icon: <Image className="tw-size-4" />,
    isAction: true,
  },
];

export function useAtMentionCategories(): CategoryOption[] {
  return useMemo(() => {
    const base = CATEGORY_OPTIONS.filter((cat) => {
      if (cat.category === "webTabs") {
        return isDesktopRuntime();
      }
      return true;
    });
    return base.map((category) => ({
      ...category,
      title: t(category.title),
      subtitle: category.subtitle ? t(category.subtitle) : category.subtitle,
    }));
  }, []);
}
