const nodeFs = jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises");

// 模拟磁盘卡住：指定日志文件之后的每一次确认落盘都挂起，直到测试放行或判定失败。https://github.com/ItsDalk-Lane/Scribe/issues/55
export function stallConfirmations(path: string): { release(): void; fail(error: Error): void } {
  let release!: () => void;
  let fail!: (error: Error) => void;
  const gate = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  const originalOpen = nodeFs.open;
  const spy = jest
    .spyOn(nodeFs, "open")
    .mockImplementation(async (...args: Parameters<typeof nodeFs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === path) jest.spyOn(handle, "sync").mockImplementation(() => gate);
      return handle;
    });
  return {
    release: () => {
      release();
      spy.mockRestore();
    },
    fail: (error: Error) => {
      fail(error);
      spy.mockRestore();
    },
  };
}
