import {
  ClaudeCompatibilityStore,
  type ClaudeCompatibilityInput,
} from "./claudeCompatibilityStore";

function input(cacheKey = "claude-a"): ClaudeCompatibilityInput {
  return {
    cacheKey,
    path: "/usr/local/bin/claude",
    source: "custom",
    env: process.env,
  };
}

describe("claudeCompatibilityStore", () => {
  describe("ClaudeCompatibilityStore", () => {
    describe("get()", () => {
      it("returns a stable checking snapshot until the runtime publishes state", () => {
        const store = new ClaudeCompatibilityStore();
        const first = store.get(input());

        expect(first).toEqual({ kind: "checking", source: "custom" });
        expect(store.get(input())).toBe(first);
      });
    });

    describe("refresh()", () => {
      it("reuses a completed check without running the CLI again unless a recheck is requested", async () => {
        const store = new ClaudeCompatibilityStore();
        const run = jest.fn().mockResolvedValue({ stdout: "2.1.281 (Claude Code)" });
        const first = await store.refresh(input(), { run });

        expect(await store.refresh(input(), { run })).toBe(first);
        expect(run).toHaveBeenCalledTimes(1);
      });

      it("keeps the first checking snapshot stable and publishes only the completed result", async () => {
        const store = new ClaudeCompatibilityStore();
        const checking = store.get(input());
        const listener = jest.fn();
        store.subscribe(listener);
        let complete!: (value: { stdout: string }) => void;
        const pending = store.refresh(input(), {
          run: () => new Promise<{ stdout: string }>((resolve) => (complete = resolve)),
        });
        const duringCheck = store.get(input());
        const notificationsDuringCheck = listener.mock.calls.length;
        complete({ stdout: "2.1.281 (Claude Code)" });
        await pending;

        expect(duringCheck).toBe(checking);
        expect(notificationsDuringCheck).toBe(0);
        expect(store.get(input())).toEqual({ kind: "ready", source: "custom", version: "2.1.281" });
        expect(listener).toHaveBeenCalledTimes(1);
      });

      it("keeps a ready runtime and its snapshot unchanged when a forced recheck finds the same installation", async () => {
        const store = new ClaudeCompatibilityStore();
        await store.refresh(input(), { run: async () => ({ stdout: "2.1.281 (Claude Code)" }) });
        const ready = store.get(input());
        const listener = jest.fn();
        store.subscribe(listener);
        let complete!: (value: { stdout: string }) => void;
        const pending = store.refresh(input(), {
          force: true,
          run: () => new Promise<{ stdout: string }>((resolve) => (complete = resolve)),
        });
        const duringCheck = store.get(input());
        complete({ stdout: "2.1.281 (Claude Code)" });
        const refreshed = await pending;

        expect(duringCheck).toBe(ready);
        expect(store.get(input())).toBe(ready);
        expect(refreshed).toBe(ready);
        expect(listener).not.toHaveBeenCalled();
      });

      it("updates the reported version when an installed runtime is upgraded", async () => {
        const store = new ClaudeCompatibilityStore();
        await store.refresh(input(), { run: async () => ({ stdout: "2.1.281 (Claude Code)" }) });
        const listener = jest.fn();
        store.subscribe(listener);
        await store.refresh(input(), {
          force: true,
          run: async () => ({ stdout: "2.1.282 (Claude Code)" }),
        });
        expect(store.get(input())).toEqual({ kind: "ready", source: "custom", version: "2.1.282" });
        expect(listener).toHaveBeenCalledTimes(1);
      });

      it("publishes a newly incompatible installation once without clearing the ready view during the recheck", async () => {
        const store = new ClaudeCompatibilityStore();
        await store.refresh(input(), { run: async () => ({ stdout: "2.1.281 (Claude Code)" }) });
        const ready = store.get(input());
        const listener = jest.fn();
        store.subscribe(listener);
        let complete!: (value: { stdout: string }) => void;
        const pending = store.refresh(input(), {
          force: true,
          run: () => new Promise<{ stdout: string }>((resolve) => (complete = resolve)),
        });
        const duringCheck = store.get(input());
        complete({ stdout: "2.1.280 (Claude Code)" });
        await pending;

        expect(duringCheck).toBe(ready);
        expect(store.get(input())).toMatchObject({
          kind: "incompatible",
          currentVersion: "2.1.280",
        });
        expect(listener).toHaveBeenCalledTimes(1);
      });

      it("publishes a failed recheck once so an unavailable installation is still reported", async () => {
        const store = new ClaudeCompatibilityStore();
        await store.refresh(input(), { run: async () => ({ stdout: "2.1.281 (Claude Code)" }) });
        const listener = jest.fn();
        store.subscribe(listener);
        await store.refresh(input(), {
          force: true,
          run: async () => {
            throw new Error("runtime disappeared");
          },
        });

        expect(store.get(input())).toMatchObject({ kind: "error" });
        expect(listener).toHaveBeenCalledTimes(1);

        await store.refresh(input(), {
          force: true,
          run: async () => ({ stdout: "2.1.281 (Claude Code)" }),
        });
        expect(store.get(input())).toEqual({ kind: "ready", source: "custom", version: "2.1.281" });
        expect(listener).toHaveBeenCalledTimes(2);
      });

      it("publishes an incompatible result and notifies subscribers", async () => {
        const store = new ClaudeCompatibilityStore();
        const listener = jest.fn();
        store.subscribe(listener);
        const run = jest.fn().mockResolvedValue({ stdout: "2.1.280 (Claude Code)" });

        expect(store.get(input())).toEqual({ kind: "checking", source: "custom" });
        await expect(store.refresh(input(), { run })).resolves.toEqual({
          kind: "incompatible",
          source: "custom",
          currentVersion: "2.1.280",
          minVersion: "2.1.281",
          message:
            "Claude Code 2.1.280 is not supported. Scribe requires Claude Code 2.1.281 or newer.",
        });
        expect(listener).toHaveBeenCalledTimes(1);
      });

      it("deduplicates concurrent probes for the same runtime", async () => {
        const store = new ClaudeCompatibilityStore();
        let resolveRun!: (value: { stdout: string }) => void;
        const run = jest.fn(
          () => new Promise<{ stdout: string }>((resolve) => (resolveRun = resolve))
        );

        const first = store.refresh(input(), { run });
        const second = store.refresh(input(), { run });
        expect(first).toBe(second);
        expect(run).toHaveBeenCalledTimes(1);

        resolveRun({ stdout: "2.1.281 (Claude Code)" });
        await expect(first).resolves.toEqual({
          kind: "ready",
          source: "custom",
          version: "2.1.281",
        });
      });

      it("keeps states independent across runtime cache keys", async () => {
        const store = new ClaudeCompatibilityStore();
        const oldRun = jest.fn().mockResolvedValue({ stdout: "2.1.280 (Claude Code)" });
        const newRun = jest.fn().mockResolvedValue({ stdout: "2.1.281 (Claude Code)" });

        await store.refresh(input("old-path"), { run: oldRun });
        await store.refresh(input("new-path-or-env"), { run: newRun });

        expect(store.get(input("old-path")).kind).toBe("incompatible");
        expect(store.get(input("new-path-or-env"))).toEqual({
          kind: "ready",
          source: "custom",
          version: "2.1.281",
        });
      });

      it("returns a readable error when the version cannot be checked", async () => {
        const store = new ClaudeCompatibilityStore();
        const run = jest.fn().mockRejectedValue(new Error("spawn failed"));

        const state = await store.refresh(input(), { run });

        expect(state.kind).toBe("error");
        expect(state.kind === "error" && state.message).toContain(
          "Could not verify the installed Claude Code version"
        );
      });
    });
  });
});
