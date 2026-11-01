import React from "react";
import type { App } from "obsidian";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  AgentExtensionDetails,
  AgentExtensionScope,
} from "@/agentMode/session/extensionManagement";
import {
  ExtensionDetailsView,
  ExtensionImportForm,
  ExtensionModal,
  PluginInstallForm,
} from "./ExtensionDialogs";

const scope: AgentExtensionScope = { kind: "project", cwd: "/vault" };
const pluginDetails: AgentExtensionDetails = {
  item: {
    id: "notes",
    name: "Notes",
    description: "Read notes",
    source: "project",
    location: "/plugins/notes",
    toolCount: 2,
  },
  revision: "revision",
  content: "Read-only content",
};

class TestModal extends ExtensionModal {
  renderBodyForTest(close: () => void) {
    return this.renderContent(close);
  }
}

describe("ExtensionDialogs", () => {
  describe("ExtensionModal", () => {
    describe("renderContent()", () => {
      it("renders the supplied native-modal body and forwards its close action", () => {
        const close = jest.fn();
        const modal = new TestModal({} as App, "Details", (dismiss) => (
          <button type="button" onClick={dismiss}>
            Done
          </button>
        ));
        render(modal.renderBodyForTest(close));
        fireEvent.click(screen.getByRole("button", { name: "Done" }));
        expect(close).toHaveBeenCalledTimes(1);
      });
    });
  });
  describe("PluginInstallForm()", () => {
    it("selects a marketplace plugin and installs its catalog identity in the selected scope", async () => {
      const onInstall = jest.fn().mockResolvedValue(undefined);
      const onClose = jest.fn();
      render(
        <PluginInstallForm
          scope={scope}
          marketplaces={[
            {
              name: "community",
              source: "https://example.com/plugins",
              plugins: [{ id: "notes@community", name: "Notes", description: "Read notes" }],
            },
          ]}
          onInstall={onInstall}
          onClose={onClose}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Notes Read notes" }));
      fireEvent.click(screen.getByRole("button", { name: "Add plugin" }));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onInstall).toHaveBeenCalledWith({
        action: "install",
        scope,
        plugin: "notes@community",
        local: false,
      });
    });
    it("keeps the marketplace address and plugin name after a failed install so it can be retried", async () => {
      const onInstall = jest
        .fn()
        .mockRejectedValueOnce(new Error("Marketplace unavailable"))
        .mockResolvedValue(undefined);
      const onClose = jest.fn();
      render(
        <PluginInstallForm
          scope={scope}
          marketplaces={[]}
          onInstall={onInstall}
          onClose={onClose}
        />
      );
      fireEvent.change(screen.getByLabelText("Marketplace address (optional)"), {
        target: { value: "https://example.com/market" },
      });
      fireEvent.change(screen.getByLabelText("Plugin name"), { target: { value: "notes" } });
      fireEvent.click(screen.getByRole("button", { name: "Add plugin" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Marketplace unavailable");
      fireEvent.click(screen.getByRole("button", { name: "Add plugin" }));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onInstall).toHaveBeenLastCalledWith({
        action: "install",
        scope,
        plugin: "notes",
        marketplace: "https://example.com/market",
        local: false,
      });
    });

    it("keeps a local plugin path after installation fails and retries without deleting the source", async () => {
      const onInstall = jest
        .fn()
        .mockRejectedValueOnce(new Error("Invalid plugin manifest"))
        .mockResolvedValue(undefined);
      const onClose = jest.fn();
      render(
        <PluginInstallForm
          scope={scope}
          marketplaces={[]}
          onInstall={onInstall}
          onClose={onClose}
        />
      );
      fireEvent.change(screen.getByLabelText("Add from"), { target: { value: "local" } });
      fireEvent.change(screen.getByLabelText("Plugin directory"), {
        target: { value: "/local/notes" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Add plugin" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Invalid plugin manifest");
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByLabelText<HTMLInputElement>("Plugin directory").value).toBe(
        "/local/notes"
      );
      fireEvent.click(screen.getByRole("button", { name: "Add plugin" }));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onInstall).toHaveBeenLastCalledWith({
        action: "install",
        scope,
        plugin: "/local/notes",
        local: true,
      });
    });
  });
  describe("ExtensionImportForm()", () => {
    it("imports pasted configuration into the selected kind and scope", async () => {
      const onImport = jest.fn().mockResolvedValue(undefined);
      const onClose = jest.fn();
      render(
        <ExtensionImportForm kind="mcp" scope={scope} onImport={onImport} onClose={onClose} />
      );
      fireEvent.change(screen.getByLabelText("Configuration content"), {
        target: { value: '{"mcpServers":{"notes":{"url":"https://example.com"}}}' },
      });
      fireEvent.click(screen.getByRole("button", { name: "Import" }));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onImport).toHaveBeenCalledWith({
        kind: "mcp",
        scope,
        content: '{"mcpServers":{"notes":{"url":"https://example.com"}}}',
      });
    });
    it("reads the chosen configuration file before importing it", async () => {
      const onImport = jest.fn().mockResolvedValue(undefined);
      const content = '{"hooks":{"SessionStart":[]}}';
      const file = Object.assign(new File([content], "hooks.json", { type: "application/json" }), {
        text: jest.fn().mockResolvedValue(content),
      });
      render(
        <ExtensionImportForm kind="hook" scope={scope} onImport={onImport} onClose={jest.fn()} />
      );
      fireEvent.change(screen.getByLabelText("Choose configuration file"), {
        target: { files: [file] },
      });
      await waitFor(() =>
        expect(screen.getByLabelText<HTMLTextAreaElement>("Configuration content").value).toBe(
          content
        )
      );
      fireEvent.click(screen.getByRole("button", { name: "Import" }));
      await waitFor(() => expect(onImport).toHaveBeenCalledWith({ kind: "hook", scope, content }));
    });

    it("shows an import failure and leaves the pasted configuration available for correction", async () => {
      render(
        <ExtensionImportForm
          kind="mcp"
          scope={scope}
          onImport={jest.fn().mockRejectedValue(new Error("Invalid configuration"))}
          onClose={jest.fn()}
        />
      );
      fireEvent.change(screen.getByLabelText("Configuration content"), {
        target: { value: "invalid" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Import" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Invalid configuration");
      expect(screen.getByLabelText<HTMLTextAreaElement>("Configuration content").value).toBe(
        "invalid"
      );
    });
  });
  describe("ExtensionDetailsView()", () => {
    it("shows read-only child details without editable or uninstall actions even when callbacks exist", () => {
      render(
        <ExtensionDetailsView
          details={{
            ...pluginDetails,
            item: { ...pluginDetails.item, parentPluginId: "notes@community", readOnly: true },
          }}
          onClose={jest.fn()}
          onUpdate={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      expect(
        screen.getByText(
          "This entry is managed by its source and cannot be edited or deleted independently."
        )
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Update plugin" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Uninstall" })).toBeNull();
      expect(screen.getByLabelText<HTMLTextAreaElement>("Content").readOnly).toBe(true);
    });
    it("updates a managed plugin and closes after success", async () => {
      const onUpdate = jest.fn().mockResolvedValue(undefined);
      const onClose = jest.fn();
      render(
        <ExtensionDetailsView
          details={pluginDetails}
          onUpdate={onUpdate}
          onClose={onClose}
          onDelete={jest.fn()}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Update plugin" }));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
