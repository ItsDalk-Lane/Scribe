import { SkillLibrary } from "@/agentMode/skills/SkillLibrary";
import { mapWithConcurrency } from "@/agentMode/skills/concurrency";
import { getBuiltinSkillPackages } from "@/agentMode/skills/builtinSkills";
import type { SkillPackage } from "@/agentMode/skills/types";
import { t } from "@/lib/i18n";
import { logError } from "@/logger";
import { getSettings, updateSetting } from "@/settings/model";
import { getEffectiveSkillsFolder } from "@/settings/scribeFolder";
import { publishSkillLoadErrorCount } from "@/settings/skillLoadErrorState";
import { assertScribePath, writeVaultFile } from "@/utils/vaultFileStore";
import { atom, createStore, useAtomValue } from "jotai";
import { FileSystemAdapter, type App } from "obsidian";
import { discoverManagedSkills } from "./discoverManagedSkills";
import { compareSkills } from "./mergeDiscovery";
import type { MigrateSkillResult } from "./migrateProjectSkill";
import { suffixOnCollision } from "./suffixOnCollision";
import {
  parseSkillFile,
  serializeSkillFile,
  validateName,
  type SkillFrontmatterPatch,
} from "./skillFormat";
import type { BackendId, RejectedSkill, Skill } from "./types";

const EMPTY_SKILLS = Object.freeze([]) as unknown as Skill[];
const EMPTY_REJECTED_SKILLS = Object.freeze([]) as unknown as RejectedSkill[];
const store = createStore();
const skillsAtom = atom<Skill[]>(EMPTY_SKILLS);
const rejectedSkillsAtom = atom<RejectedSkill[]>(EMPTY_REJECTED_SKILLS);

export type SkillOperationFailureCode =
  | "no-vault-path"
  | "unknown-agent"
  | "invalid"
  | "collision"
  | "eperm"
  | "fs-error"
  | "read-only";
export type SkillOperationResult<
  TCode extends SkillOperationFailureCode = SkillOperationFailureCode,
> = { ok: true } | { ok: false; code: TCode; message: string };
export type ToggleAgentResult = SkillOperationResult<
  "no-vault-path" | "unknown-agent" | "eperm" | "fs-error"
>;
export type DeleteSkillResult = SkillOperationResult<"no-vault-path" | "fs-error">;
export type SavePropertiesResult = SkillOperationResult<
  "no-vault-path" | "invalid" | "collision" | "eperm" | "fs-error"
> & { warning?: string };
export interface RefreshResult {
  ok: boolean;
  folder: string;
  skillCount: number;
  reconcileErrorCount: number;
  discoveryError?: string;
  reconcileError?: string;
}
export type SkillSetChangeListener = (backendId: BackendId, signature: string) => void;

export class SkillManager {
  private static instance: SkillManager | null = null;
  private inFlight: Promise<RefreshResult> | null = null;
  private queuedRefresh = false;
  private disposed = false;
  private readonly library: SkillLibrary;
  private mutations: Promise<unknown> = Promise.resolve();
  private builtinWarnings: string[] = [];
  private readonly signatures = new Map<BackendId, string>();
  private readonly listeners = new Set<SkillSetChangeListener>();

  private constructor(
    private readonly app: App,
    private readonly agents: Readonly<Record<BackendId, string>>
  ) {
    this.library = new SkillLibrary(app.vault);
  }

  static initialize(app: App, agents: Readonly<Record<BackendId, string>>): SkillManager {
    SkillManager.instance ??= new SkillManager(app, agents);
    return SkillManager.instance;
  }

  static getInstance(): SkillManager {
    if (!SkillManager.instance)
      throw new Error("SkillManager.getInstance called before initialize");
    return SkillManager.instance;
  }

  static hasInstance(): boolean {
    return SkillManager.instance !== null;
  }

  static resetForTesting(): void {
    SkillManager.instance?.dispose();
    store.set(skillsAtom, EMPTY_SKILLS);
    store.set(rejectedSkillsAtom, EMPTY_REJECTED_SKILLS);
    publishSkillLoadErrorCount(0);
  }

  getAgentDirsProjectRel(): Readonly<Record<BackendId, string>> {
    return this.agents;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.signatures.clear();
    if (SkillManager.instance === this) SkillManager.instance = null;
  }

  refresh(force = false): Promise<RefreshResult> {
    if (this.inFlight) {
      if (force) this.queuedRefresh = true;
      return this.inFlight;
    }
    this.inFlight = this.runRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runRefresh(): Promise<RefreshResult> {
    let result: RefreshResult;
    do {
      this.queuedRefresh = false;
      const folder = getEffectiveSkillsFolder();
      try {
        await this.library.load();
        await assertScribePath(this.app.vault, folder);
        const adapter = this.app.vault.adapter;
        const base =
          adapter instanceof FileSystemAdapter
            ? adapter.getBasePath().replace(/[/\\]+$/, "")
            : null;
        const discovered = await discoverManagedSkills({
          skillsFolderRelPath: folder,
          skillsFolderAbsPath: base ? `${base}/${folder}` : null,
          adapter: {
            exists: async (path) => {
              await assertScribePath(this.app.vault, path);
              return adapter.exists(path);
            },
            list: async (path) => {
              await assertScribePath(this.app.vault, path);
              return adapter.list(path);
            },
            read: async (path) => {
              await assertScribePath(this.app.vault, path);
              return adapter.read(path);
            },
          },
        });
        const sourced = await mapWithConcurrency(discovered.accepted, 4, async (skill) => ({
          ...skill,
          source: this.library.entry(skill.name)?.source ?? { kind: "local" as const },
          contentHash: await this.library.fingerprint(skill.name).catch(() => skill.contentHash),
        }));
        const skills = sourced.length ? sourced.sort(compareSkills) : EMPTY_SKILLS;
        if (!this.disposed) {
          this.publish(skills);
          store.set(
            rejectedSkillsAtom,
            discovered.rejected.length
              ? discovered.rejected.map((skill) => ({
                  ...skill,
                  source: this.library.entry(skill.name)?.source ?? { kind: "local" as const },
                }))
              : EMPTY_REJECTED_SKILLS
          );
          publishSkillLoadErrorCount(discovered.rejected.length);
        }
        result = { ok: true, folder, skillCount: skills.length, reconcileErrorCount: 0 };
      } catch (error) {
        logError("[Skills] Discovery failed", error);
        result = {
          ok: false,
          folder,
          skillCount: 0,
          reconcileErrorCount: 0,
          discoveryError: error instanceof Error ? error.message : String(error),
        };
      }
    } while (this.queuedRefresh && !this.disposed);
    return result;
  }

  subscribeToSkillSetChange(listener: SkillSetChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async relativePath(
    skill: Pick<Skill, "filePath"> & { location?: Skill["location"] }
  ): Promise<string> {
    const adapter = this.app.vault.adapter;
    const folder = getEffectiveSkillsFolder();
    const base =
      adapter instanceof FileSystemAdapter
        ? `${adapter.getBasePath().replace(/[/\\]+$/, "")}/`
        : "";
    const path =
      base && skill.filePath.startsWith(base) ? skill.filePath.slice(base.length) : skill.filePath;
    if (
      (skill.location && skill.location.kind !== "canonical") ||
      !path.startsWith(`${folder}/`) ||
      path.slice(folder.length + 1).split("/").length !== 2
    ) {
      throw new Error("仅管理当前库 .scribe 内的技能。");
    }
    await assertScribePath(this.app.vault, path);
    return path;
  }

  async readContent(skill: Skill): Promise<string> {
    return this.app.vault.adapter.read(await this.relativePath(skill));
  }

  private async skillFilePath(skill: Skill, relativePath: string): Promise<string> {
    const document = await this.relativePath(skill);
    const directory = document.slice(0, document.lastIndexOf("/"));
    if (
      directory !== `${getEffectiveSkillsFolder()}/${skill.name}` ||
      !relativePath ||
      relativePath
        .split("/")
        .some((part) => !part || part === "." || part === ".." || /[\\:\0]/.test(part))
    )
      throw new Error(t("The skill contains an unsafe file path: {path}", { path: relativePath }));
    const path =
      relativePath.toLowerCase() === "skill.md" ? document : `${directory}/${relativePath}`;
    await assertScribePath(this.app.vault, path);
    return path;
  }

  async listSkillFiles(skill: Skill): Promise<string[]> {
    await this.skillFilePath(skill, "SKILL.md");
    return (await this.library.listFiles(skill.name))
      .map((path) => (path.toLowerCase() === "skill.md" ? "SKILL.md" : path))
      .sort();
  }

  async readSkillFile(skill: Skill, relativePath: string): Promise<string> {
    const path = await this.skillFilePath(skill, relativePath);
    const data = await this.app.vault.adapter.readBinary(path);
    try {
      const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
      if (content.includes("\0")) throw new Error();
      return content;
    } catch {
      throw new Error(t("This file cannot be previewed as text."));
    }
  }

  // 界面元数据的图标资产读取：仍受技能目录路径约束。https://github.com/ItsDalk-Lane/Scribe/issues/47
  async readSkillAsset(skill: Skill, relativePath: string): Promise<Uint8Array> {
    const path = await this.skillFilePath(skill, relativePath);
    return new Uint8Array(await this.app.vault.adapter.readBinary(path));
  }

  async saveSkillFile(
    skill: Skill,
    relativePath: string,
    content: string,
    expectedContent: string
  ): Promise<SavePropertiesResult> {
    try {
      await this.skillFilePath(skill, relativePath);
      if (relativePath.toLowerCase() === "skill.md") {
        const parsed = parseSkillFile(content);
        return this.saveSkill(skill, content, parsed.frontmatter.name, expectedContent);
      }
      return this.mutate(async () => {
        try {
          await this.library.load();
          if (this.library.entry(skill.name)?.source.kind === "builtin")
            throw new Error("Builtin skills are read-only. Restore the builtin version instead.");
          const path = await this.skillFilePath(skill, relativePath);
          await this.readSkillFile(skill, relativePath);
          await writeVaultFile(this.app.vault, path, content, expectedContent);
          await this.refresh(true);
          return { ok: true };
        } catch (error) {
          return fsFailure(error);
        }
      });
    } catch (error) {
      return fsFailure(error);
    }
  }

  async createSkill(
    name: string,
    content: string,
    signal?: AbortSignal
  ): Promise<SavePropertiesResult> {
    return this.installPackage(
      {
        name,
        source: { kind: "agent" },
        files: [{ path: "SKILL.md", data: new TextEncoder().encode(content) }],
      },
      false,
      signal
    );
  }

  installPackage(
    pkg: SkillPackage,
    replace = false,
    signal?: AbortSignal
  ): Promise<SavePropertiesResult> {
    return this.mutate(async () => {
      try {
        await this.library.load();
        const same = this.library
          .entries()
          .find(
            (entry) =>
              entry.source.kind === pkg.source.kind &&
              entry.source.origin !== undefined &&
              entry.source.origin === pkg.source.origin &&
              entry.state === "installed"
          );
        let incoming = pkg;
        if (same && same.name !== pkg.name) {
          incoming = {
            ...pkg,
            name: same.name,
            files: pkg.files.map((file) => {
              if (file.path !== "SKILL.md") return file;
              const parsed = parseSkillFile(new TextDecoder().decode(file.data), pkg.name);
              return {
                ...file,
                data: new TextEncoder().encode(serializeSkillFile(parsed, { name: same.name })),
              };
            }),
          };
        }
        const names = await this.library.occupiedNames();
        const collision = names.find((name) => name.toLowerCase() === incoming.name.toLowerCase());
        if (collision && (!replace || collision !== incoming.name))
          return {
            ok: false,
            code: "collision",
            message:
              "A skill with this name already exists. Confirm an update from the same source.",
          };
        const existing = this.library.entry(incoming.name);
        if (
          collision &&
          (!existing ||
            existing.source.kind !== incoming.source.kind ||
            existing.source.origin !== incoming.source.origin ||
            !incoming.source.origin)
        )
          return {
            ok: false,
            code: "collision",
            message: "A skill from another source already uses this name.",
          };
        await this.library.install(incoming, { replace, signal });
        await this.refresh(true);
        return { ok: true };
      } catch (error) {
        return fsFailure(error);
      }
    });
  }

  saveSkill(
    skill: Skill,
    content: string,
    newName: string,
    expectedContent: string
  ): Promise<SavePropertiesResult> {
    return this.mutate(async () => {
      try {
        await this.library.load();
        if (this.library.entry(skill.name)?.source.kind === "builtin")
          return {
            ok: false,
            code: "fs-error",
            message: "Builtin skills are read-only. Restore the builtin version instead.",
          };
        await this.relativePath(skill);
        parseSkillFile(content, newName);
        const files = await this.library.readFiles(skill.name);
        const document = files.find((file) => file.path.toLowerCase() === "skill.md");
        if (!document) throw new Error(t("SKILL.md was not found."));
        document.path = "SKILL.md";
        document.data = new TextEncoder().encode(content);
        await this.library.install(
          {
            name: newName,
            source: this.library.entry(skill.name)?.source ?? { kind: "local" },
            files,
          },
          { replace: true, previousName: skill.name, expectedContent, updateBaseline: false }
        );
        await this.refresh(true);
        return { ok: true };
      } catch (error) {
        return fsFailure(error);
      }
    });
  }

  private mutate<T>(work: () => Promise<T>): Promise<T> {
    const result = this.mutations.catch(() => undefined).then(work);
    this.mutations = result;
    return result;
  }

  getBuiltinWarnings(): readonly string[] {
    return this.builtinWarnings;
  }

  async getBuiltinStatuses(): Promise<
    Array<{
      name: string;
      status: "installed" | "uninstalled" | "modified" | "missing" | "conflict";
      message?: string;
    }>
  > {
    await this.library.load();
    const names = await this.library.occupiedNames();
    return Promise.all(
      getBuiltinSkillPackages().map(async (pkg) => {
        const entry = this.library.entry(pkg.name);
        const occupied = names.some((name) => name.toLowerCase() === pkg.name);
        if (entry?.source.kind !== "builtin")
          return {
            name: pkg.name,
            status: occupied ? ("conflict" as const) : ("missing" as const),
          };
        if (entry.state === "uninstalled")
          return { name: pkg.name, status: "uninstalled" as const };
        if (!occupied) return { name: pkg.name, status: "missing" as const };
        const unchanged = await this.library.fingerprint(pkg.name).then(
          (hash) => hash === entry.baseline,
          () => false
        );
        return {
          name: pkg.name,
          status: unchanged ? ("installed" as const) : ("modified" as const),
        };
      })
    );
  }

  syncBuiltins(): Promise<void> {
    return this.mutate(async () => {
      this.builtinWarnings = [];
      try {
        await this.library.load();
        for (const pkg of getBuiltinSkillPackages()) {
          if (this.disposed) return;
          const entry = this.library.entry(pkg.name);
          const collision = (await this.library.occupiedNames()).find(
            (name) => name.toLowerCase() === pkg.name
          );
          if (entry?.state === "uninstalled") continue;
          if (collision && entry?.source.kind !== "builtin") {
            this.builtinWarnings.push(pkg.name);
            continue;
          }
          if (entry && !collision) {
            this.builtinWarnings.push(pkg.name);
            continue;
          }
          if (entry && entry.source.version === pkg.source.version) continue;
          if (
            entry &&
            (await this.library.fingerprint(pkg.name).then(
              (hash) => hash !== entry.baseline,
              () => true
            ))
          ) {
            this.builtinWarnings.push(pkg.name);
            continue;
          }
          await this.library.install(pkg, { replace: Boolean(entry) });
        }
      } catch (error) {
        logError("[Skills] Builtin sync failed", error);
        this.builtinWarnings.push(
          "Builtin skills could not be synchronized. Open Skills to retry or restore them."
        );
      }
      await this.refresh(true);
    });
  }

  restoreBuiltin(name: string): Promise<SavePropertiesResult> {
    return this.mutate(async () => {
      try {
        await this.library.load();
        const pkg = getBuiltinSkillPackages().find((item) => item.name === name);
        if (!pkg) throw new Error(t("This builtin skill is unavailable."));
        const occupied = (await this.library.occupiedNames()).find(
          (item) => item.toLowerCase() === name
        );
        if (occupied && this.library.entry(name)?.source.kind !== "builtin")
          return {
            ok: false,
            code: "collision",
            message: t("A personal skill uses this name. It was not replaced."),
          };
        await this.library.install(pkg, { replace: Boolean(occupied), preserveEnabled: false });
        await this.refresh(true);
        return { ok: true };
      } catch (error) {
        return fsFailure(error);
      }
    });
  }

  async saveContent(skill: Skill, content: string): Promise<SavePropertiesResult> {
    return this.saveSkill(skill, content, skill.name, await this.readContent(skill));
  }

  toggleAgent(skill: Skill, agent: BackendId, enabled: boolean): Promise<ToggleAgentResult> {
    return this.mutate(() => this.toggleAgentNow(skill, agent, enabled));
  }

  private async toggleAgentNow(
    skill: Skill,
    agent: BackendId,
    enabled: boolean
  ): Promise<ToggleAgentResult> {
    if (!(agent in this.agents))
      return { ok: false, code: "unknown-agent", message: `Unknown agent: ${agent}` };
    try {
      const path = await this.relativePath(skill);
      const original = await this.app.vault.adapter.read(path);
      const parsed = parseSkillFile(original, skill.name);
      const enabledAgents = enabled
        ? [...new Set([...parsed.frontmatter.enabledAgents, agent])]
        : parsed.frontmatter.enabledAgents.filter((id) => id !== agent);
      await writeVaultFile(
        this.app.vault,
        path,
        serializeSkillFile(parsed, { enabledAgents }),
        original
      );
      await this.refresh(true);
      return { ok: true };
    } catch (error) {
      return fsFailure(error);
    }
  }

  deleteSkill(skill: Skill | RejectedSkill): Promise<DeleteSkillResult> {
    return this.mutate(async () => {
      try {
        await this.relativePath(skill);
        await this.library.load();
        if ("contentHash" in skill && skill.contentHash) {
          const fingerprint = await this.library.fingerprint(skill.name);
          if (fingerprint !== skill.contentHash)
            return {
              ok: false,
              code: "fs-error",
              message: "The skill changed before uninstallation. Refresh and confirm again.",
            };
        }
        await this.library.remove(skill.name);
        await this.refresh(true);
        return { ok: true };
      } catch (error) {
        return fsFailure(error);
      }
    });
  }

  async saveProperties(
    skill: Skill,
    req: { newName?: string; patch: Omit<SkillFrontmatterPatch, "name" | "enabledAgents"> }
  ): Promise<SavePropertiesResult> {
    try {
      const original = await this.readContent(skill);
      const parsed = parseSkillFile(original, skill.name);
      const nextName = req.newName ?? skill.name;
      validateName(nextName, nextName);
      return this.saveSkill(
        skill,
        serializeSkillFile(parsed, { ...req.patch, name: nextName }),
        nextName,
        original
      );
    } catch (error) {
      return fsFailure(error);
    }
  }

  resolveCanonicalNameForMigration(name: string): string {
    return suffixOnCollision(name, new Set(getManagedSkills().map((skill) => skill.name)));
  }

  getSuppressMigrationConfirm(): boolean {
    return Boolean(getSettings().agentMode?.skills?.suppressMigrationConfirm);
  }

  setSuppressMigrationConfirm(value: boolean): void {
    const agentMode = getSettings().agentMode;
    updateSetting("agentMode", {
      ...agentMode,
      skills: { ...agentMode.skills, suppressMigrationConfirm: value },
    });
  }

  async migrateProjectSkillForToggle(
    _skill: Skill,
    _targetAgent: BackendId | null,
    _action: "expandToNewAgent" | "disableLastAgent" | "consolidate"
  ): Promise<MigrateSkillResult> {
    return { ok: false, reason: "不导入旧位置的技能资料。" };
  }

  async consolidateMirroredSkill(
    skill: Skill,
    _suppressFuture: boolean
  ): Promise<MigrateSkillResult> {
    return this.migrateProjectSkillForToggle(skill, null, "consolidate");
  }

  async removeProjectAgentDir(
    _skill: Skill,
    _agent: BackendId
  ): Promise<SkillOperationResult<"no-vault-path" | "unknown-agent" | "fs-error">> {
    return fsFailure(new Error("不修改旧位置的技能资料。"));
  }

  private publish(skills: Skill[]): void {
    store.set(skillsAtom, skills.length ? skills : EMPTY_SKILLS);
    for (const backendId of Object.keys(this.agents)) {
      const signature = computeSkillSetSignature(skills, backendId);
      const previous = this.signatures.get(backendId);
      this.signatures.set(backendId, signature);
      if (signature === previous || (previous === undefined && skills.length === 0)) continue;
      for (const listener of this.listeners) {
        try {
          listener(backendId, signature);
        } catch (error) {
          logError("[Skills] Listener failed", error);
        }
      }
    }
  }
}

export function useManagedSkills(): Skill[] {
  return useAtomValue(skillsAtom, { store });
}
export function useRejectedSkills(): RejectedSkill[] {
  return useAtomValue(rejectedSkillsAtom, { store });
}
export function getManagedSkills(): Skill[] {
  return store.get(skillsAtom);
}

export function computeSkillSetSignature(skills: readonly Skill[], backendId: BackendId): string {
  if (skills.length === 0) return "skills:v1:0";
  const rows = skills
    .map((skill) =>
      [
        skill.name,
        skill.enabledAgents.includes(backendId) ? "1" : "0",
        skill.description,
        skill.allowedTools ?? "",
        skill.model ?? "",
        String(skill.disableModelInvocation ?? false),
        String(skill.userInvocable ?? true),
        stableHash(skill.body),
        skill.contentHash ?? "",
      ].join("\u001f")
    )
    .sort();
  return `skills:v1:${stableHash(rows.join("\u001e"))}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function fsFailure(error: unknown): { ok: false; code: "fs-error"; message: string } {
  return {
    ok: false,
    code: "fs-error",
    message:
      error && typeof error === "object" && "code" in error && error.code === "ENOSPC"
        ? t("Not enough free space to save this skill. Free some space and try again.")
        : error &&
            typeof error === "object" &&
            "code" in error &&
            (error.code === "EACCES" || error.code === "EPERM")
          ? t("Scribe cannot change these skill files. Check the folder permissions and try again.")
          : error instanceof Error
            ? error.message
            : t("The skill operation failed. Refresh and try again."),
  };
}
