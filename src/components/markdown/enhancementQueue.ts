interface EnhancementJob {
  target: HTMLElement;
  run: () => Promise<void>;
  signal: AbortSignal;
  resolve: () => void;
  reject: (error: unknown) => void;
  abort: () => void;
}

interface EnhancementQueue {
  jobs: EnhancementJob[];
  running: boolean;
  frame: number | null;
}

const queues = new WeakMap<Window, EnhancementQueue>();

export function scheduleMarkdownEnhancement(
  target: HTMLElement,
  run: () => Promise<void>,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const win = target.win;
  let queue = queues.get(win);
  if (!queue) {
    queue = { jobs: [], running: false, frame: null };
    queues.set(win, queue);
  }
  const current = queue;
  return new Promise<void>((resolve, reject) => {
    const job: EnhancementJob = {
      target,
      run,
      signal,
      resolve,
      reject,
      abort: () => {
        const index = current.jobs.indexOf(job);
        if (index < 0) return;
        current.jobs.splice(index, 1);
        signal.removeEventListener("abort", job.abort);
        resolve();
        if (!current.jobs.length && current.frame !== null) {
          win.cancelAnimationFrame(current.frame);
          current.frame = null;
        }
      },
    };
    current.jobs.push(job);
    signal.addEventListener("abort", job.abort, { once: true });
    requestNext(win, current);
  });
}

function requestNext(win: Window, queue: EnhancementQueue): void {
  if (queue.running || queue.frame !== null || !queue.jobs.length) return;
  queue.frame = win.requestAnimationFrame(() => {
    queue.frame = null;
    const visible = queue.jobs.findIndex(({ target }) => {
      const bounds = target.getBoundingClientRect();
      return target.isConnected && bounds.bottom >= 0 && bounds.top <= win.innerHeight;
    });
    const job = queue.jobs.splice(visible < 0 ? 0 : visible, 1)[0];
    if (!job) return;
    job.signal.removeEventListener("abort", job.abort);
    if (job.signal.aborted) {
      job.resolve();
      requestNext(win, queue);
      return;
    }
    queue.running = true;
    void (async () => {
      try {
        await job.run();
        job.resolve();
      } catch (error) {
        job.reject(error);
      } finally {
        queue.running = false;
        requestNext(win, queue);
      }
    })();
  });
}
