import type { BackendId } from "@/agentMode/session/types";
import type { SkillDependency, SkillUiMetadata } from "@/agentMode/skills/skillFormat";

export type { BackendId };
export type { SkillDependency, SkillUiMetadata };

export type SkillLocation = { kind: "canonical" } | { kind: "project"; agentDirs: BackendId[] };

export type SkillSourceKind = "builtin" | "agent" | "system" | "local";

export interface SkillSource {
  kind: SkillSourceKind;
  origin?: string;
  displayPath?: string;
  version?: string;
}

export interface SkillPackageFile {
  path: string;
  data: Uint8Array;
}

// 导入暂存区自动修复的逐行差异；安装的始终是确认后的修复副本。
// https://github.com/ItsDalk-Lane/Scribe/issues/44
export interface SkillImportRepairChange {
  before: string;
  after: string;
}

export interface SkillPackage {
  name: string;
  files: SkillPackageFile[];
  source: SkillSource;
  repair?: SkillImportRepairChange[];
}

export interface SkillImportCandidate {
  id: string;
  name: string;
  description: string;
  path: string;
  sources: string[];
  status: "available" | "installed" | "conflict";
  error?: string;
  renamedFrom?: string;
  repair?: SkillImportRepairChange[];
}

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  dirPath: string;
  body: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string;
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  enabledAgents: BackendId[];
  location: SkillLocation;
  contentHash?: string;
  displayNameSuffix?: string;
  source?: SkillSource;
  author?: string;
  version?: string;
  tags?: string[];
  dependencies?: SkillDependency[];
  uiMetadata?: SkillUiMetadata;
  webSearchCommand?: string;
}

export interface RejectedSkill {
  name: string;
  filePath: string;
  dirPath: string;
  reason: string;
  offendingText?: string;
  source?: SkillSource;
}

export interface SkillDiscoveryResult<T> {
  accepted: T[];
  rejected: RejectedSkill[];
}
