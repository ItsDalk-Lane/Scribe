import { applyEdits, format, parseTree, type ParseError } from "jsonc-parser";

export interface FormattedToolText {
  kind: "json" | "json-string" | "markdown" | "text";
  text: string;
}

export function formatToolText(text: string): FormattedToolText {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (tree && errors.length === 0) {
    let jsonText = text;
    let kind: FormattedToolText["kind"] = "json";
    // 有些工具把JSON包在返回字符串内；只解开这一层，并保留内部数字与字符串字段原文。https://github.com/ItsDalk-Lane/Scribe/issues/52
    if (tree.type === "string" && typeof tree.value === "string") {
      const innerErrors: ParseError[] = [];
      const innerTree = parseTree(tree.value, innerErrors, {
        disallowComments: true,
        allowTrailingComma: false,
      });
      if (
        (innerTree?.type === "object" || innerTree?.type === "array") &&
        innerErrors.length === 0
      ) {
        jsonText = tree.value;
        kind = "json-string";
      }
    }
    // 只调整JSON空白，避免大整数和转义值在解析再序列化时改变。https://github.com/ItsDalk-Lane/Scribe/issues/52
    return {
      kind,
      text: applyEdits(
        jsonText,
        format(jsonText, undefined, { tabSize: 2, insertSpaces: true, eol: "\n" })
      ),
    };
  }
  return {
    kind: /(?:^|\n)\s*(?:#{1,6}\s|[-*+]\s|\d+\.\s|>|```|\|)|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/.test(
      text
    )
      ? "markdown"
      : "text",
    text,
  };
}

export function toolValueText(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? "");
}
