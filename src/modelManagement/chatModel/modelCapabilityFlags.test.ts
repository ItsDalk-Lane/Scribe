import { ModelCapability } from "@/constants";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import { capabilityListFromModelInfo, isChatModelInfo } from "./modelCapabilityFlags";

describe("modelCapabilityFlags", () => {
  describe("isChatModelInfo()", () => {
    it.each([
      { id: "manual-model", displayName: "Manual" },
      {
        id: "vision-model",
        displayName: "Vision",
        modalities: { input: ["text", "image"], output: ["text"] },
      },
    ])("allows ordinary and manually entered chat models %p", (info) =>
      expect(isChatModelInfo(info)).toBe(true)
    );
    it.each([
      { id: "embed", displayName: "Embed", isEmbedding: true },
      { id: "image-model", displayName: "Image", modalities: { output: ["image"] } },
      { id: "voice-model", displayName: "Voice", modalities: { output: ["audio"] } },
      {
        id: "transcribe",
        displayName: "Transcribe",
        modalities: { input: ["audio"], output: ["text"] },
      },
      { id: "nv-rerank-qa", displayName: "Rerank", modalities: { output: ["text"] } },
      {
        id: "gpt-realtime",
        displayName: "Realtime",
        modalities: { input: ["text", "audio"], output: ["text", "audio"] },
      },
    ])("keeps non-chat model %p out of text chat", (info) =>
      expect(isChatModelInfo(info)).toBe(false)
    );
  });
  describe("capabilityListFromModelInfo()", () => {
    it("maps reasoning + vision to the capability enum values", () => {
      const info: ModelInfo = {
        id: "m",
        displayName: "M",
        modalities: { input: ["text", "image"] },
        reasoning: true,
      };
      expect(capabilityListFromModelInfo(info)).toEqual([
        ModelCapability.REASONING,
        ModelCapability.VISION,
      ]);
    });

    it("reads vision from an image input modality only", () => {
      const info: ModelInfo = {
        id: "m",
        displayName: "M",
        modalities: { input: ["text", "image"] },
      };
      expect(capabilityListFromModelInfo(info)).toEqual([ModelCapability.VISION]);
    });

    it("is empty for an input without image", () => {
      const info: ModelInfo = { id: "m", displayName: "M", modalities: { input: ["text"] } };
      expect(capabilityListFromModelInfo(info)).toEqual([]);
    });

    it("returns an empty list for a plain model", () => {
      expect(capabilityListFromModelInfo({ id: "m", displayName: "M" })).toEqual([]);
    });
  });
});
