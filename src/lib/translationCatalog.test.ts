import { chineseTranslations } from "@/lib/i18n";
import { readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import ts from "typescript";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) && !/\.(test|stories|d)\./.test(path) ? [path] : [];
  });
}

describe("translationCatalog", () => {
  describe("Chinese interface coverage", () => {
    it("provides a Chinese translation for every literal interface lookup", () => {
      const missing: string[] = [];
      for (const path of sourceFiles(resolve(__dirname, ".."))) {
        const source = ts.createSourceFile(
          path,
          readFileSync(path, "utf8"),
          ts.ScriptTarget.Latest,
          true
        );
        const visit = (node: ts.Node): void => {
          if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "t"
          ) {
            const english = node.arguments[0];
            if (
              english &&
              ts.isStringLiteralLike(english) &&
              !Object.prototype.hasOwnProperty.call(chineseTranslations, english.text)
            ) {
              missing.push(`${path}: ${english.text}`);
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
      expect(missing).toEqual([]);
    });
  });
});
