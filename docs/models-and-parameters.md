# Models, Effort, and Permissions

Scribe 的 Agent Chat、Quick Ask 和 Quick Command 使用同一套模型连接。你可以使用云端供应商、兼容服务或本机模型；模型服务决定访问权限、费用和实际能力。

隔离测试发现，更改 Scribe 设置可能触发内置技能刷新；如果技能缺少文件，已修改和新增的文件可能丢失。请先备份现有文件，再暂时停用 Scribe，直到问题修复；关闭时程序可能完成之前排队的保存。以下设置步骤应在修复后执行，详见[故障排查](troubleshooting-and-faq.md)。

Isolated tests found that changing Scribe settings can refresh built-in skills; if a skill is missing a file, edited or added files may be lost. Back up your files first, then disable Scribe until this is fixed; pending saves may finish during shutdown. Follow the setup steps below after the fixes. See [Troubleshooting](troubleshooting-and-faq.md).

## Where models come from

在 **Settings → Scribe → 快捷操作 → 模型与供应商** 添加供应商，按需要填写密钥及地址，然后选择或手动输入模型。目录中没有能力标签的手动模型仍可加入 Agent Chat。

Agent Chat 不再使用外部代理的账号、模型列表或订阅额度。Anthropic 和其他供应商一样，通过模型与供应商设置接入。

## Enable models and choose defaults

- **代理 → Scribe** 控制 Agent Chat 可见模型及默认选择。
- **快捷操作 → 工具配置** 控制 Quick Ask、Quick Command 可见模型及**快捷指令默认模型**。
- 两个使用位置可以分别启用模型，共用原来的供应商、密钥、自定义地址和连接方式。

隔离测试发现，即使代理模型全部停用，状态仍可能显示就绪；本机缺少设置所引用的密钥时，也可能显示可用但启动失败。请在上述文件安全问题修复后，分别检查代理模型开关及供应商密钥；测试未使用真实桌面或设备密钥。

Isolated tests found that the agent can appear ready with all its models disabled, or appear available but fail to start when its saved key reference has no key on this device. After the file-safety issues above are fixed, check the agent's model switches and provider key separately. The tests did not use a real desktop or device credentials.

## Choose a model while chatting

输入框旁的模型和推理强度选择应用于当前聊天。模型支持时才显示相应强度；未明确指定时沿用已保存的模型配置或供应商默认值。 **Default** 保留模型原来的思考设置；**Off** 是明确关闭，只有模型报告支持时才提供。切换后从下一次请求生效，重新选择 **Default** 即恢复原来的默认行为。

更高推理强度可能增加耗时和用量。模型可以提出工具调用；Scribe 根据权限决定是否允许并执行工具。端点拒绝工具或无法继续时，会保留模型、连接方式和失败阶段的错误信息。

## Model, effort, and permissions

| 使用位置        | 可调整的内容                                           |
| --------------- | ------------------------------------------------------ |
| **Agent Chat**  | 模型、支持的推理强度、Default / Plan / Auto 权限模式。 |
| **Quick tools** | 已启用的模型；保持原来的快捷提问和编辑交互。           |

**Default** 下，编辑和执行命令通常需要批准。保持 **Plan** 时，编辑和命令执行会被阻止；批准计划会让当前聊天切回 **Default**，你也可以手动切换模式。**Auto** 通常自动允许资料库内的普通笔记和绘图编辑，但不自动放行资料库配置目录中的编辑或系统命令。编辑和命令可在当前聊天中保存对相同操作的允许或拒绝；已保存的决定先于 Auto 规则生效，所以权限卡不一定每次出现。具体选项以卡片显示为准。

在聊天中手动切换权限模式，也会更新之后打开聊天时使用的默认模式；批准计划后的自动切换只改变当前聊天，不更改已保存的默认值。

## Related

- [Models and providers](llm-providers.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Settings: Common](settings.md#通用)
