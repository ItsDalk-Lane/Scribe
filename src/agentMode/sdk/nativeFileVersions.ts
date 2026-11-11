export type NativeObservedFileVersion =
  | { kind: "text"; fingerprint: string; complete: boolean; readThrough?: number }
  | { kind: "drawing"; revision: string | number };
