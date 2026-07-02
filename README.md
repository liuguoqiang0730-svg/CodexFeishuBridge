# Codex Feishu Bridge

通过飞书机器人把消息转发到本机 Codex，用于在手机或其他飞书客户端远程选择 Codex 项目、选择会话、发送任务并接收结果。

这个项目的目标是：只消耗 Codex/OpenAI 额度，不额外接入另一个 AI 中转服务。

## 当前能力

- 在飞书里查看本机 Codex 项目：`/projects`
- 选择项目：`/use project <序号|项目名>`
- 查看项目下的会话：`/threads`
- 选择会话：`/use thread <序号|标题>`
- 发送消息到 Codex：`/ask <内容>`
- 查看状态：`/status`
- 设置默认模型记录：`/model <model>`
- 设置默认推理强度：`/effort <low|medium|high|xhigh>`

## 重要限制

`/ask` 当前能让 Codex 执行并把结果回到飞书，但不保证 Codex Desktop 当前打开的聊天窗口实时刷新。

原因是 Codex Desktop 的实时 UI 通道没有公开给普通外部进程直接复用。项目现在采用：

1. 优先通过本地 `@openai/codex` 的 `app-server` 协议发送。
2. 失败时可回退到 `codex exec resume`。

如果你只需要飞书远程下发任务并收到结果，这已经可用。如果你强要求桌面 UI 同步显示，需要另做 Windows UI 自动化或使用 Codex 官方远程控制能力。

## 安装

要求：

- Windows
- Node.js 20+
- 已安装并登录 Codex Desktop 或 Codex CLI
- 一个飞书企业自建应用

```powershell
npm install
copy .env.example .env
npm run build
```

编辑 `.env`，至少填写：

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_ALLOWED_USER_IDS=local-dev
```

启动飞书长连接机器人：

```powershell
npm run feishu
```

本地 HTTP 调试模式：

```powershell
npm run start
```

然后测试：

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8787/local/message -ContentType 'application/json' -Body '{"userId":"local-dev","text":"/status"}'
```

## 飞书机器人创建流程

### 1. 创建企业自建应用

1. 打开飞书开放平台。
2. 进入开发者后台。
3. 创建企业自建应用。
4. 应用名称可以用：`Codex 编码桥`。
5. 应用描述可以用：`通过飞书消息转发到本机 Codex，用于选择项目和会话、发送任务与接收执行结果。`
6. 应用图标建议使用机器人、终端、代码、桥接类图标。

### 2. 添加机器人能力

在应用能力里添加“机器人”。发布后，把机器人拉进你要使用的单聊或群聊。

### 3. 配置事件订阅

推荐使用长连接模式，不需要公网 HTTPS 回调。

路径大致是：

```text
开发者后台 -> 事件与回调 -> 订阅方式 -> 使用长连接接收事件/回调
```

然后添加事件，至少需要接收用户发给机器人的消息。不同飞书后台版本名称会略有变化，通常是：

- 接收消息
- 机器人被用户或群聊 @ 的消息
- 群聊中用户 @ 当前机器人的消息

### 4. 开通权限

至少需要：

- 接收单聊、群组消息：`im:message:readonly`
- 获取群组中 @ 机器人的消息：`im:message.group_at_msg:readonly`
- 获取群组中其他机器人和用户 @ 当前机器人的消息：`im:message.group_at_msg.include_bot:readonly`
- 以应用身份发送消息：`im:message:send_as_bot`

如果飞书后台提示“免审权限”，直接开通即可。如果提示需要发布后生效，需要走“版本管理与发布”。

### 5. 发布应用

进入：

```text
版本管理与发布 -> 创建版本 -> 发布
```

如果是企业内部应用，通常提交发布后即可在企业内使用，具体取决于企业管理员审核规则。

### 6. 填写 .env

在“凭证与基础信息”里找到：

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
```

第一次启动时，可以先保留：

```env
FEISHU_ALLOWED_USER_IDS=local-dev
```

然后在飞书里给机器人发：

```text
/status
```

如果用户未授权，机器人会返回检测到的 `userId/openId/chatId`。把其中一个填进：

```env
FEISHU_ALLOWED_USER_IDS=ou_xxx
```

多个 ID 用英文逗号分隔。

### 7. 重启服务

```powershell
npm run build
npm run feishu
```

## 常用命令

```text
/status
/projects
/use project 1
/threads
/use thread 1
/ask 帮我检查当前项目的问题
/model gpt-5.5
/effort medium
```

`/ask` 正常情况下不会先回复“已收到”。它只返回 Codex 的最终回复。如果 1 分钟内没有拿到结果，会返回超时错误。可以用 `.env` 调整：

```env
FEISHU_ASK_TIMEOUT_MS=60000
```

## 配置项

见 `.env.example`。

关键配置：

- `FEISHU_APP_ID`：飞书应用 App ID
- `FEISHU_APP_SECRET`：飞书应用 App Secret
- `FEISHU_ALLOWED_USER_IDS`：允许使用机器人的用户 ID、open ID 或 chat ID
- `CODEX_HOME`：Codex 本地配置和会话目录，默认是 `C:\Users\<you>\.codex`
- `CODEX_BIN`：Codex CLI 入口，推荐指向项目本地 `node_modules\@openai\codex\bin\codex.js`
- `CODEX_SEND_MODE`：`auto`、`app-server` 或 `cli`
- `DEFAULT_MODEL`：默认模型
- `DEFAULT_EFFORT`：默认推理强度
- `FEISHU_ASK_TIMEOUT_MS`：飞书等待 Codex 回复的超时时间

## 开源前检查

不要提交：

- `.env`
- `node_modules/`
- `dist/`
- `.tmp-schemas/`
- `config/sessions.json`
- 任何 Codex 账号、飞书密钥、用户私有路径、会话数据库或日志

建议开源时保留：

- `src/`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `.env.example`
- `.gitignore`
- `README.md`

## 能不能帮用户创建飞书机器人？

可以做“半自动向导”，但不能替用户保存或收集密钥。

合理做法：

1. 用户自己在飞书开放平台创建企业自建应用。
2. 用户复制 `App ID` 和 `App Secret` 到本机 `.env`。
3. 本项目提供检查命令，验证权限、长连接、授权用户是否配置正确。

不建议提供托管服务代管用户的飞书密钥和 Codex 凭据。这个项目更适合本机自托管。
