/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 测试替身必须保留实际 Hook 名称。 */
import { ConfiguredModelEnableList } from "@/settings/v2/components/ConfiguredModelEnableList";
import type { BackendDescriptor } from "@/agentMode";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mockEnable = jest.fn().mockResolvedValue(undefined),
  mockDisable = jest.fn().mockResolvedValue(undefined);
const mockSetEnabled = jest.fn().mockResolvedValue(undefined);
let mockBackends: Record<string, { enabledModels: string[] }> = {
  claude: { enabledModels: ["first"] },
};
const mockModels = [
  {
    configuredModelId: "first",
    providerId: "agent",
    info: { id: "first-code", displayName: "Same model", description: "From agent" },
  },
  {
    configuredModelId: "other",
    providerId: "byok",
    info: { id: "byok-code", displayName: "BYOK model" },
  },
  {
    configuredModelId: "second",
    providerId: "agent",
    info: { id: "second-code", displayName: "Same model" },
  },
];
const mockProviders = {
  agent: {
    providerId: "agent",
    displayName: "Claude Code",
    origin: { kind: "agent", agentType: "claude" },
  },
  byok: { providerId: "byok", origin: { kind: "byok" } },
};
jest.mock("@/modelManagement", () => ({
  configuredModelsAtom: "models",
  providersAtom: "providers",
  backendsAtom: "backends",
  capabilitiesFromConfiguredInfo: () => [],
  isChatModelInfo: () => true,
  useModelManagement: () => ({
    backendConfigRegistry: {
      enableModel: mockEnable,
      disableModel: mockDisable,
      setEnabledModels: mockSetEnabled,
    },
  }),
}));
jest.mock("jotai", () => ({
  useAtomValue: (atom: string) =>
    atom === "models" ? mockModels : atom === "providers" ? mockProviders : mockBackends,
}));
jest.mock("@/settings/model", () => ({ settingsStore: {} }));

describe("ConfiguredModelEnableList", () => {
  describe("ConfiguredModelEnableList()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockBackends = { claude: { enabledModels: ["first"] }, chat: { enabledModels: ["other"] } };
    });

    it("uses existing BYOK chat selections for native visibility and preserves the inherited list when its first switch changes", async () => {
      render(
        <ConfiguredModelEnableList
          descriptor={{ id: "native", displayName: "Scribe" } as BackendDescriptor}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /Visible models/ }));
      expect(screen.getByText("BYOK model")).toBeTruthy();
      expect(screen.queryByText("Same model")).toBeNull();
      const toggle = screen.getByRole("switch", { name: /byok-code/ });
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(toggle);
      await waitFor(() => expect(mockSetEnabled).toHaveBeenCalledWith("native", []));
    });

    it("keeps an explicitly empty native model list disabled instead of inheriting chat selections again", async () => {
      mockBackends.native = { enabledModels: [] };
      render(
        <ConfiguredModelEnableList
          descriptor={{ id: "native", displayName: "Scribe" } as BackendDescriptor}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /Visible models/ }));
      const toggle = screen.getByRole("switch", { name: /byok-code/ });
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(toggle);
      await waitFor(() => expect(mockSetEnabled).toHaveBeenCalledWith("native", ["other"]));
    });

    it("uses every entry registered for this agent while excluding BYOK models and preserving entry identities", async () => {
      render(
        <ConfiguredModelEnableList
          descriptor={{ id: "claude", displayName: "Claude" } as BackendDescriptor}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /Visible models/ }));
      expect(screen.queryByText("BYOK model")).toBeNull();
      expect(screen.getAllByText("Same model")).toHaveLength(2);
      expect(screen.getByText("first-code")).toBeTruthy();
      expect(screen.getByText("second-code")).toBeTruthy();
      fireEvent.click(screen.getByRole("switch", { name: /second-code/ }));
      await waitFor(() => expect(mockEnable).toHaveBeenCalledWith("claude", "second"));
      fireEvent.click(screen.getByRole("switch", { name: /first-code/ }));
      await waitFor(() => expect(mockDisable).toHaveBeenCalledWith("claude", "first"));
    });
  });
});
