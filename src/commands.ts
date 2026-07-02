import type { AppConfig, CodexThreadInfo, CommandResult, Effort, ProjectInfo, SessionState } from "./types.js";
import { findActiveThread, saveState } from "./state.js";
import { assertProjectInsideRoot, findFallbackFolderProject, listFallbackFolderProjects } from "./router.js";
import { runCodexExec } from "./codexExec.js";
import { listCodexProjects, listCodexThreads, sendToCodexThread } from "./codexSource.js";

const efforts = new Set(["low", "medium", "high", "xhigh"]);

export async function handleCommand(config: AppConfig, state: SessionState, text: string): Promise<CommandResult> {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "/help") return { ok: true, text: helpText() };
  if (trimmed === "/status") return status(config, state);
  if (trimmed === "/projects") return projects(config);
  if (trimmed === "/fallback projects") return fallbackProjects(config);
  if (trimmed === "/threads") return threads(config, state);
  if (trimmed.startsWith("/use project ")) return useProject(config, state, trimmed.slice(13).trim());
  if (trimmed.startsWith("/new thread ")) return newThread(state, trimmed.slice(12).trim());
  if (trimmed.startsWith("/use thread ")) return useThread(config, state, trimmed.slice(12).trim());
  if (trimmed.startsWith("/model ")) return setModel(state, trimmed.slice(7).trim());
  if (trimmed.startsWith("/effort ")) return setEffort(state, trimmed.slice(8).trim());
  if (trimmed.startsWith("/ask ")) return ask(config, state, trimmed.slice(5).trim());
  return { ok: false, text: `未知命令：${trimmed}\n\n${helpText()}` };
}

function helpText(): string {
  return [
    "可用命令：",
    "/status                         查看当前连接状态",
    "/projects                       查看 Codex 项目列表",
    "/use project <序号|项目名>       选择项目，例如 /use project 1",
    "/threads                        查看当前项目的会话列表",
    "/use thread <序号|标题>          选择会话，例如 /use thread 1",
    "/new thread <标题>              新开会话（待接 Codex 内部接口）",
    "/ask <内容>                     发给已选择的 Codex 会话",
    "/model <model>                  设置模型记录",
    "/effort <low|medium|high|xhigh> 设置推理强度记录",
  ].join("\n");
}

function status(config: AppConfig, state: SessionState): CommandResult {
  const thread = findActiveThread(state);
  return { ok: true, text: [
    "CodexFeishuBridge 在线",
    `数据源：Codex Desktop 本地状态库${config.codexAppServerUrl ? ` + App Server ${config.codexAppServerUrl}` : ""}`,
    `发送模式：${config.codexSendMode}`, 
    `当前项目：${state.activeProject || "未选择"}`,
    `当前会话：${state.activeThread || "未选择"}`,
    `模型记录：${thread?.model || config.defaultModel}`,
    `推理强度记录：${thread?.effort || config.defaultEffort}`,
    "",
    "下一步：/projects 或 /threads",
  ].join("\n") };
}

async function projects(config: AppConfig): Promise<CommandResult> {
  const codexProjects = await listCodexProjects(config);
  if (codexProjects.available) {
    if (!codexProjects.items.length) return { ok: true, text: "Codex 数据源可用，但没有发现项目。" };
    return { ok: true, text: formatProjects(codexProjects.items) };
  }

  const fallback = listFallbackFolderProjects(config);
  const fallbackText = fallback.length
    ? `\n\n文件夹扫描只是兜底，不代表 Codex 桌面已有项目：\n${formatProjects(fallback)}`
    : "\n\n文件夹兜底也没有发现项目。";
  return { ok: false, text: `${codexProjects.message}${fallbackText}` };
}

function fallbackProjects(config: AppConfig): CommandResult {
  const items = listFallbackFolderProjects(config);
  if (!items.length) return { ok: true, text: "文件夹兜底没有发现项目。" };
  return { ok: true, text: formatProjects(items) };
}

function isGeneratedSessionTitle(title: string | undefined): boolean {
  if (!title) return true;
  return /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(title) || /^019[0-9a-f-]{10,}$/i.test(title);
}

function displayTitle(title: string | undefined): string {
  if (isGeneratedSessionTitle(title)) return "未命名会话";
  const clean = title!.replace(/\s+/g, " ").trim();
  return clean.length > 36 ? `${clean.slice(0, 36)}...` : clean;
}

function formatProjects(items: ProjectInfo[]): string {
  const lines = ["项目列表（按最近使用排序）：", ""];
  for (const [index, item] of items.entries()) {
    lines.push(`${index + 1}. ${item.name}`);
    lines.push(`   最近：${displayTitle(item.latestThreadTitle)}`);
  }
  lines.push("");
  lines.push("选择项目：/use project <序号>，例如 /use project 1");
  return lines.join("\n");
}

async function threads(config: AppConfig, state: SessionState): Promise<CommandResult> {
  if (!state.activeCodexProjectId && !state.activeProject) return { ok: false, text: "请先用 /use project <序号|项目名> 选择 Codex 项目。" };
  const codexThreads = await listCodexThreads(config, state.activeCodexProjectId || state.activeProject);
  if (codexThreads.available) {
    if (!codexThreads.items.length) return { ok: true, text: "当前 Codex 项目没有发现会话。\n\n0. 新开一个会话（发送 /new thread <标题>，待接 Codex 内部接口）" };
    return { ok: true, text: formatThreads(codexThreads.items) };
  }

  const local = state.threads.filter((item) => item.project === state.activeProject);
  const localText = local.length
    ? `\n\n本地旧版会话记录只是兜底，不代表 Codex 桌面真实会话：\n${local.map((item, index) => `${index + 1}. ${item.name} (${item.model}, ${item.effort})`).join("\n")}`
    : "\n\n没有本地兜底会话记录。";
  return { ok: false, text: `${codexThreads.message}${localText}` };
}

function formatThreads(items: CodexThreadInfo[]): string {
  const lines = ["会话列表（按最近使用排序）：", ""];
  for (const [index, item] of items.entries()) {
    lines.push(`${index + 1}. ${displayTitle(item.title)}`);
  }
  lines.push("");
  lines.push("0. 新开一个会话（发送 /new thread <标题>，待接 Codex 内部接口）");
  lines.push("选择会话：/use thread <序号>，例如 /use thread 1");
  return lines.join("\n");
}

function pickByIndex<T>(items: T[], value: string): T | null {
  if (!/^\d+$/.test(value)) return null;
  const index = Number(value) - 1;
  return index >= 0 && index < items.length ? items[index] : null;
}

async function useProject(config: AppConfig, state: SessionState, name: string): Promise<CommandResult> {
  const codexProjects = await listCodexProjects(config);
  if (codexProjects.available) {
    const byIndex = pickByIndex(codexProjects.items, name);
    const project = byIndex || codexProjects.items.find((item) => item.name.toLowerCase() === name.toLowerCase() || item.id.toLowerCase() === name.toLowerCase());
    if (!project) return { ok: false, text: `没有找到项目：${name}\n先发 /projects 查看项目序号。` };
    state.activeProject = project.name;
    state.activeCodexProjectId = project.id;
    state.activeThread = null;
    state.activeCodexThreadId = null;
    saveState(state);
    return { ok: true, text: `已选择项目：${project.name}\n下一步：/threads` };
  }

  const fallback = findFallbackFolderProject(config, name);
  if (!fallback || !fallback.path) return { ok: false, text: `${codexProjects.message}\n\n没有找到同名兜底文件夹项目：${name}` };
  assertProjectInsideRoot(config, fallback.path);
  state.activeProject = fallback.name;
  state.activeCodexProjectId = null;
  const existing = state.threads.find((item) => item.project === fallback.name);
  state.activeThread = existing?.name || null;
  state.activeCodexThreadId = existing?.codexThreadId || null;
  saveState(state);
  return { ok: true, text: `真实 Codex 项目源不可用，已选择文件夹兜底项目：${fallback.name}\n注意：这不是 Codex 桌面 app 里的项目记录。` };
}

function newThread(state: SessionState, name: string): CommandResult {
  if (!state.activeProject) return { ok: false, text: "请先使用 /use project <序号|项目名> 选择项目。" };
  if (!name) return { ok: false, text: "请提供会话标题，例如 /new thread 帮我检查登录问题。" };
  return {
    ok: false,
    text: [
      "新开 Codex 桌面会话目前还没接通。",
      "原因：桥接服务现在只能读取 Codex 桌面的本地数据库，不能直接调用桌面内部的创建会话接口。",
      "后续需要接 Codex Desktop 内部接口后，/new thread 才能真正创建会话。",
    ].join("\n"),
  };
}

async function useThread(config: AppConfig, state: SessionState, name: string): Promise<CommandResult> {
  if (!state.activeProject && !state.activeCodexProjectId) return { ok: false, text: "请先选择 Codex 项目。" };
  const codexThreads = await listCodexThreads(config, state.activeCodexProjectId || state.activeProject);
  if (codexThreads.available) {
    const byIndex = pickByIndex(codexThreads.items, name);
    const thread = byIndex || codexThreads.items.find((item) => item.title.toLowerCase() === name.toLowerCase() || item.id.toLowerCase() === name.toLowerCase());
    if (!thread) return { ok: false, text: `没有找到会话：${name}\n先发 /threads 查看会话序号。` };
    state.activeThread = displayTitle(thread.title);
    state.activeCodexThreadId = thread.id;
    saveState(state);
    return { ok: true, text: `已选择会话：${displayTitle(thread.title)}\n现在可以发：/ask <内容>` };
  }

  const thread = state.threads.find((item) => item.project === state.activeProject && item.name.toLowerCase() === name.toLowerCase());
  if (!thread) return { ok: false, text: `${codexThreads.message}\n\n没有找到本地兜底会话：${name}` };
  state.activeThread = thread.name;
  state.activeCodexThreadId = thread.codexThreadId || null;
  thread.lastUsedAt = new Date().toISOString();
  saveState(state);
  return { ok: true, text: `已切换本地兜底会话：${thread.name}\n注意：这还不是 Codex 桌面 app 里的真实会话。` };
}

function setModel(state: SessionState, model: string): CommandResult {
  const thread = findActiveThread(state);
  if (!thread) return { ok: false, text: "请先选择项目和会话。" };
  thread.model = model;
  thread.lastUsedAt = new Date().toISOString();
  saveState(state);
  return { ok: true, text: `模型记录已设置为：${model}` };
}

function setEffort(state: SessionState, effort: string): CommandResult {
  if (!efforts.has(effort)) return { ok: false, text: "推理强度只能是 low、medium、high、xhigh。" };
  const thread = findActiveThread(state);
  if (!thread) return { ok: false, text: "请先选择项目和会话。" };
  thread.effort = effort as Effort;
  thread.lastUsedAt = new Date().toISOString();
  saveState(state);
  return { ok: true, text: `推理强度记录已设置为：${effort}` };
}

async function ask(config: AppConfig, state: SessionState, prompt: string): Promise<CommandResult> {
  if (state.activeCodexThreadId) {
    const sent = await sendToCodexThread(config, state.activeCodexThreadId, prompt);
    if (sent.available) return { ok: true, text: sent.items[0] || "已发送到 Codex 会话。" };
    return { ok: false, text: sent.message || "Codex 会话发送适配器不可用。" };
  }

  const thread = findActiveThread(state);
  if (!state.activeProject || !thread) return { ok: false, text: "请先选择 Codex 项目和会话。" };
  const fallback = findFallbackFolderProject(config, state.activeProject);
  if (!fallback?.path) return { ok: false, text: "真实 Codex 会话未选择，且没有可用文件夹兜底项目。" };
  assertProjectInsideRoot(config, fallback.path);
  const output = await runCodexExec(config, fallback.path, prompt, thread.model, thread.effort);
  thread.lastUsedAt = new Date().toISOString();
  saveState(state);
  return { ok: true, text: `通过文件夹兜底执行 codex exec，不是继续 Codex 桌面已有会话。\n\n${output}` };
}


