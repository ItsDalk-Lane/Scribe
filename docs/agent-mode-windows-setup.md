# Windows setup for Agent Chat

Windows 上的 Agent Chat 直接在 Obsidian 桌面版内运行 Scribe 代理，不需要安装外部代理或登录其账户。

## Set up a model

1. 在 **Settings → Scribe → 快捷操作 → 模型** 添加供应商或本地模型服务。
2. 填写它需要的密钥、地址和额外信息；也可以手动输入模型 ID。
3. 在 **代理 → Scribe** 启用模型，选择默认模型及权限模式。
4. 打开 Agent Chat，发送任务。

真实系统命令使用 Windows 的运行环境，并遵守 Scribe 权限卡。模型服务、本机命令和附加 Obsidian 插件各自需要在电脑上可用。

## Skills

在 **Settings → Scribe → 技能** 启用 Scribe 技能，输入 `/` 选择允许手动调用的条目。项目技能只在对应项目的聊天中出现。

`obsidian-cli` 技能仍要求在 Obsidian 的 **Settings → General → Command line interface** 开启命令行功能。

更多说明见 [Agent Chat](agent-mode-and-tools.md)、[Model Sources and BYOK](llm-providers.md)。
