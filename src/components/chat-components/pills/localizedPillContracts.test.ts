import { setInterfaceLocale } from "@/lib/i18n";
import { createEditor } from "lexical";
import { ActiveNotePillNode } from "./ActiveNotePillNode";
import { ActiveWebTabPillNode } from "./ActiveWebTabPillNode";
import { WebTabPillNode } from "./WebTabPillNode";

function withPills(run: () => void) {
  const editor = createEditor({
    namespace: "localized-pill-contracts",
    nodes: [ActiveNotePillNode, ActiveWebTabPillNode, WebTabPillNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(run, { discrete: true });
}

describe("localizedPillContracts", () => {
  beforeEach(() => setInterfaceLocale("zh-CN"));
  afterEach(() => setInterfaceLocale("en"));

  describe("ActiveNotePillNode", () => {
    describe("exportJSON()", () => {
      it("keeps the saved active note marker unchanged in a Chinese interface", () => {
        withPills(() => {
          const node = new ActiveNotePillNode();
          expect(node.exportJSON()).toMatchObject({
            value: "Current Note",
            type: "active-note-pill",
          });
          expect(node.getTextContent()).toBe("{activeNote}");
        });
      });
    });
  });

  describe("ActiveWebTabPillNode", () => {
    describe("exportJSON()", () => {
      it("keeps the saved active web tab marker unchanged in a Chinese interface", () => {
        withPills(() => {
          const node = new ActiveWebTabPillNode();
          expect(node.exportJSON()).toMatchObject({
            value: "Current Web Tab",
            type: "active-web-tab-pill",
          });
          expect(node.getTextContent()).toBe("{activeWebTab}");
        });
      });
    });
  });

  describe("WebTabPillNode", () => {
    describe("exportJSON()", () => {
      it("keeps a user's web tab title and URL unchanged in a Chinese interface", () => {
        withPills(() => {
          const node = new WebTabPillNode(
            "https://example.com/my-note",
            "My private title 我的标题"
          );
          expect(node.exportJSON()).toMatchObject({
            url: "https://example.com/my-note",
            title: "My private title 我的标题",
          });
          expect(node.getTextContent()).toBe("[🌐: My private title 我的标题]");
        });
      });
    });
  });
});
