import type { Vault } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { ensureFolderExists } from "@/utils";
import { sha256 } from "@/utils/hash";
import { arrayBufferToBase64 } from "@/utils/base64";
import { assertScribePath, writeVaultFile } from "@/utils/vaultFileStore";
import { parseSkillFile, serializeSkillFile, validateName } from "@/agentMode/skills/skillFormat";
import type { SkillPackage, SkillPackageFile, SkillSource } from "@/agentMode/skills/types";
import { logWarn } from "@/logger";
import { t } from "@/lib/i18n";

export const SKILL_LIBRARY = ".scribe/skills";
const REGISTRY = `${SKILL_LIBRARY}/.registry.json`;
const OPERATIONS = `${SKILL_LIBRARY}/.operations`;

export interface SkillLibraryEntry {
  id: string;
  name: string;
  source: SkillSource;
  state: "installed" | "uninstalled";
  baseline: string;
}
interface Registry {
  version: 1;
  entries: SkillLibraryEntry[];
}
interface Operation {
  version: 1;
  name: string;
  previousName?: string;
  before: Registry;
  beforeText?: string | null;
  after: Registry;
  fingerprint?: string;
  previousFingerprint?: string;
}

export class SkillLibrary {
  private registry: Registry = { version: 1, entries: [] };
  private registryText: string | null = null;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly vault: Vault) {}

  entries(): readonly SkillLibraryEntry[] {
    return this.registry.entries;
  }

  entry(name: string): SkillLibraryEntry | undefined {
    return this.registry.entries.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  }

  load(): Promise<void> {
    return this.serial(() => this.readState());
  }

  private async readState(): Promise<void> {
    await assertScribePath(this.vault, REGISTRY);
    this.registryText = (await this.vault.adapter.exists(REGISTRY))
      ? await this.vault.adapter.read(REGISTRY)
      : null;
    this.registry =
      this.registryText === null ? { version: 1, entries: [] } : parseRegistry(this.registryText);
    await this.recover();
  }

  async occupiedNames(): Promise<string[]> {
    await assertScribePath(this.vault, SKILL_LIBRARY);
    if (!(await this.vault.adapter.exists(SKILL_LIBRARY))) return [];
    const listed = await this.vault.adapter.list(SKILL_LIBRARY);
    return [...listed.files, ...listed.folders]
      .map((path) => path.slice(SKILL_LIBRARY.length + 1))
      .filter((name) => !name.startsWith("."));
  }

  async readFiles(name: string): Promise<SkillPackageFile[]> {
    validateFolder(name);
    return this.readTree(`${SKILL_LIBRARY}/${name}`);
  }

  async listFiles(name: string): Promise<string[]> {
    validateFolder(name);
    return this.listTree(`${SKILL_LIBRARY}/${name}`);
  }

  private async listTree(root: string): Promise<string[]> {
    const files: string[] = [];
    const pending = [root];
    while (pending.length) {
      const directory = pending.pop()!;
      await assertScribePath(this.vault, directory);
      const listing = await this.vault.adapter.list(directory);
      for (const path of [...listing.files, ...listing.folders]) {
        if (!path.startsWith(`${directory}/`) || path.slice(directory.length + 1).includes("/"))
          throw new Error(t("The skill folder returned an unsafe child path."));
        await assertScribePath(this.vault, path);
      }
      pending.push(...listing.folders);
      files.push(...listing.files.map((path) => path.slice(root.length + 1)));
    }
    return files;
  }

  private async readTree(root: string): Promise<SkillPackageFile[]> {
    const files: SkillPackageFile[] = [];
    for (const relativePath of await this.listTree(root)) {
      const path = `${root}/${relativePath}`;
      await assertScribePath(this.vault, path);
      const data =
        relativePath.toLowerCase() === "skill.md"
          ? new TextEncoder().encode(await this.vault.adapter.read(path))
          : new Uint8Array(await this.vault.adapter.readBinary(path));
      files.push({ path: relativePath, data });
    }
    return files;
  }

  async fingerprint(name: string): Promise<string> {
    return fingerprintFiles(await this.readFiles(name), name);
  }

  install(
    pkg: SkillPackage,
    options: {
      replace?: boolean;
      previousName?: string;
      expectedContent?: string;
      preserveEnabled?: boolean;
      updateBaseline?: boolean;
      signal?: AbortSignal;
    } = {}
  ): Promise<void> {
    return this.serial(async () => {
      await this.readState();
      options.signal?.throwIfAborted();
      validatePackage(pkg);
      const previousName = options.previousName ?? pkg.name;
      validateName(previousName, previousName);
      const existing = this.entry(previousName);
      const names = await this.occupiedNames();
      const collision = names.find(
        (name) => name.toLowerCase() === pkg.name.toLowerCase() && name !== previousName
      );
      if (collision)
        throw new Error(t("A skill named “{name}” already exists.", { name: collision }));
      const hasPrevious = names.includes(previousName);
      if (hasPrevious && !options.replace)
        throw new Error(t("Confirm replacement before updating this skill."));
      if (
        hasPrevious &&
        !sameSource(
          existing?.state === "installed" ? existing.source : { kind: "local" },
          pkg.source
        )
      )
        throw new Error(t("A skill from another source already uses this name."));
      if (existing && !sameSource(existing.source, pkg.source))
        throw new Error(t("A skill from another source already uses this name."));
      const current = hasPrevious ? await this.readFiles(previousName) : [];
      const original = current.find((file) => file.path.toLowerCase() === "skill.md");
      if (
        options.expectedContent !== undefined &&
        (!original || new TextDecoder().decode(original.data) !== options.expectedContent)
      )
        throw new Error(t("The skill changed outside this editor. Refresh before saving again."));
      const files: SkillPackageFile[] = pkg.files.map((file) => ({
        ...file,
        data: file.data.slice(),
      }));
      const document = files.find((file) => file.path === "SKILL.md")!;
      if (options.expectedContent === undefined) {
        const parsed = parseSkillFile(new TextDecoder().decode(document.data), pkg.name);
        let enabledAgents = ["native"];
        if (options.preserveEnabled !== false && hasPrevious) {
          enabledAgents = [];
          if (original) {
            try {
              enabledAgents = parseSkillFile(new TextDecoder().decode(original.data), previousName)
                .frontmatter.enabledAgents;
            } catch {
              logWarn(
                "[Skills] Previous skill enablement is unreadable; replacement remains disabled",
                { name: previousName }
              );
            }
          }
        }
        document.data = new TextEncoder().encode(serializeSkillFile(parsed, { enabledAgents }));
      }
      const after: Registry = {
        version: 1,
        entries: this.registry.entries.filter(
          (entry) => entry.name !== previousName && entry.name !== pkg.name
        ),
      };
      after.entries.push({
        id: existing?.id ?? uuidv4(),
        name: pkg.name,
        source: pkg.source,
        state: "installed",
        baseline:
          options.updateBaseline === false && existing
            ? existing.baseline
            : fingerprintFiles(files, pkg.name),
      });
      await this.transact(
        {
          version: 1,
          name: pkg.name,
          previousName: hasPrevious ? previousName : undefined,
          before: this.registry,
          after,
          fingerprint: exactFingerprintFiles(files),
        },
        files,
        hasPrevious ? exactFingerprintFiles(current) : undefined,
        options.signal
      );
    });
  }

  remove(name: string): Promise<void> {
    return this.serial(async () => {
      await this.readState();
      validateFolder(name);
      const entry = this.entry(name);
      const after: Registry = {
        version: 1,
        entries: this.registry.entries.filter((record) => record.name !== name),
      };
      if (entry?.source.kind === "builtin") after.entries.push({ ...entry, state: "uninstalled" });
      const exists = await this.vault.adapter.exists(`${SKILL_LIBRARY}/${name}`);
      const expected = exists ? exactFingerprintFiles(await this.readFiles(name)) : undefined;
      await this.transact(
        { version: 1, name, previousName: exists ? name : undefined, before: this.registry, after },
        undefined,
        expected
      );
    });
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.pending.catch(() => undefined).then(work);
    this.pending = next;
    return next;
  }

  private async transact(
    operation: Operation,
    files?: SkillPackageFile[],
    expected?: string,
    signal?: AbortSignal
  ): Promise<void> {
    operation.beforeText = this.registryText;
    operation.previousFingerprint = expected;
    const adapter = this.vault.adapter;
    const directory = `${OPERATIONS}/${uuidv4()}`;
    const stage = `${directory}/stage`;
    const backup = `${directory}/backup`;
    const target = `${SKILL_LIBRARY}/${operation.name}`;
    const previous = operation.previousName
      ? `${SKILL_LIBRARY}/${operation.previousName}`
      : undefined;
    await ensureFolderExists(this.vault, directory);
    try {
      if (files) {
        await ensureFolderExists(this.vault, stage);
        for (const file of files) {
          signal?.throwIfAborted();
          const path = `${stage}/${file.path}`;
          await assertScribePath(this.vault, path);
          await ensureFolderExists(this.vault, path.slice(0, path.lastIndexOf("/")));
          if (file.path === "SKILL.md")
            await adapter.write(path, new TextDecoder().decode(file.data));
          else await adapter.writeBinary(path, file.data.slice().buffer);
        }
      }
      signal?.throwIfAborted();
      await writeVaultFile(
        this.vault,
        `${directory}/operation.json`,
        JSON.stringify(operation),
        null
      );
      signal?.throwIfAborted();
      if (previous) {
        if (expected !== exactFingerprintFiles(await this.readFiles(operation.previousName!)))
          throw new Error(t("The skill changed before replacement. Refresh and try again."));
        await assertScribePath(this.vault, previous);
        await assertScribePath(this.vault, backup);
        signal?.throwIfAborted();
        await adapter.rename(previous, backup);
      }
      if (files) {
        signal?.throwIfAborted();
        await assertScribePath(this.vault, stage);
        await assertScribePath(this.vault, target);
        if (await adapter.exists(target))
          throw new Error(t("The destination was created by another operation."));
        signal?.throwIfAborted();
        await adapter.rename(stage, target);
      }
      signal?.throwIfAborted();
      await writeVaultFile(
        this.vault,
        REGISTRY,
        JSON.stringify(operation.after),
        this.registryText
      );
      this.registry = operation.after;
      this.registryText = JSON.stringify(operation.after);
    } catch (error) {
      await assertScribePath(this.vault, `${directory}/operation.json`);
      if (await adapter.exists(`${directory}/operation.json`)) {
        await this.recoverOperation(directory, operation);
      } else {
        await assertScribePath(this.vault, directory);
        await adapter.rmdir(directory, true);
      }
      throw error;
    }
    try {
      await this.cleanupOperation(directory, operation);
    } catch (error) {
      logWarn(
        "[Skills] Installation committed; transaction cleanup will be retried on reopening",
        error
      );
    }
  }

  private async recover(): Promise<void> {
    await assertScribePath(this.vault, OPERATIONS);
    if (!(await this.vault.adapter.exists(OPERATIONS))) return;
    const listing = await this.vault.adapter.list(OPERATIONS);
    for (const directory of listing.folders) {
      await assertScribePath(this.vault, directory);
      const path = `${directory}/operation.json`;
      await assertScribePath(this.vault, path);
      if (!(await this.vault.adapter.exists(path))) {
        throw new Error(
          t("Unrecognized skill recovery files were retained. Review them before changing skills.")
        );
      }
      const operation: unknown = JSON.parse(await this.vault.adapter.read(path));
      if (!validOperation(operation))
        throw new Error(t("Skill recovery information is damaged. Original files were retained."));
      await this.recoverOperation(directory, operation);
    }
  }

  private async recoverOperation(directory: string, operation: Operation): Promise<void> {
    const adapter = this.vault.adapter;
    await assertScribePath(this.vault, `${directory}/operation.json`);
    if ((await adapter.read(`${directory}/operation.json`)) !== JSON.stringify(operation))
      throw new Error(t("Skill recovery information changed. Original files were retained."));
    await assertScribePath(this.vault, REGISTRY);
    const current = (await adapter.exists(REGISTRY)) ? await adapter.read(REGISTRY) : null;
    const after = JSON.stringify(operation.after);
    if (current === after) {
      this.registry = operation.after;
      this.registryText = current;
      await this.cleanupOperation(directory, operation);
      return;
    }
    if (current !== operation.beforeText)
      throw new Error(t("Skill records changed during recovery. Original files were retained."));
    const target = `${SKILL_LIBRARY}/${operation.name}`;
    const backup = `${directory}/backup`;
    const stage = `${directory}/stage`;
    await assertScribePath(this.vault, target);
    await assertScribePath(this.vault, backup);
    await assertScribePath(this.vault, stage);
    if (!(await adapter.exists(stage)) && operation.fingerprint && (await adapter.exists(target))) {
      if (exactFingerprintFiles(await this.readFiles(operation.name)) !== operation.fingerprint)
        throw new Error(t("The new skill changed during recovery. Both copies were retained."));
      await assertScribePath(this.vault, target);
      await assertScribePath(this.vault, stage);
      await adapter.rename(target, stage);
    }
    if (await adapter.exists(backup)) {
      if (
        !operation.previousFingerprint ||
        exactFingerprintFiles(await this.readTree(backup)) !== operation.previousFingerprint
      )
        throw new Error(t("The backup changed during recovery. Both copies were retained."));
      const previous = `${SKILL_LIBRARY}/${operation.previousName!}`;
      await assertScribePath(this.vault, previous);
      if (await adapter.exists(previous))
        throw new Error(t("The original location is occupied. The backup was retained."));
      await assertScribePath(this.vault, backup);
      await adapter.rename(backup, previous);
    }
    await this.cleanupOperation(directory, operation);
  }

  private async cleanupOperation(directory: string, operation: Operation): Promise<void> {
    const adapter = this.vault.adapter;
    await assertScribePath(this.vault, directory);
    const listing = await adapter.list(directory);
    if (
      listing.files.some((path) => path !== `${directory}/operation.json`) ||
      listing.folders.some(
        (path) => path !== `${directory}/stage` && path !== `${directory}/backup`
      )
    )
      throw new Error(t("Unknown recovery files were retained instead of being removed."));
    await assertScribePath(this.vault, `${directory}/operation.json`);
    if ((await adapter.read(`${directory}/operation.json`)) !== JSON.stringify(operation))
      throw new Error(t("Skill recovery information changed. Original files were retained."));
    for (const [folder, expected] of [
      ["stage", operation.fingerprint],
      ["backup", operation.previousFingerprint],
    ] as const) {
      const path = `${directory}/${folder}`;
      await assertScribePath(this.vault, path);
      if (
        (await adapter.exists(path)) &&
        (!expected || exactFingerprintFiles(await this.readTree(path)) !== expected)
      )
        throw new Error(t("Changed recovery files were retained instead of being removed."));
    }
    await assertScribePath(this.vault, directory);
    await adapter.rmdir(directory, true);
  }
}

function exactFingerprintFiles(files: readonly SkillPackageFile[]): string {
  return sha256(
    [...files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((file) => `${file.path}\0${arrayBufferToBase64(file.data.slice().buffer)}\0`)
      .join("")
  );
}

export function fingerprintFiles(files: readonly SkillPackageFile[], name: string): string {
  return sha256(
    [...files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((file) => {
        let data = file.data;
        if (file.path.toLowerCase() === "skill.md") {
          try {
            const parsed = parseSkillFile(new TextDecoder().decode(data), name);
            data = new TextEncoder().encode(serializeSkillFile(parsed, { enabledAgents: [] }));
          } catch {
            data = file.data;
          }
        }
        return `${file.path}\0${arrayBufferToBase64(data.slice().buffer)}\0`;
      })
      .join("")
  );
}

function sameSource(a: SkillSource, b: SkillSource): boolean {
  return a.kind === b.kind && a.origin === b.origin;
}

function validatePackage(pkg: SkillPackage): void {
  validateName(pkg.name, pkg.name);
  const seen = new Set<string>();
  let bytes = 0;
  for (const file of pkg.files) {
    const key = file.path.toLowerCase();
    if (
      !file.path ||
      file.path
        .split("/")
        .some((part) => !part || part === "." || part === ".." || /[\\:\0]/.test(part)) ||
      seen.has(key)
    )
      throw new Error(t("The skill contains an unsafe or duplicate file path."));
    seen.add(key);
    bytes += file.data.byteLength;
  }
  if (pkg.files.length > 2000 || bytes > 50 * 1024 * 1024)
    throw new Error(t("The skill exceeds the file count or size limit."));
  const document = pkg.files.find((file) => file.path === "SKILL.md");
  if (!document) throw new Error(t("SKILL.md was not found."));
  parseSkillFile(new TextDecoder().decode(document.data), pkg.name);
}

function parseRegistry(text: string): Registry {
  const value: unknown = JSON.parse(text);
  if (!validRegistry(value))
    throw new Error(
      t("Skill source records are damaged. Restore the records before changing skills.")
    );
  return value;
}

function validRegistry(value: unknown): value is Registry {
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("entries" in value) ||
    !Array.isArray(value.entries)
  )
    return false;
  const names = new Set<string>();
  return value.entries.every((entry: unknown) => {
    if (!entry || typeof entry !== "object") return false;
    const record = entry as SkillLibraryEntry;
    if (
      typeof record.id !== "string" ||
      typeof record.name !== "string" ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(record.name) ||
      record.name.length > 64 ||
      names.has(record.name) ||
      !record.source ||
      !["builtin", "agent", "system", "local"].includes(record.source.kind) ||
      !(["origin", "displayPath", "version"] as const).every(
        (key) => record.source[key] === undefined || typeof record.source[key] === "string"
      ) ||
      !["installed", "uninstalled"].includes(record.state) ||
      typeof record.baseline !== "string"
    )
      return false;
    names.add(record.name);
    return true;
  });
}

function validOperation(value: unknown): value is Operation {
  if (!value || typeof value !== "object") return false;
  const operation = value as Operation;
  return (
    operation.version === 1 &&
    safeFolder(operation.name) &&
    (operation.previousName === undefined || safeFolder(operation.previousName)) &&
    validRegistry(operation.before) &&
    validRegistry(operation.after) &&
    (operation.fingerprint === undefined || /^[a-f0-9]{64}$/.test(operation.fingerprint)) &&
    (operation.previousFingerprint === undefined ||
      /^[a-f0-9]{64}$/.test(operation.previousFingerprint)) &&
    (operation.beforeText === null || typeof operation.beforeText === "string")
  );
}

function safeFolder(name: unknown): name is string {
  return (
    typeof name === "string" && name.length > 0 && !name.startsWith(".") && !/[\\/:\0]/.test(name)
  );
}

function validateFolder(name: string): void {
  if (!safeFolder(name)) throw new Error(t("The skill folder is not safe to manage."));
}
