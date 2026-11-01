# GitLab 模型映射来源

`gitlabModelMappings.ts` 完整取自固定版本 `gitlab-ai-provider@6.23.1` 的公开 `MODEL_MAPPINGS`，包含全部 44 个别名与对应协议。该包仅在开发和测试时使用；运行时采用这份相同数据，避免同时携带未使用的推理客户端。

来源：https://www.npmjs.com/package/gitlab-ai-provider/v/6.23.1

原授权随附在 `gitlabModelMappings.LICENSE`。更新开发依赖版本时，使用以下命令同步生成，随后运行相邻测试验证一致性：

```sh
node -e 'const fs=require("node:fs");fs.writeFileSync("src/LLMProviders/nativeSdk/gitlabModelMappings.ts","export const gitlabModelMappings = "+JSON.stringify(require("gitlab-ai-provider").MODEL_MAPPINGS,null,2)+" as const;\n")'
```

鉴权保持同版本公开客户端的请求与缓存方式：向实例 `/api/v4/ai/third_party_agents/direct_access` 发送 Bearer 用户令牌，取得推理令牌和附加请求头，内存缓存 25 分钟，无磁盘写入。官方 GitLab 同时公开了该端点及代理用法：[直接访问令牌权限](https://docs.gitlab.com/auth/tokens/fine_grained_access_tokens_rest/)、[原始端点说明](https://gitlab.com/gitlab-org/gitlab/-/merge_requests/202453)、[官方代理配置](https://docs.gitlab.com/user/duo_agent_platform/agents/external_examples/)。
