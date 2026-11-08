import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

describe("dropdown-menu", () => {
  describe("DropdownMenu()", () => {
    let frame: HTMLIFrameElement | undefined;
    afterEach(() => {
      cleanup();
      window.activeDocument = document;
      frame?.remove();
      frame = undefined;
    });

    it("opens a menu from its trigger and invokes the selected action", async () => {
      const onSelect = jest.fn();
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Choose mode</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onSelect}>Plan</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
      fireEvent.keyDown(screen.getByRole("button", { name: "Choose mode" }), { key: "Enter" });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Plan" }));
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("opens the first menu in its trigger document when another window was active during mounting", async () => {
      frame = document.createElement("iframe");
      document.body.appendChild(frame);
      const previousDocument = frame.contentDocument!;
      window.activeDocument = previousDocument;
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>Choose mode</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Plan</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
      window.activeDocument = document;
      fireEvent.keyDown(screen.getByRole("button", { name: "Choose mode" }), { key: "Enter" });
      const menu = await screen.findByRole("menu");
      expect(menu.ownerDocument).toBe(document);
      expect(previousDocument.querySelector('[role="menu"]')).toBeNull();
    });
    it.each(["object", "callback"])("preserves the caller's %s trigger reference", (kind) => {
      const objectRef = { current: null as HTMLButtonElement | null };
      const callbackRef = jest.fn();
      render(
        <DropdownMenu>
          <DropdownMenuTrigger ref={kind === "object" ? objectRef : callbackRef}>
            Choose mode
          </DropdownMenuTrigger>
        </DropdownMenu>
      );
      const trigger = screen.getByRole("button", { name: "Choose mode" });
      if (kind === "object") expect(objectRef.current).toBe(trigger);
      else expect(callbackRef).toHaveBeenCalledWith(trigger);
    });

    it("keeps an explicit portal container when one is supplied", async () => {
      const container = document.createElement("section");
      document.body.appendChild(container);
      try {
        render(
          <DropdownMenu>
            <DropdownMenuTrigger>Choose mode</DropdownMenuTrigger>
            <DropdownMenuContent container={container}>
              <DropdownMenuItem>Plan</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
        fireEvent.keyDown(screen.getByRole("button", { name: "Choose mode" }), { key: "Enter" });
        expect(container.contains(await screen.findByRole("menu"))).toBe(true);
      } finally {
        cleanup();
        container.remove();
      }
    });
  });
});
