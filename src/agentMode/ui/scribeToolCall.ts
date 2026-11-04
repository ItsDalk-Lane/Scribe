import { SCRIBE_MCP_SERVER_NAME } from "@/agentMode/session/scribeToolDefinitions";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";

export type ScribeToolCall = { args: Record<string, unknown> } | { code: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function scribeToolCall(part: ToolCallPart, toolName: string): ScribeToolCall | null {
  const input = asRecord(part.input);
  if (part.mcpServer === SCRIBE_MCP_SERVER_NAME && part.vendorToolName === toolName) {
    return { args: input };
  }
  if (input.server === SCRIBE_MCP_SERVER_NAME && input.tool === toolName) {
    return { args: asRecord(input.arguments) };
  }
  const code = typeof input.code === "string" ? input.code : "";
  const singleQuoted = `tools['${SCRIBE_MCP_SERVER_NAME}'].${toolName}(`;
  const doubleQuoted = `tools["${SCRIBE_MCP_SERVER_NAME}"].${toolName}(`;
  let index = code.indexOf(singleQuoted);
  if (index < 0) index = code.indexOf(doubleQuoted);
  return index >= 0 ? { code: code.slice(index) } : null;
}

const STRING_FIELD_PATTERN =
  /\b([A-Za-z_$][\w$]*)["']?:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;

function decodeStringLiteral(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = body[++i];
    if (next === undefined) break;
    switch (next) {
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      case "v":
        out += "\v";
        break;
      case "0":
        out += "\0";
        break;
      case "x": {
        const hex = body.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 2;
        }
        break;
      }
      case "u": {
        const hex = body.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        }
        break;
      }
      default:
        out += next;
    }
  }
  return out;
}

export function codeStringField(code: string, field: string): string | null {
  for (const literal of code.matchAll(STRING_FIELD_PATTERN)) {
    if (literal[1] !== field) continue;
    const body = decodeStringLiteral(literal[2] ?? literal[3]);
    return body.length > 0 ? body : null;
  }
  return null;
}
