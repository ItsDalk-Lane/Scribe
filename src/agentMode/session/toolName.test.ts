import { parseMcpToolName, toolPresentationName } from "@/agentMode/session/toolName";

describe("toolName", () => {
  describe("toolPresentationName()", () => {
    it.each([
      ["read_note", "Read"],
      ["list_directory", "LS"],
      ["find_paths", "Glob"],
      ["search_content", "Grep"],
      ["write_note", "Write"],
      ["edit_note", "Edit"],
      ["run_command", "Bash"],
      ["delegate_task", "Agent"],
      ["ask_user", "AskUserQuestion"],
      ["propose_plan", "ExitPlanMode"],
      ["update_todos", "TodoWrite"],
      ["web_search", "WebSearch"],
      ["fetch_url", "WebFetch"],
      ["invoke_skill", "Skill"],
    ])("keeps %s in the existing %s presentation category", (native, category) => {
      expect(toolPresentationName(native)).toBe(category);
    });
    it("preserves unknown and existing category names", () => {
      expect(toolPresentationName("registered_custom_tool")).toBe("registered_custom_tool");
      expect(toolPresentationName("Read")).toBe("Read");
    });
  });
  describe("parseMcpToolName()", () => {
    it("splits a qualified MCP name into server and tool", () => {
      expect(parseMcpToolName("mcp__context7__query-docs")).toEqual({
        server: "context7",
        tool: "query-docs",
      });
    });

    it("treats the first '__' after the prefix as the separator (single-underscore server)", () => {
      expect(parseMcpToolName("mcp__my_server__do_thing")).toEqual({
        server: "my_server",
        tool: "do_thing",
      });
    });

    it("keeps trailing '__' inside the tool segment", () => {
      expect(parseMcpToolName("mcp__srv__tool__name")).toEqual({
        server: "srv",
        tool: "tool__name",
      });
    });

    it("returns null for non-MCP names", () => {
      expect(parseMcpToolName("Read")).toBeNull();
      expect(parseMcpToolName("AskUserQuestion")).toBeNull();
      expect(parseMcpToolName("mcp__incomplete")).toBeNull();
      expect(parseMcpToolName("")).toBeNull();
    });
  });
});
