import { ActivityGroupCard } from "@/agentMode/ui/ActivityGroupCard";
import type { ActivityMember } from "@/agentMode/ui/activityGroups";
import { useTrailExpansion } from "@/agentMode/ui/useTrailExpansion";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import React from "react";

function action(id: string): ActivityMember {
  return {
    type: "action",
    part: { kind: "tool_call", id, title: id, status: "completed", vendorToolName: "Read" },
  };
}

const Trail: React.FC<{ members: ActivityMember[] }> = ({ members }) => {
  const { isOpen, toggle } = useTrailExpansion();
  return (
    <ActivityGroupCard
      group={{ type: "activityGroup", id: "activity-0", members }}
      open={isOpen("activity-0")}
      onToggle={() => toggle("activity-0")}
      renderMember={(m, key) => <div key={key}>{m.type === "action" ? m.part.id : "thought"}</div>}
    />
  );
};

describe("useTrailExpansion", () => {
  describe("useTrailExpansion()", () => {
    it("opens running activity by default, then closes every manual choice when the reply ends", () => {
      const { result, rerender } = renderHook(({ running }) => useTrailExpansion(running), {
        initialProps: { running: true },
      });
      expect(result.current.isOpen("group")).toBe(true);
      expect(result.current.isOpen("tool")).toBe(true);
      act(() => result.current.toggle("group"));
      expect(result.current.isOpen("group")).toBe(false);
      act(() => result.current.toggle("group"));
      expect(result.current.isOpen("group")).toBe(true);
      rerender({ running: false });
      expect(result.current.isOpen("group")).toBe(false);
      expect(result.current.isOpen("tool")).toBe(false);
      act(() => result.current.toggle("group"));
      rerender({ running: false });
      expect(result.current.isOpen("group")).toBe(true);
    });

    it("keeps a running group's manual close while new activity appears and resets the next run", () => {
      const { result, rerender } = renderHook(({ running }) => useTrailExpansion(running), {
        initialProps: { running: true },
      });
      act(() => result.current.toggle("group"));
      rerender({ running: true });
      expect(result.current.isOpen("group")).toBe(false);
      expect(result.current.isOpen("new-tool")).toBe(true);
      rerender({ running: false });
      act(() => result.current.toggle("group"));
      rerender({ running: true });
      expect(result.current.isOpen("group")).toBe(true);
    });

    it("supports an explicitly closed-by-default detail inside otherwise open running activity", () => {
      const { result } = renderHook(() => useTrailExpansion(true));
      expect(result.current.isOpen("prompt", false)).toBe(false);
      act(() => result.current.toggle("prompt", false));
      expect(result.current.isOpen("prompt", false)).toBe(true);
      act(() => result.current.toggle("prompt", false));
      expect(result.current.isOpen("prompt", false)).toBe(false);
    });

    it("reports every group closed until the user opens one", () => {
      const { result, rerender } = renderHook(() => useTrailExpansion());

      expect(result.current.isOpen("activity-0")).toBe(false);
      rerender();
      expect(result.current.isOpen("activity-0")).toBe(false);

      act(() => result.current.toggle("activity-0"));

      expect(result.current.isOpen("activity-0")).toBe(true);
      expect(result.current.isOpen("activity-1")).toBe(false);
    });

    it("closes a group again only when the user toggles it a second time", () => {
      const { result } = renderHook(() => useTrailExpansion());

      act(() => result.current.toggle("activity-0"));
      act(() => result.current.toggle("activity-1"));
      act(() => result.current.toggle("activity-0"));

      expect(result.current.isOpen("activity-0")).toBe(false);
      expect(result.current.isOpen("activity-1")).toBe(true);
    });

    it("keeps the toggle callback stable so cards do not re-render on unrelated state", () => {
      const { result } = renderHook(() => useTrailExpansion());
      const firstToggle = result.current.toggle;

      act(() => result.current.toggle("activity-0"));

      expect(result.current.toggle).toBe(firstToggle);
    });

    it("keeps a completed group open when its displayed members update", () => {
      const members = [action("a"), action("b")];
      const { rerender } = render(<Trail members={members} />);

      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");

      rerender(<Trail members={[...members, action("c")]} />);
      expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText("c")).not.toBeNull();

      rerender(<Trail members={[...members, action("c")]} />);
      expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
    });
  });
});
