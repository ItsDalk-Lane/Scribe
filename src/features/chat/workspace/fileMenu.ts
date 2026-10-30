import type { App, EventRef } from 'obsidian';
import { Notice, TFile } from 'obsidian';

import { formatComposerWikilink } from '@/features/chat/composer/composerWikilinks';
import { t } from '@/i18n/i18n';

interface FileMenuViewHost {
  appendToActiveInput(text: string): boolean;
}

export interface FileMenuHost {
  readonly app: App;
  activateView(): Promise<void>;
  getView(): FileMenuViewHost | null;
  registerEvent(eventRef: EventRef): void;
}

export async function addFileToScribe(host: FileMenuHost, file: TFile): Promise<boolean> {
  try {
    await host.activateView();
    const appended = host.getView()?.appendToActiveInput(formatComposerWikilink(file.path)) ?? false;
    if (!appended) {
      new Notice(t('chat.fileMenu.notReady'));
    }
    return appended;
  } catch {
    new Notice(t('chat.fileMenu.failed'));
    return false;
  }
}

export function registerFileMenu(host: FileMenuHost): void {
  host.registerEvent(
    host.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile)) return;

      menu.addItem((item) => item
        .setTitle(t('chat.fileMenu.add'))
        .setIcon('message-square-plus')
        .onClick(() => addFileToScribe(host, file)));
    }),
  );
}
