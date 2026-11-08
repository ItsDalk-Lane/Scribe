import { requireNodeModule } from "@/utils/desktopRuntime";

export interface DesktopStreamingFetchBridge {
  fetch(url: string, init: RequestInit): Promise<Response>;
  AbortController: typeof AbortController;
}

interface ElectronNetworkBridge {
  remote?: {
    require?(id: string): { net?: { fetch?: DesktopStreamingFetchBridge["fetch"] } };
    getGlobal?(name: string): typeof AbortController;
  };
}

export function loadDesktopStreamingFetch(): typeof fetch {
  const remote = requireNodeModule<ElectronNetworkBridge>("electron").remote;
  const net = remote?.require?.("electron").net;
  const MainAbortController = remote?.getGlobal?.("AbortController");
  if (!net?.fetch || !MainAbortController)
    throw new Error("The desktop network bridge required for streaming requests is unavailable.");
  return createDesktopStreamingFetch({
    fetch: (url, init) => net.fetch!(url, init),
    AbortController: MainAbortController,
  });
}

export function createDesktopStreamingFetch(bridge: DesktopStreamingFetchBridge): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    const body = request.body ? await request.text() : undefined;
    request.signal.throwIfAborted();
    const mainAbort = new bridge.AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let output: ReadableStreamDefaultController<Uint8Array> | undefined;
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      request.signal.removeEventListener("abort", abort);
      reader?.releaseLock();
    };
    const cancel = async (reason?: unknown): Promise<void> => {
      mainAbort.abort();
      try {
        await reader?.cancel(reason);
      } finally {
        finish();
      }
    };
    const abort = (): void => {
      if (finished) return;
      output?.error(request.signal.reason);
      void cancel(request.signal.reason).catch(() => undefined);
    };
    request.signal.addEventListener("abort", abort, { once: true });
    try {
      const response = await bridge.fetch(request.url, {
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        ...(body === undefined ? {} : { body }),
        redirect: request.redirect,
        signal: mainAbort.signal,
      });
      request.signal.throwIfAborted();
      const headers = new Headers();
      const entries = response.headers.entries();
      for (let entry = entries.next(); !entry.done; entry = entries.next())
        headers.append(entry.value[0], entry.value[1]);
      let stream: ReadableStream<Uint8Array> | null = null;
      if (response.body) {
        reader = response.body.getReader();
        stream = new ReadableStream<Uint8Array>(
          {
            start(controller) {
              output = controller;
            },
            async pull(controller) {
              try {
                const next = await reader!.read();
                if (finished) return;
                if (next.done) {
                  controller.close();
                  finish();
                } else controller.enqueue(new Uint8Array(next.value));
              } catch (error) {
                if (finished) return;
                controller.error(error);
                mainAbort.abort();
                finish();
              }
            },
            cancel,
          },
          { highWaterMark: 0 }
        );
      } else finish();
      return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      mainAbort.abort();
      finish();
      request.signal.throwIfAborted();
      throw error;
    }
  };
}
