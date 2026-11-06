import type { BackendId } from "@/agentMode/session/types";

export type { BackendId };

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

export interface SkillPackage {
  name: string;
  files: SkillPackageFile[];
  source: SkillSource;
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
