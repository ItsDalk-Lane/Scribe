import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = join(
  dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-ai/providers/all"))),
  "data"
);
const models = [];
for (const file of (await readdir(directory)).sort()) {
  if (!file.endsWith(".json") || file.startsWith(".")) continue;
  const groups = JSON.parse(await readFile(join(directory, file), "utf8"));
  for (const group of Object.values(groups)) {
    for (const model of Object.values(group)) {
      if (model.type !== "chat" || !model.reasoning) continue;
      models.push({
        id: model.id,
        provider: model.provider,
        baseUrl: model.baseUrl,
        api: model.api,
        reasoning: model.reasoning,
        thinkingLevelMap: model.thinkingLevelMap,
        compat: model.compat && {
          supportsReasoningEffort: model.compat.supportsReasoningEffort,
          thinkingFormat: model.compat.thinkingFormat,
          // 保留协议能力，否则新版 Claude 会被错误发送旧式预算参数。https://github.com/ItsDalk-Lane/Scribe/issues/56
          ...(model.api === "anthropic-messages" && {
            forceAdaptiveThinking: model.compat.forceAdaptiveThinking,
            supportsTemperature: model.compat.supportsTemperature,
          }),
        },
      });
    }
  }
}
await writeFile(
  new URL("../src/LLMProviders/nativeSdk/modelThinkingCatalog.json", import.meta.url),
  `${JSON.stringify(models)}\n`
);
