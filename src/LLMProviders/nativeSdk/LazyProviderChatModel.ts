import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { NativeSdkCallOptions } from "./NativeSdkChatModel";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";

export class LazyProviderChatModel extends BaseChatModel<NativeSdkCallOptions> {
  constructor(
    private readonly resolveModel: (options: NativeSdkCallOptions) => Promise<BaseChatModel>
  ) {
    super({ maxRetries: 3, maxConcurrency: 3 });
  }

  _llmType(): string {
    return "authenticated-provider";
  }

  async _generate(messages: BaseMessage[], options: NativeSdkCallOptions): Promise<ChatResult> {
    const model = await this.caller.callWithOptions({ signal: options.signal }, () =>
      this.resolveModel(options)
    );
    const message = await model.invoke(messages, options);
    return {
      generations: [{ text: message.text, message }],
    };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: NativeSdkCallOptions,
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    const model = await this.caller.callWithOptions({ signal: options.signal }, () =>
      this.resolveModel(options)
    );
    for await (const message of await model.stream(messages, options)) {
      yield new ChatGenerationChunk({
        text: message.text,
        message,
      });
      if (message.text) await runManager?.handleLLMNewToken(message.text);
    }
  }
}
