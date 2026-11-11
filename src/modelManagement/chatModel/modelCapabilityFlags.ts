import { ModelCapability } from "@/constants";
import type { ModelInfo } from "@/modelManagement/types/catalog";

const IMAGE_MODALITY = "image";

const EMPTY_CAPABILITY_LIST: ModelCapability[] = Object.freeze([]) as unknown as ModelCapability[];

export function isChatModelInfo(info: ModelInfo): boolean {
  if (info.isEmbedding) return false;
  const output = info.modalities?.output;
  const input = info.modalities?.input;
  if (output?.length && !output.includes("text")) return false;
  if (input?.length && !input.includes("text")) return false;
  return !/(^|[-_/.\s])(embed(?:ding)?|rerank(?:er|ing)?|realtime|speech|tts|stt|asr|transcription)($|[-_/.\s])/i.test(
    `${info.id} ${info.family ?? ""}`
  );
}

export function capabilityListFromModelInfo(info: ModelInfo): ModelCapability[] {
  const reasoning = !!info.reasoning;
  const vision = !!info.modalities?.input?.includes(IMAGE_MODALITY);
  if (!reasoning && !vision) return EMPTY_CAPABILITY_LIST;
  const list: ModelCapability[] = [];
  if (reasoning) list.push(ModelCapability.REASONING);
  if (vision) list.push(ModelCapability.VISION);
  return list;
}

export function capabilitiesFromConfiguredInfo(info: ModelInfo): ModelCapability[] | undefined {
  // 只有非空输入类型能证明图片能力，输出元数据或空列表不能当作明确的纯文本声明。https://github.com/ItsDalk-Lane/Scribe/issues/56
  return info.modalities?.input?.length ? capabilityListFromModelInfo(info) : undefined;
}
