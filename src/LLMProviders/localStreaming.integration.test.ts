import { createServer } from "node:http";
import { runInThisContext } from "node:vm";
import type { Socket } from "node:net";
import { createChatChain, createChatMemory } from "@/commands/customCommandChatEngine";
import { ChatModelProviders } from "@/constants";

jest.mock("@/logger");
const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/8";
// Native fetch rejects jsdom AbortSignals, so the socket test uses one Web API realm. https://github.com/ItsDalk-Lane/Scribe/issues/8
const nativeRuntime = runInThisContext("({ fetch, AbortController, AbortSignal })") as Pick<
  typeof window,
  "fetch" | "AbortController" | "AbortSignal"
>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("localStreaming integration", () => {
  describe("createChatChain()", () => {
    it.each(["Ollama", "LM Studio"])(
      `receives real HTTP chunks from a keyless %s-compatible server, aborts its socket and replays accepted history (${issue})`,
      async (name) => {
        const closed = deferred<void>();
        const requests: Array<{ headers: Record<string, unknown>; body: { messages: unknown[] } }> =
          [];
        const sockets = new Set<Socket>();
        let firstEnded = false;
        const chunk = (text: string, finish_reason: string | null = null) =>
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason }] })}\n\n`;
        const server = createServer((request, response) => {
          let body = "";
          request.on("data", (bytes) => {
            body += String(bytes);
          });
          request.on("end", () => {
            requests.push({
              headers: request.headers,
              body: JSON.parse(body) as { messages: unknown[] },
            });
            response.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-cache",
            });
            if (requests.length === 1) {
              response.on("close", () => {
                firstEnded = response.writableEnded;
                closed.resolve();
              });
              response.write(chunk("Partial answer"));
            } else {
              response.end(chunk("Follow-up answer", "stop") + "data: [DONE]\n\n");
            }
          });
          server.on("connection", (socket) => {
            sockets.add(socket);
            socket.on("close", () => sockets.delete(socket));
          });
        });
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        const originalRuntime = {
          fetch: window.fetch,
          AbortController: window.AbortController,
          AbortSignal: window.AbortSignal,
        };
        Object.assign(window, nativeRuntime);
        const controller = new AbortController();
        try {
          const address = server.address();
          if (!address || typeof address === "string")
            throw new Error("Missing fixture server port");
          const chain = await createChatChain(
            {
              name: `${name}-private-model`,
              provider: ChatModelProviders.OPENAI_FORMAT,
              providerNpm: "@ai-sdk/openai-compatible",
              baseUrl: `http://127.0.0.1:${address.port}/v1`,
              enabled: true,
              requiresApiKey: false,
              enableCors: false,
            },
            "Original system",
            createChatMemory()
          );
          const events = chain.stream("First question", {
            signal: controller.signal,
            maxRetries: 0,
          });
          const iterator = events[Symbol.asyncIterator]();
          let partial = "";
          while (!partial) {
            const event = await iterator.next();
            if (event.done) throw new Error("Stream ended before its first text chunk");
            if (event.value.type === "text_delta") partial += event.value.delta;
          }
          expect(partial).toBe("Partial answer");
          expect(firstEnded).toBe(false);
          controller.abort();
          await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
          await closed.promise;
          expect(firstEnded).toBe(false);
          chain.saveContext("First question", partial);
          let answer = "";
          for await (const event of chain.stream("Continue", {}))
            if (event.type === "text_delta") answer += event.delta;
          expect(answer).toBe("Follow-up answer");
          expect(requests[1].body.messages).toEqual([
            { role: "system", content: "Original system" },
            { role: "user", content: "First question" },
            { role: "assistant", content: "Partial answer" },
            { role: "user", content: "Continue" },
          ]);
          expect(requests.every((request) => !request.headers.authorization)).toBe(true);
        } finally {
          controller.abort();
          Object.assign(window, originalRuntime);
          for (const socket of sockets) socket.destroy();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
          );
        }
      }
    );
  });
});
