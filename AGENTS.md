# AGENTS.md

默认使用中文与用户沟通。

本项目是 CodexFeishuBridge：飞书自建机器人到本机 Codex 的消息桥。飞书只做消息转发，不使用小龙虾或其他模型；实际任务由本机 Codex 执行。

关键产品语义：
- 飞书里选择的“项目 / 对话”必须优先来自当前 Codex 桌面 app 已有项目和已有对话。
- `E:\Codex-AI-Coding` 只是用户归纳项目的总目录，不是 Codex 项目/会话的真源。
- 文件夹扫描只能作为 fallback/debug，不能在 UI 文案里伪装成 Codex 项目。

开发约束：
- 保持项目与 `E:\Codex-AI-Coding` 下其他项目隔离。
- 不要实现任意 shell 直通。
- 默认只允许白名单飞书用户。
- `/ask` 最终目标是继续真实 Codex 对话；`codex exec` 只能是兜底。
- 涉及 token、secret、session 的内容不得写入日志或提交到仓库。
- 代码修改前先说明理解和方案，得到确认后再改。
