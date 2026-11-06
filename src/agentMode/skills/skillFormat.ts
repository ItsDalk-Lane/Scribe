import { Document, parseDocument, isMap, isScalar, isSeq, isNode, YAMLMap } from "yaml";
import type { BackendId } from "./types";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;

export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 1024;
const NAME_REPAIR_MESSAGE = "Use the same lowercase, hyphenated name in the file and folder.";

export interface ParsedSkillFile {
  frontmatter: SkillFrontmatter;
  body: string;
  doc: Document.Parsed;
  yaml: string;
}

// 依赖声明是可选元数据：命令行工具、Obsidian 插件或 Python 包。
// https://github.com/ItsDalk-Lane/Scribe/issues/46
export type SkillDependencyType = "command" | "obsidian-plugin" | "python-package";

export interface SkillDependency {
  type: SkillDependencyType;
  name: string;
  note?: string;
}

export interface SkillUiMetadata {
  displayName?: string;
  shortDescription?: string;
  icon?: string;
  brandColor?: string;
  defaultPrompt?: string;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string;
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  enabledAgents: BackendId[];
  dependencies?: SkillDependency[];
  uiMetadata?: SkillUiMetadata;
}

function splitFrontmatter(content: string): { yaml: string; body: string } {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) {
    throw new SkillFormatError(
      "SKILL.md must begin with a YAML frontmatter block delimited by ---"
    );
  }
  return { yaml: m[1] ?? "", body: m[2] ?? "" };
}

export class SkillFormatError extends Error {
  constructor(
    message: string,
    readonly offendingText?: string
  ) {
    super(message);
    this.name = "SkillFormatError";
  }
}

function yamlFormatError(
  yaml: string,
  error: { code: string; message: string; linePos?: readonly { line: number }[] }
): SkillFormatError {
  const errorLine = error.linePos?.[0]?.line;
  const offendingText = errorLine === undefined ? undefined : yaml.split(/\r?\n/)[errorLine - 1];

  if (error.code === "BLOCK_AS_IMPLICIT_KEY") {
    const descriptionLine = /^(description[ \t]*:[ \t]*([^'"\r\n]*: [^\r\n]*))$/.exec(
      offendingText ?? ""
    );
    if (descriptionLine?.[1] !== undefined && descriptionLine[2] !== undefined) {
      return new SkillFormatError(
        'The description contains ": " and must be quoted.',
        descriptionLine[1]
      );
    }
  }

  return new SkillFormatError(
    `SKILL.md frontmatter YAML is invalid: ${error.message}`,
    offendingText
  );
}

function frontmatterLine(doc: Document.Parsed, yaml: string, key: string): string | undefined {
  if (!isMap(doc.contents)) return undefined;
  const pair = doc.contents.items.find((item) => isScalar(item.key) && item.key.value === key);
  const keyOffset = pair?.key?.range?.[0];
  if (keyOffset === undefined) return undefined;

  const lineStart = yaml.lastIndexOf("\n", keyOffset - 1) + 1;
  const nextLine = yaml.indexOf("\n", keyOffset);
  const lineEnd = nextLine === -1 ? yaml.length : nextLine;
  return yaml.slice(lineStart, lineEnd).replace(/\r$/, "");
}

function readString(doc: Document.Parsed, key: string): string | undefined {
  const v = doc.get(key);
  return typeof v === "string" ? v : undefined;
}

function readBoolean(doc: Document.Parsed, key: string): boolean | undefined {
  const v = doc.get(key);
  return typeof v === "boolean" ? v : undefined;
}

function readEnabledAgents(doc: Document.Parsed): BackendId[] {
  const metadata = doc.get("metadata");
  if (!isMap(metadata)) return [];
  const raw = metadata.get("scribe-enabled-agents");
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const DEPENDENCY_TYPES: readonly SkillDependencyType[] = [
  "command",
  "obsidian-plugin",
  "python-package",
];

function readDependencies(doc: Document.Parsed): SkillDependency[] | undefined {
  if (!doc.has("dependencies")) return undefined;
  const raw = doc.get("dependencies", true);
  if (!isSeq(raw))
    throw new SkillFormatError("`dependencies` must be a list of dependency entries");
  return raw.items.map((item) => {
    if (!isMap(item)) throw new SkillFormatError("Each skill dependency must be a mapping");
    const type = item.get("type", true);
    const name = item.get("name", true);
    if (
      !isScalar(type) ||
      typeof type.value !== "string" ||
      !DEPENDENCY_TYPES.includes(type.value as SkillDependencyType)
    )
      throw new SkillFormatError(
        `Skill dependencies must use one of: ${DEPENDENCY_TYPES.join(", ")}`
      );
    if (!isScalar(name) || typeof name.value !== "string" || !name.value.trim())
      throw new SkillFormatError("Each skill dependency needs a non-empty `name`");
    const note = item.get("note", true);
    if (note !== undefined && (!isScalar(note) || typeof note.value !== "string"))
      throw new SkillFormatError("A skill dependency note must be a string");
    return {
      type: type.value as SkillDependencyType,
      name: name.value.trim(),
      ...(note !== undefined && isScalar(note) ? { note: note.value as string } : {}),
    };
  });
}

// 界面元数据存于 metadata.*，全部可选；缺失时行为与现状一致。
// https://github.com/ItsDalk-Lane/Scribe/issues/47
function readUiMetadata(doc: Document.Parsed, yaml: string): SkillUiMetadata | undefined {
  const metadata = doc.get("metadata");
  if (!isMap(metadata)) return undefined;
  const read = (key: string): string | undefined => {
    const value = metadata.get(key);
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  };
  const displayName = read("display-name");
  const shortDescription = read("short-description");
  const icon = read("icon");
  const brandColor = read("brand-color");
  const defaultPrompt = read("default-prompt");
  if (!displayName && !shortDescription && !icon && !brandColor && !defaultPrompt) return undefined;
  if (icon && (icon.startsWith("/") || /[\\:]/.test(icon) || icon.split("/").includes("..")))
    throw new SkillFormatError(
      "The skill icon must be a relative path inside the skill folder",
      frontmatterLine(doc, yaml, "metadata")
    );
  if (brandColor && !/^#[0-9a-fA-F]{6}$/.test(brandColor))
    throw new SkillFormatError("The skill brand color must look like #RRGGBB");
  return {
    ...(displayName ? { displayName } : {}),
    ...(shortDescription ? { shortDescription } : {}),
    ...(icon ? { icon } : {}),
    ...(brandColor ? { brandColor } : {}),
    ...(defaultPrompt ? { defaultPrompt } : {}),
  };
}

export function parseSkillFile(content: string, parentDirName?: string): ParsedSkillFile {
  const { yaml, body } = splitFrontmatter(content);
  const doc = parseDocument(yaml, { keepSourceTokens: true, intAsBigInt: true });

  if (doc.errors.length > 0) {
    throw yamlFormatError(yaml, doc.errors[0]);
  }
  if (!isMap(doc.contents)) {
    throw new SkillFormatError("SKILL.md frontmatter must be a YAML mapping");
  }

  const name = readString(doc, "name");
  if (name === undefined) {
    if (doc.has("name")) {
      throw new SkillFormatError(
        "Skill `name` must be a string",
        frontmatterLine(doc, yaml, "name")
      );
    }
    throw new SkillFormatError("SKILL.md frontmatter is missing required field `name`");
  }
  validateName(name, parentDirName ?? name, frontmatterLine(doc, yaml, "name"));

  const description = readString(doc, "description");
  if (description === undefined) {
    if (doc.has("description")) {
      throw new SkillFormatError(
        "Skill `description` must be a string",
        frontmatterLine(doc, yaml, "description")
      );
    }
    throw new SkillFormatError("SKILL.md frontmatter is missing required field `description`");
  }
  validateDescription(description, frontmatterLine(doc, yaml, "description"));

  const frontmatter: SkillFrontmatter = {
    name,
    description,
    license: readString(doc, "license"),
    compatibility: readString(doc, "compatibility"),
    allowedTools: readString(doc, "allowed-tools"),
    model: readString(doc, "model"),
    disableModelInvocation: readBoolean(doc, "disable-model-invocation"),
    userInvocable: readBoolean(doc, "user-invocable"),
    enabledAgents: readEnabledAgents(doc),
    dependencies: readDependencies(doc),
    uiMetadata: readUiMetadata(doc, yaml),
  };

  return { frontmatter, body, doc, yaml };
}

export function validateName(name: string, parentDirName: string, offendingText?: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new SkillFormatError("Skill `name` must be a non-empty string", offendingText);
  }
  if (name.length > NAME_MAX) {
    throw new SkillFormatError(
      `Skill \`name\` must be at most ${NAME_MAX} characters (got ${name.length})`,
      offendingText
    );
  }
  if (!NAME_RE.test(name)) {
    throw new SkillFormatError(NAME_REPAIR_MESSAGE, offendingText);
  }
  if (name !== parentDirName) {
    throw new SkillFormatError(NAME_REPAIR_MESSAGE, offendingText);
  }
}

export function validateDescription(description: string, offendingText?: string): void {
  if (typeof description !== "string" || description.length === 0) {
    throw new SkillFormatError("Skill `description` must be a non-empty string", offendingText);
  }
  if (description.length > DESCRIPTION_MAX) {
    throw new SkillFormatError(
      `Skill \`description\` must be at most ${DESCRIPTION_MAX} characters (got ${description.length})`,
      offendingText
    );
  }
}

export interface SkillFrontmatterPatch {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string;
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  enabledAgents?: BackendId[];
  author?: string;
  version?: string;
  tags?: string[];
  dependencies?: SkillDependency[];
  uiMetadata?: SkillUiMetadata;
}

export function serializeSkillFile(
  parsed: Pick<ParsedSkillFile, "doc" | "yaml" | "body">,
  patch: SkillFrontmatterPatch = {}
): string {
  let yaml = parsed.yaml;
  const fields = {
    name: "name",
    description: "description",
    license: "license",
    compatibility: "compatibility",
    allowedTools: "allowed-tools",
    model: "model",
    disableModelInvocation: "disable-model-invocation",
    userInvocable: "user-invocable",
  } as const;
  for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
    if (key in patch) yaml = patchYamlField(yaml, [fields[key]], patch[key]);
  }
  for (const key of ["author", "version", "tags"] as const) {
    if (key in patch)
      yaml = patchYamlField(yaml, parsed.doc.has(key) ? [key] : ["metadata", key], patch[key]);
  }
  if (patch.enabledAgents !== undefined)
    yaml = patchYamlField(
      yaml,
      ["metadata", "scribe-enabled-agents"],
      patch.enabledAgents.join(",")
    );
  if (patch.dependencies !== undefined)
    yaml = patchYamlField(yaml, ["dependencies"], patch.dependencies);
  if (patch.uiMetadata) {
    const uiKeys = {
      displayName: "display-name",
      shortDescription: "short-description",
      icon: "icon",
      brandColor: "brand-color",
      defaultPrompt: "default-prompt",
    } as const;
    // 按 key 存在性写入：undefined 表示清除该字段，其余原文不动。https://github.com/ItsDalk-Lane/Scribe/issues/47
    for (const key of Object.keys(uiKeys) as Array<keyof typeof uiKeys>) {
      if (key in patch.uiMetadata)
        yaml = patchYamlField(yaml, ["metadata", uiKeys[key]], patch.uiMetadata[key]);
    }
  }
  return `---\n${yaml.replace(/\n+$/, "")}\n---\n${parsed.body}`;
}

function patchYamlField(
  yaml: string,
  path: string[],
  value: string | boolean | string[] | SkillDependency[] | undefined
): string {
  const doc = parseDocument(yaml, { keepSourceTokens: true, intAsBigInt: true });
  if (!isMap(doc.contents))
    throw new SkillFormatError("SKILL.md frontmatter must be a YAML mapping");
  let owner: YAMLMap = doc.contents;
  const key = path[path.length - 1];
  let replacement = value === undefined ? undefined : JSON.stringify(value);
  if (path.length === 2) {
    const metadata = owner.get(path[0], true);
    if (metadata === undefined && replacement === undefined) return yaml;
    if (metadata === undefined) {
      const scalar = new Document(value).toString({ lineWidth: 0 }).trimEnd();
      const encoded = scalar.includes("\n") ? replacement : scalar;
      return `${yaml.replace(/\n+$/, "")}\n${path[0]}:\n  ${key}: ${encoded}\n`;
    }
    if (!isMap(metadata))
      throw new SkillFormatError(
        "Skill metadata must be a mapping before enablement can be changed."
      );
    owner = metadata;
  }
  if (typeof value === "string") {
    const scalar = new Document(value).toString({ lineWidth: 0 }).trimEnd();
    if (!scalar.includes("\n") && !(owner.flow && /[,[\]{}]/.test(scalar))) replacement = scalar;
  }
  const pair = owner.items.find((item) => isScalar(item.key) && item.key.value === key);
  const node = pair?.value;
  if (typeof value === "string" && isScalar(node)) {
    if (node.type === "QUOTE_DOUBLE") replacement = JSON.stringify(value);
    if (node.type === "QUOTE_SINGLE") replacement = `'${value.replace(/'/g, "''")}'`;
  }
  if (isNode(node) && node.range) {
    const [start, end, after] = node.range;
    if (replacement === undefined && pair && isScalar(pair.key) && pair.key.range) {
      if (owner.flow) {
        const afterValue = yaml.slice(end);
        const comma = /^\s*,\s*/.exec(afterValue);
        if (comma) return yaml.slice(0, pair.key.range[0]) + afterValue.slice(comma[0].length);
        const beforeKey = yaml.slice(0, pair.key.range[0]);
        return beforeKey.replace(/,\s*$/, "") + afterValue;
      }
      const line = yaml.lastIndexOf("\n", pair.key.range[0] - 1) + 1;
      return yaml.slice(0, line) + yaml.slice(after);
    }
    const trailing = yaml.slice(start, end).endsWith("\n") ? "\n" : "";
    const prefix = yaml.slice(0, start);
    return prefix + (prefix.endsWith(":") ? " " : "") + replacement + trailing + yaml.slice(end);
  }
  if (pair && isScalar(pair.key) && pair.key.range) {
    const start = pair.key.range[0];
    const end = yaml.indexOf("\n", start);
    const after = end === -1 ? yaml.length : end;
    if (replacement === undefined)
      return yaml.slice(0, yaml.lastIndexOf("\n", start - 1) + 1) + yaml.slice(after + 1);
    const colon = yaml.indexOf(":", pair.key.range[1]);
    return yaml.slice(0, colon + 1) + " " + replacement + yaml.slice(after);
  }
  if (replacement === undefined) return yaml;
  if (owner.flow && owner.range) {
    const position = owner.range[1] - 1;
    return `${yaml.slice(0, position)}${owner.items.length ? ", " : ""}${key}: ${replacement}${yaml.slice(position)}`;
  }
  const position = path.length === 2 && owner.range ? owner.range[1] : yaml.length;
  const before = yaml.slice(0, position).replace(/\n*$/, "\n");
  return `${before}${path.length === 2 ? "  " : ""}${key}: ${replacement}\n${yaml.slice(position)}`;
}
