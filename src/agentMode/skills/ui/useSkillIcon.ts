import React from "react";
import { SkillManager } from "@/agentMode/skills/SkillManager";
import type { RejectedSkill, Skill } from "@/agentMode/skills/types";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

// 界面元数据图标：经技能目录受控读取并按内容哈希缓存为 data URL。
// https://github.com/ItsDalk-Lane/Scribe/issues/47
export function loadSkillIcon(skill: Skill): Promise<string | null> {
  const icon = skill.uiMetadata?.icon;
  if (!icon) return Promise.resolve(null);
  const key = `${skill.contentHash ?? skill.dirPath}|${icon}`;
  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const load = (async () => {
    try {
      const data = await SkillManager.getInstance().readSkillAsset(skill, icon);
      const mime = MIME_BY_EXTENSION[extensionOf(icon)] ?? "application/octet-stream";
      let binary = "";
      for (const byte of data) binary += String.fromCharCode(byte);
      const url = `data:${mime};base64,${btoa(binary)}`;
      cache.set(key, url);
      return url;
    } catch {
      return null;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, load);
  return load;
}

export function useSkillIcon(skill: Skill | RejectedSkill): string | null {
  const [icon, setIcon] = React.useState<string | null>(() =>
    "uiMetadata" in skill && skill.uiMetadata?.icon && skill.contentHash
      ? (cache.get(`${skill.contentHash}|${skill.uiMetadata.icon}`) ?? null)
      : null
  );
  React.useEffect(() => {
    if (!("uiMetadata" in skill) || !skill.uiMetadata?.icon) {
      setIcon(null);
      return;
    }
    let active = true;
    void loadSkillIcon(skill).then((url) => {
      if (active) setIcon(url);
    });
    return () => {
      active = false;
    };
  }, [skill]);
  return icon;
}
