import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { setInterfaceLocale, type InterfaceLocale } from "@/lib/i18n";

const mockEnsureLoaded = jest.fn().mockResolvedValue(undefined);
const mockGetAllProviders = jest.fn().mockReturnValue([]);
const mockOnChange = jest.fn().mockReturnValue(() => {});
const mockRemoveProvider = jest.fn().mockResolvedValue(undefined);
const mockAddProviderOpen = jest.fn();
const mockConfigureOpen = jest.fn();
const mockVerify = jest.fn();
const mockListByOrigin = jest.fn();
const mockUnsubscribe = jest.fn();
let mockProviderListener: (() => void) | undefined;
const mockSubscribe = jest.fn((listener: () => void) => {
  mockProviderListener = listener;
  return mockUnsubscribe;
});

jest.mock("@/modelManagement/ui/ModelManagementContext", () => {
  const api = {
    catalogService: {
      ensureLoaded: mockEnsureLoaded,
      getAllProviders: mockGetAllProviders,
      onChange: mockOnChange,
      refresh: jest.fn(),
    },
    coordinator: { removeProvider: mockRemoveProvider },
    providerRegistry: {
      verify: mockVerify,
      listByOrigin: mockListByOrigin,
      subscribe: mockSubscribe,
    },
  };
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook
  return { useModelManagement: () => api };
});
// eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real `useApp` hook; the name must match the export
jest.mock("@/context", () => ({ useApp: () => ({}) }));
jest.mock("@/modelManagement/state/atoms", () => {
  const jotai = jest.requireActual<typeof import("jotai")>("jotai");
  const byokProviders = jotai.atom([
    {
      providerId: "p1",
      providerType: "anthropic",
      displayName: "Anthropic",
      origin: { kind: "byok", catalogProviderId: "anthropic" },
      addedAt: 0,
    },
    {
      providerId: "p2",
      providerType: "openai-compatible",
      displayName: "Local",
      origin: { kind: "byok" },
      addedAt: 0,
      requiresApiKey: false,
    },
  ]);
  return {
    byokProvidersAtom: byokProviders,
    visibleByokProvidersAtom: byokProviders,
    configuredModelsAtom: jotai.atom([
      {
        configuredModelId: "m1",
        providerId: "p1",
        info: { id: "claude", displayName: "Claude Sonnet 4.5", limits: { context: 200000 } },
        configuredAt: 0,
      },
    ]),
  };
});
jest.mock("@/settings/model", () => {
  const jotai = jest.requireActual<typeof import("jotai")>("jotai");
  return {
    settingsStore: jotai.createStore(),
  };
});
jest.mock("@/modelManagement/ui/dialogs/ConfigureProviderDialog", () => ({
  ConfigureProviderModal: jest.fn().mockImplementation(() => ({ open: mockConfigureOpen })),
}));
jest.mock("@/modelManagement/ui/dialogs/AddProviderDialog", () => ({
  AddProviderModal: jest.fn().mockImplementation(() => ({ open: mockAddProviderOpen })),
}));

import { ModelsAndProvidersPanel } from "./ModelsAndProvidersPanel";
import { AddProviderModal } from "@/modelManagement/ui/dialogs/AddProviderDialog";
import { ConfigureProviderModal } from "@/modelManagement/ui/dialogs/ConfigureProviderDialog";

function completeProviderSave(): void {
  fireEvent.click(screen.getByRole("button", { name: /Add a provider/i }));
  const options = jest.mocked(AddProviderModal).mock.calls.at(-1)![1];
  options.onPick({} as never);
  jest.mocked(ConfigureProviderModal).mock.calls.at(-1)![1].onSaved!();
}

const mockReadVerificationCache = jest.fn<Promise<Record<string, unknown>>, unknown[]>();
const mockRememberVerification = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
const mockVerificationFingerprint = jest.fn(
  (provider: { providerId: string; apiKeyRef?: string | null }) =>
    `fp:${provider.providerId}:${provider.apiKeyRef ?? "none"}`
);
jest.mock("@/modelManagement/providers/providerVerificationCache", () => ({
  readProviderVerificationCache: (...args: unknown[]) => mockReadVerificationCache(...args),
  rememberProviderVerification: (...args: unknown[]) => mockRememberVerification(...args),
  providerVerificationFingerprint: (provider: { providerId: string; apiKeyRef?: string | null }) =>
    mockVerificationFingerprint(provider),
}));

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

describe("ModelsAndProvidersPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListByOrigin.mockReturnValue([{ providerId: "p1" }, { providerId: "p2" }]);
    mockVerify.mockReset().mockResolvedValue({ ok: true, checkedAt: 0 });
    mockEnsureLoaded.mockResolvedValue(undefined);
    mockReadVerificationCache.mockReset().mockResolvedValue({});
    mockRememberVerification.mockClear();
  });
  describe("ModelsAndProvidersPanel", () => {
    it.each([
      ["en", "Models and providers", "Add a provider", "Search providers…"],
      ["zh-CN", "模型与供应商", "添加供应商", "搜索供应商…"],
    ] as const)(
      "names the shared provider settings in %s",
      async (language: InterfaceLocale, title, add, search) => {
        setInterfaceLocale(language);
        try {
          render(<ModelsAndProvidersPanel />);
          expect(await screen.findByText(title)).toBeTruthy();
          expect(screen.getByText("Anthropic")).toBeTruthy();
          expect(screen.getByText("Local")).toBeTruthy();
          expect(screen.getByRole("button", { name: add })).toBeTruthy();
          expect(screen.getByPlaceholderText(search)).toBeTruthy();
        } finally {
          setInterfaceLocale("en");
        }
      }
    );

    it("browses providers and reopens settings without credential checks or network verification", async () => {
      const first = render(<ModelsAndProvidersPanel />);
      await waitFor(() => expect(mockEnsureLoaded).toHaveBeenCalled());
      expect(mockVerify).not.toHaveBeenCalled();
      expect(screen.queryByText("Checking…")).toBeNull();
      expect(screen.getAllByText("Not verified")).toHaveLength(2);
      first.unmount();
      render(<ModelsAndProvidersPanel />);
      await waitFor(() => expect(mockEnsureLoaded).toHaveBeenCalledTimes(2));
      expect(mockVerify).not.toHaveBeenCalled();
    });

    it("shows the cached verification result on open when the provider config is unchanged (https://github.com/ItsDalk-Lane/Scribe/issues/39)", async () => {
      mockReadVerificationCache.mockResolvedValue({
        p1: { fingerprint: "fp:p1:none", result: { ok: true, checkedAt: 41 } },
      });
      render(<ModelsAndProvidersPanel />);
      expect(await screen.findByText("Endpoint accessible")).toBeTruthy();
      expect(screen.getAllByText("Not verified")).toHaveLength(1);
      expect(mockVerify).not.toHaveBeenCalled();
    });

    it("keeps the unverified badge when the cached fingerprint no longer matches (https://github.com/ItsDalk-Lane/Scribe/issues/39)", async () => {
      mockReadVerificationCache.mockResolvedValue({
        p1: { fingerprint: "fp-from-old-config", result: { ok: true, checkedAt: 41 } },
      });
      render(<ModelsAndProvidersPanel />);
      await screen.findByText("Anthropic");
      expect(screen.getAllByText("Not verified")).toHaveLength(2);
      expect(mockVerify).not.toHaveBeenCalled();
    });

    it("keeps the verifying banner hidden when only cached results are seeded (https://github.com/ItsDalk-Lane/Scribe/issues/39)", async () => {
      mockReadVerificationCache.mockResolvedValue({
        p1: { fingerprint: "fp:p1:none", result: { ok: true, checkedAt: 41 } },
      });
      render(<ModelsAndProvidersPanel />);
      expect(await screen.findByText("Endpoint accessible")).toBeTruthy();
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByText("Verifying providers…")).toBeNull();
    });

    it("renders configured providers and their models after the catalog loads", async () => {
      render(<ModelsAndProvidersPanel />);
      const providerCard = await screen.findByText("Anthropic");
      expect(providerCard).toBeTruthy();

      fireEvent.click(providerCard);
      expect(await screen.findByText("Claude Sonnet 4.5")).toBeTruthy();
    });

    it("opens the Add Provider modal from the add button", async () => {
      render(<ModelsAndProvidersPanel />);
      await screen.findByText("Anthropic");
      fireEvent.click(screen.getByRole("button", { name: /Add a provider/i }));
      expect(mockAddProviderOpen).toHaveBeenCalled();
    });
    it("checks each provider independently and clears progress only after every result", async () => {
      let resolveFirst!: (result: { ok: boolean; checkedAt: number }) => void;
      let resolveSecond!: (result: { ok: boolean; code: string; checkedAt: number }) => void;
      mockVerify.mockImplementation((id: string) =>
        id === "p1"
          ? new Promise((resolve) => {
              resolveFirst = resolve;
            })
          : new Promise((resolve) => {
              resolveSecond = resolve;
            })
      );
      render(<ModelsAndProvidersPanel />);
      await screen.findByText("Anthropic");
      act(() => completeProviderSave());
      expect(mockListByOrigin).toHaveBeenCalledWith("byok");
      expect(mockVerify.mock.calls).toEqual([["p1"], ["p2"]]);
      expect(screen.getAllByText("Checking…")).toHaveLength(2);
      expect(screen.getByRole("status")).toBeTruthy();
      await act(async () => {
        resolveFirst({ ok: true, checkedAt: 0 });
      });
      expect(screen.getByText("Endpoint accessible")).toBeTruthy();
      expect(screen.getByText("Checking…")).toBeTruthy();
      expect(screen.getByRole("status")).toBeTruthy();
      await act(async () => {
        resolveSecond({ ok: false, code: "invalid_api_key", checkedAt: 0 });
      });
      expect(screen.getByText("Invalid key")).toBeTruthy();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("rechecks rotated keys and ignores previous requests after a completed save", async () => {
      const oldResolvers: Array<(result: { ok: boolean; checkedAt: number }) => void> = [];
      mockVerify.mockImplementation(
        () =>
          new Promise((resolve) => {
            oldResolvers.push(resolve);
          })
      );
      render(<ModelsAndProvidersPanel />);
      await screen.findByText("Anthropic");
      act(() => completeProviderSave());
      mockVerify.mockResolvedValue({ ok: false, code: "missing_api_key", checkedAt: 1 });
      await act(async () => {
        completeProviderSave();
      });
      expect(screen.getAllByText("No key")).toHaveLength(2);
      await act(async () => {
        oldResolvers.forEach((resolve) => resolve({ ok: true, checkedAt: 0 }));
      });
      expect(screen.queryByText("Endpoint accessible")).toBeNull();
      expect(screen.getAllByText("No key")).toHaveLength(2);
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("clears an earlier success while checking edited providers and shows rejected checks", async () => {
      render(<ModelsAndProvidersPanel />);
      act(() => completeProviderSave());
      await screen.findAllByText("Endpoint accessible");
      let rejectCheck!: (error: Error) => void;
      mockListByOrigin.mockReturnValue([{ providerId: "p1" }]);
      mockVerify.mockImplementation(
        () =>
          new Promise((_, reject) => {
            rejectCheck = reject;
          })
      );
      act(() => {
        completeProviderSave();
      });
      expect(screen.queryByText("Endpoint accessible")).toBeNull();
      await act(async () => {
        rejectCheck(new Error("storage unavailable"));
      });
      expect(screen.getByText("Check failed")).toBeTruthy();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("does not probe intermediate registry mutations before a save completes", async () => {
      render(<ModelsAndProvidersPanel />);
      await screen.findByText("Anthropic");
      act(() => mockProviderListener?.());
      expect(mockVerify).not.toHaveBeenCalled();
      await act(async () => completeProviderSave());
      expect(mockVerify).toHaveBeenCalledTimes(2);
    });

    it("finishes without a progress banner when there are no providers", async () => {
      mockListByOrigin.mockReturnValue([]);
      render(<ModelsAndProvidersPanel />);
      await waitFor(() => expect(mockEnsureLoaded).toHaveBeenCalled());
      expect(mockVerify).not.toHaveBeenCalled();
      expect(screen.queryByRole("status")).toBeNull();
    });
    it("shows configured providers without credential checks while the catalog is loading", async () => {
      mockEnsureLoaded.mockReturnValue(new Promise(() => {}));
      render(<ModelsAndProvidersPanel />);
      expect(screen.getByText("Anthropic")).toBeTruthy();
      expect(mockVerify).not.toHaveBeenCalled();
    });

    it("discards in-flight results after leaving and reopening the tab", async () => {
      const oldResolvers: Array<(result: { ok: boolean; checkedAt: number }) => void> = [];
      mockVerify.mockImplementation(
        () =>
          new Promise((resolve) => {
            oldResolvers.push(resolve);
          })
      );
      const first = render(<ModelsAndProvidersPanel />);
      act(() => completeProviderSave());
      first.unmount();
      mockVerify.mockResolvedValue({ ok: false, code: "invalid_api_key", checkedAt: 1 });
      render(<ModelsAndProvidersPanel />);
      act(() => completeProviderSave());
      await screen.findAllByText("Invalid key");
      await act(async () => {
        oldResolvers.forEach((resolve) => resolve({ ok: true, checkedAt: 0 }));
      });
      expect(screen.queryByText("Endpoint accessible")).toBeNull();
      expect(screen.getAllByText("Invalid key")).toHaveLength(2);
    });
  });
});
