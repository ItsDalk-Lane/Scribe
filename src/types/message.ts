import { TFile } from "obsidian";

export interface FormattedDateTime {
  epoch: number;
  display: string;
  fileName: string;
}

interface BaseSelectedTextContext {
  id: string;
  content: string;
}

export interface NoteSelectedTextContext extends BaseSelectedTextContext {
  sourceType: "note";
  noteTitle: string;
  notePath: string;
  startLine: number;
  endLine: number;
}

export interface WebSelectedTextContext extends BaseSelectedTextContext {
  sourceType: "web";
  title: string;
  url: string;
  faviconUrl?: string;
}

export type SelectedTextContext = NoteSelectedTextContext | WebSelectedTextContext;

export function isWebSelectedTextContext(ctx: SelectedTextContext): ctx is WebSelectedTextContext {
  return ctx.sourceType === "web";
}

export function isNoteSelectedTextContext(
  ctx: SelectedTextContext
): ctx is NoteSelectedTextContext {
  return ctx.sourceType === "note";
}

export interface WebTabContext {
  url: string;
  title?: string;
  faviconUrl?: string;
  isLoaded?: boolean;
  isActive?: boolean;
}

export interface MessageContext {
  notes: TFile[];
  tags?: string[];
  folders?: string[];
  selectedTextContexts?: SelectedTextContext[];
  webTabs?: WebTabContext[];
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ResponseMetadata {
  wasTruncated?: boolean;

  tokenUsage?: TokenUsage;
}

export interface StreamingResult {
  content: string;

  wasTruncated: boolean;

  tokenUsage: TokenUsage | null;
}

export interface ChatMessage {
  id?: string;

  message: string;

  originalMessage?: string;

  sender: string;

  timestamp: FormattedDateTime | null;

  isVisible: boolean;

  content?: unknown[];

  context?: MessageContext;

  isErrorMessage?: boolean;

  needsContextReprocessing?: boolean;

  responseMetadata?: ResponseMetadata;
}
