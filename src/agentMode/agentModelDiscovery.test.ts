import type { ModelManagementApi } from "@/modelManagement";
import type CopilotPlugin from "@/main";
import type { AgentSessionManager, BackendDescriptor } from "@/agentMode";
import { logInfo } from "@/logger";
import { waitFor } from "@testing-library/react";
import { wireAgentModelDiscovery } from "./agentModelDiscovery";
let mockDescriptors: BackendDescriptor[] = [];
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));
jest.mock("@/agentMode", () => ({
  listBackendDescriptors: () => mockDescriptors,
}));

const mockedLogInfo = jest.mocked(logInfo);
type ModelCatalog = NonNullable<ReturnType<AgentSessionManager["getCachedModelCatalog"]>>;
const identityWire = {
  encode: (s: { baseModelId: string }) => s.baseModelId,
  decode: (wireId: string) => ({
    selection: { baseModelId: wireId, effort: null as string | null },
    provider: null as string | null,
  }),
};

function makeDescriptor(partial: Partial<BackendDescriptor>): BackendDescriptor {
  return {
    id: "claude",
    displayName: "Claude",
    wire: identityWire,
    ...partial,
  } as unknown as BackendDescriptor;
}

function catalogWithModels(baseIds: string[]): ModelCatalog {
  return {
    availableModels: baseIds.map((baseModelId) => ({
      baseModelId,
      name: baseModelId,
      provider: null,
      effortOptions: [],
    })),
  };
}

interface ApiFake {
  api: ModelManagementApi;
  agentProviders: Array<{ providerId: string; origin: { kind: string; agentType: string } }>;
  byok: Array<{ origin: { kind: string; catalogProviderId?: string } }>;
  registerAgentProvider: jest.Mock;
  syncAgentModels: jest.Mock;
}

function makeApiFake(): ApiFake {
  const agentProviders: ApiFake["agentProviders"] = [];
  const byok: ApiFake["byok"] = [];

  const registerAgentProvider = jest.fn(
    async (input: { agentType: string; wireModelIds: string[] }) => {
      const providerId = `prov-${input.agentType}`;
      agentProviders.push({ providerId, origin: { kind: "agent", agentType: input.agentType } });
      return {
        providerId,
        configuredModelIds: input.wireModelIds.map((_w, i) => `cm-${input.agentType}-${i}`),
      };
    }
  );
  const syncAgentModels = jest.fn(async () => ({ added: [], removed: [] }));

  const api = {
    providerRegistry: {
      listByOrigin: (kind: string) => {
        if (kind === "agent") return agentProviders;
        if (kind === "byok") return byok;
        return [];
      },
    },
    setup: { agent: { registerAgentProvider, syncAgentModels } },
  } as unknown as ModelManagementApi;

  return {
    api,
    agentProviders,
    byok,
    registerAgentProvider,
    syncAgentModels,
  };
}

interface ManagerFake {
  manager: AgentSessionManager;
  setCatalog: (backendId: string, catalog: ModelCatalog | null) => void;
  emit: () => void;
}

function makeManagerFake(): ManagerFake {
  const catalogs = new Map<string, ModelCatalog | null>();
  let listener: (() => void) | null = null;
  const manager = {
    getCachedModelCatalog: (id: string) => catalogs.get(id) ?? null,
    subscribeModelCache: (cb: () => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
  } as unknown as AgentSessionManager;
  return {
    manager,
    setCatalog: (id, catalog) => catalogs.set(id, catalog),
    emit: () => listener?.(),
  };
}

function makePlugin(api: ModelManagementApi): CopilotPlugin {
  return { modelManagement: api } as unknown as CopilotPlugin;
}

async function waitForDiscoveryLog(message: string): Promise<void> {
  await waitFor(() => expect(mockedLogInfo).toHaveBeenCalledWith(expect.stringContaining(message)));
}

beforeEach(() => {
  mockDescriptors = [];
  mockedLogInfo.mockClear();
});

describe("agentModelDiscovery", () => {
  describe("wireAgentModelDiscovery()", () => {
    it("registers an agent provider with every reported model on the first probe", async () => {
      mockDescriptors = [makeDescriptor({ id: "claude" })];
      const m = makeManagerFake();
      const a = makeApiFake();
      m.setCatalog("claude", catalogWithModels(["gpt-5", "gpt-5.5"]));

      const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
      await waitForDiscoveryLog("first enrollment for claude");

      expect(a.registerAgentProvider).toHaveBeenCalledTimes(1);
      expect(a.registerAgentProvider.mock.calls[0][0]).toMatchObject({
        agentType: "claude",
        providerType: "anthropic",
        wireModelIds: ["gpt-5", "gpt-5.5"],
      });
      expect(a.syncAgentModels).not.toHaveBeenCalled();
      unsub();
    });

    it("leaves a model with an empty reported name out of the fallback display names", async () => {
      mockDescriptors = [makeDescriptor({ id: "claude" })];
      const m = makeManagerFake();
      const a = makeApiFake();
      m.setCatalog("claude", {
        availableModels: [
          { baseModelId: "gpt-5", name: "GPT-5", provider: null, effortOptions: [] },
          { baseModelId: "blank", name: "", provider: null, effortOptions: [] },
        ],
      });

      const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
      await waitForDiscoveryLog("first enrollment for claude");

      expect(a.registerAgentProvider.mock.calls[0][0].fallbackDisplayNames).toEqual({
        "gpt-5": "GPT-5",
      });
      unsub();
    });

    it("leaves auto-enroll ids unset for claude so its whole catalog starts enabled", async () => {
      mockDescriptors = [makeDescriptor({ id: "claude" })];
      const m = makeManagerFake();
      const a = makeApiFake();
      m.setCatalog("claude", catalogWithModels(["gpt-5", "gpt-5.5"]));

      const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
      await waitForDiscoveryLog("first enrollment for claude");

      expect(a.registerAgentProvider.mock.calls[0][0].autoEnrollModelIds).toBeUndefined();
      unsub();
    });

    it("syncs the changed model list instead of registering again when the agent provider already exists", async () => {
      mockDescriptors = [makeDescriptor({ id: "claude" })];
      const m = makeManagerFake();
      const a = makeApiFake();
      m.setCatalog("claude", catalogWithModels(["gpt-5"]));

      const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
      await waitForDiscoveryLog("first enrollment for claude");

      m.setCatalog("claude", catalogWithModels(["gpt-5", "gpt-5.5"]));
      m.emit();
      await waitFor(() => expect(a.syncAgentModels).toHaveBeenCalledTimes(1));

      expect(a.registerAgentProvider).toHaveBeenCalledTimes(1);
      expect(a.syncAgentModels).toHaveBeenCalledTimes(1);
      expect(a.syncAgentModels.mock.calls[0][0]).toEqual({
        agentType: "claude",
        wireModelIds: ["gpt-5", "gpt-5.5"],
        fallbackDisplayNames: { "gpt-5": "gpt-5", "gpt-5.5": "gpt-5.5" },
        fallbackDescriptions: {},
      });
      unsub();
    });

    it("does nothing when a later probe reports the same model list", async () => {
      mockDescriptors = [makeDescriptor({ id: "claude" })];
      const m = makeManagerFake();
      const a = makeApiFake();
      m.setCatalog("claude", catalogWithModels(["gpt-5"]));

      const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
      await waitForDiscoveryLog("first enrollment for claude");
      a.syncAgentModels.mockClear();

      m.emit();

      expect(a.syncAgentModels).not.toHaveBeenCalled();
      unsub();
    });

    it("neither registers nor syncs when the probe reports no models", async () => {
      mockDescriptors = [makeDescriptor({ id: "claude" })];
      const m = makeManagerFake();
      const a = makeApiFake();
      m.setCatalog("claude", catalogWithModels([]));

      const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
      await waitForDiscoveryLog("empty model list for claude");

      expect(a.registerAgentProvider).not.toHaveBeenCalled();
      expect(a.syncAgentModels).not.toHaveBeenCalled();
      unsub();
    });

    it("ignores a backend that has not reported a model catalog yet", () => {
      mockDescriptors = [makeDescriptor({ id: "claude" })];
      const m = makeManagerFake();
      const a = makeApiFake();
      m.setCatalog("claude", null);

      const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);

      expect(a.registerAgentProvider).not.toHaveBeenCalled();
      expect(a.syncAgentModels).not.toHaveBeenCalled();
      unsub();
    });

    it("stops reacting to model cache updates after the returned unsubscribe runs", () => {
      mockDescriptors = [makeDescriptor({ id: "claude" })];
      const m = makeManagerFake();
      const a = makeApiFake();

      const unsub = wireAgentModelDiscovery(makePlugin(a.api), m.manager);
      unsub();

      m.setCatalog("claude", catalogWithModels(["gpt-5"]));
      m.emit();
      expect(a.registerAgentProvider).not.toHaveBeenCalled();
    });
  });
});
