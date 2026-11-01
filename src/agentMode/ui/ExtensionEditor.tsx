import type {
  AgentExtensionDetails,
  AgentExtensionDraft,
  AgentExtensionScope,
} from "@/agentMode/session/extensionManagement";
import type { AgentExtensionKind } from "@/agentMode/session/extensionInventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";
import { ChevronDown } from "lucide-react";
import React from "react";

export interface ExtensionEditorProps {
  kind: Exclude<AgentExtensionKind, "plugin">;
  scope: AgentExtensionScope;
  original?: AgentExtensionDetails;
  onSave: (draft: AgentExtensionDraft) => Promise<void>;
  onClose: () => void;
  onTest?: (draft: AgentExtensionDraft) => Promise<string>;
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

export function ExtensionField({ label, children }: FieldProps) {
  return (
    <label className="tw-block tw-space-y-2">
      <span className="tw-block tw-text-ui-small tw-font-medium tw-text-normal">{label}</span>
      {children}
    </label>
  );
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}

export function ExtensionSelect({ value, onChange, options }: SelectProps) {
  return (
    <span className="tw-relative tw-block">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="!tw-h-8 tw-w-full !tw-appearance-none !tw-rounded-md !tw-border tw-border-solid tw-border-border !tw-bg-transparent !tw-px-3 !tw-pr-9 !tw-text-ui-small tw-text-normal !tw-shadow-none focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="tw-pointer-events-none tw-absolute tw-right-3 tw-top-1/2 tw-size-4 tw--translate-y-1/2 tw-text-muted"
      />
    </span>
  );
}

export function parseExtensionPairs(content: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of content.split(/\r?\n/).filter((line) => line.trim())) {
    const index = line.indexOf("=");
    if (index < 1 || !line.slice(0, index).trim())
      throw new Error(t("Use one NAME=value pair per line."));
    pairs[line.slice(0, index).trim()] = line.slice(index + 1);
  }
  return pairs;
}

function fieldText(value: unknown, fallback = ""): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : fallback;
}

function formatPairs(value: unknown): string {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value)
        .map(([key, entry]) => `${key}=${fieldText(entry)}`)
        .join("\n")
    : "";
}

const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "SessionEnd",
  "PreCompact",
  "PostCompact",
];

export function ExtensionEditor({
  kind,
  scope,
  original,
  onSave,
  onClose,
  onTest,
}: ExtensionEditorProps) {
  const config = original?.config ?? {};
  const [name, setName] = React.useState(original?.item.name ?? "");
  const [description, setDescription] = React.useState(() =>
    fieldText(config.description, original?.item.description ?? "")
  );
  const [content, setContent] = React.useState(
    (original?.content ?? "").replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
  );
  const [transport, setTransport] = React.useState(() =>
    fieldText(config.type, config.command ? "stdio" : "http")
  );
  const [url, setUrl] = React.useState(() => fieldText(config.url));
  const [command, setCommand] = React.useState(() => fieldText(config.command));
  const hookType = fieldText(config.type, "command");
  const supportedHook = ["command", "prompt", "agent", "http"].includes(hookType);
  const [prompt, setPrompt] = React.useState(() => fieldText(config.prompt));
  const [args, setArgs] = React.useState(Array.isArray(config.args) ? config.args.join("\n") : "");
  const [environment, setEnvironment] = React.useState(() => formatPairs(config.env));
  const [headers, setHeaders] = React.useState(() => formatPairs(config.headers));
  const [event, setEvent] = React.useState(() => fieldText(config.event, "SessionStart"));
  const [matcher, setMatcher] = React.useState(() => fieldText(config.matcher));
  const [timeout, setTimeoutValue] = React.useState(() =>
    fieldText(config.timeout, original ? "" : "60")
  );
  const [model, setModel] = React.useState(() => fieldText(config.model));
  const initialTools = Array.isArray(config.tools)
    ? config.tools.join(", ")
    : fieldText(config.tools);
  const [tools, setTools] = React.useState(initialTools);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [testResult, setTestResult] = React.useState("");
  const draft = (): AgentExtensionDraft => {
    if (kind === "mcp")
      return {
        kind,
        scope,
        name: name.trim(),
        original,
        config:
          transport === "stdio"
            ? {
                ...config,
                type: "stdio",
                command,
                args: args.split(/\r?\n/).filter(Boolean),
                env: parseExtensionPairs(environment),
                url: undefined,
                headers: undefined,
              }
            : {
                ...config,
                type: transport,
                url,
                headers: parseExtensionPairs(headers),
                command: undefined,
                args: undefined,
                env: undefined,
              },
      };
    if (kind === "hook") {
      if (!supportedHook) throw new Error(t("This hook type is not supported by this editor."));
      const seconds = timeout.trim() ? Number(timeout) : undefined;
      if (seconds !== undefined && (!Number.isFinite(seconds) || seconds <= 0))
        throw new Error(t("Timeout must be greater than zero."));
      return {
        kind,
        scope,
        name: event,
        original,
        config: {
          ...config,
          type: hookType,
          event,
          matcher,
          timeout: seconds,
          ...(hookType === "command"
            ? { command }
            : hookType === "http"
              ? { url, headers: parseExtensionPairs(headers) }
              : { prompt }),
        },
      };
    }
    return {
      kind,
      scope,
      name: name.trim(),
      original,
      content,
      config: {
        ...config,
        description,
        ...(kind === "subagent"
          ? {
              model: model.trim() || undefined,
              tools:
                tools === initialTools
                  ? config.tools
                  : tools.trim()
                    ? tools
                        .split(",")
                        .map((tool) => tool.trim())
                        .filter(Boolean)
                    : undefined,
            }
          : {}),
      },
    };
  };
  const submit = async (testing: boolean) => {
    setBusy(true);
    setError("");
    setTestResult("");
    try {
      const value = draft();
      if (testing && onTest) setTestResult(await onTest(value));
      else {
        await onSave(value);
        onClose();
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("Could not save configuration."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="tw-group/settings tw-space-y-4 tw-text-normal"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(false);
      }}
    >
      <fieldset disabled={busy} className="tw-min-w-0 tw-space-y-4 tw-border-0 tw-p-0">
        {kind !== "hook" && (
          <ExtensionField label={t("Name")}>
            <Input required value={name} onChange={(event) => setName(event.target.value)} />
          </ExtensionField>
        )}
        {(kind === "skill" || kind === "subagent" || kind === "command") && (
          <>
            <ExtensionField label={t("Description")}>
              <Input
                required={kind !== "command"}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </ExtensionField>
            {kind === "subagent" && (
              <div className="tw-grid tw-gap-4 sm:tw-grid-cols-2">
                <div className="tw-space-y-2">
                  <ExtensionField label={t("Model")}>
                    <Input
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                      placeholder={t("Use the agent's default")}
                    />
                  </ExtensionField>
                  <p className="tw-text-ui-smaller tw-leading-normal tw-text-muted">
                    {t(
                      "Leave blank to use the agent's default; inherit follows the main agent's model."
                    )}
                  </p>
                </div>
                <ExtensionField label={t("Allowed tools")}>
                  <Input
                    value={tools}
                    onChange={(event) => setTools(event.target.value)}
                    placeholder="Read, Grep, Glob"
                  />
                </ExtensionField>
              </div>
            )}
            <ExtensionField label={t(kind === "subagent" ? "Instructions" : "Content")}>
              <Textarea
                required
                rows={8}
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </ExtensionField>
          </>
        )}
        {kind === "mcp" && (
          <>
            <ExtensionField label={t("Connection type")}>
              <ExtensionSelect
                value={transport}
                onChange={setTransport}
                options={[
                  { value: "http", label: "HTTP" },
                  { value: "sse", label: "SSE" },
                  { value: "stdio", label: t("Local command") },
                ]}
              />
            </ExtensionField>
            {transport === "stdio" ? (
              <>
                <ExtensionField label={t("Startup command")}>
                  <Input
                    required
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                  />
                </ExtensionField>
                <ExtensionField label={t("Arguments (one per line)")}>
                  <Textarea
                    rows={3}
                    value={args}
                    onChange={(event) => setArgs(event.target.value)}
                  />
                </ExtensionField>
                <ExtensionField label={t("Environment variables (NAME=value)")}>
                  <Textarea
                    rows={3}
                    value={environment}
                    onChange={(event) => setEnvironment(event.target.value)}
                  />
                </ExtensionField>
              </>
            ) : (
              <>
                <ExtensionField label={t("Server address")}>
                  <Input
                    type="url"
                    required
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                </ExtensionField>
                <ExtensionField label={t("Request headers (NAME=value)")}>
                  <Textarea
                    rows={3}
                    value={headers}
                    onChange={(event) => setHeaders(event.target.value)}
                  />
                </ExtensionField>
              </>
            )}
            {onTest && (
              <div className="tw-group/extension-actions">
                <Button type="button" variant="secondary" onClick={() => void submit(true)}>
                  {t("Test connection")}
                </Button>
              </div>
            )}
          </>
        )}
        {kind === "hook" && (
          <>
            <p className="tw-text-ui-small tw-text-muted">
              {t("Hook type")}: {hookType}
            </p>
            <ExtensionField label={t("Trigger event")}>
              <ExtensionSelect
                value={event}
                onChange={setEvent}
                options={[...new Set([event, ...(original?.hookEvents ?? HOOK_EVENTS)])].map(
                  (value) => ({ value, label: value })
                )}
              />
            </ExtensionField>
            {hookType === "command" && (
              <ExtensionField label={t("Command")}>
                <Textarea
                  rows={3}
                  required
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </ExtensionField>
            )}
            {(hookType === "prompt" || hookType === "agent") && (
              <ExtensionField label={t("Prompt")}>
                <Textarea
                  rows={5}
                  required
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </ExtensionField>
            )}
            {hookType === "http" && (
              <>
                <ExtensionField label={t("Server address")}>
                  <Input
                    type="url"
                    required
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                </ExtensionField>
                <ExtensionField label={t("Request headers (NAME=value)")}>
                  <Textarea
                    rows={3}
                    value={headers}
                    onChange={(event) => setHeaders(event.target.value)}
                  />
                </ExtensionField>
              </>
            )}
            {!supportedHook && (
              <p role="alert">{t("This hook type is not supported by this editor.")}</p>
            )}
            <div className="tw-grid tw-gap-4 sm:tw-grid-cols-2">
              <ExtensionField label={t("Timeout (seconds)")}>
                <Input
                  type="number"
                  min="1"
                  value={timeout}
                  onChange={(event) => setTimeoutValue(event.target.value)}
                />
              </ExtensionField>
              <ExtensionField label={t("Match condition")}>
                <Input value={matcher} onChange={(event) => setMatcher(event.target.value)} />
              </ExtensionField>
            </div>
            <p className="tw-text-ui-smaller tw-leading-normal tw-text-muted">
              {t("Saving a hook does not run it immediately.")}
            </p>
          </>
        )}
      </fieldset>
      {testResult && (
        <p role="status" className="tw-text-ui-small tw-text-muted">
          {testResult}
        </p>
      )}
      {error && (
        <p role="alert" className="tw-text-ui-small tw-text-error">
          {error}
        </p>
      )}
      <div className="tw-group/extension-actions tw-flex tw-justify-end tw-gap-2 tw-border-0 tw-border-t tw-border-solid tw-border-border tw-pt-4">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button type="submit" disabled={busy || (kind === "hook" && !supportedHook)}>
          {t(busy ? "Saving…" : "Save")}
        </Button>
      </div>
    </form>
  );
}
