# Windows setup for Agent Chat

Windows 上的 Agent Chat 直接在 Obsidian 桌面版内运行 Scribe 代理，不需要安装外部代理或登录其账户。

隔离测试在 macOS 上发现启动、更改或重置设置、技能刷新、缓存清理和笔记写入存在文件受损风险；Windows 尚未实机验证。请先备份现有文件，再暂时停用 Scribe，直到问题修复；关闭时程序可能完成之前排队的保存。以下步骤应在修复后执行，详见[故障排查](troubleshooting-and-faq.md)。

Isolated macOS tests found file-safety risks during startup, changing or resetting settings, skill refresh, cache cleanup, and note writes; Windows has not been tested for these cases. Back up your files first, then disable Scribe until these issues are fixed; pending saves may finish during shutdown. Follow the steps below after the fixes. See [Troubleshooting](troubleshooting-and-faq.md).

## Set up a model

1. 在 **Settings → Scribe → 快捷操作 → 模型与供应商** 添加供应商或本机模型服务。
2. 填写它需要的密钥、地址和额外信息；也可以手动输入模型 ID。
3. 在 **代理 → Scribe** 启用模型，选择默认模型及权限模式。
4. 打开 Agent Chat，发送任务。

真实系统命令使用 Windows 的运行环境，并遵守 Scribe 权限卡。模型服务、本机命令和附加 Obsidian 插件各自需要在电脑上可用。

## Skills

在 **Settings → Scribe → 技能** 启用 Scribe 技能，输入 `/` 选择允许手动调用的条目。当前版本可能无法自动发现项目目录中的技能。

`obsidian-cli` 技能仍要求在 Obsidian 的 **Settings → General → Command line interface** 开启命令行功能。

更多说明见 [Agent Chat](agent-mode-and-tools.md)、[Models and providers](llm-providers.md)。
