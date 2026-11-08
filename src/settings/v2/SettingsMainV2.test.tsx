import { setInterfaceLocale } from "@/lib/i18n";
import type ScribePlugin from "@/main";
import SettingsMainV2 from "@/settings/v2/SettingsMainV2";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

jest.mock("@/settings/v2/components/BasicSettings", () => ({ BasicSettings: () => null }));
jest.mock("@/settings/v2/components/AboutSettingsPanel", () => ({
  AboutSettingsPanel: () => null,
}));
jest.mock("@/settings/v2/components/CommandSettings", () => ({ CommandSettings: () => null }));
jest.mock("@/settings/v2/components/DesktopOnlySettingsPanel", () => ({
  DesktopOnlySettingsPanel: () => null,
}));
const mockSkillManagerRefresh = jest.fn().mockResolvedValue(undefined);
jest.mock("@/agentMode", () => ({
  SkillsSettings: () => null,
  McpSettingsPanel: () => null,
}));
jest.mock("@/modelManagement", () => ({
  ModelsAndProvidersPanel: () => null,
  ModelManagementProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/settings/model", () => ({ resetSettings: jest.fn() }));
let mockSkillLoadErrorCount = 0;
jest.mock("@/settings/skillLoadErrorState", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; the name must match the export
  useSkillLoadErrorCount: () => mockSkillLoadErrorCount,
}));
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: () => true }));

const plugin = {
  app: {},
  manifest: { version: "1.2.3" },
  skills: { refresh: mockSkillManagerRefresh },
} as unknown as ScribePlugin;

describe("SettingsMainV2", () => {
  describe("SettingsMainV2", () => {
    afterEach(() => setInterfaceLocale("en"));

    it("translates all settings tabs after the module has already loaded", () => {
      setInterfaceLocale("zh-CN");
      render(<SettingsMainV2 plugin={plugin} initialTab="quickActions" />);
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Agent 配置",
        "模型",
        "我的指令",
        "技能",
        "命令",
        "子代理",
        "MCP",
        "关于",
      ]);
      expect(screen.getByRole("tab", { name: "模型" }).getAttribute("aria-selected")).toBe("true");
    });

    beforeEach(() => {
      mockSkillLoadErrorCount = 0;
      mockSkillManagerRefresh.mockClear();
    });

    it("displays text without icons in every settings tab", () => {
      render(<SettingsMainV2 plugin={plugin} initialTab="quickActions" />);
      for (const tab of screen.getAllByRole("tab")) {
        expect(tab.querySelector("svg")).toBeNull();
      }
    });

    it("keeps version information out of the settings header", () => {
      render(<SettingsMainV2 plugin={plugin} />);
      expect(screen.queryByText("v1.2.3")).toBeNull();
    });

    it("lists models and my commands as independent tabs without an agent page https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      render(<SettingsMainV2 plugin={plugin} />);

      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Agent configuration",
        "Models",
        "My commands",
        "Skills",
        "Commands",
        "Subagents",
        "MCP",
        "About",
      ]);
    });

    it("marks the Skills tab while a skill failed to load", () => {
      mockSkillLoadErrorCount = 1;

      render(<SettingsMainV2 plugin={plugin} />);

      expect(
        screen.getByRole("tab", { name: "Skills: Some skills failed to load" })
      ).not.toBeNull();
      expect(screen.getByTitle("Some skills failed to load")).not.toBeNull();
    });

    it("refreshes hidden Agent repairs when Settings reopens", async () => {
      render(<SettingsMainV2 plugin={plugin} />);

      await waitFor(() => expect(mockSkillManagerRefresh).toHaveBeenCalledTimes(1));
    });

    it("opens on a requested tab", () => {
      render(<SettingsMainV2 plugin={plugin} initialTab="quickActions" />);

      expect(screen.getByRole("tab", { name: "Models" }).getAttribute("aria-selected")).toBe(
        "true"
      );
    });
  });
});
