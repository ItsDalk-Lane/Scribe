# SAP AI Core 直接连接契约

2026-10-31 对照 SAP 官方文档核查。直接连接替代此前 SDK 的相同调用流程，减少插件携带的证书库、日志系统和云环境发现依赖。

- 登录：服务密钥的 `url` 后加 `/oauth/token`，发送表单 `grant_type=client_credentials`、`client_id`、`client_secret`，使用返回的 `access_token` 和 `expires_in`，到期前刷新。[使用服务密钥](https://help.sap.com/docs/ai-core/ai-core/use-service-key)、[获取令牌](https://help.sap.com/docs/AI_CORE/b9f48eb4a993445b863a55dd4d38f64d/0808d423946141bca151356d995939f5.html?locale=en-US)
- 部署发现：使用服务密钥的 `AI_API_URL`，调用 `/v2/lm/deployments`，限定运行中的 orchestration 部署，保留 `Authorization: Bearer` 与 `AI-Resource-Group`。[获取部署地址](https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/get-your-orchestration-deployment-url)
- 普通请求：部署的 `/v2/completion` 接收 `config.modules.prompt_templating`，其中包括 `model.name`、模型参数和消息模板；回复在 `final_result.choices[0].message.content`。明确的长度设置使用官方教程展示的 `max_completion_tokens`。[最小请求](https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/minimal-call-663f1b7795bf4472a436e4b865321498)、[官方 V2 教程](https://developers.sap.com/tutorials/ai-core-orchestration-consumption-v2)
- 逐步回复：启用 `config.stream.enabled`；服务返回 SSE，文字位于 `final_result.choices[0].delta.content`，使用量位于 `final_result.usage`。正常完成必须出现 `[DONE]`；错误包位于 `error`，不能把错误或意外断开当成功。[官方流格式](https://help.sap.com/docs/AI_CORE/2d6c5984063c40a59eda62f4a9135bee/streaming)
- 思考文字：保留 `reasoning_content` 各块的 `content`；不会将加密块改写成可见内容。[官方 V2 示例](https://sap.github.io/ai-sdk/docs/python/examples/orchestration-service2)
- 用户消息中的模板语法通过官方 `placeholder_values` 原样传入；不会插入不可见字符或改写用户文字。[官方内联配置示例](https://help.sap.com/docs/sap-ai-core/generative-ai/use-orchestration-config-in-llm-orchestration)

相邻测试保留原 SDK 验证时的输入和输出样本，并独立检查真实请求地址、认证、资源组、原文、逐步输出、凭据复用、到期刷新和错误。测试不调用用户模型。
