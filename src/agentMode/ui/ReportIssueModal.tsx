import { t } from "@/lib/i18n";
import { frameSink } from "@/agentMode/session/debugSink";
import { logError, logInfo, logWarn } from "@/logger";
import { logFileManager } from "@/logFileManager";
import { isDesktopRuntime, requireNodeModule } from "@/utils/desktopRuntime";
import { formatBytes } from "@/utils/formatBytes";
import {
  buildLinkedReportIssueUrl,
  buildManualIssueUrl,
  buildReportBundle,
  getNodeReportRuntime,
  type ReportLogRequest,
} from "@/utils/issueReport";
import { ReportUploadError, type ReportUploader } from "@/utils/reportUpload";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { captureWindowBehindDialogs } from "./reportScreenshot";
import { getSettings } from "@/settings/model";
import { getPersistedDeviceId } from "@/utils/deviceId";
import { createReportUploader } from "@/utils/reportUpload.brevilabs";
import { App, ItemView, Modal, Notice, Plugin, apiVersion } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";
import {
  ReportIssueFlow,
  type PreparedReport,
  type ReportSourceId,
  type ReportSourceOption,
  type UploadOutcome,
} from "./ReportIssueFlow";

const FRAME_LOG_NAME = "acp-frames.ndjson.txt";
const CHAT_LOG_NAME = "scribe-log.md";

export interface ReportIssueModalParams {
  app: App;
  activeBackend: string;
  pluginVersion: string;
  uploader: ReportUploader;
  initialNote?: string;
  preselectAllSources?: boolean;
  onReported?: (report: { reportId: string; issueUrl: string }) => void;
}

export type OpenReportIssueOptions = Pick<
  ReportIssueModalParams,
  "activeBackend" | "initialNote" | "preselectAllSources" | "onReported"
>;

export function openReportIssueModal(
  plugin: Pick<Plugin, "app" | "manifest">,
  options: OpenReportIssueOptions
): ReportIssueModal {
  const { app, manifest } = plugin;
  const modal = new ReportIssueModal({
    ...options,
    app,
    pluginVersion: manifest.version,
    uploader: createReportUploader({
      installId: () => getPersistedDeviceId(app),
      clientVersion: manifest.version,
    }),
  });
  modal.open();
  return modal;
}

interface ElectronShell {
  openExternal?: (url: string) => Promise<void>;
  showItemInFolder?: (path: string) => void;
}
function getElectronShell(): ElectronShell | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron shell is optional and loaded lazily so reporting can degrade gracefully
    const electron = require("electron") as
      | { shell?: ElectronShell; remote?: { shell?: ElectronShell } }
      | undefined;
    return electron?.shell ?? electron?.remote?.shell ?? null;
  } catch {
    return null;
  }
}

export async function createReportDir(): Promise<string> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const os = requireNodeModule<typeof import("node:os")>("os");
  const path = requireNodeModule<typeof import("node:path")>("path");
  return fs.mkdtemp(path.join(os.tmpdir(), "obsidian-scribe-report-"));
}

export async function discardReport(report: Pick<PreparedReport, "zipDir">): Promise<void> {
  try {
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    await fs.rm(report.zipDir, { recursive: true, force: true });
  } catch (err) {
    logWarn(`[ReportIssue] could not remove the abandoned report at ${report.zipDir}:`, err);
  }
}

function formatBundleId(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}-${date.getTime().toString(36).slice(-4)}`;
}

export async function uploadReport(
  uploader: ReportUploader,
  report: PreparedReport
): Promise<UploadOutcome> {
  try {
    const { reportId } = await uploader(report.uploadAttempt);
    return { ok: true, reportId, issueUrl: buildLinkedReportIssueUrl(report.issueDraft, reportId) };
  } catch (err) {
    logError("[ReportIssue] could not upload the report:", err);
    const generic = t("Something went wrong while uploading the report.");
    return { ok: false, error: err instanceof ReportUploadError ? err.message : generic };
  }
}

export async function openIssuePageWith(
  shell: Pick<ElectronShell, "openExternal"> | null,
  url: string
): Promise<boolean> {
  if (!shell?.openExternal) return false;
  try {
    await shell.openExternal(url);
    return true;
  } catch (err) {
    logError("[ReportIssue] could not open the issue page:", err);
    return false;
  }
}

export class ReportIssueModal extends Modal {
  private root: Root | null = null;
  private prepared: PreparedReport | null = null;
  private uploading = false;

  constructor(private readonly params: ReportIssueModalParams) {
    super(params.app);
    // @ts-ignore — setTitle exists at runtime (see ConfirmModal).
    this.setTitle(t("Report an issue"));
  }

  onOpen() {
    if (!isDesktopRuntime()) {
      new Notice(t("Reporting an issue is available on desktop only."));
      this.close();
      return;
    }
    this.root = createPluginRoot(this.contentEl, this.app);
    this.root.render(
      <ReportIssueFlow
        initialNote={this.params.initialNote}
        sources={this.buildSources()}
        prepare={(note, selected) => this.prepare(note, selected)}
        upload={(report) => this.upload(report)}
        discardReport={(report) => this.discard(report)}
        onCancel={() => this.close()}
        onUploaded={(outcome) => void this.onUploaded(outcome)}
        openIssuePage={(url) => void this.openIssuePage(url)}
        revealFile={(path) => this.revealFile(path)}
      />
    );
  }

  onClose() {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
    if (this.prepared && !this.uploading) void this.discard(this.prepared);
  }

  private discard(report: PreparedReport): Promise<void> {
    if (this.prepared !== report) return Promise.resolve();
    this.prepared = null;
    return discardReport(report);
  }

  private buildSources(): ReportSourceOption[] {
    const settings = getSettings();
    const activityLogOn = settings.agentMode.debugFullFrames;
    const sources: ReportSourceOption[] = [
      { id: "screenshot", label: t("Screenshot of the Obsidian window"), defaultChecked: true },
      {
        id: "activityLog",
        label: t("Agent activity log"),
        description: activityLogOn ? undefined : t("turned off in Settings → Advanced"),
        defaultChecked: activityLogOn,
      },
      {
        id: "chatLog",
        label: t("Scribe log"),
        description: t("includes agent errors"),
        defaultChecked: true,
      },
    ];
    return sources;
  }

  private async prepare(
    note: string,
    selected: ReadonlySet<ReportSourceId>
  ): Promise<PreparedReport> {
    let screenshotPng: Uint8Array | null | undefined;
    if (selected.has("screenshot")) {
      screenshotPng = null;
      try {
        const workspaceWindow =
          this.app.workspace.getActiveViewOfType(ItemView)?.containerEl.win ?? this.containerEl.win;
        screenshotPng = await captureWindowBehindDialogs(workspaceWindow);
      } catch (err) {
        logWarn("[ReportIssue] the screenshot failed; the report goes without it:", err);
      }
    }

    const logs: ReportLogRequest[] = [];
    if (selected.has("chatLog")) logs.push(await chatLogRequest());
    if (selected.has("activityLog")) logs.push(await activityLogRequest());

    const bundle = await buildReportBundle(
      {
        bundleId: formatBundleId(new Date()),
        note,
        env: {
          pluginVersion: this.params.pluginVersion,
          platform: process.platform,
          obsidianVersion: apiVersion,
          activeBackend: this.params.activeBackend,
        },
        screenshotPng,
        logs,
      },
      getNodeReportRuntime()
    );

    const zipDir = await createReportDir();
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    const path = requireNodeModule<typeof import("node:path")>("path");
    const zipPath = path.join(zipDir, bundle.zipName);
    try {
      await fs.writeFile(zipPath, bundle.zip);
    } catch (err) {
      await discardReport({ zipDir });
      throw err;
    }

    logInfo(
      `[ReportIssue] bundle ready at ${zipPath} (${formatBytes(bundle.uploadAttempt.body.byteLength)})`
    );
    this.prepared = {
      zipDir,
      zipPath,
      zipName: bundle.zipName,
      uploadAttempt: bundle.uploadAttempt,
      issueDraft: bundle.issueDraft,
      manualIssueUrl: buildManualIssueUrl(bundle.issueDraft),
      attachments: bundle.attachments,
    };
    return this.prepared;
  }

  private async upload(report: PreparedReport): Promise<UploadOutcome> {
    this.uploading = true;
    const outcome = await uploadReport(this.params.uploader, report);
    this.uploading = false;
    if (outcome.ok) {
      this.params.onReported?.({ reportId: outcome.reportId, issueUrl: outcome.issueUrl });
    }
    if (this.root) return outcome;
    if (outcome.ok) {
      this.issueLinkNotice(
        t("Report uploaded (ID {p0}).", { p0: outcome.reportId }),
        outcome.issueUrl
      );
    } else {
      logWarn(
        `[ReportIssue] the upload failed after the dialog closed; the zip is still at ${report.zipPath}:`,
        outcome.error
      );
    }
    return outcome;
  }

  private async onUploaded({ reportId, issueUrl }: { reportId: string; issueUrl: string }) {
    this.prepared = null;
    const opened = openIssuePageWith(getElectronShell(), issueUrl);
    this.close();
    if (await opened) {
      new Notice(t("Report uploaded. Finish the issue in your browser."));
    } else {
      this.issueLinkNotice(
        t("Report uploaded (ID {p0}), but Scribe could not open your browser.", { p0: reportId }),
        issueUrl
      );
    }
  }

  private async openIssuePage(url: string): Promise<void> {
    this.prepared = null;
    if (!(await openIssuePageWith(getElectronShell(), url))) {
      this.issueLinkNotice(t("Scribe could not open your browser."), url);
    }
  }

  private issueLinkNotice(text: string, url: string): void {
    const fragment = this.contentEl.doc.win.createFragment();
    fragment.append(`${text} `);
    fragment.createEl("a", { href: url, text: t("Open the GitHub issue page") });
    new Notice(fragment, 0);
  }

  private revealFile(path: string): void {
    const shell = getElectronShell();
    if (!shell?.showItemInFolder) {
      new Notice(t("Scribe could not open the folder. The report is at {p0}", { p0: path }));
      return;
    }
    try {
      shell.showItemInFolder(path);
    } catch (err) {
      logError("[ReportIssue] could not reveal the report:", err);
      new Notice(t("Scribe could not open the folder. The report is at {p0}", { p0: path }));
    }
  }
}

async function activityLogRequest(): Promise<ReportLogRequest> {
  const base = { id: "activityLog", name: FRAME_LOG_NAME };
  if (!getSettings().agentMode.debugFullFrames) {
    return { ...base, unavailableReason: t("The agent activity log is turned off.") };
  }
  const path = await frameSink.getValidatedPath();
  return path === null
    ? { ...base, unavailableReason: t("The agent activity log's location is unavailable.") }
    : { ...base, path };
}

async function chatLogRequest(): Promise<ReportLogRequest> {
  const base = { id: "chatLog", name: CHAT_LOG_NAME };
  const text = logFileManager.exportLogText();
  return text.length > 0
    ? { ...base, text }
    : { ...base, unavailableReason: t("No chat log entries.") };
}
