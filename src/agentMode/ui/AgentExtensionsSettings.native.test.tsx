import { NativeBackendDescriptor } from "@/agentMode/backends/native/descriptor";
import {
  extensionCheckCacheIdentity,
  resetExtensionCheckCacheForTests,
} from "@/agentMode/session/extensionCheckCache";
import { resetExpandedExtensionSectionsForTests } from "@/agentMode/ui/AgentExtensionsPanel";
import * as skillRuntimeModule from "@/agentMode/skills/ui/skillRuntimeItem";
import type { Skill } from "@/agentMode/skills/types";
import { DEFAULT_SETTINGS } from "@/constants";
import { AppContext } from "@/context";
import { PluginProvider } from "@/contexts/PluginContext";
import { settingsAtom, settingsStore } from "@/settings/model";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { render, screen, waitFor, within } from "@testing-library/react";
import { FileSystemAdapter, type App } from "obsidian";
import React from "react";
import { AgentExtensionsSettings } from "./AgentExtensionsSettings";
import type ScribePlugin from "@/main";

const mockSkills: Skill[] = [];
const mockProjects = [
  { id: "alpha", name: "Alpha" },
  { id: "beta", name: "Beta" },
];
const mockRefresh = jest.fn().mockResolvedValue({ ok: true, reconcileErrorCount: 0 });
const mockStorage = new Map<string, unknown>();
const mockNoRejectedSkills: readonly never[] = Object.freeze([]);
const mockInstallStates = Object.freeze({ native: { kind: "ready", source: "managed" } });
function mockReadSkills() {
  return mockSkills;
}
function mockReadRejectedSkills() {
  return mockNoRejectedSkills;
}
function mockReadEpermSeen() {
  return false;
}
function mockReadProjects() {
  return mockProjects;
}
function mockReadInstallStates() {
  return mockInstallStates;
}

jest.mock("@/agentMode/backends/registry", () => ({
  backendDisplayOrder: () => [NativeBackendDescriptor],
  listBackendDescriptors: () => [NativeBackendDescriptor],
}));
jest.mock("@/agentMode/session/useBackendInstallStates", () => ({
  useBackendInstallStates: mockReadInstallStates,
}));
jest.mock("@/agentMode/skills/SkillManager", () => ({
  SkillManager: {
    getInstance: () => ({
      refresh: mockRefresh,
      getAgentDirsProjectRel: () => ({ native: ".scribe/skills" }),
    }),
  },
  getManagedSkills: mockReadSkills,
  useManagedSkills: mockReadSkills,
  useRejectedSkills: mockReadRejectedSkills,
  useEpermSeen: mockReadEpermSeen,
  dismissEpermBanner: jest.fn(),
}));
jest.mock("@/projects/state", () => ({
  useProjects: mockReadProjects,
  getCachedProjectRecordById: (id: string) =>
    mockProjects.some((project) => project.id === id)
      ? { filePath: `${id}/project.md`, project: { id } }
      : undefined,
  getCachedProjectRecords: () => [],
}));
jest.mock("@/commands/state", () => ({ getCachedCustomCommands: () => [] }));
jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  isObsidianCliEnabled: () => true,
}));
jest.mock("@/logger", () => ({ logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

function projectSkill(
  project: string,
  name: string,
  options: { enabled: boolean; manual?: boolean; description?: string }
): Skill {
  const dirPath = `${project ? `/vault/${project}` : "/vault"}/.scribe/skills/${name}`;
  return {
    name,
    description: options.description ?? name,
    body: "Skill body",
    filePath: `${dirPath}/SKILL.md`,
    dirPath,
    enabledAgents: options.enabled ? ["native"] : [],
    ...(options.manual ? { disableModelInvocation: true } : {}),
    location: { kind: "project", agentDirs: ["native"] },
  };
}

function makeApp(): App {
  const adapter = new (FileSystemAdapter as unknown as new (base: string) => FileSystemAdapter)(
    "/vault"
  );
  return {
    vault: { adapter, getAbstractFileByPath: () => null },
    workspace: { openLinkText: jest.fn() },
    loadLocalStorage: (key: string) => mockStorage.get(key) ?? null,
    saveLocalStorage: jest.fn((key: string, value: unknown) => mockStorage.set(key, value)),
  } as unknown as App;
}

function renderSettings(app: App) {
  const plugin = {
    app,
    agentSessionManager: {
      isBackendEnabled: () => true,
      isExtensionChangePending: () => false,
      subscribe: () => () => {},
    },
    skills: { refresh: mockRefresh },
  } as unknown as ScribePlugin;
  return render(
    <PluginProvider plugin={plugin}>
      <AppContext.Provider value={app}>
        <AgentExtensionsSettings kind="skill" />
      </AppContext.Provider>
    </PluginProvider>
  );
}

function switchForDescription(description: string, name: string): HTMLElement {
  const label = screen.getByText(description).closest("button");
  const row = label?.parentElement?.parentElement;
  if (!row) throw new Error(`Missing skill row: ${description}`);
  return within(row).getByRole("switch", { name: `Enable ${name}` });
}

describe("AgentExtensionsSettings", () => {
  describe("AgentExtensionsSettings()", () => {
    beforeEach(() => {
      jest.restoreAllMocks();
      resetExtensionCheckCacheForTests();
      resetExpandedExtensionSectionsForTests();
      __resetVaultBaseCache();
      mockStorage.clear();
      mockSkills.length = 0;
      mockProjects.splice(
        0,
        mockProjects.length,
        { id: "alpha", name: "Alpha" },
        { id: "beta", name: "Beta" }
      );
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, scribeFolder: "scribe" });
    });

    it("keeps each project's file-specific enabled, manual and disabled states through fresh checks and reopening without rewriting old cache (https://github.com/ItsDalk-Lane/Scribe/issues/6)", async () => {
      mockSkills.push(
        projectSkill("alpha", "alpha-active", { enabled: true }),
        projectSkill("alpha", "alpha-manual", { enabled: true, manual: true }),
        projectSkill("alpha", "alpha-off", { enabled: false }),
        projectSkill("alpha", "shared-name", { enabled: true, description: "Alpha copy" }),
        projectSkill("beta", "shared-name", { enabled: false, description: "Beta copy" }),
        projectSkill("", "root-name", { enabled: true, description: "Vault copy" }),
        projectSkill("beta", "root-name", { enabled: false, description: "Project copy" })
      );
      const app = makeApp();
      const readState = jest.spyOn(skillRuntimeModule, "skillRuntimeItem");
      const first = renderSettings(app);

      await waitFor(() => {
        expect(
          screen.getByRole("switch", { name: "Enable alpha-active" }).getAttribute("aria-checked")
        ).toBe("true");
        expect(
          screen.getByRole("switch", { name: "Enable alpha-manual" }).getAttribute("aria-checked")
        ).toBe("true");
        expect(
          screen.getByRole("switch", { name: "Enable alpha-off" }).getAttribute("aria-checked")
        ).toBe("false");
        expect(switchForDescription("Alpha copy", "shared-name").getAttribute("aria-checked")).toBe(
          "true"
        );
        expect(switchForDescription("Beta copy", "shared-name").getAttribute("aria-checked")).toBe(
          "false"
        );
        expect(switchForDescription("Vault copy", "root-name").getAttribute("aria-checked")).toBe(
          "true"
        );
        expect(switchForDescription("Project copy", "root-name").getAttribute("aria-checked")).toBe(
          "false"
        );
      });
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Refresh and check" }).hasAttribute("disabled")
        ).toBe(false)
      );
      const availabilityAt = (path: string) => {
        const index = readState.mock.calls.map(([skill]) => skill.filePath).lastIndexOf(path);
        return index >= 0 ? readState.mock.results[index].value.availability : undefined;
      };
      expect(app.saveLocalStorage).not.toHaveBeenCalled();
      expect(availabilityAt(mockSkills[0].filePath)).toBe("loaded");
      expect(availabilityAt(mockSkills[1].filePath)).toBe("manual_only");
      expect(availabilityAt(mockSkills[2].filePath)).toBe("disabled");
      expect(availabilityAt(mockSkills[3].filePath)).toBe("loaded");
      expect(availabilityAt(mockSkills[4].filePath)).toBe("disabled");
      expect(availabilityAt(mockSkills[5].filePath)).toBe("loaded");
      expect(availabilityAt(mockSkills[6].filePath)).toBe("disabled");
      first.unmount();
      resetExtensionCheckCacheForTests();

      const reopened = renderSettings(app);
      expect(
        screen.getByRole("switch", { name: "Enable alpha-active" }).getAttribute("aria-checked")
      ).toBe("true");
      expect(
        screen.getByRole("switch", { name: "Enable alpha-manual" }).getAttribute("aria-checked")
      ).toBe("true");
      expect(
        screen.getByRole("switch", { name: "Enable alpha-off" }).getAttribute("aria-checked")
      ).toBe("false");
      expect(switchForDescription("Alpha copy", "shared-name").getAttribute("aria-checked")).toBe(
        "true"
      );
      expect(switchForDescription("Beta copy", "shared-name").getAttribute("aria-checked")).toBe(
        "false"
      );
      expect(switchForDescription("Vault copy", "root-name").getAttribute("aria-checked")).toBe(
        "true"
      );
      expect(switchForDescription("Project copy", "root-name").getAttribute("aria-checked")).toBe(
        "false"
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Refresh and check" }).hasAttribute("disabled")
        ).toBe(false)
      );
      expect(availabilityAt(mockSkills[0].filePath)).toBe("loaded");
      expect(availabilityAt(mockSkills[1].filePath)).toBe("manual_only");
      expect(availabilityAt(mockSkills[2].filePath)).toBe("disabled");
      expect(availabilityAt(mockSkills[3].filePath)).toBe("loaded");
      expect(availabilityAt(mockSkills[4].filePath)).toBe("disabled");
      expect(availabilityAt(mockSkills[5].filePath)).toBe("loaded");
      expect(availabilityAt(mockSkills[6].filePath)).toBe("disabled");
      expect(app.saveLocalStorage).not.toHaveBeenCalled();
      readState.mockRestore();
      reopened.unmount();
    });

    it("does not reopen a pre-fix cached view that attributed the root check to a disabled project skill (https://github.com/ItsDalk-Lane/Scribe/issues/6)", async () => {
      const skill = projectSkill("alpha", "alpha-off", { enabled: false });
      mockSkills.push(skill);
      const legacyIdentity = JSON.stringify(["native", "project", "/vault", "/vault"]);
      mockStorage.set("scribe:extension-check-cache:v1", {
        checks: {},
        views: {
          [legacyIdentity]: {
            groups: [
              {
                kind: "skill",
                status: "partial",
                warnings: [],
                items: [
                  {
                    id: skill.filePath,
                    name: skill.name,
                    source: "project",
                    location: skill.filePath,
                    availability: "loaded",
                  },
                ],
              },
            ],
            runtimeState: "checked",
          },
        },
      });

      const view = renderSettings(makeApp());

      expect(
        screen.getByRole("switch", { name: "Enable alpha-off" }).getAttribute("aria-checked")
      ).toBe("false");
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Refresh and check" }).hasAttribute("disabled")
        ).toBe(false)
      );
      expect(
        screen.getByRole("switch", { name: "Enable alpha-off" }).getAttribute("aria-checked")
      ).toBe("false");
      view.unmount();
    });

    it("does not use a saved pathless root report to confirm a same-named project file, preserves saved preferences and all old cache data (https://github.com/ItsDalk-Lane/Scribe/issues/6)", async () => {
      const rootSkill = projectSkill("", "root-only-report", {
        enabled: true,
        description: "Root verified file",
      });
      const unconfirmed = projectSkill("undiscovered", "root-only-report", {
        enabled: true,
        description: "Unconfirmed project file",
      });
      const disabled = projectSkill("alpha", "disabled-current", { enabled: false });
      mockSkills.push(rootSkill, unconfirmed, disabled);
      const scopeList = [
        { kind: "user" },
        { kind: "project", cwd: "/vault" },
        { kind: "project", cwd: "/vault/alpha" },
        { kind: "project", cwd: "/vault/beta" },
      ];
      const identity = JSON.stringify([
        extensionCheckCacheIdentity({
          backendId: "native",
          scopeKind: "project",
          cwd: "/vault",
          vaultBase: "/vault",
        }),
        scopeList,
      ]);
      const oldCache = {
        futureData: { text: "unknown data must survive", nested: [1, { retained: true }] },
        checks: Object.fromEntries(
          Array.from({ length: 20 }, (_, index) => [
            `retained-check-${index}`,
            { futureField: index, skills: [] },
          ])
        ),
        views: {
          ...Object.fromEntries(
            Array.from({ length: 8 }, (_, index) => [
              `retained-view-${index}`,
              { groups: [], futureField: index },
            ])
          ),
          [identity]: {
            runtimeState: "checked",
            groups: [
              {
                kind: "skill",
                status: "partial",
                warnings: [],
                items: [
                  {
                    id: "runtime:root-only-report",
                    name: "root-only-report",
                    source: "runtime",
                    availability: "loaded",
                  },
                  {
                    id: disabled.filePath,
                    name: disabled.name,
                    source: "project",
                    location: disabled.filePath,
                    availability: "loaded",
                  },
                ],
              },
            ],
          },
        },
      };
      const bytes = JSON.stringify(oldCache);
      mockStorage.set("scribe:extension-check-cache:v1", oldCache);
      const app = makeApp();
      const first = renderSettings(app);
      expect(
        switchForDescription("Unconfirmed project file", "root-only-report").getAttribute(
          "aria-description"
        )
      ).toBe("Checking availability…");
      expect(
        switchForDescription("Unconfirmed project file", "root-only-report").getAttribute(
          "aria-checked"
        )
      ).toBe("true");
      expect(
        screen.getByRole("switch", { name: "Enable disabled-current" }).getAttribute("aria-checked")
      ).toBe("false");
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Refresh and check" }).hasAttribute("disabled")
        ).toBe(false)
      );
      expect(
        switchForDescription("Unconfirmed project file", "root-only-report").getAttribute(
          "aria-description"
        )
      ).toBe("Availability could not be confirmed. Check again.");
      expect(
        switchForDescription("Unconfirmed project file", "root-only-report").getAttribute(
          "aria-checked"
        )
      ).toBe("true");
      expect(
        switchForDescription("Root verified file", "root-only-report").getAttribute("aria-checked")
      ).toBe("true");
      expect(
        switchForDescription("Root verified file", "root-only-report").getAttribute(
          "aria-description"
        )
      ).not.toBe("Availability could not be confirmed. Check again.");
      expect(JSON.stringify(mockStorage.get("scribe:extension-check-cache:v1"))).toBe(bytes);
      expect(app.saveLocalStorage).not.toHaveBeenCalled();
      first.unmount();
      resetExtensionCheckCacheForTests();
      const reopened = renderSettings(app);
      expect(
        screen.getByRole("switch", { name: "Enable disabled-current" }).getAttribute("aria-checked")
      ).toBe("false");
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Refresh and check" }).hasAttribute("disabled")
        ).toBe(false)
      );
      expect(JSON.stringify(mockStorage.get("scribe:extension-check-cache:v1"))).toBe(bytes);
      expect(app.saveLocalStorage).not.toHaveBeenCalled();
      reopened.unmount();
    });

    it("does not reuse a saved view after the project list changes (https://github.com/ItsDalk-Lane/Scribe/issues/6)", async () => {
      mockProjects.pop();
      mockSkills.push(projectSkill("beta", "beta-active", { enabled: true }));
      const app = makeApp();
      const first = renderSettings(app);
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Refresh and check" }).hasAttribute("disabled")
        ).toBe(false)
      );
      first.unmount();
      mockProjects.push({ id: "beta", name: "Beta" });

      const reopened = renderSettings(app);

      expect(
        screen.getByRole("switch", { name: "Enable beta-active" }).getAttribute("aria-description")
      ).toBe("Checking availability…");
      await waitFor(() =>
        expect(
          screen.getByRole("switch", { name: "Enable beta-active" }).getAttribute("aria-checked")
        ).toBe("true")
      );
      reopened.unmount();
    });
  });
});
