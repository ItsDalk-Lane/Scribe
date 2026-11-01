import {
  buildModelEnableGroups,
  partitionCandidates,
  partitionChatCandidates,
  rowMatches,
  toRow,
  type Candidate,
} from "./configuredModelGrouping";
import type { ConfiguredModel, Provider } from "@/modelManagement";
import { ModelCapability } from "@/constants";

function byokProvider(id: string, displayName: string): Provider {
  return {
    providerId: id,
    providerType: "anthropic",
    displayName,
    origin: { kind: "byok", catalogProviderId: "anthropic" },
    addedAt: 0,
  };
}

function agentProvider(id: string, agentType: "claude", displayName = id): Provider {
  return {
    providerId: id,
    providerType: "openai-compatible",
    displayName,
    origin: { kind: "agent", agentType },
    addedAt: 0,
  };
}

function model(configuredModelId: string, providerId: string, infoId: string): ConfiguredModel {
  return {
    configuredModelId,
    providerId,
    info: { id: infoId, displayName: infoId },
    configuredAt: 0,
  };
}

describe("configuredModelGrouping", () => {
  describe("partitionCandidates()", () => {
    const byok = byokProvider("byok-1", "Anthropic");
    const claudeAgent = agentProvider("claude-agent", "claude", "Claude");
    const providers = { [byok.providerId]: byok, [claudeAgent.providerId]: claudeAgent };
    const models = [
      model("m-byok", "byok-1", "claude-sonnet-4-5"),
      model("m-claude", "claude-agent", "sonnet"),
    ];

    it("claude: only this agent's agent-origin rows, no BYOK", () => {
      const { byokCandidates, agentOriginCandidates } = partitionCandidates(
        models,
        providers,
        new Set(),
        "claude"
      );
      expect(byokCandidates).toHaveLength(0);
      expect(agentOriginCandidates.map((c) => c.configuredModel.configuredModelId)).toEqual([
        "m-claude",
      ]);
    });

    it("reflects enabled state from the enabled-id set", () => {
      const { agentOriginCandidates } = partitionCandidates(
        models,
        providers,
        new Set(["m-claude"]),
        "claude"
      );
      expect(agentOriginCandidates[0].enabled).toBe(true);
    });

    it("skips models whose provider row is missing", () => {
      const orphan = [model("orphan", "missing-provider", "x")];
      const { byokCandidates, agentOriginCandidates } = partitionCandidates(
        orphan,
        providers,
        new Set(),
        "claude"
      );
      expect(byokCandidates).toHaveLength(0);
      expect(agentOriginCandidates).toHaveLength(0);
    });
  });

  describe("partitionChatCandidates()", () => {
    const byok = byokProvider("byok-1", "Anthropic");
    const agent = agentProvider("claude-agent", "claude", "Claude");
    const providers = { [byok.providerId]: byok, [agent.providerId]: agent };

    it("lists non-agent chat models with their enabled state and no agent-origin rows", () => {
      const { byokCandidates, agentOriginCandidates } = partitionChatCandidates(
        [
          model("m-on", "byok-1", "claude-sonnet-4-5"),
          model("m-off", "byok-1", "claude-haiku-4-5"),
        ],
        providers,
        new Set(["m-on"])
      );
      expect(byokCandidates.map((c) => [c.configuredModel.configuredModelId, c.enabled])).toEqual([
        ["m-on", true],
        ["m-off", false],
      ]);
      expect(agentOriginCandidates).toEqual([]);
    });

    it("omits non-chat models even when previously enabled, while keeping unknown manual chat candidates (https://github.com/logancyang/obsidian-copilot/issues/3147)", () => {
      const configuredModels = [
        model("chat", "byok-1", "claude-sonnet"),
        {
          ...model("image", "byok-1", "image-generator"),
          info: { id: "image-generator", displayName: "Image", modalities: { output: ["image"] } },
        },
        {
          ...model("speech", "byok-1", "voice-model"),
          info: { id: "voice-model", displayName: "Speech", family: "text-to-speech" },
        },
        model("rerank", "byok-1", "rerank-v3"),
        model("realtime", "byok-1", "gpt-realtime"),
        model("manual", "byok-1", "private-model-42"),
      ];
      const enabled = new Set(configuredModels.map((record) => record.configuredModelId));
      const { byokCandidates } = partitionChatCandidates(configuredModels, providers, enabled);
      expect(
        byokCandidates.map((candidate) => [
          candidate.configuredModel.configuredModelId,
          candidate.enabled,
        ])
      ).toEqual([
        ["chat", true],
        ["manual", true],
      ]);
      expect(configuredModels).toHaveLength(6);
      expect(enabled.size).toBe(6);
    });

    it("omits embedding models, agent-origin models, and models whose provider is missing", () => {
      const embedding: ConfiguredModel = {
        ...model("m-embed", "byok-1", "text-embedding-3-small"),
        info: { id: "text-embedding-3-small", displayName: "Embed", isEmbedding: true },
      };
      const { byokCandidates } = partitionChatCandidates(
        [
          embedding,
          model("m-agent", "claude-agent", "gpt-5"),
          model("m-orphan", "missing-provider", "x"),
          model("m-chat", "byok-1", "claude-sonnet-4-5"),
        ],
        providers,
        new Set()
      );
      expect(byokCandidates.map((c) => c.configuredModel.configuredModelId)).toEqual(["m-chat"]);
    });
  });

  describe("toRow()", () => {
    it("never surfaces the wire id as the description (it duplicates the label)", () => {
      const provider = byokProvider("p", "Anthropic");
      const withName: Candidate = {
        configuredModel: {
          configuredModelId: "cm",
          providerId: "p",
          info: { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
          configuredAt: 0,
        },
        provider,
        enabled: true,
      };
      const row = toRow(withName);
      expect(row.label).toBe("Claude Sonnet 4.5");
      expect(row.description).toBeUndefined();
      expect(row.wireId).toBe("claude-sonnet-4-5");

      const sameAsId: Candidate = {
        configuredModel: model("cm2", "p", "raw-id"),
        provider,
        enabled: false,
      };
      expect(toRow(sameAsId).description).toBeUndefined();
    });

    it("prefers the capability blurb over the wire id for the description line", () => {
      const provider = agentProvider("claude", "claude", "Claude");
      const candidate: Candidate = {
        configuredModel: {
          configuredModelId: "cm",
          providerId: "claude",
          info: {
            id: "default",
            displayName: "Default (recommended)",
            description: "Opus 4.7 with 1M context · Most capable for complex work",
          },
          configuredAt: 0,
        },
        provider,
        enabled: true,
      };
      const row = toRow(candidate);
      expect(row.label).toBe("Default (recommended)");
      expect(row.description).toBe("Opus 4.7 with 1M context · Most capable for complex work");
    });

    it("derives the vision capability from info.modalities (for the row's icon)", () => {
      const provider = agentProvider("claude", "claude", "Claude");
      const visionRow = toRow({
        configuredModel: {
          configuredModelId: "cm",
          providerId: "claude",
          info: {
            id: "claude-sonnet-4-5",
            displayName: "Claude Sonnet 4.5",
            modalities: { input: ["text", "image"] },
          },
          configuredAt: 0,
        },
        provider,
        enabled: true,
      });
      expect(visionRow.capabilities).toContain(ModelCapability.VISION);
    });

    it("leaves capabilities undefined for an unknown snapshot, defined for a known one", () => {
      const provider = agentProvider("claude", "claude", "Claude");
      const unknownRow = toRow({
        configuredModel: {
          configuredModelId: "cm",
          providerId: "claude",
          info: { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
          configuredAt: 0,
        },
        provider,
        enabled: true,
      });
      expect(unknownRow.capabilities).toBeUndefined();

      const knownNoVisionRow = toRow({
        configuredModel: {
          configuredModelId: "cm2",
          providerId: "claude",
          info: { id: "text-only", displayName: "Text Only", modalities: { input: ["text"] } },
          configuredAt: 0,
        },
        provider,
        enabled: true,
      });
      expect(knownNoVisionRow.capabilities).toBeDefined();
      expect(knownNoVisionRow.capabilities).not.toContain(ModelCapability.VISION);
    });
  });

  describe("rowMatches()", () => {
    it("matches a model by its wire id even when the label differs", () => {
      const row = toRow({
        configuredModel: {
          configuredModelId: "cm",
          providerId: "p",
          info: { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
          configuredAt: 0,
        },
        provider: byokProvider("p", "Anthropic"),
        enabled: true,
      });
      expect(rowMatches(row, "claude-sonnet-4-5")).toBe(true);
      expect(rowMatches(row, "sonnet")).toBe(true);
      expect(rowMatches(row, "gpt")).toBe(false);
    });
  });

  describe("buildModelEnableGroups()", () => {
    const byok = byokProvider("byok-1", "Anthropic");
    const claudeAgent = agentProvider("claude-agent", "claude", "claude");

    it("groups chat and agent models separately and labels mixed origins", () => {
      const groups = buildModelEnableGroups(
        {
          byokCandidates: [
            {
              configuredModel: model("byok-model", byok.providerId, "claude-sonnet"),
              provider: byok,
              enabled: true,
            },
          ],
          agentOriginCandidates: [
            {
              configuredModel: model("agent-model", claudeAgent.providerId, "sonnet"),
              provider: claudeAgent,
              enabled: true,
            },
          ],
        },
        ""
      );

      expect(
        groups.map(({ label, badge, destination }) => ({ label, badge, destination }))
      ).toEqual([
        { label: "Anthropic", badge: "BYOK", destination: { kind: "cloud", label: "Anthropic" } },
        { label: "claude", badge: "Agent Provided", destination: undefined },
      ]);
    });

    it("filters rows by the search query and drops empty groups", () => {
      const partition = {
        byokCandidates: [],
        agentOriginCandidates: [
          {
            configuredModel: model("m-sonnet", "claude-agent", "sonnet"),
            provider: claudeAgent,
            enabled: false,
          },
          {
            configuredModel: model("m-haiku", "claude-agent", "haiku"),
            provider: claudeAgent,
            enabled: false,
          },
        ],
      };
      const groups = buildModelEnableGroups(partition, "sonnet");
      expect(groups.map((g) => g.label)).toEqual(["claude"]);
      expect(groups[0].rows.map((r) => r.id)).toEqual(["m-sonnet"]);
    });

    it("claude: agent-origin rows render as a single provider group", () => {
      const claudeAgent = agentProvider("claude-agent", "claude", "Claude");
      const partition = {
        byokCandidates: [],
        agentOriginCandidates: [
          {
            configuredModel: model("m-claude", "claude-agent", "gpt-5"),
            provider: claudeAgent,
            enabled: true,
          },
        ],
      };
      const groups = buildModelEnableGroups(partition, "");
      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBe("Claude");
    });

    it("omits badges when the list has a single origin (claude)", () => {
      const claudeAgent = agentProvider("claude-agent", "claude", "Claude");
      const partition = {
        byokCandidates: [],
        agentOriginCandidates: [
          {
            configuredModel: model("m-claude", "claude-agent", "gpt-5"),
            provider: claudeAgent,
            enabled: true,
          },
        ],
      };
      const groups = buildModelEnableGroups(partition, "");
      expect(groups[0].badge).toBeUndefined();
    });
  });
});
