import {
  formatStartupMigrationSummary,
  runStartupMigrationSummary,
  type StartupMigrationItem,
  type StartupMigrationTask,
  type StartupMigrationTasks,
} from "@/services/startupMigration";

const initial: StartupMigrationItem = {
  id: "credentials",
  title: "API keys",
  status: "success",
  summary: "Keys migrated.",
};
const failure: StartupMigrationItem = {
  id: "projects",
  title: "Projects",
  status: "error",
  summary: "Projects failed.",
};
const final: StartupMigrationItem = {
  id: "prompts",
  title: "Prompts",
  status: "action-required",
  summary: "Review prompt locations.",
  details: ["Open Scribe Settings."],
};

const EMPTY_TASK: StartupMigrationTask = {
  result: Promise.resolve(null),
  failure: null,
  onFailure: jest.fn(),
};

function tasks(projects: StartupMigrationTask = EMPTY_TASK): StartupMigrationTasks {
  return [projects, EMPTY_TASK, EMPTY_TASK];
}

describe("startupMigration", () => {
  describe("formatStartupMigrationSummary()", () => {
    it("formats statuses and recovery details as one readable message", () => {
      expect(formatStartupMigrationSummary([initial, failure, final])).toBe(
        [
          "Scribe startup report.",
          "API keys — Completed\nKeys migrated.",
          "Projects — Failed\nProjects failed.",
          "Prompts — Action required\nReview prompt locations.\n• Open Scribe Settings.",
        ].join("\n\n")
      );
    });
  });

  describe("runStartupMigrationSummary()", () => {
    it("settles failures before presenting and acknowledging one ordered summary", async () => {
      const onFailure = jest.fn();
      const calls: string[] = [];

      await runStartupMigrationSummary({
        initialItems: [initial],
        tasks: tasks({
          result: Promise.reject(new Error("failed")),
          failure,
          onFailure,
        }),
        present: (items) => calls.push(`present:${items.map(({ id }) => id).join(",")}`),
        acknowledge: () => calls.push("acknowledge"),
      });

      expect(onFailure).toHaveBeenCalledWith(expect.any(Error));
      expect(calls).toEqual(["present:credentials,projects", "acknowledge"]);
    });

    it("does nothing when no migration has an outcome", async () => {
      const present = jest.fn();
      const acknowledge = jest.fn();

      await runStartupMigrationSummary({
        initialItems: [],
        tasks: tasks(),
        present,
        acknowledge,
      });

      expect(present).not.toHaveBeenCalled();
      expect(acknowledge).not.toHaveBeenCalled();
    });

    it("does not acknowledge outcomes when presentation fails", async () => {
      const acknowledge = jest.fn();

      await expect(
        runStartupMigrationSummary({
          initialItems: [initial],
          tasks: tasks(),
          present: () => {
            throw new Error("modal failed");
          },
          acknowledge,
        })
      ).rejects.toThrow("modal failed");

      expect(acknowledge).not.toHaveBeenCalled();
    });
  });
});
