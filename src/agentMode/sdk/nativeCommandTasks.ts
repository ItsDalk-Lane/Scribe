import { v4 as uuidv4 } from "uuid";
import type { SessionUpdate } from "@/agentMode/session/types";
import { requireNodeModule } from "@/utils/desktopRuntime";

export interface NativeCommandTasksOptions {
  cwd: string;
  sessionId: string;
  outputDirectory: string;
  getEnv?(): Promise<Readonly<Record<string, string>>>;
  emit(update: SessionUpdate): void;
}

export interface NativeCommandInput {
  toolCallId: string;
  command: string;
  background?: boolean;
  signal?: AbortSignal;
  onUpdate?(output: string): void;
  checkPermission?(): void;
}

export interface NativeCommandResult {
  taskId: string;
  outputFile: string;
  output: string;
  exitCode: number | null;
  status: "running" | "completed" | "failed" | "stopped";
}

type ChildProcess = import("node:child_process").ChildProcess;

interface RunningCommand {
  child: ChildProcess;
  completion: Promise<NativeCommandResult>;
  stop(): void;
}

function collectDescendants(
  pid: number | undefined,
  childProcess: typeof import("node:child_process"),
  fs: typeof import("node:fs"),
  processRuntime: typeof import("node:process")
): number[] {
  if (!pid || processRuntime.platform === "win32") return [];
  const children = (parent: number): number[] => {
    try {
      if (processRuntime.platform === "darwin") {
        const output = childProcess.execFileSync("pgrep", ["-P", String(parent)], {
          encoding: "utf8",
          windowsHide: true,
        });
        return output
          .split("\n")
          .map((line) => Number(line.trim()))
          .filter((candidate) => candidate > 0);
      }
      const descendants: number[] = [];
      for (const entry of fs.readdirSync("/proc")) {
        if (!/^\d+$/.test(entry)) continue;
        const stat = fs.readFileSync(`/proc/${entry}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/);
        if (Number(fields[1]) === parent) descendants.push(Number(entry));
      }
      return descendants;
    } catch {
      return [];
    }
  };
  const found: number[] = [];
  const queue = [pid];
  const seen = new Set([pid]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of children(current)) {
      if (!seen.has(child)) {
        seen.add(child);
        found.push(child);
        queue.push(child);
      }
    }
  }
  return found;
}

export class NativeCommandTasks {
  private readonly tasks = new Map<string, RunningCommand>();
  private closed = false;

  constructor(private readonly options: NativeCommandTasksOptions) {}

  async run(input: NativeCommandInput): Promise<NativeCommandResult> {
    if (this.closed) throw new Error("The command runner is closed.");
    input.signal?.throwIfAborted();
    if (!input.command.trim()) throw new Error("A command is required.");
    const fs = requireNodeModule<typeof import("node:fs")>("fs");
    const path = requireNodeModule<typeof import("node:path")>("path");
    const childProcess = requireNodeModule<typeof import("node:child_process")>("child_process");
    const processRuntime = requireNodeModule<typeof import("node:process")>("process");
    const environment = await this.options.getEnv?.();
    if (this.closed) throw new Error("The command runner is closed.");
    input.signal?.throwIfAborted();
    input.checkPermission?.();
    fs.mkdirSync(this.options.outputDirectory, { recursive: true });
    input.signal?.throwIfAborted();
    const taskId = `command-${uuidv4()}`;
    const outputFile = path.join(this.options.outputDirectory, `${taskId}.output`);
    const fd = fs.openSync(outputFile, "wx", 0o600);
    let output = "";
    let stopped = false;
    let taskStarted = false;
    let failure: Error | undefined;
    let killTimer: number | undefined;
    const decoder = new TextDecoder();
    let child: ChildProcess;
    try {
      child = childProcess.spawn(input.command, {
        cwd: this.options.cwd,
        shell: true,
        detached: processRuntime.platform !== "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        ...(environment ? { env: { ...processRuntime.env, ...environment } } : {}),
      });
    } catch (error) {
      fs.closeSync(fd);
      throw error;
    }
    const killGroup = (signal: NodeJS.Signals): void => {
      if (!child.pid) return;
      try {
        if (processRuntime.platform === "win32") {
          childProcess.execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
        } else {
          processRuntime.kill(-child.pid, signal);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
          failure = error instanceof Error ? error : new Error(String(error));
          child.kill(signal);
        }
      }
    };
    let descendants: number[] = [];
    const killDescendants = (signal: NodeJS.Signals): void => {
      for (const pid of descendants) {
        try {
          processRuntime.kill(pid, signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH")
            failure = error instanceof Error ? error : new Error(String(error));
        }
      }
    };
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      descendants = collectDescendants(child.pid, childProcess, fs, processRuntime);
      killGroup("SIGTERM");
      killDescendants("SIGTERM");
      killTimer = window.setTimeout(() => {
        killGroup("SIGKILL");
        killDescendants("SIGKILL");
      }, 1000);
    };
    const abort = (): void => stop();
    const record = (chunk: Uint8Array): void => {
      try {
        fs.writeSync(fd, chunk);
        output = (output + decoder.decode(chunk, { stream: true })).slice(-65_536);
        input.onUpdate?.(output);
        if (input.background) {
          this.options.emit({
            sessionUpdate: "task_progress",
            taskId,
            outputFile,
            progress: { description: output.slice(-500) },
          });
        }
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        stop();
      }
    };
    child.stdout?.on("data", record);
    child.stderr?.on("data", record);
    let resolveCompletion!: (result: NativeCommandResult) => void;
    const completion = new Promise<NativeCommandResult>((resolve) => {
      resolveCompletion = resolve;
    });
    this.tasks.set(taskId, { child, completion, stop });
    child.once("close", (exitCode) => {
      if (killTimer) window.clearTimeout(killTimer);
      output = (output + decoder.decode()).slice(-65_536);
      if (stopped) {
        killDescendants("SIGKILL");
        if (processRuntime.platform !== "win32") killGroup("SIGKILL");
      }
      input.signal?.removeEventListener("abort", abort);
      fs.closeSync(fd);
      this.tasks.delete(taskId);
      const status = failure
        ? "failed"
        : stopped
          ? "stopped"
          : exitCode === 0
            ? "completed"
            : "failed";
      const result: NativeCommandResult = {
        taskId,
        outputFile,
        output: failure ? `${output}\n${failure.message}` : output,
        exitCode,
        status,
      };
      if (input.background && taskStarted) {
        this.options.emit({
          sessionUpdate: "task_ended",
          taskId,
          status,
          summary: failure?.message ?? `Exit code: ${exitCode ?? "unavailable"}`,
          outputFile,
        });
      }
      resolveCompletion(result);
    });
    const ready = new Promise<void>((resolve, reject) => {
      child.once("spawn", () => {
        if (input.background) {
          taskStarted = true;
          this.options.emit({
            sessionUpdate: "task_started",
            taskId,
            toolCallId: input.toolCallId,
            kind: "command",
            description: input.command,
            command: input.command,
          });
          this.options.emit({ sessionUpdate: "task_progress", taskId, outputFile });
        }
        resolve();
      });
      child.once("error", (error) => {
        failure = error;
        reject(error);
      });
    });
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) stop();
    await ready;
    if (input.background) {
      input.signal?.removeEventListener("abort", abort);
      if (stopped) return completion;
      return { taskId, outputFile, output, exitCode: null, status: "running" };
    }
    return completion;
  }

  async stop(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.stop();
    await task.completion;
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    const tasks = [...this.tasks.values()];
    for (const task of tasks) task.stop();
    await Promise.all(tasks.map((task) => task.completion));
  }
}
