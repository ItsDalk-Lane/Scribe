import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentTool, ToolExecutionMode } from "@earendil-works/pi-agent-core";
import type { Context, JsonObject, Model } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { createAssistantMessage } from "@/LLMProviders/piChatModel";

const model = {
  id: "configured-model",
  name: "Configured model",
  api: "openai-completions" as const,
  provider: "configured-provider",
  baseUrl: "http://localhost/fixture",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10000,
  maxTokens: 1000,
} satisfies Model<"openai-completions">;

function scriptedResponse(calls: Array<{ id: string; name: string; arguments: JsonObject }> = []) {
  const stream = createAssistantMessageEventStream();
  const message = createAssistantMessage(model);
  message.content = [...calls.map((call) => ({ type: "toolCall" as const, ...call }))];
  message.stopReason = calls.length ? "toolUse" : "stop";
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason: message.stopReason, message });
  return stream;
}

function soloTool(name: string, timeline: string[], executionMode: ToolExecutionMode): AgentTool {
  return {
    name,
    label: name,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
    executionMode,
    execute: async () => {
      timeline.push(`start:${name}`);
      timeline.push(`end:${name}`);
      return { content: [{ type: "text", text: `${name} ok` }], details: undefined };
    },
  };
}

function overlappingReadPair(): { tools: AgentTool[]; timeline: string[] } {
  const timeline: string[] = [];
  let started = 0;
  let openGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  const make = (name: string): AgentTool => ({
    name,
    label: name,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
    executionMode: "parallel",
    execute: async () => {
      timeline.push(`start:${name}`);
      started += 1;
      if (started === 2) openGate();
      await gate;
      timeline.push(`end:${name}`);
      return { content: [{ type: "text", text: `${name} ok` }], details: undefined };
    },
  });
  return { tools: [make("read_a"), make("read_b")], timeline };
}

type ToolCallSpec = { id: string; name: string };

async function runBatch(
  calls: ToolCallSpec[],
  tools: AgentTool[]
): Promise<{ agent: Agent; secondRequestMessages: Agent["state"]["messages"] }> {
  let secondRequestMessages: Agent["state"]["messages"] = [];
  const batched = calls.map((call) => ({
    id: call.id,
    name: call.name,
    arguments: {},
  }));
  let requests = 0;
  const agent = new Agent({
    initialState: { model, tools },
    toolExecution: "parallel",
    streamFn: (_model, context: Context) => {
      requests += 1;
      if (requests === 2) {
        secondRequestMessages = [...context.messages];
        return scriptedResponse();
      }
      return scriptedResponse(batched);
    },
  });
  await agent.prompt("Run the batch.");
  return { agent, secondRequestMessages };
}

const positionOf = (timeline: string[], event: string): number => {
  const position = timeline.indexOf(event);
  expect(position).toBeGreaterThanOrEqual(0);
  return position;
};

describe("pi-agent-core tool batch execution", () => {
  describe("mixed batches with parallel and sequential calls", () => {
    it("runs consecutive parallel calls concurrently while sequential calls execute exclusively and in segment order", async () => {
      const { tools: readers, timeline } = overlappingReadPair();
      const tools = [
        ...readers,
        soloTool("write_a", timeline, "sequential"),
        soloTool("read_c", timeline, "parallel"),
      ];
      await runBatch(
        [
          { id: "call-1", name: "read_a" },
          { id: "call-2", name: "read_b" },
          { id: "call-3", name: "write_a" },
          { id: "call-4", name: "read_c" },
        ],
        tools
      );
      expect(positionOf(timeline, "start:read_b")).toBeLessThan(positionOf(timeline, "end:read_a"));
      expect(positionOf(timeline, "start:read_a")).toBeLessThan(positionOf(timeline, "end:read_b"));
      expect(positionOf(timeline, "start:write_a")).toBeGreaterThan(
        positionOf(timeline, "end:read_a")
      );
      expect(positionOf(timeline, "start:write_a")).toBeGreaterThan(
        positionOf(timeline, "end:read_b")
      );
      expect(positionOf(timeline, "start:read_c")).toBeGreaterThan(
        positionOf(timeline, "end:write_a")
      );
    });

    it("appends tool results to the conversation history in the assistant's source order", async () => {
      const { tools: readers, timeline } = overlappingReadPair();
      const tools = [
        ...readers,
        soloTool("write_a", timeline, "sequential"),
        soloTool("read_c", timeline, "parallel"),
      ];
      const { secondRequestMessages } = await runBatch(
        [
          { id: "call-1", name: "read_a" },
          { id: "call-2", name: "read_b" },
          { id: "call-3", name: "write_a" },
          { id: "call-4", name: "read_c" },
        ],
        tools
      );
      const resultOrder = secondRequestMessages
        .filter((message) => message.role === "toolResult")
        .map((message) => (message as { toolName: string }).toolName);
      expect(resultOrder).toEqual(["read_a", "read_b", "write_a", "read_c"]);
    });

    it("starts parallel calls only after a leading sequential call has finished", async () => {
      const { tools: readers, timeline } = overlappingReadPair();
      const tools = [soloTool("write_a", timeline, "sequential"), ...readers];
      await runBatch(
        [
          { id: "call-1", name: "write_a" },
          { id: "call-2", name: "read_a" },
          { id: "call-3", name: "read_b" },
        ],
        tools
      );
      expect(positionOf(timeline, "start:read_a")).toBeGreaterThan(
        positionOf(timeline, "end:write_a")
      );
      expect(positionOf(timeline, "start:read_b")).toBeGreaterThan(
        positionOf(timeline, "end:write_a")
      );
      expect(positionOf(timeline, "start:read_b")).toBeLessThan(positionOf(timeline, "end:read_a"));
    });
  });

  describe("uniform batches", () => {
    it("keeps a fully parallel batch concurrent", async () => {
      const { tools, timeline } = overlappingReadPair();
      await runBatch(
        [
          { id: "call-1", name: "read_a" },
          { id: "call-2", name: "read_b" },
        ],
        tools
      );
      expect(positionOf(timeline, "start:read_b")).toBeLessThan(positionOf(timeline, "end:read_a"));
    });

    it("keeps a fully sequential batch ordered one call at a time", async () => {
      const timeline: string[] = [];
      await runBatch(
        [
          { id: "call-1", name: "write_a" },
          { id: "call-2", name: "write_b" },
        ],
        [soloTool("write_a", timeline, "sequential"), soloTool("write_b", timeline, "sequential")]
      );
      expect(positionOf(timeline, "end:write_a")).toBeLessThan(
        positionOf(timeline, "start:write_b")
      );
    });
  });
});
