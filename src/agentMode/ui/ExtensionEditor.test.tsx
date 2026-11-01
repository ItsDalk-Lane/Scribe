import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  AgentExtensionDetails,
  AgentExtensionScope,
} from "@/agentMode/session/extensionManagement";
import {
  ExtensionEditor,
  ExtensionField,
  ExtensionSelect,
  parseExtensionPairs,
} from "./ExtensionEditor";

const scope: AgentExtensionScope = { kind: "project", cwd: "/vault" };
function original(config: Record<string, unknown>): AgentExtensionDetails {
  return {
    item: { id: "entry", name: "review", source: "project", enabled: true },
    revision: "revision",
    content: "---\nname: review\ndescription: Before\n---\nOld instructions",
    config,
  };
}

describe("ExtensionEditor", () => {
  describe("ExtensionField()", () => {
    it("associates a field label with its input", () => {
      render(
        <ExtensionField label="Friendly name">
          <input defaultValue="notes" />
        </ExtensionField>
      );
      expect(screen.getByLabelText<HTMLInputElement>("Friendly name").value).toBe("notes");
    });
  });
  describe("ExtensionSelect()", () => {
    it("displays the selected option and reports a new selection", () => {
      const onChange = jest.fn();
      render(
        <ExtensionSelect
          value="http"
          onChange={onChange}
          options={[
            { value: "http", label: "HTTP" },
            { value: "stdio", label: "Local" },
          ]}
        />
      );
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "stdio" } });
      expect(onChange).toHaveBeenCalledWith("stdio");
    });
  });
  describe("parseExtensionPairs()", () => {
    it("keeps equals signs inside values and accepts blank lines", () => {
      expect(parseExtensionPairs("Authorization=Bearer token=a\n\n MODE =safe\r\n")).toEqual({
        Authorization: "Bearer token=a",
        MODE: "safe",
      });
    });
    it.each(["no equals", "=missing-name"])("rejects malformed pair %s", (value) => {
      expect(() => parseExtensionPairs(value)).toThrow("Use one NAME=value pair per line.");
    });
  });
  describe("ExtensionEditor()", () => {
    it("offers only the trigger events supported by the existing hook type", () => {
      render(
        <ExtensionEditor
          kind="hook"
          scope={scope}
          original={{
            ...original({ type: "agent", event: "Stop", prompt: "Check" }),
            hookEvents: ["Stop", "PreToolUse"],
          }}
          onSave={jest.fn()}
          onClose={jest.fn()}
        />
      );
      expect(
        [...screen.getByLabelText<HTMLSelectElement>("Trigger event").options].map(
          (option) => option.value
        )
      ).toEqual(["Stop", "PreToolUse"]);
    });
    it.each([undefined, "inherit", "haiku"])(
      "preserves model %s and omitted tools when only a subagent description changes",
      async (model) => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(
          <ExtensionEditor
            kind="subagent"
            scope={scope}
            original={original({ description: "Before", ...(model ? { model } : {}) })}
            onSave={onSave}
            onClose={jest.fn()}
          />
        );
        fireEvent.change(screen.getByLabelText("Description"), { target: { value: "After" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(onSave).toHaveBeenCalled());
        expect(onSave.mock.calls[0][0].config).toMatchObject({ description: "After" });
        expect(onSave.mock.calls[0][0].config.model).toBe(model);
        expect(onSave.mock.calls[0][0].config.tools).toBeUndefined();
      }
    );
    it.each(["prompt", "agent"])(
      "edits a %s hook without converting its execution type",
      async (type) => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(
          <ExtensionEditor
            kind="hook"
            scope={scope}
            original={original({ type, event: "Stop", prompt: "Check the result", model: "haiku" })}
            onSave={onSave}
            onClose={jest.fn()}
          />
        );
        fireEvent.change(screen.getByLabelText("Prompt"), {
          target: { value: "Check all results" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(onSave).toHaveBeenCalled());
        expect(onSave.mock.calls[0][0].config).toMatchObject({
          type,
          prompt: "Check all results",
          model: "haiku",
        });
        expect(onSave.mock.calls[0][0].config.timeout).toBeUndefined();
        expect(onSave.mock.calls[0][0].config.command).toBeUndefined();
      }
    );
    it("edits an HTTP hook address while preserving its headers and environment restrictions", async () => {
      const onSave = jest.fn().mockResolvedValue(undefined);
      render(
        <ExtensionEditor
          kind="hook"
          scope={scope}
          original={original({
            type: "http",
            event: "PreToolUse",
            url: "https://example.com/hook",
            headers: { Authorization: "Bearer $TOKEN" },
            allowedEnvVars: ["TOKEN"],
          })}
          onSave={onSave}
          onClose={jest.fn()}
        />
      );
      fireEvent.change(screen.getByLabelText("Server address"), {
        target: { value: "https://example.com/new-hook" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave.mock.calls[0][0].config).toMatchObject({
        type: "http",
        url: "https://example.com/new-hook",
        headers: { Authorization: "Bearer $TOKEN" },
        allowedEnvVars: ["TOKEN"],
      });
      expect(onSave.mock.calls[0][0].config.command).toBeUndefined();
    });
    it("keeps malformed structured values out of editable text fields", () => {
      render(
        <ExtensionEditor
          kind="subagent"
          scope={scope}
          original={original({
            description: { unexpected: true },
            model: { unexpected: true },
            tools: { unexpected: true },
          })}
          onSave={jest.fn()}
          onClose={jest.fn()}
        />
      );
      expect(screen.getByLabelText<HTMLInputElement>("Description").value).toBe("");
      expect(screen.getByLabelText<HTMLInputElement>("Model").value).toBe("");
      expect(screen.getByLabelText<HTMLInputElement>("Allowed tools").value).toBe("");
      expect(screen.queryByDisplayValue("[object Object]")).toBeNull();
    });
    it("allows removing a subagent's explicit model and tool override", async () => {
      const onSave = jest.fn().mockResolvedValue(undefined);
      render(
        <ExtensionEditor
          kind="subagent"
          scope={scope}
          original={original({ description: "Review", model: "haiku", tools: ["Read"] })}
          onSave={onSave}
          onClose={jest.fn()}
        />
      );
      fireEvent.change(screen.getByLabelText("Model"), { target: { value: "" } });
      fireEvent.change(screen.getByLabelText("Allowed tools"), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave.mock.calls[0][0].config.model).toBeUndefined();
      expect(onSave.mock.calls[0][0].config.tools).toBeUndefined();
    });
    it("does not overwrite a hook type that the editor cannot interpret", () => {
      const onSave = jest.fn();
      render(
        <ExtensionEditor
          kind="hook"
          scope={scope}
          original={original({ type: "future", event: "Stop", config: { keep: true } })}
          onSave={onSave}
          onClose={jest.fn()}
        />
      );
      expect(screen.getByRole("alert").textContent).toContain("not supported");
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).not.toHaveBeenCalled();
    });

    it("saves an HTTP server with named request headers and unknown settings intact", async () => {
      const onSave = jest.fn().mockResolvedValue(undefined);
      const onClose = jest.fn();
      render(
        <ExtensionEditor
          kind="mcp"
          scope={scope}
          original={original({
            type: "http",
            url: "https://example.com/mcp",
            customSetting: { keep: true },
          })}
          onSave={onSave}
          onClose={onClose}
        />
      );
      fireEvent.change(screen.getByLabelText("Request headers (NAME=value)"), {
        target: { value: "Authorization=Bearer token=a" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "mcp",
          scope,
          name: "review",
          config: expect.objectContaining({
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer token=a" },
            customSetting: { keep: true },
          }),
        })
      );
    });
    it("saves a local server command with one argument per line and environment variables", async () => {
      const onSave = jest.fn().mockResolvedValue(undefined);
      render(<ExtensionEditor kind="mcp" scope={scope} onSave={onSave} onClose={jest.fn()} />);
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "local-notes" } });
      fireEvent.change(screen.getByLabelText("Connection type"), { target: { value: "stdio" } });
      fireEvent.change(screen.getByLabelText("Startup command"), { target: { value: "node" } });
      fireEvent.change(screen.getByLabelText("Arguments (one per line)"), {
        target: { value: "/a path/server.js\n--mode=notes" },
      });
      fireEvent.change(screen.getByLabelText("Environment variables (NAME=value)"), {
        target: { value: "API_KEY=test=value" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave.mock.calls[0][0].config).toMatchObject({
        type: "stdio",
        command: "node",
        args: ["/a path/server.js", "--mode=notes"],
        env: { API_KEY: "test=value" },
      });
    });
    it("tests a draft connection without saving it or closing the editor", async () => {
      const onTest = jest.fn().mockResolvedValue("Connected: 2 tools");
      const onSave = jest.fn();
      const onClose = jest.fn();
      render(
        <ExtensionEditor
          kind="mcp"
          scope={scope}
          original={original({ type: "http", url: "https://example.com/mcp" })}
          onSave={onSave}
          onClose={onClose}
          onTest={onTest}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
      expect(await screen.findByRole("status")).toHaveProperty("textContent", "Connected: 2 tools");
      expect(onTest).toHaveBeenCalledWith(expect.objectContaining({ kind: "mcp", scope }));
      expect(onSave).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
    it("keeps a failed save open so it can be retried with the same draft", async () => {
      const onSave = jest
        .fn()
        .mockRejectedValueOnce(new Error("Server address unavailable"))
        .mockResolvedValue(undefined);
      const onClose = jest.fn();
      render(
        <ExtensionEditor
          kind="mcp"
          scope={scope}
          original={original({ type: "http", url: "https://example.com/mcp" })}
          onSave={onSave}
          onClose={onClose}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Server address unavailable");
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onSave).toHaveBeenCalledTimes(2);
    });
    it("saves a hook's event, matcher and timeout without executing its command", async () => {
      const onSave = jest.fn().mockResolvedValue(undefined);
      render(
        <ExtensionEditor
          kind="hook"
          scope={scope}
          original={original({
            event: "PreToolUse",
            command: "echo ready",
            matcher: "Read",
            timeout: 12,
            customPolicy: "keep",
          })}
          onSave={onSave}
          onClose={jest.fn()}
        />
      );
      fireEvent.change(screen.getByLabelText("Match condition"), {
        target: { value: "Read|Grep" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave.mock.calls[0][0]).toMatchObject({
        kind: "hook",
        name: "PreToolUse",
        config: {
          event: "PreToolUse",
          matcher: "Read|Grep",
          timeout: 12,
          command: "echo ready",
          customPolicy: "keep",
          type: "command",
        },
      });
      expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull();
    });
    it.each(["skill", "subagent"] as const)(
      "preserves unknown %s configuration while editing its instructions",
      async (kind) => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        const details = original({
          description: "Before",
          customPolicy: { keep: true },
          model: "sonnet",
          tools: ["Read", "Grep"],
        });
        render(
          <ExtensionEditor
            kind={kind}
            scope={scope}
            original={details}
            onSave={onSave}
            onClose={jest.fn()}
          />
        );
        const contentLabel = kind === "subagent" ? "Instructions" : "Content";
        expect(screen.getByLabelText<HTMLTextAreaElement>(contentLabel).value).toBe(
          "Old instructions"
        );
        fireEvent.change(screen.getByLabelText(contentLabel), {
          target: { value: "New instructions" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(onSave).toHaveBeenCalled());
        expect(onSave.mock.calls[0][0]).toMatchObject({
          kind,
          content: "New instructions",
          original: details,
          config: { customPolicy: { keep: true }, model: "sonnet", tools: ["Read", "Grep"] },
        });
      }
    );
  });
});
