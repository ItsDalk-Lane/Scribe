import type { App } from "obsidian";
import { ProjectRegister } from "@/projects/projectRegister";

const initialize = jest.fn(async () => null);
jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: { getInstance: () => ({ initialize }) },
}));

describe("projectRegister", () => {
  describe("ProjectRegister", () => {
    describe("initialize()", () => {
      it("loads projects once without subscribing to invisible vault-file events", async () => {
        const register = new ProjectRegister({} as App);
        expect(await register.initialize()).toBeNull();
        expect(initialize).toHaveBeenCalledTimes(1);
      });
    });
    describe("cleanup()", () => {
      it("can close without removing user workspace files", () => {
        expect(() => new ProjectRegister({} as App).cleanup()).not.toThrow();
      });
    });
  });
});
