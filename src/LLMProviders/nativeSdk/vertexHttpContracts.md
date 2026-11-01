# Vertex 移动端授权

服务账号授权采用 Google 官方 RS256 JWT 流程：签名包含固定的 Google OAuth 接收地址、服务账号邮箱、Cloud Platform 权限范围和一小时有效期，再以表单换取访问令牌。仅使用明确需要的邮箱、私钥及可选密钥标识，不采用凭据 JSON 中的任意 `token_uri`。[Google 官方协议](https://developers.google.com/identity/protocols/oauth2/service-account)

相邻测试生成真实 RSA 密钥并验证签名；通过注入的连接方式检查 OAuth 地址、授权表单、取消信号、缓存、过期刷新和失败后的重新尝试。工厂测试进一步确认手机环境中的 OAuth 与模型请求均经过统一连接，并忽略伪造的凭据地址。没有真实访问模型服务。
