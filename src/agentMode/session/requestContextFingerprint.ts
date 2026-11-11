import { sha256 } from "@/utils/hash";
import { isRecord } from "@/utils/obsidianInternals";

export function serializeRequestContext(value: unknown): string {
  return (
    JSON.stringify(value, (_key, item: unknown) =>
      isRecord(item) && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .filter(
                (key) =>
                  key !== "attachmentHash" || item.type !== "image" || typeof item.data !== "string"
              )
              .map((key) => [key, item[key]])
          )
        : item
    ) ?? "undefined"
  );
}

export function fingerprintRequestContext(value: unknown): string {
  return sha256(serializeRequestContext(value));
}
