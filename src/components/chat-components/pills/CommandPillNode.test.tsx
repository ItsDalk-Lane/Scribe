import React from "react";
import { render, screen } from "@testing-library/react";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from "lexical";
import {
  $applyLeadingCommandChip,
  CommandBadge,
  CommandPillNode,
  $createCommandPillNode,
} from "./CommandPillNode";

function makeEditor() {
  const editor = createEditor({
    namespace: "command-pill-test",
    nodes: [CommandPillNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.setRootElement(document.body.createDiv());
  return editor;
}
function withEditor(run: () => void) {
  const editor = makeEditor();
  editor.update(run, { discrete: true });
  return editor;
}
function setPrompt(text: string) {
  const paragraph = $createParagraphNode();
  if (text) paragraph.append($createTextNode(text));
  $getRoot().clear();
  $getRoot().append(paragraph);
}

describe("CommandPillNode", () => {
  describe("getTextContent()", () => {
    it("serializes the chip back to the slash invocation so sent text stays byte-identical (https://github.com/ItsDalk-Lane/Scribe/issues/35)", () => {
      withEditor(() => {
        const node = $createCommandPillNode("review-notes", "skill");
        expect(node.getTextContent()).toBe("/review-notes");
        expect(node.getCommandName()).toBe("review-notes");
        expect(node.getCommandKind()).toBe("skill");
      });
    });
  });
  describe("exportJSON()", () => {
    it("round-trips the command name and kind through importJSON (https://github.com/ItsDalk-Lane/Scribe/issues/35)", () => {
      withEditor(() => {
        const serialized = $createCommandPillNode("review-notes", "skill").exportJSON();
        expect(serialized).toMatchObject({
          value: "/review-notes",
          commandName: "review-notes",
          commandKind: "skill",
          type: "command-pill",
        });
        const restored = CommandPillNode.importJSON(serialized).exportJSON();
        expect(restored).toEqual(serialized);
      });
    });
  });
  describe("exportDOM()", () => {
    it("keeps the slash text plus name and kind attributes for clipboard round-trips (https://github.com/ItsDalk-Lane/Scribe/issues/35)", () => {
      const editor = makeEditor();
      editor.update(
        () => {
          const { element } = $createCommandPillNode("compact", "builtin").exportDOM(editor);
          const span = element as HTMLElement;
          expect(span.textContent).toBe("/compact");
          expect(span.getAttribute("data-lexical-command-pill")).toBe("");
          expect(span.getAttribute("data-command-name")).toBe("compact");
          expect(span.getAttribute("data-command-kind")).toBe("builtin");
        },
        { discrete: true }
      );
    });
  });
  describe("importDOM()", () => {
    it("rebuilds a chip from an exported span and leaves foreign spans alone (https://github.com/ItsDalk-Lane/Scribe/issues/35)", () => {
      const editor = makeEditor();
      editor.update(
        () => {
          const exported = $createCommandPillNode("review-notes", "skill").exportDOM(editor)
            .element as HTMLElement;
          const plan = CommandPillNode.importDOM()?.span?.(exported);
          const converted = plan?.conversion(exported);
          const node = Array.isArray(converted?.node) ? converted?.node[0] : converted?.node;
          expect(node?.getTextContent()).toBe("/review-notes");
          const plain = document.body.createEl("span");
          expect(CommandPillNode.importDOM()?.span?.(plain)).toBeNull();
        },
        { discrete: true }
      );
    });
  });
  describe("CommandBadge()", () => {
    it("shows the bare command name with a kind icon and no slash (https://github.com/ItsDalk-Lane/Scribe/issues/35)", () => {
      render(<CommandBadge name="review-notes" kind="skill" />);
      expect(screen.getByText("review-notes")).toBeTruthy();
      expect(screen.queryByText("/review-notes")).toBeNull();
      expect(screen.getByText("review-notes").querySelector("svg")).toBeTruthy();
    });
  });
  describe("$applyLeadingCommandChip()", () => {
    const kinds = new Map([
      ["review-notes", "skill"],
      ["skill-creator", "skill"],
      ["compact", "builtin"],
    ]);
    it("converts a seeded leading command into a chip while preserving the exact text content (https://github.com/ItsDalk-Lane/Scribe/issues/35)", () => {
      const editor = makeEditor();
      let applied = false;
      let textAfter = "";
      editor.update(
        () => {
          setPrompt("/skill-creator Describe the workflow");
          applied = $applyLeadingCommandChip(kinds);
          textAfter = $getRoot().getTextContent();
        },
        { discrete: true }
      );
      expect(applied).toBe(true);
      expect(textAfter).toBe("/skill-creator Describe the workflow");
      expect(editor.getRootElement()?.querySelector(".command-pill-wrapper")).toBeTruthy();
    });
    it("converts a bare command without trailing text and leaves unknown commands as plain text (https://github.com/ItsDalk-Lane/Scribe/issues/35)", () => {
      withEditor(() => {
        setPrompt("/review-notes");
        expect($applyLeadingCommandChip(kinds)).toBe(true);
        expect($getRoot().getTextContent()).toBe("/review-notes");

        setPrompt("/unknown-command do things");
        expect($applyLeadingCommandChip(kinds)).toBe(false);
        expect($getRoot().getTextContent()).toBe("/unknown-command do things");

        setPrompt("hello /review-notes");
        expect($applyLeadingCommandChip(kinds)).toBe(false);
      });
    });
    it("does not re-chip a prompt that already starts with a command chip (https://github.com/ItsDalk-Lane/Scribe/issues/35)", () => {
      withEditor(() => {
        $getRoot().clear();
        const paragraph = $createParagraphNode();
        paragraph.append($createCommandPillNode("review-notes", "skill"));
        paragraph.append($createTextNode(" Read the note"));
        $getRoot().append(paragraph);
        expect($applyLeadingCommandChip(kinds)).toBe(false);
        expect($getRoot().getTextContent()).toBe("/review-notes Read the note");
      });
    });
  });
});
