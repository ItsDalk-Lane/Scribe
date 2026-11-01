# Models, Effort, and Permissions

Scribe keeps a separate model list for each experience. A model can be
available in Scribe without appearing in every picker: you choose where it is
enabled, then choose the default for new Agent chats or quick-tool runs.

## Where models come from

| Model source                    | Where you can use it |
| ------------------------------- | -------------------- |
| Your API key or endpoint (BYOK) | **Quick tools**      |
| Models reported by Claude Code  | **Claude** only      |

The available lineups can change, so the lists in Scribe are the source of
truth. See [Model Sources and BYOK](llm-providers.md) to add a provider or connect an agent account.

## Enable models and choose defaults

Open **Settings → Scribe → 代理**.

1. Claude is the only agent used for new Agent Chats.
2. Select **Claude** or **Quick tools**.
3. Turn on the models you want shown in that experience's model picker.
4. For an agent, choose **Default model**; **Agent default** leaves the choice
   to that agent. For **Quick tools**, choose **Default quick command model**,
   shared by Quick Ask, Quick Command, and saved commands set to **Default model**.
5. If the selected agent model supports it, choose **Default effort**. The
   available effort levels come from the agent and model, so they vary.

The two lists are independent:

- **Claude** shows only models reported by Claude Code.
  Its account owns access and billing; BYOK models are not added to this list.
- **Quick tools models** contains BYOK chat models. Agent-owned
  models do not appear here.

New BYOK chat models start enabled for Quick tools. Models newly reported by Claude may appear switched off until you enable them.

BYOK model choices follow the provider catalog; a custom
endpoint with no published levels uses low, medium, and high when its model is
marked as reasoning-capable.

## Choose a model while chatting

In **Agent Chat**, the model picker shows the Claude models you have enabled.

A model or effort picked beside the message box applies to that chat; it does
not replace the saved **Default model** or **Default effort**. Saved agent
defaults are used for new chats. Changes to an explicit
default apply to open chats on their next turn; choosing **Agent default**
leaves open chats unchanged.

Quick Ask and Quick Command show enabled **Quick tools models**. Each run starts
with **Default quick command model**. Changing a popup's model affects only that
run; change the saved default under **快捷操作 → 工具配置** or **Command**.

## Model, effort, and permissions

| Experience      | Choices available now                                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Claude**      | Model; effort when supported; **Default**, **Plan**, and **Auto** permissions. **Auto mode permissions** controls what Auto may approve. **Show extended thinking** controls whether reasoning blocks are displayed; it is separate from effort. |
| **Quick tools** | Model only. Agent effort and permission controls do not apply.                                                                                                                                                                                   |

**Default** uses the agent's normal approval behavior, **Plan** prepares a plan
before editing, and **Auto** uses the selected agent's automatic permission
behavior.

Scribe V4 does not expose temperature, top-p, or similar tuning in these model
lists. Quick tools provide model selection without agent effort or permission controls.

## Related

- [Model Sources and BYOK](llm-providers.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Settings: General](settings.md#general)
