export interface CustomCommand {
  title: string;

  enabled?: boolean;

  enableTemplating?: boolean;

  content: string;

  showInContextMenu: boolean;

  order: number;

  modelKey: string;

  lastUsedMs: number;
}
