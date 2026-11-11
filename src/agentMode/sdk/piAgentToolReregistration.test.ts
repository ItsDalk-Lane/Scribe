import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Context, JsonObject, Model } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
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

function response(
  model: Model<"openai-completions">,
  calls: Array<{ id: string; name: string; arguments: JsonObject }> = []
) {
  const stream = createAssistantMessageEventStream();
  const message = createAssistantMessage(model);
  message.content = [...calls.map((call) => ({ type: "toolCall" as const, ...call }))];
  message.stopReason = calls.length ? "toolUse" : "stop";
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason: message.stopReason, message });
  return stream;
}

function recordingTool(name: string, onExecute?: () => void): AgentTool {
  return {
    name,
    label: name,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
    execute: async () => {
      onExecute?.();
      return { content: [{ type: "text", text: `${name} ok` }], details: undefined };
    },
  };
}

describe("pi-agent-core Agent state.tools", () => {
  describe("mid-run reassignment", () => {
    it("carries a newly assigned tool into the next request and lets the model call it", async () => {
      const seenToolSets: string[][] = [];
      const lateTool = recordingTool("late_tool");
      const lateExecute = jest.spyOn(lateTool, "execute");
      const bridgeTool = recordingTool("bridge_tool", () => {
        agent.state.tools = [...agent.state.tools, lateTool];
      });
      let requests = 0;
      const agent: Agent = new Agent({
        initialState: { model, tools: [bridgeTool] },
        streamFn: (_model, context: Context) => {
          seenToolSets.push(getCurrentTools(context.messages).map((tool) => tool.name));
          requests += 1;
          if (requests === 1)
            return response(model, [{ id: "call-1", name: "bridge_tool", arguments: {} }]);
          if (requests === 2)
            return response(model, [{ id: "call-2", name: "late_tool", arguments: {} }]);
          return response(model);
        },
        prepareRequest: ({ context }) => ({ context: { ...context, tools: agent.state.tools } }),
        prepareNextTurnWithContext: ({ context }) => ({
          context: { ...context, tools: agent.state.tools },
        }),
      });
      await agent.prompt("Use the bridged tool.");
      expect(seenToolSets[0]).toEqual(["bridge_tool"]);
      expect(seenToolSets[1]).toContain("late_tool");
      expect(lateExecute).toHaveBeenCalledTimes(1);
    });
  });
});
