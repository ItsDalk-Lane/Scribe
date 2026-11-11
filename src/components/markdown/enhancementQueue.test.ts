import { scheduleMarkdownEnhancement } from "@/components/markdown/enhancementQueue";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function frameDriver() {
  let identity = 0;
  let frameRequested = deferred();
  const callbacks = new Map<number, FrameRequestCallback>();
  const requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
    const id = ++identity;
    callbacks.set(id, callback);
    frameRequested.resolve();
    return id;
  });
  const cancelAnimationFrame = jest.fn((id: number) => {
    callbacks.delete(id);
    if (!callbacks.size) frameRequested = deferred();
  });
  const win = {
    innerHeight: 600,
    requestAnimationFrame,
    cancelAnimationFrame,
  } as unknown as Window;
  return {
    win,
    pending: () => callbacks.size,
    requested: () => frameRequested.promise,
    advance: () => {
      const frame = [...callbacks.values()];
      expect(frame).toHaveLength(1);
      callbacks.clear();
      frameRequested = deferred();
      for (const callback of frame) callback(0);
    },
  };
}

function targetIn(win: Window, top = 0) {
  const target = document.createElement("div");
  Object.defineProperty(target, "win", { value: win });
  jest.spyOn(target, "getBoundingClientRect").mockReturnValue({
    top,
    bottom: top + 20,
    left: 0,
    right: 100,
    width: 100,
    height: 20,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
  document.body.appendChild(target);
  return target;
}

describe("enhancementQueue", () => {
  afterEach(() => {
    document.body.replaceChildren();
    jest.restoreAllMocks();
  });

  describe("scheduleMarkdownEnhancement()", () => {
    it("runs enhancement work in a requested animation frame and settles after the work finishes https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
      const frames = frameDriver();
      const work = deferred();
      const run = jest.fn(() => work.promise);
      const result = scheduleMarkdownEnhancement(
        targetIn(frames.win),
        run,
        new AbortController().signal
      );
      expect(run).not.toHaveBeenCalled();
      expect(frames.pending()).toBe(1);
      frames.advance();
      expect(run).toHaveBeenCalledTimes(1);
      work.resolve();
      await result;
      expect(frames.pending()).toBe(0);
    });

    it("keeps one asynchronous work item active per window and starts the next in a later frame https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
      const frames = frameDriver();
      const firstWork = deferred();
      const secondWork = deferred();
      let active = 0;
      let peak = 0;
      const run = (work: ReturnType<typeof deferred>) =>
        jest.fn(async () => {
          active++;
          peak = Math.max(peak, active);
          await work.promise;
          active--;
        });
      const firstRun = run(firstWork);
      const secondRun = run(secondWork);
      const first = scheduleMarkdownEnhancement(
        targetIn(frames.win),
        firstRun,
        new AbortController().signal
      );
      const second = scheduleMarkdownEnhancement(
        targetIn(frames.win),
        secondRun,
        new AbortController().signal
      );
      frames.advance();
      expect(firstRun).toHaveBeenCalledTimes(1);
      expect(secondRun).not.toHaveBeenCalled();
      expect(active).toBe(1);
      expect(frames.pending()).toBe(0);
      firstWork.resolve();
      await first;
      await frames.requested();
      expect(secondRun).not.toHaveBeenCalled();
      expect(active).toBe(0);
      frames.advance();
      expect(secondRun).toHaveBeenCalledTimes(1);
      expect(active).toBe(1);
      expect(peak).toBe(1);
      secondWork.resolve();
      await second;
      expect(active).toBe(0);
    });

    it("prioritizes connected visible content before older offscreen content https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
      const frames = frameDriver();
      const order: string[] = [];
      const offscreen = scheduleMarkdownEnhancement(
        targetIn(frames.win, 800),
        async () => {
          order.push("offscreen");
        },
        new AbortController().signal
      );
      const visible = scheduleMarkdownEnhancement(
        targetIn(frames.win, 100),
        async () => {
          order.push("visible");
        },
        new AbortController().signal
      );
      frames.advance();
      expect(order).toEqual(["visible"]);
      await visible;
      await frames.requested();
      frames.advance();
      await offscreen;
      expect(order).toEqual(["visible", "offscreen"]);
    });

    it("removes queued aborted work, releases its listener, and cancels an unused frame https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
      const frames = frameDriver();
      const controller = new AbortController();
      const removeListener = jest.spyOn(controller.signal, "removeEventListener");
      const run = jest.fn(async () => {});
      const result = scheduleMarkdownEnhancement(targetIn(frames.win), run, controller.signal);
      controller.abort();
      await result;
      expect(run).not.toHaveBeenCalled();
      expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(frames.win.cancelAnimationFrame).toHaveBeenCalledTimes(1);
      expect(frames.pending()).toBe(0);
    });

    it("leaves a frame available for remaining work when another queued item is aborted https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
      const frames = frameDriver();
      const abortedController = new AbortController();
      const abortedRun = jest.fn(async () => {});
      const keptRun = jest.fn(async () => {});
      const aborted = scheduleMarkdownEnhancement(
        targetIn(frames.win),
        abortedRun,
        abortedController.signal
      );
      const kept = scheduleMarkdownEnhancement(
        targetIn(frames.win),
        keptRun,
        new AbortController().signal
      );
      abortedController.abort();
      await aborted;
      expect(frames.pending()).toBe(1);
      expect(frames.win.cancelAnimationFrame).not.toHaveBeenCalled();
      frames.advance();
      await kept;
      expect(abortedRun).not.toHaveBeenCalled();
      expect(keptRun).toHaveBeenCalledTimes(1);
    });

    it("keeps the active slot occupied after abort until the underlying work really finishes https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
      const frames = frameDriver();
      const controller = new AbortController();
      const firstWork = deferred();
      const firstRun = jest.fn(() => firstWork.promise);
      const secondRun = jest.fn(async () => {});
      const first = scheduleMarkdownEnhancement(targetIn(frames.win), firstRun, controller.signal);
      const second = scheduleMarkdownEnhancement(
        targetIn(frames.win),
        secondRun,
        new AbortController().signal
      );
      frames.advance();
      controller.abort();
      expect(secondRun).not.toHaveBeenCalled();
      expect(frames.pending()).toBe(0);
      expect(frames.win.requestAnimationFrame).toHaveBeenCalledTimes(1);
      firstWork.resolve();
      await first;
      await frames.requested();
      expect(secondRun).not.toHaveBeenCalled();
      frames.advance();
      await second;
      expect(secondRun).toHaveBeenCalledTimes(1);
    });

    it.each(["rejected promise", "synchronous throw"])(
      "rejects a %s and continues remaining work in a later frame https://github.com/ItsDalk-Lane/Scribe/issues/72",
      async (failure) => {
        const frames = frameDriver();
        const work = deferred();
        const error = new Error("Enhancement failed");
        const firstRun = jest.fn(() => {
          if (failure === "synchronous throw") throw error;
          return work.promise;
        });
        const secondRun = jest.fn(async () => {});
        const first = scheduleMarkdownEnhancement(
          targetIn(frames.win),
          firstRun,
          new AbortController().signal
        );
        const caught = first.catch((reason: unknown) => reason);
        const second = scheduleMarkdownEnhancement(
          targetIn(frames.win),
          secondRun,
          new AbortController().signal
        );
        expect(() => frames.advance()).not.toThrow();
        expect(firstRun).toHaveBeenCalledTimes(1);
        expect(secondRun).not.toHaveBeenCalled();
        if (failure === "rejected promise") work.reject(error);
        expect(await caught).toBe(error);
        await frames.requested();
        expect(secondRun).not.toHaveBeenCalled();
        frames.advance();
        await second;
        expect(secondRun).toHaveBeenCalledTimes(1);
      }
    );

    it("allows work in different windows to run independently https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
      const firstWindow = frameDriver();
      const secondWindow = frameDriver();
      const firstWork = deferred();
      const secondWork = deferred();
      const firstRun = jest.fn(() => firstWork.promise);
      const secondRun = jest.fn(() => secondWork.promise);
      const first = scheduleMarkdownEnhancement(
        targetIn(firstWindow.win),
        firstRun,
        new AbortController().signal
      );
      const second = scheduleMarkdownEnhancement(
        targetIn(secondWindow.win),
        secondRun,
        new AbortController().signal
      );
      firstWindow.advance();
      secondWindow.advance();
      expect(firstRun).toHaveBeenCalledTimes(1);
      expect(secondRun).toHaveBeenCalledTimes(1);
      firstWork.resolve();
      secondWork.resolve();
      await Promise.all([first, second]);
      expect(firstWindow.pending()).toBe(0);
      expect(secondWindow.pending()).toBe(0);
    });

    it("skips work whose signal was already aborted without requesting a frame https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
      const frames = frameDriver();
      const controller = new AbortController();
      controller.abort();
      const run = jest.fn(async () => {});
      await scheduleMarkdownEnhancement(targetIn(frames.win), run, controller.signal);
      expect(run).not.toHaveBeenCalled();
      expect(frames.win.requestAnimationFrame).not.toHaveBeenCalled();
    });
  });
});
