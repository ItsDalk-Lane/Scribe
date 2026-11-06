import React from "react";
import { act, render, screen } from "@testing-library/react";
import type { Skill } from "@/agentMode/skills/types";
import { AgentExtensionsSettings } from "@/agentMode/ui/AgentExtensionsSettings";
import { AppContext } from "@/context";
import { PluginProvider } from "@/contexts/PluginContext";
import type ScribePlugin from "@/main";
import type { App } from "obsidian";
const mockSkills: Skill[] = [];
const mockRefresh = jest.fn().mockResolvedValue({ ok: true });
const mockStatuses = jest.fn().mockResolvedValue([]);
const mockNoRejected: readonly never[] = Object.freeze([]);
function mockReadSkills() {
  return mockSkills;
}
function mockReadRejected() {
  return mockNoRejected;
}
jest.mock("@/agentMode/skills/SkillManager", () => ({
  SkillManager: {
    hasInstance: () => true,
    getInstance: () => ({ refresh: mockRefresh, getBuiltinStatuses: mockStatuses }),
  },
  getManagedSkills: mockReadSkills,
  useManagedSkills: mockReadSkills,
  useRejectedSkills: mockReadRejected,
}));
jest.mock("@/utils/vaultPath", () => ({
  getVaultBase: () => "/vault",
  toVaultRelative: (path: string) => path.replace("/vault/", ""),
}));
const makeSkill = (name: string, enabledAgents: string[], manual = false): Skill => ({
  name,
  enabledAgents,
  description: name,
  body: "Read",
  filePath: `/vault/.scribe/skills/${name}/SKILL.md`,
  dirPath: `/vault/.scribe/skills/${name}`,
  disableModelInvocation: manual,
  location: { kind: "canonical" },
});
describe("AgentExtensionsSettings", () => {
  describe("AgentExtensionsSettings()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockSkills.length = 0;
    });
    it("retains saved enablement for automatic, manual-only, and disabled skills after reopening", async () => {
      mockSkills.push(
        makeSkill("automatic", ["native"]),
        makeSkill("manual", ["native"], true),
        makeSkill("disabled", [])
      );
      const app = { loadLocalStorage: jest.fn(), saveLocalStorage: jest.fn() } as unknown as App;
      const plugin = {
        app,
        newAgentChatWithDraft: jest.fn(),
        newSkillAuthoringChat: jest.fn(),
      } as unknown as ScribePlugin;
      const tree = (
        <PluginProvider plugin={plugin}>
          <AppContext.Provider value={app}>
            <AgentExtensionsSettings kind="skill" />
          </AppContext.Provider>
        </PluginProvider>
      );
      const first = render(tree);
      await act(async () => {
        await mockRefresh.mock.results[0].value;
      });
      expect(
        screen.getByRole("switch", { name: "Enable automatic" }).getAttribute("aria-checked")
      ).toBe("true");
      expect(
        screen.getByRole("switch", { name: "Enable manual" }).getAttribute("aria-checked")
      ).toBe("true");
      expect(
        screen.getByRole("switch", { name: "Enable disabled" }).getAttribute("aria-checked")
      ).toBe("false");
      first.unmount();
      await act(async () => {
        render(tree);
      });
      expect(
        screen.getByRole("switch", { name: "Enable disabled" }).getAttribute("aria-checked")
      ).toBe("false");
      expect(app.loadLocalStorage).not.toHaveBeenCalled();
      expect(app.saveLocalStorage).not.toHaveBeenCalled();
    });
    it("does not let an old cached runtime report enable a disabled current-vault skill https://github.com/ItsDalk-Lane/Scribe/issues/6", async () => {
      mockSkills.push(makeSkill("same-name", []));
      const oldCache = {
        futureData: { kept: true },
        views: { root: { skills: ["same-name"], runtimeState: "checked" } },
      };
      const bytes = JSON.stringify(oldCache);
      const app = {
        loadLocalStorage: jest.fn(() => oldCache),
        saveLocalStorage: jest.fn(),
      } as unknown as App;
      const plugin = { app } as unknown as ScribePlugin;
      await act(async () => {
        render(
          <PluginProvider plugin={plugin}>
            <AppContext.Provider value={app}>
              <AgentExtensionsSettings kind="skill" />
            </AppContext.Provider>
          </PluginProvider>
        );
      });
      expect(
        screen.getByRole("switch", { name: "Enable same-name" }).getAttribute("aria-checked")
      ).toBe("false");
      expect(JSON.stringify(oldCache)).toBe(bytes);
      expect(app.loadLocalStorage).not.toHaveBeenCalled();
      expect(app.saveLocalStorage).not.toHaveBeenCalled();
    });
  });
});
