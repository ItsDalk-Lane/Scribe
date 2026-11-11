import { Markdown, type MarkdownProps } from "@/components/markdown/ui/Markdown";
import { Button } from "@/components/ui/button";
import type { Meta, StoryObj } from "@/lib/story";
import { MarkdownRenderer, type App, type Component } from "obsidian";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";

interface StressSample {
  id: string;
  label: string;
  text: string;
  stream?: boolean;
}

interface StressCase {
  id: string;
  label: string;
  samples: readonly StressSample[];
}

interface PipelineMetrics {
  calls: number;
  inputCharacters: number;
  maxInFlight: number;
  totalHostMs: number;
  elapsedMs: number;
  longTaskCount: number;
  longTaskMs: number;
  longTasksSupported: boolean;
}

interface MeasurementWindow extends Window {
  PerformanceObserver?: typeof PerformanceObserver;
}

type HostRender = (
  this: unknown,
  app: App,
  markdown: string,
  target: HTMLElement,
  sourcePath: string,
  component: Component
) => Promise<void>;

function measurePipeline(root: HTMLElement): () => PipelineMetrics {
  const win = root.win;
  const clock = win.performance;
  const started = clock.now();
  const renderer = MarkdownRenderer as unknown as { render: HostRender };
  const original = renderer.render;
  let calls = 0;
  let inputCharacters = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  let totalHostMs = 0;
  let longTaskCount = 0;
  let longTaskMs = 0;
  let active = true;
  let observer: PerformanceObserver | undefined;
  let result: PipelineMetrics | undefined;
  const recordLongTasks = (entries: PerformanceEntryList): void => {
    for (const entry of entries) {
      if (entry.entryType !== "longtask") continue;
      longTaskCount++;
      longTaskMs += entry.duration;
    }
  };
  const Observer = (win as MeasurementWindow).PerformanceObserver;
  if (Observer?.supportedEntryTypes?.includes("longtask")) {
    observer = new Observer((list) => recordLongTasks(list.getEntries()));
    observer.observe({ entryTypes: ["longtask"] });
  }
  const measured: HostRender = function (...args) {
    if (!active || !root.contains(args[2])) return original.apply(this, args) as Promise<void>;
    calls++;
    inputCharacters += args[1].length;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const hostStarted = clock.now();
    const finish = (): void => {
      inFlight--;
      totalHostMs += clock.now() - hostStarted;
    };
    try {
      return (original.apply(this, args) as Promise<void>).finally(finish);
    } catch (error) {
      finish();
      throw error;
    }
  };
  renderer.render = measured;
  return () => {
    if (result) return result;
    active = false;
    if (renderer.render === measured) renderer.render = original;
    if (observer) {
      recordLongTasks(observer.takeRecords());
      observer.disconnect();
    }
    result = {
      calls,
      inputCharacters,
      maxInFlight,
      totalHostMs,
      elapsedMs: clock.now() - started,
      longTaskCount,
      longTaskMs,
      longTasksSupported: observer !== undefined,
    };
    return result;
  };
}

const FRAME_COUNT = 120;
const EMPTY_SETTLED: readonly string[] = Object.freeze([]);

function paragraphs(count: number, label: string): string {
  return Array.from(
    { length: count },
    (_, index) =>
      `## ${label}：第 ${index + 1} 段\n\n这是一段用于比较排版过程的固定文字。生成时可以向上阅读、选中文字，也可以继续查看后面的内容。已经完成的段落应保持稳定，新增内容应持续出现。完整原文始终保留，不会因为显示速度而丢失。`
  ).join("\n\n");
}

function deliveredLength(sample: StressSample, progress: number): number {
  if (sample.stream === false || progress === FRAME_COUNT) return sample.text.length;
  return Math.min(
    Math.max(0, sample.text.length - 1),
    Math.ceil((sample.text.length * progress) / FRAME_COUNT)
  );
}

const STRESS_CASES: readonly StressCase[] = [
  {
    id: "short",
    label: "短回答",
    samples: [
      {
        id: "short-answer",
        label: "一条短回答",
        text: "## 今日整理\n\n已核对三篇笔记，保留了原文。\n\n- 先确认来源。\n- 再整理共同结论。\n- 最后补上需要继续核对的问题。\n\n**整理完成。**",
      },
    ],
  },
  {
    id: "paragraphs",
    label: "长段落",
    samples: [{ id: "long-answer", label: "八十段连续正文", text: paragraphs(80, "长回答") }],
  },
  {
    id: "code",
    label: "超长代码",
    samples: [
      {
        id: "long-code",
        label: "超过增强上限的完整代码",
        text: `下面的代码完整保留，超过增强上限时应保持原文可读。\n\n\`\`\`typescript\n${Array.from(
          { length: 2400 },
          (_, index) =>
            `const result${index} = "第 ${index + 1} 行：内容完整保留，可以阅读和复制。";`
        ).join("\n")}\n\`\`\`\n\n代码已全部输出。`,
      },
    ],
  },
  {
    id: "diagrams",
    label: "多图表",
    samples: [
      {
        id: "many-diagrams",
        label: "八张逐步闭合的图表",
        text: Array.from(
          { length: 8 },
          (_, index) =>
            `## 第 ${index + 1} 张图\n\n\`\`\`mermaid\ngraph TD\n  A${index}[读取资料] --> B${index}[核对来源]\n  B${index} --> C${index}[整理结果]\n  C${index} --> D${index}[保留原文]\n\`\`\`\n\n这张图的源码也应完整保留。`
        ).join("\n\n"),
      },
    ],
  },
  {
    id: "history",
    label: "30 回合",
    samples: Array.from({ length: 30 }, (_, index) => ({
      id: `history-${index + 1}`,
      label: `第 ${index + 1} 回合`,
      text: paragraphs(index === 29 ? 12 : 2, `第 ${index + 1} 回合`),
      stream: index === 29,
    })),
  },
  {
    id: "parallel",
    label: "并行 3 条",
    samples: Array.from({ length: 3 }, (_, index) => ({
      id: `parallel-${index + 1}`,
      label: `并行回答 ${index + 1}`,
      text: paragraphs(24, `并行回答 ${index + 1}`),
    })),
  },
];

interface StressResponseProps {
  sample: StressSample;
  text: string;
  isStreaming: boolean;
  run: number;
  onSettled: (id: string, run: number) => void;
}

const StressResponse = memo(function StressResponse({
  sample,
  text,
  isStreaming,
  run,
  onSettled,
}: StressResponseProps) {
  const latest = useRef({ text, isStreaming });
  latest.current = { text, isStreaming };
  const onRendered = useCallback(() => {
    if (!latest.current.isStreaming && latest.current.text === sample.text)
      onSettled(sample.id, run);
  }, [onSettled, sample, run]);
  return (
    <section aria-label={sample.label} className="tw-rounded tw-border tw-border-border tw-p-3">
      <h3 className="tw-mb-2 tw-text-sm tw-font-medium">{sample.label}</h3>
      <Markdown
        text={text}
        sourcePath=""
        contentPolicy="model"
        renderIdentity={`stress/${run}/${sample.id}`}
        isStreaming={isStreaming}
        onRendered={onRendered}
      />
    </section>
  );
});

function StressWorkbenchDemo(): React.ReactElement {
  const [selected, setSelected] = useState(STRESS_CASES[0]);
  const [run, setRun] = useState(0);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [settled, setSettled] = useState(EMPTY_SETTLED);
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const activeRun = useRef(0);
  const measurement = useRef<(() => PipelineMetrics) | null>(null);

  useEffect(
    () => () => {
      measurement.current?.();
      measurement.current = null;
    },
    []
  );

  useEffect(() => {
    if (!running || !root.current) return;
    const win = root.current.win;
    let frame = 0;
    let request: number;
    const append = (): void => {
      frame++;
      setProgress(frame);
      if (frame === FRAME_COUNT) setRunning(false);
      else request = win.requestAnimationFrame(append);
    };
    request = win.requestAnimationFrame(append);
    return () => win.cancelAnimationFrame(request);
  }, [running, run]);

  const markSettled = useCallback((id: string, completedRun: number) => {
    if (activeRun.current !== completedRun) return;
    setSettled((previous) => (previous.includes(id) ? previous : [...previous, id]));
  }, []);
  const total = selected.samples.reduce((sum, sample) => sum + sample.text.length, 0);
  const delivered = selected.samples.reduce(
    (sum, sample) => sum + deliveredLength(sample, progress),
    0
  );
  const rendered =
    started && !running && progress === FRAME_COUNT && settled.length === selected.samples.length;
  useEffect(() => {
    if (!rendered || !measurement.current || !root.current) return;
    const finish = measurement.current;
    const win = root.current.win;
    // 最后一次宿主任务必须结束，才能收集它产生的长任务记录。https://github.com/ItsDalk-Lane/Scribe/issues/72
    const frame = win.requestAnimationFrame(() => {
      if (measurement.current !== finish) return;
      measurement.current = null;
      setMetrics(finish());
    });
    return () => win.cancelAnimationFrame(frame);
  }, [rendered, run]);
  const complete = rendered && metrics !== null;
  return (
    <div ref={root} className="tw-flex tw-flex-col tw-gap-3">
      <div role="group" aria-label="选择测试样例" className="tw-flex tw-flex-wrap tw-gap-2">
        {STRESS_CASES.map((scenario) => (
          <Button
            key={scenario.id}
            variant={selected.id === scenario.id ? "secondary" : "ghost"}
            aria-pressed={selected.id === scenario.id}
            onClick={() => {
              measurement.current?.();
              measurement.current = null;
              activeRun.current++;
              setSelected(scenario);
              setRunning(false);
              setStarted(false);
              setProgress(0);
              setSettled(EMPTY_SETTLED);
              setMetrics(null);
            }}
          >
            {scenario.label}
          </Button>
        ))}
      </div>
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-3">
        <Button
          disabled={running}
          onClick={() => {
            if (!root.current) return;
            measurement.current?.();
            measurement.current = measurePipeline(root.current);
            const next = ++activeRun.current;
            setRun(next);
            setSettled(EMPTY_SETTLED);
            setProgress(0);
            setStarted(true);
            setRunning(true);
            setMetrics(null);
          }}
        >
          开始逐步输出
        </Button>
        <div
          role="status"
          data-case={selected.id}
          data-complete={complete}
          data-frames={progress}
          data-delivered-characters={started ? delivered : 0}
          data-total-characters={total}
          className="tw-text-sm tw-text-muted"
        >
          {!started
            ? "尚未开始"
            : complete
              ? "最终排版完成"
              : running
                ? `正在输出：${progress} / ${FRAME_COUNT} 帧`
                : "文字已输出，等待排版"}
        </div>
      </div>
      <output
        data-pipeline-metrics
        aria-label="排版测量结果"
        className="tw-whitespace-pre-wrap tw-break-words tw-font-mono tw-text-xs tw-text-muted"
      >
        {JSON.stringify(metrics ?? { state: running ? "running" : "idle" })}
      </output>
      <p className="tw-text-sm tw-text-muted">
        使用固定内容和 120 帧输出比较排版过程，不调用模型。30 回合样例保留 29
        条历史正文，只追加最后一条。
      </p>
      {started ? (
        <div className="tw-flex tw-flex-col tw-gap-3">
          {selected.samples.map((sample) => (
            <StressResponse
              key={`${run}/${sample.id}`}
              sample={sample}
              run={run}
              text={sample.text.slice(0, deliveredLength(sample, progress))}
              isStreaming={sample.stream !== false && running}
              onSettled={markSettled}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const meta = {
  title: "Chat/Markdown",
  component: Markdown,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<MarkdownProps>;
export default meta;

export const StressWorkbench: StoryObj<MarkdownProps> = { render: StressWorkbenchDemo };

export const UnclosedCode: StoryObj<MarkdownProps> = {
  args: {
    text: "代码还在继续生成，源码保持可读。\n\n```typescript\nconst notes = [\n  '第一篇笔记',\n  '第二篇笔记',",
    sourcePath: "",
    contentPolicy: "model",
    isStreaming: true,
    renderIdentity: "unclosed-code-preview",
  },
};

export const NestedCode: StoryObj<MarkdownProps> = {
  args: {
    sourcePath: "",
    contentPolicy: "model",
    text: "- ```javascript\n  const answer = 42;\n  ```\n\n> ```text\n> 引用中的完整代码\n> ```",
  },
};

export const HostCompatibility: StoryObj<MarkdownProps> = {
  args: {
    sourcePath: "",
    contentPolicy: "model",
    text: "## 宿主兼容检查\n\n[[渲染验收目标]]\n\n公式：\\(a^2+b^2=c^2\\)。\n\n![本地合成图片](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIyNCI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjI0IiBmaWxsPSIjNjQ3NDhiIi8+PC9zdmc+)\n\n参考内容[^1]。\n\n[^1]: 完整脚注。",
  },
};
