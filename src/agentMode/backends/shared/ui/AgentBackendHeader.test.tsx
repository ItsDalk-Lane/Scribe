import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentBackendHeader } from "./AgentBackendHeader";
import meta, { SignInRequired, CheckingSignIn, SignedIn } from "./AgentBackendHeader.stories";

describe("AgentBackendHeader", () => {
  describe("AgentBackendHeader()", () => {
    it("renders the backend icon, name, and resolved path and opens configuration from Configure", () => {
      const onConfigure = jest.fn();
      render(
        <AgentBackendHeader
          {...meta.args}
          displayName="Claude"
          Icon={() => <svg aria-label="Claude icon" />}
          resolvedPath="/usr/local/bin/claude"
          installState={{ kind: "ready", source: "custom" }}
          authStatus={{ signedIn: true }}
          onConfigure={onConfigure}
        />
      );
      expect(screen.getByLabelText("Claude icon")).toBeTruthy();
      expect(screen.getByText("Claude")).toBeTruthy();
      expect(screen.getByText("/usr/local/bin/claude")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(onConfigure).toHaveBeenCalledTimes(1);
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 shows Ready only after the installed agent is signed in", () => {
      const view = render(<AgentBackendHeader {...meta.args} {...SignInRequired.args} />);
      expect(screen.getByText("Sign in required")).toBeTruthy();
      expect(screen.queryByText("Ready")).toBeNull();
      view.rerender(<AgentBackendHeader {...meta.args} {...CheckingSignIn.args} />);
      expect(screen.getByText("Checking sign-in…")).toBeTruthy();
      view.rerender(<AgentBackendHeader {...meta.args} {...SignedIn.args} />);
      expect(screen.getByText("Ready")).toBeTruthy();
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/531 keeps configuration available through setup progress and failure", () => {
      const onConfigure = jest.fn();
      const view = render(<AgentBackendHeader {...meta.args} onConfigure={onConfigure} />);
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(onConfigure).toHaveBeenCalledTimes(1);
      view.rerender(
        <AgentBackendHeader
          {...meta.args}
          managedInstall={{ kind: "running", label: "Preparing agent (42%)" }}
        />
      );
      expect(screen.getByRole("button", { name: "Configure" }).hasAttribute("disabled")).toBe(
        false
      );
      expect(screen.getByText("Preparing agent (42%)")).toBeTruthy();
      view.rerender(
        <AgentBackendHeader
          {...meta.args}
          managedInstall={{ kind: "running", label: "Preparing agent" }}
        />
      );
      expect(screen.getByText("Preparing agent")).toBeTruthy();
      expect(screen.queryByText(/0%/)).toBeNull();
      view.rerender(
        <AgentBackendHeader
          {...meta.args}
          managedInstall={{ kind: "error", message: "Setup failed. Check your connection." }}
          onConfigure={onConfigure}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(onConfigure).toHaveBeenCalledTimes(2);
    });
  });
});
