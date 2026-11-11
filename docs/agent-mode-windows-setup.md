# Windows setup for Agent Chat

Windows 上的 Agent Chat 直接在 Obsidian 桌面版内运行 Scribe 代理，不需要安装外部代理或登录其账户。

隔离测试在 macOS 上发现启动迁移、更改密钥、编辑技能、缓存清理和笔记写入存在文件受损风险；Windows 尚未实机验证。请先备份现有文件，再暂时停用 Scribe，直到问题修复；关闭时程序可能完成之前排队的保存。以下步骤应在修复后执行，详见[故障排查](troubleshooting-and-faq.md)。

Isolated macOS tests found file-safety risks during startup migrations, credential changes, skill edits, cache cleanup, and note writes; Windows has not been tested for these cases. Back up your files first, then disable Scribe until these issues are fixed; pending saves may finish during shutdown. Follow the steps below after the fixes. See [Troubleshooting](troubleshooting-and-faq.md).

## Set up a model

1. 在 **Settings → Scribe → 模型** 添加供应商或本机模型服务。
2. 填写它需要的密钥、地址和额外信息；也可以手动输入模型 ID。
3. 保存后模型直接可用。在聊天输入框旁选择模型及权限模式；首次采用第一个可运行模型和自动模式，后续记住最近一次成功选择。
4. 打开 Agent Chat，发送任务。

真实系统命令使用 Windows 的运行环境，并遵守 Scribe 权限卡。模型服务、本机命令和附加 Obsidian 插件各自需要在电脑上可用。

## Skills

在 **Settings → Scribe → 技能** 启用 Scribe 技能，输入 `/` 选择允许手动调用的条目。所有项目使用当前库统一管理的技能。

Scribe 附带七个只读内置技能，可启用、停用、卸载和恢复。添加技能有 Agent 创建、系统搜索和本地文件夹／ZIP 导入三种方式；不会自动安装技能需要的其他程序或更改 Obsidian 功能设置。此前保存的技能保留并按“本地”管理。

更多说明见 [Agent Chat](agent-mode-and-tools.md)、[Models and providers](llm-providers.md)。
