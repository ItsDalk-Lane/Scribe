import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { $getRoot } from "lexical";
import type { Skill } from "@/agentMode";
import { CommandPillNode } from "@/components/chat-components/pills/CommandPillNode";
import { SlashCommandPlugin } from "@/components/chat-components/plugins/SlashCommandPlugin";
import { ValueSyncPlugin } from "@/components/chat-components/plugins/ValueSyncPlugin";

let mockSkills: Skill[] = [];
jest.mock("@/agentMode", () => ({
  getManagedSkills: () => mockSkills,
  SkillManager: {
    hasInstance: () => true,
    getInstance: () => ({ subscribeToSkillSetChange: () => () => undefined }),
  },
  listBackendDescriptors: () => [{ id: "native" }],
}));

const makeSkill = (name: string): Skill => ({
  name,
  description: `Instructions for ${name}`,
  body: "Read",
  filePath: `/vault/.scribe/skills/${name}/SKILL.md`,
  dirPath: `/vault/.scribe/skills/${name}`,
  enabledAgents: ["native"],
  location: { kind: "canonical" },
});

let reportedText = "";
function ComposerHarness({ value }: { value: string }) {
  reportedText = "";
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "slash-command-test",
        theme: {},
        nodes: [CommandPillNode],
        onError: (error) => {
          throw error;
        },
      }}
    >
      <PlainTextPlugin
        contentEditable={<ContentEditable aria-label="chat editor" />}
        placeholder=""
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin
        onChange={(state) =>
          state.read(() => {
            reportedText = $getRoot().getTextContent();
          })
        }
        ignoreSelectionChange
      />
      <ValueSyncPlugin value={value} />
      <SlashCommandPlugin skills={mockSkills} />
    </LexicalComposer>
  );
}

describe("SlashCommandPlugin", () => {
  describe("SlashCommandPlugin()", () => {
    it("renders a seeded skill-command draft as a command chip while reporting identical text (https://github.com/ItsDalk-Lane/Scribe/issues/35)", async () => {
      mockSkills = [makeSkill("review-notes")];
      render(<ComposerHarness value="/review-notes Read the full note" />);
      await waitFor(() =>
        expect(
          screen.getByLabelText("chat editor").querySelector(".command-pill-wrapper")
        ).toBeTruthy()
      );
      expect(screen.getByText("review-notes")).toBeTruthy();
      expect(screen.queryByText("/review-notes Read the full note")).toBeNull();
      await waitFor(() => expect(reportedText).toBe("/review-notes Read the full note"));
    });

    it("keeps unknown and mid-text slash drafts as plain text (https://github.com/ItsDalk-Lane/Scribe/issues/35)", async () => {
      mockSkills = [makeSkill("review-notes")];
      const { rerender } = render(<ComposerHarness value="/unknown-command do things" />);
      await waitFor(() => expect(reportedText).toBe("/unknown-command do things"));
      expect(
        screen.getByLabelText("chat editor").querySelector(".command-pill-wrapper")
      ).toBeNull();
      rerender(<ComposerHarness value="hello /review-notes and more" />);
      await waitFor(() => expect(reportedText).toBe("hello /review-notes and more"));
      expect(
        screen.getByLabelText("chat editor").querySelector(".command-pill-wrapper")
      ).toBeNull();
    });
  });
});
