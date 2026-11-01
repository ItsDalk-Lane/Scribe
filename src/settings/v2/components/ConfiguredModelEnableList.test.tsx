/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 测试替身必须保留实际 Hook 名称。 */
import { ConfiguredModelEnableList } from "@/settings/v2/components/ConfiguredModelEnableList";
import type { BackendDescriptor } from "@/agentMode";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mockEnable = jest.fn().mockResolvedValue(undefined),
  mockDisable = jest.fn().mockResolvedValue(undefined);
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
  useModelManagement: () => ({
    backendConfigRegistry: { enableModel: mockEnable, disableModel: mockDisable },
  }),
}));
jest.mock("jotai", () => ({
  useAtomValue: (atom: string) =>
    atom === "models"
      ? mockModels
      : atom === "providers"
        ? mockProviders
        : { claude: { enabledModels: ["first"] } },
}));
jest.mock("@/settings/model", () => ({ settingsStore: {} }));

describe("ConfiguredModelEnableList", () => {
  describe("ConfiguredModelEnableList()", () => {
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
