import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeCommandTasks, formatCommandResult } from "@/agentMode/sdk/nativeCommandTasks";
import type { SessionUpdate } from "@/agentMode/session/types";

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const text = await readFile(path, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return "";
    });
    if (text) return text;
    if (Date.now() > deadline) throw new Error(`Expected file signal was not observed: ${path}`);
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  }
}

describe("nativeCommandTasks", () => {
  describe("formatCommandResult()", () => {
    it("always includes command outcome and full-output location beside nonempty stdout https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
      const actual = formatCommandResult({
        taskId: "command-1",
        outputFile: "/vault/.scribe/chats/v2/tasks/command-1.output",
        output: "Wrote part of the file",
        exitCode: 3,
        status: "failed",
        truncated: false,
        complete: false,
      });
      expect(actual).toContain('"status":"failed"');
      expect(actual).toContain('"exitCode":3');
      expect(actual).toContain('"retry":"verify_before_retry"');
      expect(actual).toContain("command-1.output");
      expect(actual).toContain("Wrote part of the file");
    });
    it("identifies a background command as running and forbids launching the same task again https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
      const actual = formatCommandResult({
        taskId: "command-1",
        outputFile: "command-1.output",
        output: "Starting",
        exitCode: null,
        status: "running",
        truncated: false,
        complete: false,
      });
      expect(actual).toContain('"status":"running"');
      expect(actual).toContain('"retry":"never"');
      expect(actual).toContain('"complete":false');
    });
  });

  describe("NativeCommandTasks", () => {
    let directory: string;
    let tasks: NativeCommandTasks;
    let updates: SessionUpdate[];
    let onUpdate: (update: SessionUpdate) => void;

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), "scribe-native-command-"));
      updates = [];
      onUpdate = () => {};
      tasks = new NativeCommandTasks({
        cwd: directory,
        sessionId: "session-commands",
        outputDirectory: join(directory, "output"),
        emit: (update) => {
          updates.push(update);
          onUpdate(update);
        },
      });
    });

    afterEach(async () => {
      await tasks.shutdown();
      await rm(directory, { recursive: true, force: true });
    });

    describe("run", () => {
      it("reports complete short output with stable result identity https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
        const actual = await tasks.run({
          toolCallId: "complete",
          command: `"${process.execPath}" -p "42"`,
        });
        expect(actual).toMatchObject({
          status: "completed",
          exitCode: 0,
          complete: true,
          truncated: false,
          taskId: expect.any(String),
          outputFile: expect.any(String),
        });
      });
      it("marks a long command output as partial without splitting emoji https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
        const actual = await tasks.run({
          toolCallId: "emoji",
          command: `"${process.execPath}" -e "process.stdout.write('😀'.repeat(32768)+'x')"`,
        });
        expect(actual).toMatchObject({ status: "completed", truncated: true, complete: false });
        expect(actual.output.charCodeAt(0) >= 0xdc00 && actual.output.charCodeAt(0) <= 0xdfff).toBe(
          false
        );
        expect(await readFile(actual.outputFile, "utf8")).toBe("😀".repeat(32768) + "x");
      });

      it("passes the Scribe skill environment to the real command without changing machine configuration", async () => {
        const runner = new NativeCommandTasks({
          cwd: directory,
          sessionId: "native-env",
          outputDirectory: join(directory, "skill-output"),
          emit: () => {},
          getEnv: async () => ({ SCRIBE_SKILL_FIXTURE: "skill-ready" }),
        });
        try {
          const result = await runner.run({
            toolCallId: "skill-env",
            command: `"${process.execPath}" -p "process.env.SCRIBE_SKILL_FIXTURE"`,
          });
          expect(result.output.trim()).toBe("skill-ready");
          expect(process.env.SCRIBE_SKILL_FIXTURE).toBeUndefined();
        } finally {
          await runner.shutdown();
        }
      });
      it("returns real foreground output and its successful exit code", async () => {
        const result = await tasks.run({
          toolCallId: "foreground",
          command: `"${process.execPath}" -p "40 + 2"`,
        });
        expect(result.output).toContain("42");
        expect(result.exitCode).toBe(0);
        expect(result.status).toBe("completed");
        expect(await readFile(result.outputFile, "utf8")).toContain("42");
      });

      it("reports a nonzero exit as a failed command and preserves stderr", async () => {
        const result = await tasks.run({
          toolCallId: "failure",
          command: `"${process.execPath}" -e "process.stderr.write('failure');process.exit(3)"`,
        });
        expect(result.status).toBe("failed");
        expect(result.exitCode).toBe(3);
        expect(result.output).toContain("failure");
      });

      it("streams real foreground output before exit and stops the process when cancelled", async () => {
        const controller = new AbortController();
        let firstOutput!: () => void;
        const outputReceived = new Promise<void>((resolve) => {
          firstOutput = resolve;
        });
        const running = tasks.run({
          toolCallId: "streaming",
          command: `"${process.execPath}" -e "process.stdout.write('running');setInterval(() => {},1000)"`,
          signal: controller.signal,
          onUpdate: (output) => {
            if (output.includes("running")) firstOutput();
          },
        });
        await outputReceived;
        controller.abort();
        const result = await running;
        expect(result.status).toBe("stopped");
        expect(result.output).toContain("running");
      });

      it("preserves unicode output and keeps a bounded tool response while the output file retains the whole command output", async () => {
        const result = await tasks.run({
          toolCallId: "long-output",
          command: `"${process.execPath}" -e "process.stdout.write('笔记'.repeat(40000))"`,
        });
        const saved = await readFile(result.outputFile, "utf8");
        expect(saved).toBe("笔记".repeat(40000));
        expect(result.output.length).toBeLessThanOrEqual(65536);
        expect(result.output).not.toContain("�");
      });

      it("reports a missing working directory without inventing a started background task", async () => {
        const failedUpdates: SessionUpdate[] = [];
        const unavailable = new NativeCommandTasks({
          cwd: join(directory, "removed"),
          sessionId: "missing-directory",
          outputDirectory: join(directory, "output"),
          emit: (update) => failedUpdates.push(update),
        });
        await expect(
          unavailable.run({
            toolCallId: "missing",
            command: `"${process.execPath}" -p "42"`,
            background: true,
          })
        ).rejects.toThrow(/ENOENT/);
        await unavailable.shutdown();
        expect(failedUpdates).toEqual([]);
      });

      it("does not launch a process when its signal is already cancelled", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(
          tasks.run({
            toolCallId: "cancelled",
            command: `"${process.execPath}" -p "'unexpected'"`,
            signal: controller.signal,
          })
        ).rejects.toThrow(/abort/i);
        expect(updates).toEqual([]);
      });

      it("keeps an already launched background command alive when the main turn is cancelled", async () => {
        const controller = new AbortController();
        const result = await tasks.run({
          toolCallId: "background",
          command: `"${process.execPath}" -e "process.stdout.write('ready');setInterval(() => {},1000)"`,
          background: true,
          signal: controller.signal,
        });
        controller.abort();
        expect(result.status).toBe("running");
        expect(updates).toContainEqual(
          expect.objectContaining({ sessionUpdate: "task_started", taskId: result.taskId })
        );
        expect(updates).not.toContainEqual(
          expect.objectContaining({ sessionUpdate: "task_ended", taskId: result.taskId })
        );
      });

      it("reports a background command that exits during start persistence as completed https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
        let ended!: () => void;
        const exited = new Promise<void>((resolve) => {
          ended = resolve;
        });
        const runner = new NativeCommandTasks({
          cwd: directory,
          sessionId: "quick-background",
          outputDirectory: join(directory, "quick-output"),
          emit: (update) => {
            if (update.sessionUpdate === "task_ended") ended();
          },
          flush: () => exited,
        });
        try {
          await expect(
            runner.run({
              toolCallId: "quick",
              command: `"${process.execPath}" -p "42"`,
              background: true,
            })
          ).resolves.toMatchObject({ status: "completed", exitCode: 0, output: "42\n" });
        } finally {
          await runner.shutdown();
        }
      });
    });

    describe("stop", () => {
      it("stops only the selected task and writes a stopped lifecycle result", async () => {
        const first = await tasks.run({
          toolCallId: "first",
          command: `"${process.execPath}" -e "setInterval(() => {},1000)"`,
          background: true,
        });
        const second = await tasks.run({
          toolCallId: "second",
          command: `"${process.execPath}" -e "setInterval(() => {},1000)"`,
          background: true,
        });
        await tasks.stop(first.taskId);
        expect(updates).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "task_ended",
            taskId: first.taskId,
            status: "stopped",
          })
        );
        expect(updates).not.toContainEqual(
          expect.objectContaining({ sessionUpdate: "task_ended", taskId: second.taskId })
        );
      });
      const posix = process.platform === "win32" ? it.skip : it;
      posix(
        "kills a descendant that left the process group before reporting stopped and leaves an unrelated task running (https://github.com/ItsDalk-Lane/Scribe/issues/16)",
        async () => {
          const worker = join(directory, "worker.cjs");
          const wrapper = join(directory, "parent.cjs");
          const ready = join(directory, "pid");
          const gate = join(directory, "release");
          const afterStop = join(directory, "AFTER_STOP");
          await writeFile(
            worker,
            [
              "const fs=require('node:fs');",
              "setTimeout(()=>process.exit(1),8000);",
              `fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));`,
              `setInterval(()=>{if(!fs.existsSync(${JSON.stringify(gate)}))return;`,
              `fs.writeFileSync(${JSON.stringify(afterStop)},'worker survived');process.exit(0)},10);`,
            ].join("")
          );
          await writeFile(
            wrapper,
            [
              "const cp=require('node:child_process');",
              `cp.spawn(process.execPath,[${JSON.stringify(worker)}],{stdio:'ignore',detached:true}).unref();`,
              "setTimeout(()=>process.exit(),8000);",
            ].join("")
          );
          const ended: string[] = [];
          const runner = new NativeCommandTasks({
            cwd: directory,
            sessionId: "detached-audit",
            outputDirectory: join(directory, "detached-output"),
            emit: (update) => {
              if (update.sessionUpdate === "task_ended")
                ended.push(`${update.taskId}:${update.status}`);
            },
          });
          const other = await runner.run({
            toolCallId: "other",
            command: `"${process.execPath}" -e "setInterval(() => {},1000)"`,
            background: true,
          });
          let pid = 0;
          let cleanupFailure: unknown;
          try {
            const job = await runner.run({
              toolCallId: "probe",
              background: true,
              command: `"${process.execPath}" ${JSON.stringify(wrapper)}`,
            });
            pid = Number(await waitForFile(ready));
            await runner.stop(job.taskId);
            expect(ended).toEqual([`${job.taskId}:stopped`]);
            const deadline = Date.now() + 3000;
            for (;;) {
              try {
                process.kill(pid, 0);
                if (Date.now() > deadline) throw new Error("descendant survived the stop");
                await new Promise((resolve) => window.setTimeout(resolve, 20));
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
                break;
              }
            }
            await writeFile(gate, "release");
            await expect(access(afterStop)).rejects.toMatchObject({ code: "ENOENT" });
            await runner.stop(other.taskId);
            expect(ended).toHaveLength(2);
          } finally {
            if (pid > 0) {
              try {
                process.kill(pid, "SIGKILL");
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ESRCH") cleanupFailure = error;
              }
            }
            await runner.shutdown();
          }
          if (cleanupFailure instanceof Error) throw cleanupFailure;
        },
        15000
      );
    });

    describe("shutdown", () => {
      it("prevents launch when shutdown occurs during background admission persistence https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
        let entered!: () => void;
        let release!: () => void;
        const admissionEntered = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const admission = new Promise<void>((resolve) => {
          release = resolve;
        });
        const runner = new NativeCommandTasks({
          cwd: directory,
          sessionId: "pending-admission",
          outputDirectory: join(directory, "pending-output"),
          emit: (update) => updates.push(update),
          beforeStart: () => {
            entered();
            return admission;
          },
        });
        const run = runner.run({
          toolCallId: "pending",
          command: `"${process.execPath}" -p "42"`,
          background: true,
        });
        try {
          await admissionEntered;
          await runner.shutdown();
          release();
          await expect(run).rejects.toThrow(/closed/i);
          expect(updates).toEqual([]);
        } finally {
          release();
          await runner.shutdown();
        }
      });

      it("waits for all running processes to stop and prevents new commands", async () => {
        const result = await tasks.run({
          toolCallId: "unload",
          command: `"${process.execPath}" -e "setInterval(() => {},1000)"`,
          background: true,
        });
        await tasks.shutdown();
        expect(updates).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "task_ended",
            taskId: result.taskId,
            status: "stopped",
          })
        );
        await expect(tasks.run({ toolCallId: "late", command: "unexpected" })).rejects.toThrow(
          /closed/i
        );
      });
    });
  });
});
