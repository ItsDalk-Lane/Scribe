import type { ModelCostCurrency, ModelInfo, ModelStatus } from "@/modelManagement/types/catalog";

export const CONTEXT_LIMIT_PRESETS = [64000, 128000, 200000, 256000, 512000, 1000000] as const;

export const OUTPUT_LIMIT_PRESETS = [8000, 16000, 32000, 64000, 128000, 256000] as const;

export const COMMON_EFFORT_VALUES = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

// 目录声明了成本的模型按 API 计费显示单价区；未声明即按套餐计费，整个区域不出现。https://github.com/ItsDalk-Lane/Scribe/issues/67
export function hasCostConfig(info: ModelInfo): boolean {
  return info.cost !== undefined;
}

export function parseLimitInput(raw: string): number | undefined {
  const value = raw.trim().toLowerCase();
  if (value.length === 0) return undefined;
  const match = value.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!match) return undefined;
  const base = Number(match[1]);
  if (!Number.isFinite(base) || base <= 0) return undefined;
  const suffix = match[2]?.toLowerCase();
  if (suffix === "k") return Math.round(base * 1_000);
  if (suffix === "m") return Math.round(base * 1_000_000);
  return Math.round(base);
}

export interface ModelCapabilityFormState {
  inputModalities: string[];
  outputModalities: string[];
  reasoning: boolean;
  reasoningEfforts: string[];
  toolCall: boolean;
  attachment: boolean;
  structuredOutput: boolean;
  temperature: boolean;
  temperatureValue: string;
  contextLimit: string;
  outputLimit: string;
  inputLimit: string;
  costInput: string;
  costOutput: string;
  costCacheRead: string;
  costCacheWrite: string;
  costCurrency: ModelCostCurrency;
}

const MODALITY_OPTIONS = ["text", "image", "pdf", "video", "audio"];

function modalitiesFromInfo(info: ModelInfo | undefined, side: "input" | "output"): string[] {
  const values = info?.modalities?.[side];
  if (!values || values.length === 0) return [];
  return values.filter((value) => MODALITY_OPTIONS.includes(value));
}

function optionalNumberString(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function formStateFromInfo(info: ModelInfo): ModelCapabilityFormState {
  return {
    inputModalities: modalitiesFromInfo(info, "input"),
    outputModalities: modalitiesFromInfo(info, "output"),
    reasoning: info.reasoning === true,
    reasoningEfforts: [...(info.reasoningEfforts ?? [])],
    toolCall: info.toolCall === true,
    attachment: info.attachment === true,
    structuredOutput: info.structuredOutput === true,
    temperature: info.temperature === true,
    temperatureValue: optionalNumberString(info.temperatureValue),
    contextLimit: typeof info.limits?.context === "number" ? String(info.limits.context) : "",
    outputLimit: typeof info.limits?.output === "number" ? String(info.limits.output) : "",
    inputLimit: typeof info.limits?.input === "number" ? String(info.limits.input) : "",
    costInput: optionalNumberString(info.cost?.input),
    costOutput: optionalNumberString(info.cost?.output),
    costCacheRead: optionalNumberString(info.cost?.cacheRead),
    costCacheWrite: optionalNumberString(info.cost?.cacheWrite),
    costCurrency: info.cost?.currency ?? "USD",
  };
}

// 目录默认值只覆盖目录可声明的字段；温度取值与人工成本调整属于用户配置，重取默认时清空。https://github.com/ItsDalk-Lane/Scribe/issues/67
export function formStateFromCatalogDefault(catalog: ModelInfo): ModelCapabilityFormState {
  return formStateFromInfo(catalog);
}

function parseOptionalNumber(raw: string): number | undefined {
  const value = raw.trim();
  if (value.length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface ModelInfoPatch {
  modalities?: { input?: string[]; output?: string[] };
  limits?: { context?: number; output?: number; input?: number };
  reasoning?: boolean;
  reasoningEfforts?: string[];
  toolCall?: boolean;
  attachment?: boolean;
  structuredOutput?: boolean;
  temperature?: boolean;
  temperatureValue?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    currency?: ModelCostCurrency;
  };
}

export function buildModelInfoPatch(form: ModelCapabilityFormState): ModelInfoPatch {
  const patch: ModelInfoPatch = {};
  if (form.inputModalities.length > 0 || form.outputModalities.length > 0) {
    patch.modalities = {
      ...(form.inputModalities.length > 0 ? { input: [...form.inputModalities] } : {}),
      ...(form.outputModalities.length > 0 ? { output: [...form.outputModalities] } : {}),
    };
  }
  const context = parseLimitInput(form.contextLimit);
  const output = parseLimitInput(form.outputLimit);
  const input = parseLimitInput(form.inputLimit);
  const limits: NonNullable<ModelInfo["limits"]> = {};
  if (context !== undefined) limits.context = context;
  if (output !== undefined) limits.output = output;
  if (input !== undefined) limits.input = input;
  if (Object.keys(limits).length > 0) patch.limits = limits;
  patch.reasoning = form.reasoning;
  patch.reasoningEfforts = form.reasoning ? [...form.reasoningEfforts] : [];
  patch.toolCall = form.toolCall;
  patch.attachment = form.attachment;
  patch.structuredOutput = form.structuredOutput;
  patch.temperature = form.temperature;
  const temperatureValue = parseOptionalNumber(form.temperatureValue);
  if (form.temperature && temperatureValue !== undefined) {
    patch.temperatureValue = temperatureValue;
  }
  if (hasAnyCostValue(form)) {
    patch.cost = {
      ...(parseOptionalNumber(form.costInput) !== undefined
        ? { input: parseOptionalNumber(form.costInput) }
        : {}),
      ...(parseOptionalNumber(form.costOutput) !== undefined
        ? { output: parseOptionalNumber(form.costOutput) }
        : {}),
      ...(parseOptionalNumber(form.costCacheRead) !== undefined
        ? { cacheRead: parseOptionalNumber(form.costCacheRead) }
        : {}),
      ...(parseOptionalNumber(form.costCacheWrite) !== undefined
        ? { cacheWrite: parseOptionalNumber(form.costCacheWrite) }
        : {}),
      currency: form.costCurrency,
    };
    if (Object.keys(patch.cost).length <= 1) delete patch.cost;
  }
  return patch;
}

function hasAnyCostValue(form: ModelCapabilityFormState): boolean {
  return (
    hasCostText(form.costInput) ||
    hasCostText(form.costOutput) ||
    hasCostText(form.costCacheRead) ||
    hasCostText(form.costCacheWrite)
  );
}

function hasCostText(raw: string): boolean {
  return parseOptionalNumber(raw) !== undefined;
}

// 弃用模型不可新增选择；已勾选（已配置）的保留可取消勾选以便移除。https://github.com/ItsDalk-Lane/Scribe/issues/67
export function isModelSelectable(info: ModelInfo, selected: boolean): boolean {
  if (info.status === "deprecated" && !selected) return false;
  return true;
}

export type { ModelStatus };
