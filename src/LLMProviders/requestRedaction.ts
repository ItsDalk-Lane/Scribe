import {
  classifyProviderFailure,
  ProviderRequestError,
} from "@/LLMProviders/providerRequestFailure";

const NON_SECRET_VALUES = new Set(["keyless-endpoint", "provider-managed-auth", "default-key"]);

export class RequestRedactor {
  private readonly pending = new Map<number, string>();

  constructor(private readonly values: readonly string[]) {}

  private secrets(): string[] {
    const secrets = new Set<string>();
    const add = (value: string) => {
      if (!value || NON_SECRET_VALUES.has(value)) return;
      secrets.add(value);
      secrets.add(JSON.stringify(value).slice(1, -1));
    };
    const fields = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      for (const [name, child] of Object.entries(value)) {
        if (typeof child === "string" && /(?:key|token|secret|password)$/i.test(name)) add(child);
        else if (child && typeof child === "object") fields(child);
      }
    };
    for (const value of this.values) {
      add(value);
      add(value.trim());
      const token = value.match(/^(?:Bearer|Basic)\s+(.+)$/i)?.[1];
      if (token) add(token);
      try {
        fields(JSON.parse(value));
      } catch {
        continue;
      }
    }
    return [...secrets].sort((a, b) => b.length - a.length);
  }

  redact(text: string): string {
    return this.replace(text, false).visible;
  }

  private replace(text: string, holdPrefix: boolean): { visible: string; pending: string } {
    const secrets = this.secrets();
    let visible = "";
    for (let index = 0; index < text.length; ) {
      const match = secrets.find((secret) => text.startsWith(secret, index));
      if (match) {
        visible += "[redacted]";
        index += match.length;
      } else if (holdPrefix && secrets.some((secret) => secret.startsWith(text.slice(index)))) {
        return { visible, pending: text.slice(index) };
      } else {
        visible += text[index++];
      }
    }
    return { visible, pending: "" };
  }

  push(index: number, delta: string): string {
    const result = this.replace((this.pending.get(index) ?? "") + delta, true);
    this.pending.set(index, result.pending);
    return result.visible;
  }

  flush(index: number): string {
    const text = this.pending.get(index) ?? "";
    this.pending.delete(index);
    return this.redact(text);
  }

  structured<T>(value: T): T {
    if (typeof value === "string") return this.redact(value) as T;
    if (Array.isArray(value)) return value.map((child: unknown) => this.structured(child)) as T;
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, this.structured(child)])
      ) as T;
    return value;
  }

  error(error: unknown): unknown {
    const message = error instanceof Error ? error.message : String(error);
    const safe = this.redact(message);
    if (!this.secrets().length) return error;
    const failure = classifyProviderFailure({ cause: error });
    const result = new ProviderRequestError(safe, {
      ...failure,
      ...(failure.code ? { code: this.redact(failure.code) } : {}),
    });
    if (error instanceof Error) result.name = error.name;
    return result;
  }
}
