# GitLab 模型映射来源

`gitlabModelMappings.ts` 完整取自固定版本 `gitlab-ai-provider@6.23.1` 的公开 `MODEL_MAPPINGS`，包含全部 44 个别名与对应协议。该包不再是项目依赖；运行时采用这份相同数据，由 pi-ai 执行模型调用。

来源：https://www.npmjs.com/package/gitlab-ai-provider/v/6.23.1

原授权随附在 `gitlabModelMappings.LICENSE`。迁移前已用固定版本公开包逐项验证该表一致。相邻测试验证 `JSON.stringify(MODEL_MAPPINGS)` 的 SHA-256：

```text
45e619d610476b520be7af8dda882ece256ffc6a2e76db7d58b8fcc9f4b8878d
```

更新时，在独立临时目录安装所选固定版本，读取其公开 `MODEL_MAPPINGS`，逐项核对别名、模型 ID、Provider 和 OpenAI API 类型，再更新映射、版本来源、校验值及对应请求测试。不要将完整推理 SDK 加回生产或测试依赖。

鉴权保持同版本公开客户端的请求与缓存方式：向实例 `/api/v4/ai/third_party_agents/direct_access` 发送 Bearer 用户令牌，取得推理令牌和附加请求头，内存缓存 25 分钟，无磁盘写入。官方 GitLab 同时公开了该端点及代理用法：[直接访问令牌权限](https://docs.gitlab.com/auth/tokens/fine_grained_access_tokens_rest/)、[原始端点说明](https://gitlab.com/gitlab-org/gitlab/-/merge_requests/202453)、[官方代理配置](https://docs.gitlab.com/user/duo_agent_platform/agents/external_examples/)。
