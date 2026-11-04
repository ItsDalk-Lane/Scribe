import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeCommandTasks } from "@/agentMode/sdk/nativeCommandTasks";
import type { SessionUpdate } from "@/agentMode/session/types";

describe("nativeCommandTasks", () => {
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

    describe("run()", () => {
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
    });

    describe("stop()", () => {
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
    });

    describe("shutdown()", () => {
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
