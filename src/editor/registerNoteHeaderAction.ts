import { t } from "@/lib/i18n";
import { SCRIBE_AGENT_ICON_ID } from "@/constants";
import type ScribePlugin from "@/main";
import { MarkdownView } from "obsidian";

export function registerNoteHeaderAction(plugin: ScribePlugin): void {
  const { workspace } = plugin.app;
  const actions = new WeakMap<MarkdownView, HTMLElement>();
  const openViews = (): MarkdownView[] =>
    workspace
      .getLeavesOfType("markdown")
      .flatMap(({ view }) => (view instanceof MarkdownView ? [view] : []));

  const sync = (): void => {
    for (const view of openViews()) {
      if (actions.has(view)) continue;
      const action = view.addAction(
        SCRIBE_AGENT_ICON_ID,
        t("Open Scribe Agent Chat with this note"),
        () => {
          const file = view.file;
          if (file) void plugin.addNoteToAgentChat(file, true);
        }
      );
      actions.set(view, action);
    }
  };

  workspace.onLayoutReady(sync);
  plugin.registerEvent(workspace.on("layout-change", sync));
  plugin.register(() => {
    for (const view of openViews()) actions.get(view)?.remove();
  });
}
