import { isAgentBackendEnabled } from "@/settings/agentEnablement";
import type { CopilotSettings } from "@/settings/model";

describe("agentEnablement", () => {
  describe("isAgentBackendEnabled()", () => {
    it("keeps agents enabled when older settings have no explicit choice", () => {
      expect(isAgentBackendEnabled({ agentMode: {} } as CopilotSettings, "native")).toBe(true);
    });

    it.each([true, false])("returns the saved enabled choice %s", (enabled) => {
      const settings = {
        agentMode: { backends: { native: { enabled } } },
      } as CopilotSettings;
      expect(isAgentBackendEnabled(settings, "native")).toBe(enabled);
    });
  });
});
