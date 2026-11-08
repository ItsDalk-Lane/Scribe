import type { SubagentSessionSnapshot } from "@/agentMode/session/subagentTypes";
import { groupSubagentSessions, subagentRunStatusLabel } from "@/agentMode/ui/subagentDisplay";

const sessionWith = (overrides: Partial<SubagentSessionSnapshot>): SubagentSessionSnapshot => ({
  id: "child-1",
  parentSessionId: "parent-1",
  modelId: "model-1",
  name: "Child",
  cwd: "/vault",
  retention: "retained",
  createdAt: 1,
  updatedAt: 2,
  runs: [
    {
      id: "run-1",
      toolCallId: "tool-1",
      taskGenerationId: "g-1",
      status: "completed",
      createdAt: 1,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    },
  ],
  messages: [],
  ...overrides,
});

describe("subagentDisplay", () => {
  describe("groupSubagentSessions()", () => {
    it("puts sessions with any active run into Running and the rest into Completed", () => {
      const groups = groupSubagentSessions([
        sessionWith({ id: "done", updatedAt: 5 }),
        sessionWith({
          id: "active",
          updatedAt: 4,
          runs: [
            {
              id: "run-2",
              toolCallId: "tool-2",
              taskGenerationId: "g-1",
              status: "awaiting_input",
              createdAt: 2,
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
            },
          ],
        }),
      ]);
      expect(groups.running.map((session) => session.id)).toEqual(["active"]);
      expect(groups.completed.map((session) => session.id)).toEqual(["done"]);
    });

    it("sorts each group by latest activity before grouping", () => {
      const groups = groupSubagentSessions([
        sessionWith({ id: "older", updatedAt: 1 }),
        sessionWith({ id: "newer", updatedAt: 9 }),
      ]);
      expect(groups.completed.map((session) => session.id)).toEqual(["newer", "older"]);
    });
  });

  describe("subagentRunStatusLabel()", () => {
    it("labels every run status", () => {
      expect(subagentRunStatusLabel("running")).toBeTruthy();
      expect(subagentRunStatusLabel("awaiting_approval")).toBeTruthy();
      expect(subagentRunStatusLabel("interrupted")).toBeTruthy();
    });
  });
});
