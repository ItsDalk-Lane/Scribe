export const PRESET_PLAN_KEYS = [
  "payg",
  "coding",
  "codingPlan",
  "agentPlan",
  "tokenPlan",
  "enterpriseLite",
  "enterprisePro",
  "stepPlan",
  "aksk",
  "apiKey",
] as const;

export type PresetPlanKey = (typeof PRESET_PLAN_KEYS)[number];

export const PRESET_REGION_KEYS = ["cn", "intl"] as const;

export type PresetRegionKey = (typeof PRESET_REGION_KEYS)[number];

export interface ProviderPresetFamily {
  readonly displayName: string;
  readonly planOrder?: readonly PresetPlanKey[];
}

export const PRESET_FAMILIES = {
  kimi: {
    displayName: "Kimi",
    planOrder: ["payg", "coding"],
  },
  volcengine: {
    displayName: "Volcengine",
  },
  tencent: {
    displayName: "Tencent Cloud",
    planOrder: ["tokenPlan", "enterpriseLite", "enterprisePro"],
  },
  qwencloud: {
    displayName: "QwenCloud",
  },
  qianwen: {
    displayName: "千问AI平台",
  },
  zhipu: {
    displayName: "Zhipu GLM",
  },
  stepfun: {
    displayName: "StepFun",
  },
  streamlake: {
    displayName: "StreamLake",
  },
  minimax: {
    displayName: "MiniMax",
  },
  "xiaomi-mimo": {
    displayName: "Xiaomi MiMo",
  },
  sudocode: {
    displayName: "SudoCode",
  },
} as const satisfies Record<string, ProviderPresetFamily>;

export type PresetFamilyId = keyof typeof PRESET_FAMILIES;
