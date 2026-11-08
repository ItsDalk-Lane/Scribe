import {
  NativeSubagentController,
  EMPTY_SUBAGENT_USAGE,
  subagentModelMessage,
  type NativeSubagentControllerOptions,
} from "@/agentMode/sdk/NativeSubagentController";
import type { NativeSubagentState } from "@/agentMode/sdk/subagentState";
import type { SubagentMessage } from "@/agentMode/session/subagentTypes";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(
  restored: NativeSubagentState[] = [],
  hooks: {
    save?(state: NativeSubagentState): Promise<void>;
    remove?(): Promise<void>;
    reserve?(signal: AbortSignal): { ready: Promise<() => void> };
    execute?: NativeSubagentControllerOptions["execute"];
  } = {}
) {
  const saved: NativeSubagentState[] = [];
  const started = deferred<void>();
  const finish = deferred<void>();
  const received: SubagentMessage[] = [];
  const automaticDelivery: boolean[] = [];
  let taskActive = true;
  let activeCount = 0;
  let maximumActive = 0;
  const controller = new NativeSubagentController({
    parentSessionId: "parent",
    cwd: "/vault",
    restored,
    getModelId: () => "model",
    getTaskGenerationId: () => "task",
    isTaskActive: () => taskActive,
    acquire: async () => () => {},
    reserve: hooks.reserve,
    save: async (state) => {
      await hooks.save?.(state);
      saved.push(JSON.parse(JSON.stringify(state)));
    },
    remove: async () => {
      await hooks.remove?.();
    },
    changed: () => {},
    received: (_state, message, automatic) => {
      received.push(message);
      automaticDelivery.push(automatic);
    },
    execute:
      hooks.execute ??
      (async (state, run, signal, attach) => {
        activeCount++;
        maximumActive = Math.max(maximumActive, activeCount);
        const pending = state.snapshot.messages.filter(
          (message) => message.direction === "to_child" && message.state === "accepted"
        );
        await controller.recordContext(
          state.snapshot.id,
          run.id,
          pending.map(subagentModelMessage),
          pending.map((message) => message.id)
        );
        attach((message) => {
          void controller.recordContext(
            state.snapshot.id,
            run.id,
            [subagentModelMessage(message)],
            [message.id]
          );
        });
        started.resolve();
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
          void finish.promise.then(resolve);
        });
        activeCount--;
        return {
          text: "真实结论",
          status: signal.aborted ? "stopped" : "completed",
          usage: { ...EMPTY_SUBAGENT_USAGE },
        };
      }),
  });
  const create = () =>
    controller.create({ prompt: "核对资料", name: "核对", toolCallId: "call", background: true });
  return {
    controller,
    saved,
    started,
    finish,
    received,
    automaticDelivery,
    create,
    maximum: () => maximumActive,
    deactivate: () => {
      taskActive = false;
    },
  };
}

describe("NativeSubagentController", () => {
  describe("NativeSubagentController", () => {
    describe("create()", () => {
      it.each(["stopAll", "stopGeneration"] as const)(
        "%s cancels an unlaunched reserved creation before its acceptance save completes (https://github.com/ItsDalk-Lane/Scribe/issues/50)",
        async (operation) => {
          const saving = deferred<void>();
          const releaseSave = deferred<void>();
          const releaseSlot = jest.fn();
          const f = fixture([], {
            reserve: () => ({ ready: Promise.resolve(releaseSlot) }),
            save: async () => {
              saving.resolve();
              await releaseSave.promise;
            },
          });
          const creating = f.create();
          await saving.promise;
          try {
            if (operation === "stopAll") await f.controller.stopAll();
            else await f.controller.stopGeneration("task");
            expect(releaseSlot).toHaveBeenCalledTimes(1);
            releaseSave.resolve();
            await expect(creating).rejects.toThrow(/Aborted/i);
            expect(f.maximum()).toBe(0);
          } finally {
            releaseSave.resolve();
            f.finish.resolve();
            await creating.catch(() => {});
          }
        }
      );
      it("cancels and releases a reserved creation while its acceptance save is blocked by close (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const saving = deferred<void>();
        const releaseSave = deferred<void>();
        const releaseSlot = jest.fn();
        const f = fixture([], {
          reserve: () => ({ ready: Promise.resolve(releaseSlot) }),
          save: async () => {
            saving.resolve();
            await releaseSave.promise;
          },
        });
        const creating = f.create();
        await saving.promise;
        try {
          await f.controller.close();
          expect(releaseSlot).toHaveBeenCalledTimes(1);
          releaseSave.resolve();
          await expect(creating).rejects.toThrow(/关闭|Aborted/i);
          expect(f.maximum()).toBe(0);
        } finally {
          releaseSave.resolve();
          f.finish.resolve();
          await creating.catch(() => {});
        }
      });
      it("counts durable admission in flight as work for its exact generation (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const entered = deferred<void>();
        const release = deferred<void>();
        let held = false;
        const f = fixture([], {
          save: async () => {
            if (!held) {
              held = true;
              entered.resolve();
              await release.promise;
            }
          },
        });
        const creating = f.create();
        await entered.promise;
        expect(f.controller.hasWork("task")).toBe(true);
        expect(f.controller.hasWork("other-generation")).toBe(false);
        release.resolve();
        const child = await creating;
        await f.started.promise;
        await f.controller.stop(child.subagentId);
      });
      it("rejects full admission before saving a child and releases a reserved slot when durable acceptance fails (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const full = fixture([], {
          reserve: () => {
            throw new Error("queue full");
          },
        });
        await expect(full.create()).rejects.toThrow("queue full");
        expect(full.saved).toEqual([]);
        expect(full.controller.list()).toEqual([]);
        const release = jest.fn();
        const failed = fixture([], {
          reserve: () => ({ ready: Promise.resolve(release) }),
          save: async () => {
            throw new Error("disk full");
          },
        });
        await expect(failed.create()).rejects.toThrow("disk full");
        expect(release).toHaveBeenCalledTimes(1);
        expect(failed.controller.list()).toEqual([]);
      });
      it("returns a durable stable identity before the background result and retains its real result (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const created = await f.create();
        expect(created.status).toBe("queued");
        expect(f.saved[0].snapshot.id).toBe(created.subagentId);
        await f.started.promise;
        f.finish.resolve();
        const run = await f.controller.finished(created.subagentId, created.runId!);
        expect(run.result).toBe("真实结论");
        expect(f.controller.list()).toHaveLength(1);
        expect(run.resultId).toBe(`${run.id}:result`);
      });
    });
    describe("send()", () => {
      it("retries an accepted image once after admission becomes available without adding another message (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const source = fixture();
        const child = await source.create();
        await source.started.promise;
        source.finish.resolve();
        await source.controller.finished(child.subagentId, child.runId!);
        const saved = JSON.parse(JSON.stringify(source.saved.at(-1))) as NativeSubagentState;
        let available = false;
        const f = fixture([saved], {
          reserve: () => {
            if (!available) throw new Error("queue full");
            return { ready: Promise.resolve(() => {}) };
          },
        });
        const input = {
          sessionId: "parent",
          subagentId: child.subagentId,
          text: "",
          mode: "wake" as const,
          messageId: "waiting-image",
          payload: { content: [{ type: "image" as const, mimeType: "image/png", data: "YWJj" }] },
        };
        await f.controller.send(input);
        available = true;
        const results = await Promise.all([f.controller.send(input), f.controller.send(input)]);
        expect(results[0].runId).toBeTruthy();
        expect(results[1].runId).toBe(results[0].runId);
        await f.started.promise;
        f.finish.resolve();
        await f.controller.finished(child.subagentId, results[0].runId!);
        const state = f.controller.state(child.subagentId);
        expect(
          state.snapshot.messages.filter((entry) => entry.id === input.messageId)
        ).toMatchObject([{ id: input.messageId, state: "delivered", payload: input.payload }]);
        expect(state.snapshot.runs.at(-1)?.result).toBe("真实结论");
        expect(f.maximum()).toBe(1);
      });
      it("reports repeated admission failure and preserves the one pending message (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const source = fixture();
        const child = await source.create();
        await source.started.promise;
        source.finish.resolve();
        await source.controller.finished(child.subagentId, child.runId!);
        const saved = JSON.parse(JSON.stringify(source.saved.at(-1))) as NativeSubagentState;
        const f = fixture([saved], {
          reserve: () => {
            throw new Error("queue full");
          },
        });
        const input = {
          sessionId: "parent",
          subagentId: child.subagentId,
          text: "wait",
          mode: "wake" as const,
          messageId: "wait",
        };
        await f.controller.send(input);
        await expect(f.controller.send(input)).rejects.toThrow("queue full");
        expect(
          f.controller.state(child.subagentId).snapshot.messages.filter((m) => m.id === "wait")
        ).toMatchObject([{ state: "accepted", text: "wait" }]);
      });

      it("does not restart an instruction withdrawn by an explicit stop (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const source = fixture();
        const child = await source.create();
        await source.started.promise;
        source.finish.resolve();
        await source.controller.finished(child.subagentId, child.runId!);
        const saved = JSON.parse(JSON.stringify(source.saved.at(-1))) as NativeSubagentState;
        const f = fixture([saved], {
          reserve: () => {
            throw new Error("queue full");
          },
        });
        const input = {
          sessionId: "parent",
          subagentId: child.subagentId,
          text: "wait",
          mode: "wake" as const,
          messageId: "wait",
        };
        await f.controller.send(input);
        await f.controller.stop(child.subagentId);
        const before = f.controller.state(child.subagentId).snapshot.runs.length;
        await f.controller.send({ ...input, mode: "wake" });
        const state = f.controller.state(child.subagentId);
        expect(state.snapshot.runs).toHaveLength(before);
        expect(state.snapshot.messages.find((m) => m.id === "wait")?.state).toBe("withdrawn");
      });
      it("keeps unread instructions after execution failure without starting an endless retry loop (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const source = fixture();
        const child = await source.create();
        await source.started.promise;
        source.finish.resolve();
        await source.controller.finished(child.subagentId, child.runId!);
        const saved = JSON.parse(JSON.stringify(source.saved.at(-1))) as NativeSubagentState;
        let available = false;
        const f = fixture([saved], {
          reserve: () => {
            if (!available) throw new Error("queue full");
            return { ready: Promise.resolve(() => {}) };
          },
          execute: async () => ({
            text: "failed",
            status: "failed",
            usage: { ...EMPTY_SUBAGENT_USAGE },
          }),
        });
        const input = {
          sessionId: "parent",
          subagentId: child.subagentId,
          text: "wait",
          mode: "wake" as const,
          messageId: "wait",
        };
        await f.controller.send(input);
        available = true;
        const result = await f.controller.send(input);
        await f.controller.finished(child.subagentId, result.runId!);
        const state = f.controller.state(child.subagentId);
        expect(state.snapshot.runs).toHaveLength(saved.snapshot.runs.length + 1);
        expect(state.snapshot.messages.find((m) => m.id === "wait")?.state).toBe("accepted");
      });
      it("recognizes a retry of an image restored from the attachment store https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const source = fixture();
        const child = await source.create();
        await source.started.promise;
        source.finish.resolve();
        await source.controller.finished(child.subagentId, child.runId!);
        const saved = JSON.parse(JSON.stringify(source.saved.at(-1))) as NativeSubagentState;
        const content = [{ type: "image" as const, mimeType: "image/png", data: "YWJj" }];
        saved.snapshot.messages = [
          ...saved.snapshot.messages,
          {
            id: "image-retry",
            sequence: 123,
            subagentId: child.subagentId,
            taskGenerationId: "task",
            direction: "to_child",
            sender: "user",
            kind: "instruction",
            text: "",
            state: "accepted",
            acceptedAt: 1,
            payload: {
              content: [Object.assign({}, content[0], { attachmentHash: "restored-hash" })],
            },
          },
        ];
        const f = fixture([saved]);
        const result = await f.controller.send({
          sessionId: "parent",
          subagentId: child.subagentId,
          text: "",
          mode: "wake",
          messageId: "image-retry",
          payload: { content },
        });
        expect(result).toMatchObject({ status: "queued", messageId: "image-retry" });
        await f.started.promise;
        f.finish.resolve();
        await f.controller.finished(child.subagentId, result.runId!);
        expect(
          f.controller
            .state(child.subagentId)
            .snapshot.messages.filter((entry) => entry.id === "image-retry")
        ).toHaveLength(1);
      });

      it("keeps an accepted message queued when no run slot is available instead of reporting a failed send https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const source = fixture();
        const child = await source.create();
        await source.started.promise;
        source.finish.resolve();
        await source.controller.finished(child.subagentId, child.runId!);
        const saved = JSON.parse(JSON.stringify(source.saved.at(-1))) as NativeSubagentState;
        const f = fixture([saved], {
          reserve: () => {
            throw new Error("queue full");
          },
        });
        const result = await f.controller.send({
          sessionId: "parent",
          subagentId: child.subagentId,
          text: "keep once",
          mode: "wake",
          messageId: "accepted-once",
        });
        expect(result).toMatchObject({ status: "enqueued", messageId: "accepted-once" });
        expect(
          f.controller
            .state(child.subagentId)
            .snapshot.messages.filter((entry) => entry.id === "accepted-once")
        ).toMatchObject([{ text: "keep once", state: "accepted" }]);
      });

      it("delivers image-only user input to a running child and rejects a changed retry https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        const created = await f.create();
        await f.started.promise;
        const payload = {
          content: [{ type: "image" as const, mimeType: "image/png", data: "YWJj" }],
        };
        const input = {
          sessionId: "parent",
          subagentId: created.subagentId,
          text: "",
          mode: "enqueue" as const,
          messageId: "image-input",
          payload,
        };
        await f.controller.send(input);
        expect(
          f.controller
            .state(created.subagentId)
            .snapshot.messages.find((entry) => entry.id === "image-input")
        ).toMatchObject({ payload });
        expect(
          subagentModelMessage(
            f.controller
              .state(created.subagentId)
              .snapshot.messages.find((entry) => entry.id === "image-input")!
          ).content
        ).toEqual(payload.content);
        await expect(
          f.controller.send({
            ...input,
            payload: { content: [{ type: "image", mimeType: "image/png", data: "ZGVm" }] },
          })
        ).rejects.toThrow(/消息编号/);
        f.finish.resolve();
        await f.controller.finished(created.subagentId, created.runId!);
      });

      it.each(["stop", "stopGeneration", "close"] as const)(
        "clears a reserved skill authorization cancelled by %s while its run is being saved (https://github.com/ItsDalk-Lane/Scribe/issues/50)",
        async (operation) => {
          const source = fixture();
          const child = await source.create();
          await source.started.promise;
          source.finish.resolve();
          await source.controller.finished(child.subagentId, child.runId!);
          const saved = JSON.parse(JSON.stringify(source.saved.at(-1))) as NativeSubagentState;
          const entered = deferred<void>();
          const releaseSave = deferred<void>();
          const releaseSlot = jest.fn();
          let held = false;
          const f = fixture([saved], {
            reserve: () => ({ ready: Promise.resolve(releaseSlot) }),
            save: async (state) => {
              if (!held && state.snapshot.runs.length === 2) {
                held = true;
                entered.resolve();
                await releaseSave.promise;
              }
            },
          });
          const sending = f.controller.send(
            {
              sessionId: "parent",
              subagentId: child.subagentId,
              text: "授权后继续",
              mode: "wake",
              skills: ["manual-review"],
            },
            "main"
          );
          const outcome = sending.then(
            () => null,
            (error: unknown) => error
          );
          await entered.promise;
          const stopping =
            operation === "stop"
              ? f.controller.stop(child.subagentId)
              : operation === "stopGeneration"
                ? f.controller.stopGeneration("task")
                : f.controller.close();
          releaseSave.resolve();
          await stopping;
          expect(await outcome).toBeInstanceOf(Error);
          const state = f.controller.state(child.subagentId);
          expect(state.snapshot.runs.at(-1)).toMatchObject({
            status: "stopped",
            endedAt: expect.any(Number),
          });
          expect(state.snapshot.messages.find((entry) => entry.text === "授权后继续")?.state).toBe(
            "withdrawn"
          );
          expect(state.manualSkills).toEqual([]);
          expect(f.maximum()).toBe(0);
          expect(releaseSlot).toHaveBeenCalledTimes(1);
        }
      );
      it("blocks further runs if cancellation cleanup cannot be saved (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const source = fixture();
        const child = await source.create();
        await source.started.promise;
        source.finish.resolve();
        await source.controller.finished(child.subagentId, child.runId!);
        const saved = JSON.parse(JSON.stringify(source.saved.at(-1))) as NativeSubagentState;
        saved.automaticTaskIds = [];
        const entered = deferred<void>();
        const release = deferred<void>();
        const f = fixture([saved], {
          save: async (state) => {
            const latest = state.snapshot.runs.at(-1);
            if (state.snapshot.runs.length === 2 && latest?.status === "queued") {
              entered.resolve();
              await release.promise;
            }
            if (latest?.status === "stopped") throw new Error("disk full");
          },
        });
        const sending = f.controller.send(
          {
            sessionId: "parent",
            subagentId: child.subagentId,
            text: "授权后继续",
            mode: "wake",
            skills: ["manual-review"],
          },
          "main"
        );
        const result = sending.then(
          () => null,
          (error: unknown) => error
        );
        await entered.promise;
        const stopping = f.controller.stopGeneration("task");
        release.resolve();
        await stopping;
        expect(String(await result)).toContain("状态未能保存");
        const state = f.controller.state(child.subagentId);
        expect(state.snapshot.recoveryBlocked).toContain("未能保存");
        expect(state.manualSkills).toEqual([]);
        expect(state.snapshot.messages.find((entry) => entry.text === "授权后继续")?.state).toBe(
          "withdrawn"
        );
        await expect(
          f.controller.send(
            { sessionId: "parent", subagentId: child.subagentId, text: "再次继续", mode: "wake" },
            "main"
          )
        ).rejects.toThrow("未能保存");
      });
      it("grants freshly selected skills only to the resumed run and clears them on the next run (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const child = await f.create();
        await f.started.promise;
        f.finish.resolve();
        await f.controller.finished(child.subagentId, child.runId!);
        const resumed = await f.controller.send(
          {
            sessionId: "parent",
            subagentId: child.subagentId,
            text: "再次读取",
            mode: "wake",
            skills: ["manual-review"],
          } as never,
          "main"
        );
        await f.controller.finished(child.subagentId, resumed.runId!);
        expect(
          f.saved.some(
            (state) =>
              state.snapshot.runs.at(-1)?.id === resumed.runId &&
              state.manualSkills?.includes("manual-review")
          )
        ).toBe(true);
        const next = await f.controller.send(
          { sessionId: "parent", subagentId: child.subagentId, text: "下一项", mode: "wake" },
          "main"
        );
        await f.controller.finished(child.subagentId, next.runId!);
        expect(f.controller.state(child.subagentId).manualSkills).toEqual([]);
      });
      it.each(["enqueue", "interrupt"] as const)(
        "rejects skill authorization with %s before saving an instruction (https://github.com/ItsDalk-Lane/Scribe/issues/50)",
        async (mode) => {
          const f = fixture();
          const child = await f.create();
          await f.started.promise;
          f.finish.resolve();
          await f.controller.finished(child.subagentId, child.runId!);
          await expect(
            f.controller.send(
              {
                sessionId: "parent",
                subagentId: child.subagentId,
                text: "授权",
                mode,
                skills: ["manual-review"],
              },
              "main"
            )
          ).rejects.toThrow("空闲");
          expect(
            f.controller
              .state(child.subagentId)
              .snapshot.messages.some((message) => message.text === "授权")
          ).toBe(false);
        }
      );
      it("rejects authorization while a child is running or an earlier instruction is waiting (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const child = await f.create();
        await f.started.promise;
        const input = {
          sessionId: "parent",
          subagentId: child.subagentId,
          text: "授权",
          mode: "wake" as const,
          skills: ["manual-review"],
        };
        await expect(f.controller.send(input, "main")).rejects.toThrow("空闲");
        f.finish.resolve();
        await f.controller.finished(child.subagentId, child.runId!);
        await f.controller.send(
          { ...input, text: "等待中", mode: "enqueue", skills: undefined },
          "main"
        );
        await expect(f.controller.send(input, "main")).rejects.toThrow("未处理");
        expect(
          f.controller
            .state(child.subagentId)
            .snapshot.messages.some((message) => message.text === "授权")
        ).toBe(false);
      });
      it.each(["queue full", "disk full"])(
        "does not retain an authorized instruction when %s prevents starting it (https://github.com/ItsDalk-Lane/Scribe/issues/50)",
        async (failure) => {
          const source = fixture();
          const child = await source.create();
          await source.started.promise;
          source.finish.resolve();
          await source.controller.finished(child.subagentId, child.runId!);
          const saved = JSON.parse(JSON.stringify(source.saved.at(-1))) as NativeSubagentState;
          const release = jest.fn();
          const f = fixture([saved], {
            reserve: () => {
              if (failure === "queue full") throw new Error(failure);
              return { ready: Promise.resolve(release) };
            },
            save: async () => {
              if (failure === "disk full") throw new Error(failure);
            },
          });
          await expect(
            f.controller.send(
              {
                sessionId: "parent",
                subagentId: child.subagentId,
                text: "授权",
                mode: "wake",
                skills: ["manual-review"],
              },
              "main"
            )
          ).rejects.toThrow(failure);
          const state = f.controller.state(child.subagentId);
          expect(state.snapshot.runs).toHaveLength(1);
          expect(state.snapshot.messages.some((message) => message.text === "授权")).toBe(false);
          expect(state.manualSkills ?? []).not.toContain("manual-review");
          if (failure === "disk full") expect(release).toHaveBeenCalledTimes(1);
        }
      );
      it("does not mix simultaneous messages into an authorized run (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const source = fixture();
        const child = await source.create();
        await source.started.promise;
        source.finish.resolve();
        await source.controller.finished(child.subagentId, child.runId!);
        const saved = JSON.parse(JSON.stringify(source.saved.at(-1))) as NativeSubagentState;
        const entered = deferred<void>();
        const release = deferred<void>();
        const f = fixture([saved], {
          save: async (state) => {
            if (
              state.snapshot.runs.length === 2 &&
              state.snapshot.runs.at(-1)?.status === "queued"
            ) {
              entered.resolve();
              await release.promise;
            }
          },
        });
        const authorized = f.controller.send(
          {
            sessionId: "parent",
            subagentId: child.subagentId,
            text: "授权",
            mode: "wake",
            skills: ["manual-review"],
          },
          "main"
        );
        await entered.promise;
        await expect(
          f.controller.send(
            {
              sessionId: "parent",
              subagentId: child.subagentId,
              text: "并发指令",
              mode: "enqueue",
            },
            "main"
          )
        ).rejects.toThrow("其他指令");
        release.resolve();
        const run = await authorized;
        f.finish.resolve();
        await f.controller.finished(child.subagentId, run.runId!);
        expect(
          f.controller
            .state(child.subagentId)
            .snapshot.messages.some((message) => message.text === "并发指令")
        ).toBe(false);
      });
      it("does not launch a reserved resume after close begins during its queued-run save (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const source = fixture();
        const child = await source.create();
        await source.started.promise;
        source.finish.resolve();
        await source.controller.finished(child.subagentId, child.runId!);
        const saved = JSON.parse(JSON.stringify(source.saved.at(-1))) as NativeSubagentState;
        const saving = deferred<void>();
        const releaseSave = deferred<void>();
        const releaseSlot = jest.fn();
        const f = fixture([saved], {
          reserve: () => ({ ready: Promise.resolve(releaseSlot) }),
          save: async (state) => {
            if (state.snapshot.runs.length === 2) {
              saving.resolve();
              await releaseSave.promise;
            }
          },
        });
        const waking = f.controller.send({
          sessionId: "parent",
          subagentId: child.subagentId,
          text: "resume after save",
          mode: "wake",
        });
        const outcome = waking.then(
          (value) => ({ value }),
          (error: unknown) => ({ error })
        );
        await saving.promise;
        const closing = f.controller.close();
        releaseSave.resolve();
        f.finish.resolve();
        await closing;
        const result = await outcome;
        if ("value" in result) await f.controller.finished(child.subagentId, result.value.runId!);
        expect(result).toHaveProperty("error");
        expect(f.maximum()).toBe(0);
        expect(releaseSlot).toHaveBeenCalledTimes(1);
      });
      it("rejects new input during stopping instead of retaining an executable instruction in the stopped generation (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const created = await f.create();
        await f.started.promise;
        const stopping = f.controller.stop(created.subagentId);
        await expect(
          f.controller.send({
            sessionId: "parent",
            subagentId: created.subagentId,
            text: "停止期间新指令",
            mode: "enqueue",
          })
        ).rejects.toThrow("停止");
        await stopping;
        expect(
          f.controller
            .state(created.subagentId)
            .snapshot.messages.some((message) => message.text === "停止期间新指令")
        ).toBe(false);
      });
      it("continues a message accepted while the previous run is publishing its final result (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const finishing = deferred<void>();
        const release = deferred<void>();
        let held = false;
        const f = fixture([], {
          save: async (state) => {
            if (!held && state.snapshot.runs.at(-1)?.endedAt) {
              held = true;
              finishing.resolve();
              await release.promise;
            }
          },
        });
        const created = await f.create();
        await f.started.promise;
        f.finish.resolve();
        await finishing.promise;
        const sending = f.controller.send({
          sessionId: "parent",
          subagentId: created.subagentId,
          text: "最后时刻的修正",
          mode: "enqueue",
        });
        release.resolve();
        const accepted = await sending;
        expect(accepted.runId).not.toBe(created.runId);
        await f.controller.finished(created.subagentId, accepted.runId!);
        expect(
          f.controller
            .state(created.subagentId)
            .snapshot.messages.find((message) => message.id === accepted.messageId)?.state
        ).toBe("delivered");
        expect(f.maximum()).toBe(1);
      });
      it("rejects a message attributed to a different parent chat (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const created = await f.create();
        await f.started.promise;
        await expect(
          f.controller.send({
            sessionId: "other",
            subagentId: created.subagentId,
            text: "越界",
            mode: "enqueue",
          })
        ).rejects.toThrow("当前聊天");
        await f.controller.stop(created.subagentId);
      });
      it("queues an idle message without starting a new run and deduplicates exact retries (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const created = await f.create();
        await f.started.promise;
        f.finish.resolve();
        await f.controller.finished(created.subagentId, created.runId!);
        const input = {
          sessionId: "parent",
          subagentId: created.subagentId,
          text: "补充资料",
          mode: "enqueue" as const,
          messageId: "retry",
        };
        await f.controller.send(input);
        await f.controller.send(input);
        const state = f.controller.state(created.subagentId);
        expect(state.snapshot.runs).toHaveLength(1);
        expect(state.snapshot.messages.filter((message) => message.id === "retry")).toHaveLength(1);
        await expect(f.controller.send({ ...input, text: "不同内容" })).rejects.toThrow("消息编号");
      });
      it("serializes simultaneous wakes of the same retained session (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const created = await f.create();
        await f.started.promise;
        f.finish.resolve();
        await f.controller.finished(created.subagentId, created.runId!);
        f.deactivate();
        await Promise.all(
          ["甲", "乙"].map((text) =>
            f.controller.send({
              sessionId: "parent",
              subagentId: created.subagentId,
              text,
              mode: "wake",
            })
          )
        );
        const running = f.controller.state(created.subagentId).snapshot.runs.at(-1)!;
        await f.controller.finished(created.subagentId, running.id);
        expect(f.maximum()).toBe(1);
      });
    });
    describe("sendParent()", () => {
      it("shares one atomic hundred-message parent inbox across children and orders accepted deliveries (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const first = await f.create();
        const second = await f.create();
        await f.started.promise;
        for (let index = 0; index < 99; index++) {
          const child = index % 2 ? first : second;
          await f.controller.sendParent(child.subagentId, child.runId!, {
            text: `progress ${index}`,
            kind: "progress",
          });
        }
        const attempts = await Promise.allSettled(
          [first, second].map((child) =>
            f.controller.sendParent(child.subagentId, child.runId!, {
              text: "last available slot",
              kind: "discovery",
            })
          )
        );
        expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
        expect(
          f.controller
            .list()
            .flatMap((state) => state.messages)
            .filter((message) => message.direction === "to_parent" && message.state === "accepted")
        ).toHaveLength(100);
        const sequences = f.received.map((message) => message.sequence);
        expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
        await f.controller.close();
      });
      it("accepts exactly one logical message when identical retries arrive concurrently (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const created = await f.create();
        await f.started.promise;
        const input = { text: "同一条发现", kind: "discovery" as const, messageId: "same-id" };
        const accepted = await Promise.all([
          f.controller.sendParent(created.subagentId, created.runId!, input),
          f.controller.sendParent(created.subagentId, created.runId!, input),
        ]);
        expect(accepted[0]).toEqual(accepted[1]);
        expect(
          f.controller
            .state(created.subagentId)
            .snapshot.messages.filter((message) => message.id === "same-id")
        ).toHaveLength(1);
        expect(f.received.filter((message) => message.id === "same-id")).toHaveLength(1);
        await f.controller.stop(created.subagentId);
      });
      it("saves the child's source and wakes a registered waiter without awaiting a parent answer (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const created = await f.create();
        await f.started.promise;
        const waiting = f.controller.wait({ ids: [created.subagentId], after: 1 });
        const message = await f.controller.sendParent(created.subagentId, created.runId!, {
          text: "需要帮助",
          kind: "question",
        });
        expect((await waiting).message?.id).toBe(message.id);
        expect(f.saved.at(-1)?.snapshot.messages.at(-1)?.sender).toBe("subagent");
        expect(f.received.at(-1)?.text).toBe("需要帮助");
        await f.controller.stop(created.subagentId);
      });
    });
    describe("stop()", () => {
      it("reports an explicit stop instead of an internal abort error as the child result https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const started = deferred<void>();
        const f = fixture([], {
          execute: async (_state, _run, signal) => {
            started.resolve();
            await new Promise<void>((_resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => reject(new DOMException("signal is aborted without reason", "AbortError")),
                { once: true }
              );
            });
            throw new Error("unexpected completion");
          },
        });
        const created = await f.create();
        await started.promise;
        await f.controller.stop(created.subagentId);

        const run = f.controller.state(created.subagentId).snapshot.runs[0];
        expect(run).toMatchObject({ status: "stopped", result: "Subagent stopped." });
        expect(f.received.at(-1)?.text).toBe("Subagent stopped.");
      });

      it("withdraws unread instructions and stops the exact execution while retaining context (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const created = await f.create();
        await f.started.promise;
        await f.controller.send({
          sessionId: "parent",
          subagentId: created.subagentId,
          text: "待处理",
          mode: "enqueue",
        });
        await f.controller.stop(created.subagentId);
        const state = f.controller.state(created.subagentId);
        expect(state.snapshot.runs[0].status).toBe("stopped");
        expect(state.automaticTaskIds).toEqual([]);
        expect(state.context.length).toBeGreaterThan(0);
      });
    });
    describe("stopGeneration()", () => {
      it("stops only the currently matching generation and never follows old history into a newer run (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const source = fixture();
        const created = await source.create();
        await source.started.promise;
        source.finish.resolve();
        await source.controller.finished(created.subagentId, created.runId!);
        const saved = JSON.parse(JSON.stringify(source.saved.at(-1))) as NativeSubagentState;
        saved.snapshot.runs = saved.snapshot.runs.map((run) => ({
          ...run,
          taskGenerationId: "old-generation",
        }));
        saved.automaticTaskIds = ["old-generation"];
        const f = fixture([saved]);
        const next = await f.controller.send({
          sessionId: "parent",
          subagentId: created.subagentId,
          text: "new task",
          mode: "wake",
        });
        await f.started.promise;
        await f.controller.stopGeneration("old-generation");
        expect(
          f.controller.state(created.subagentId).snapshot.runs.find((run) => run.id === next.runId)
            ?.status
        ).toBe("running");
        await f.controller.stopGeneration("task");
        expect(
          f.controller.state(created.subagentId).snapshot.runs.find((run) => run.id === next.runId)
            ?.status
        ).toBe("stopped");
        expect(f.controller.state(created.subagentId).snapshot.runs[0].status).toBe("completed");
      });
    });
    describe("confirmRecovery()", () => {
      it("refuses recovery confirmation while a model is still executing (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const created = await f.create();
        await f.started.promise;
        await expect(f.controller.confirmRecovery(created.subagentId)).rejects.toThrow("停止");
        await f.controller.stop(created.subagentId);
      });
      it("saves a user's confirmation of old command identities without starting a model or replaying tools (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const created = await f.create();
        await f.started.promise;
        f.finish.resolve();
        await f.controller.finished(created.subagentId, created.runId!);
        const saved = JSON.parse(JSON.stringify(f.saved.at(-1))) as NativeSubagentState & {
          unconfirmedCommandIds: string[];
        };
        saved.snapshot.recoveryBlocked = "原后台命令状态需要核对";
        saved.unconfirmedCommandIds = ["command-a"];
        const restored = fixture([saved]);
        await restored.controller.confirmRecovery(created.subagentId);
        expect(restored.saved.at(-1)).toMatchObject({
          confirmedCommandIds: ["command-a"],
          unconfirmedCommandIds: [],
        });
        expect(
          restored.controller.state(created.subagentId).snapshot.recoveryBlocked
        ).toBeUndefined();
        expect(restored.maximum()).toBe(0);
        expect(restored.controller.state(created.subagentId).snapshot.runs).toHaveLength(1);
      });
    });
    describe("finished()", () => {
      it("never promotes an outbox result already consumed through synchronous delivery (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const child = await f.create();
        await f.started.promise;
        const messages: SubagentMessage[] = [];
        for (let index = 0; index < 100; index++)
          messages.push(
            await f.controller.sendParent(child.subagentId, child.runId!, {
              text: `progress ${index}`,
              kind: "progress",
            })
          );
        f.finish.resolve();
        const run = await f.controller.finished(child.subagentId, child.runId!);
        expect(run.deliveryBlocked).toBe(true);
        await f.controller.acknowledgeParent(child.subagentId, [], run.resultId);
        await f.controller.acknowledgeParent(child.subagentId, [messages[0].id]);
        expect(f.controller.state(child.subagentId).snapshot.runs[0]).toMatchObject({
          resultDelivered: true,
          deliveryBlocked: false,
        });
        expect(f.received.some((message) => message.id === run.resultId)).toBe(false);
        expect(
          f.controller
            .state(child.subagentId)
            .snapshot.messages.some((message) => message.id === run.resultId)
        ).toBe(false);
        await f.controller.close();
      });
      it("saves a canonical result outside a full inbox then admits and delivers it after a slot is released (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const child = await f.create();
        await f.started.promise;
        const messages: SubagentMessage[] = [];
        for (let index = 0; index < 100; index++)
          messages.push(
            await f.controller.sendParent(child.subagentId, child.runId!, {
              text: `progress ${index}`,
              kind: "progress",
            })
          );
        f.finish.resolve();
        const completed = await f.controller.finished(child.subagentId, child.runId!);
        expect(completed).toMatchObject({ result: "真实结论", deliveryBlocked: true });
        expect(
          f.controller
            .state(child.subagentId)
            .snapshot.messages.some((message) => message.id === completed.resultId)
        ).toBe(false);
        await f.controller.acknowledgeParent(child.subagentId, [messages[0].id]);
        const admitted = f.controller.state(child.subagentId);
        expect(admitted.snapshot.runs[0]).toMatchObject({ deliveryBlocked: false });
        expect(
          admitted.snapshot.messages.find((message) => message.id === completed.resultId)?.state
        ).toBe("accepted");
        expect(f.received.filter((message) => message.id === completed.resultId)).toHaveLength(1);
        await f.controller.acknowledgeParent(child.subagentId, [], completed.resultId);
        expect(f.controller.state(child.subagentId).snapshot.runs[0]).toMatchObject({
          deliveryBlocked: false,
          resultDelivered: true,
        });
        await f.controller.close();
      });
      it("rejects both current and later result waiters when final persistence fails instead of waiting forever (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture([], {
          save: async (state) => {
            if (state.snapshot.runs.at(-1)?.endedAt)
              throw new Error("Final result could not be saved");
          },
        });
        const created = await f.create();
        await f.started.promise;
        const waiting = f.controller.finished(created.subagentId, created.runId!);
        f.finish.resolve();
        await expect(waiting).rejects.toThrow("Final result could not be saved");
        await expect(f.controller.finished(created.subagentId, created.runId!)).rejects.toThrow(
          "Final result could not be saved"
        );
        expect(f.received).toEqual([]);
        expect(f.controller.state(created.subagentId).snapshot.runs[0].status).toBe("interrupted");
        expect(f.controller.state(created.subagentId).snapshot.recoveryBlocked).toContain(
          created.subagentId
        );
        expect(f.controller.state(created.subagentId).snapshot.recoveryBlocked).toContain(
          created.runId
        );
      });
    });
    describe("remove()", () => {
      it("rejects a concurrent wake while deletion is clearing the child's saved data (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const entered = deferred<void>();
        const release = deferred<void>();
        const f = fixture([], {
          remove: async () => {
            entered.resolve();
            await release.promise;
          },
        });
        const created = await f.create();
        await f.started.promise;
        f.finish.resolve();
        await f.controller.finished(created.subagentId, created.runId!);
        const removing = f.controller.remove(created.subagentId);
        await entered.promise;
        try {
          await expect(
            f.controller.send({
              sessionId: "parent",
              subagentId: created.subagentId,
              text: "删除期间再次启动",
              mode: "wake",
            })
          ).rejects.toThrow("删除");
        } finally {
          release.resolve();
          await removing;
        }
        expect(f.controller.list()).toEqual([]);
      });
    });
    describe("setArchived()", () => {
      it("retains a stopped archived result and late reports without authorizing another parent model turn (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const child = await f.create();
        await f.started.promise;
        await f.controller.setArchived(child.subagentId, true);
        await f.controller.sendParent(child.subagentId, child.runId!, {
          text: "迟到的阻塞说明",
          kind: "blocked",
        });
        expect(f.received.map((message) => message.kind)).toEqual(["result", "blocked"]);
        expect(f.automaticDelivery).toEqual([false, false]);
        expect(f.controller.state(child.subagentId).snapshot.retention).toBe("archived");
      });

      it("preserves records while archived and allows explicit cancellation of the archive (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const created = await f.create();
        await f.started.promise;
        await f.controller.setArchived(created.subagentId, true);
        await expect(
          f.controller.send({
            sessionId: "parent",
            subagentId: created.subagentId,
            text: "继续",
            mode: "wake",
          })
        ).rejects.toThrow("取消归档");
        await f.controller.setArchived(created.subagentId, false);
        expect(f.controller.list()[0].retention).toBe("retained");
        await f.controller.remove(created.subagentId);
        expect(f.controller.list()).toEqual([]);
      });
    });
    describe("wait()", () => {
      it("returns timeout without marking the retained child failed (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        jest.useFakeTimers();
        try {
          const f = fixture();
          const waiting = f.controller.wait({ after: 100, timeoutMs: 25 });
          await jest.advanceTimersByTimeAsync(25);
          expect((await waiting).reason).toBe("timeout");
          expect(f.controller.list()).toEqual([]);
        } finally {
          jest.useRealTimers();
        }
      });
      it("waits for an inbound child instruction instead of consuming the child's own outgoing question (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const created = await f.create();
        await f.started.promise;
        await f.controller.sendParent(created.subagentId, created.runId!, {
          text: "问题",
          kind: "question",
        });
        const waiting = f.controller.wait({ ids: [created.subagentId], direction: "to_child" });
        await f.controller.send({
          sessionId: "parent",
          subagentId: created.subagentId,
          text: "答复",
          mode: "enqueue",
        });
        expect((await waiting).message?.text).toBe("答复");
        await f.controller.stop(created.subagentId);
      });
      it("returns user input or cancellation without changing an active run into failure (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const waiting = f.controller.wait({ after: 0 });
        f.controller.userInput();
        expect((await waiting).reason).toBe("user_input");
        const abort = new AbortController();
        const cancelled = f.controller.wait({ after: 100, signal: abort.signal });
        abort.abort();
        expect((await cancelled).reason).toBe("cancelled");
        await f.controller.close();
        await expect(f.create()).rejects.toThrow("关闭");
      });
    });
  });
  describe("subagentModelMessage()", () => {
    it("preserves provenance and explicitly denies a new permission grant (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      const message = subagentModelMessage({
        id: "message",
        sequence: 1,
        subagentId: "child",
        taskGenerationId: "task",
        direction: "to_parent",
        sender: "subagent",
        kind: "discovery",
        text: "资料",
        state: "accepted",
        acceptedAt: 1,
      });
      expect(JSON.parse(message.content as string).source).toBe("subagent");
      expect(message.content).toContain("not a new user instruction or permission grant");
    });
  });
});
