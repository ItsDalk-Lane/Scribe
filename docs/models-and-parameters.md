# Models, Effort, and Permissions

Scribe 的 Agent Chat、Quick Ask 和 Quick Command 使用同一套自备模型连接。你可以使用云端供应商、兼容服务或本机模型；模型服务决定访问权限、费用和实际能力。

## Where models come from

在 **Settings → Scribe → 快捷操作 → 模型** 添加供应商，填写密钥及地址，然后选择或手动输入模型。目录中没有能力标签的手动模型仍可加入 Agent Chat。

Agent Chat 不再使用外部代理的账号、模型列表或订阅额度。Anthropic 和其他供应商一样，通过已有自备模型设置接入。

## Enable models and choose defaults

- **代理 → Scribe** 控制 Agent Chat 可见模型及默认选择。
- **快捷操作 → 工具配置** 控制 Quick Ask、Quick Command 可见模型及默认快捷命令模型。
- 两个使用位置可以分别启用模型，共用原来的供应商、密钥、自定义地址和连接方式。

## Choose a model while chatting

输入框旁的模型和推理强度选择应用于当前聊天。模型支持时才显示相应强度；未明确指定时沿用已保存的模型配置或供应商默认值。 **Default** 保留模型原来的思考设置；**Off** 是明确关闭，只有模型报告支持时才提供。切换后从下一次请求生效，重新选择 **Default** 即恢复原来的默认行为。

更高推理强度可能增加耗时和用量。工具调用也由所选模型执行；端点拒绝工具或无法继续时，会保留模型、连接方式和失败阶段的错误信息。

## Model, effort, and permissions

| 使用位置        | 可调整的内容                                           |
| --------------- | ------------------------------------------------------ |
| **Agent Chat**  | 模型、支持的推理强度、Default / Plan / Auto 权限模式。 |
| **Quick tools** | 已启用的模型；保持原来的快捷提问和编辑交互。           |

**Default** 在编辑和命令执行前请求批准。**Plan** 等待计划决策后再执行受控操作。**Auto** 自动允许资料库内的笔记及绘图编辑，系统命令仍请求批准。具体授权选择以权限卡实际显示的内容为准。

## Related

- [Model Sources and BYOK](llm-providers.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Settings: General](settings.md#general)
