import { isAgentBackendEnabled } from "@/settings/agentEnablement";
import type { ScribeSettings } from "@/settings/model";

describe("agentEnablement", () => {
  describe("isAgentBackendEnabled()", () => {
    it("keeps agents enabled when older settings have no explicit choice", () => {
      expect(isAgentBackendEnabled({ agentMode: {} } as ScribeSettings, "native")).toBe(true);
    });

    it.each([true, false])(
      "keeps native available despite legacy enabled choice %s https://github.com/ItsDalk-Lane/Scribe/issues/31",
      (enabled) => {
        const settings = {
          agentMode: { backends: { native: { enabled } } },
        } as ScribeSettings;
        expect(isAgentBackendEnabled(settings, "native")).toBe(true);
      }
    );
  });
});
