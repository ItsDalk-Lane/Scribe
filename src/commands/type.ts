export interface CustomCommand {
  title: string;

  enabled?: boolean;

  content: string;

  showInContextMenu: boolean;

  showInSlashMenu: boolean;

  order: number;

  modelKey: string;

  lastUsedMs: number;
}
