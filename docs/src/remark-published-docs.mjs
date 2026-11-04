import { visit } from "unist-util-visit";

const SIBLING_GUIDE_LINK = /^(?:\.\/)?([^/#?]+)\.md(#.+)?$/;

export function remarkPublishedDocs() {
  return (tree) => {
    const [opening] = tree.children;
    if (opening?.type === "heading" && opening.depth === 1) {
      tree.children.shift();
    }
    visit(tree, "link", (node) => {
      const match = SIBLING_GUIDE_LINK.exec(node.url);
      if (!match) return;
      const [, name, anchor = ""] = match;
      node.url = `${name === "index" ? "/" : `/${name}/`}${anchor}`;
    });
  };
}
