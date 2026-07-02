import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import type { AppConfig, CodexThreadInfo, DiscoveryResult, ProjectInfo } from "./types.js";
import { runCodexExecResume } from "./codexExec.js";
import { sendViaCodexAppServer } from "./codexAppServer.js";

interface IndexedThread {
  id: string;
  title: string;
  updatedAt?: string;
  cwd?: string;
}

function readFirstLine(path: string): string | null {
  const content = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const index = content.indexOf("\n");
  return index === -1 ? content : content.slice(0, index);
}

function safeJson(line: string): any | null {
  try {
    return JSON.parse(line.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function walkJsonlFiles(root: string, maxFiles = 3000): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop()!;
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) stack.push(full);
      else if (name.endsWith(".jsonl")) out.push(full);
      if (out.length >= maxFiles) break;
    }
  }
  return out;
}

function normalizeCwd(cwd: string): string {
  return cwd.replace(/^\\\\\?\\/, "");
}

function normalizeTitle(title: string): string {
  return title.replace(/\r?\n[\s\S]*$/, "").trim() || title.trim();
}

function sameCwd(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  return normalizeCwd(a).toLowerCase() === normalizeCwd(b).toLowerCase();
}

function projectIdForCwd(cwd: string): string {
  const normalized = normalizeCwd(cwd);
  const digest = createHash("sha1").update(normalized.toLowerCase()).digest("hex").slice(0, 12);
  return `codex-local:${digest}`;
}

function projectNameForCwd(cwd: string): string {
  const normalized = normalizeCwd(cwd);
  return basename(normalized) || normalized;
}

function sqliteQuery<T>(dbPath: string, sql: string): T[] | null {
  if (!existsSync(dbPath)) return null;
  const result = spawnSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return null;
  const text = result.stdout.trim();
  if (!text) return [];
  try {
    return JSON.parse(text) as T[];
  } catch {
    return null;
  }
}

function loadVisibleDesktopThreads(config: AppConfig): IndexedThread[] | null {
  const dbPath = join(config.codexHome, "state_5.sqlite");
  const rows = sqliteQuery<{ id: string; title: string; cwd: string; recency_at_ms: number }>(
    dbPath,
    "select id, title, cwd, recency_at_ms from threads where archived=0 and preview<>'' order by recency_at_ms desc, id desc"
  );
  if (!rows) return null;
  return rows.map((row) => ({
    id: row.id,
    title: normalizeTitle(row.title || row.id),
    cwd: normalizeCwd(row.cwd),
    updatedAt: new Date(Number(row.recency_at_ms)).toISOString(),
  }));
}

function loadCatalogThreads(config: AppConfig): IndexedThread[] | null {
  const dbPath = join(config.codexHome, "sqlite", "codex-dev.db");
  const rows = sqliteQuery<{ thread_id: string; display_title: string; cwd: string; source_updated_at: number }>(
    dbPath,
    "select thread_id, display_title, cwd, source_updated_at from local_thread_catalog where host_id='local' and missing_candidate=0 order by source_updated_at desc"
  );
  if (!rows) return null;
  return rows.map((row) => ({
    id: row.thread_id,
    title: normalizeTitle(row.display_title || row.thread_id),
    cwd: normalizeCwd(row.cwd),
    updatedAt: new Date(Number(row.source_updated_at) * 1000).toISOString(),
  }));
}

function loadIndex(config: AppConfig): Map<string, IndexedThread> {
  const indexPath = join(config.codexHome, "session_index.jsonl");
  const map = new Map<string, IndexedThread>();
  if (!existsSync(indexPath)) return map;
  const lines = readFileSync(indexPath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const item = safeJson(line);
    if (!item?.id) continue;
    map.set(item.id, {
      id: item.id,
      title: normalizeTitle(item.thread_name || item.id),
      updatedAt: item.updated_at,
    });
  }
  return map;
}

function enrichFromSessionFiles(config: AppConfig, index: Map<string, IndexedThread>): IndexedThread[] {
  const sessionsRoot = join(config.codexHome, "sessions");
  const files = walkJsonlFiles(sessionsRoot);
  for (const file of files) {
    const first = readFirstLine(file);
    if (!first) continue;
    const event = safeJson(first);
    if (event?.type !== "session_meta") continue;
    const payload = event.payload || {};
    const id = payload.id || payload.session_id;
    if (!id) continue;
    const existing: IndexedThread = index.get(id) || { id, title: id };
    existing.cwd = payload.cwd ? normalizeCwd(payload.cwd) : existing.cwd;
    existing.updatedAt = existing.updatedAt || payload.timestamp || event.timestamp;
    index.set(id, existing);
  }
  return [...index.values()].filter((item) => item.cwd);
}

function loadHistoricalThreads(config: AppConfig): IndexedThread[] {
  const index = loadIndex(config);
  return enrichFromSessionFiles(config, index)
    .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
}

function loadProjectSourceThreads(config: AppConfig): IndexedThread[] {
  const visibleDesktop = loadVisibleDesktopThreads(config);
  if (visibleDesktop && visibleDesktop.length) return visibleDesktop;
  const catalog = loadCatalogThreads(config);
  if (catalog && catalog.length) return catalog;
  return loadHistoricalThreads(config);
}

function loadThreadsForProject(config: AppConfig, projectId: string | null): IndexedThread[] {
  const projectThreads = loadProjectSourceThreads(config);
  const selectedProject = projectId
    ? projectThreads.find((thread) => thread.cwd && (projectIdForCwd(thread.cwd) === projectId || sameCwd(thread.cwd, projectId)))
    : null;
  const selectedCwd = selectedProject?.cwd || projectId;

  const catalog = loadCatalogThreads(config) || [];
  const catalogForProject = selectedCwd ? catalog.filter((thread) => sameCwd(thread.cwd, selectedCwd)) : catalog;
  if (catalogForProject.length) return catalogForProject;

  const visibleDesktop = loadVisibleDesktopThreads(config) || [];
  const visibleForProject = selectedCwd ? visibleDesktop.filter((thread) => sameCwd(thread.cwd, selectedCwd)) : visibleDesktop;
  if (visibleForProject.length) return visibleForProject;

  const history = loadHistoricalThreads(config);
  return selectedCwd ? history.filter((thread) => sameCwd(thread.cwd, selectedCwd)) : history;
}

export async function listCodexProjects(config: AppConfig): Promise<DiscoveryResult<ProjectInfo>> {
  const threads = loadProjectSourceThreads(config);
  if (!threads.length) {
    return {
      available: false,
      items: [],
      message: `没有从 ${config.codexHome} 的本地 Codex 会话目录发现项目。`,
    };
  }

  const byProject = new Map<string, ProjectInfo>();
  for (const thread of threads) {
    if (!thread.cwd) continue;
    const id = projectIdForCwd(thread.cwd);
    const existing = byProject.get(id);
    if (!existing || Date.parse(thread.updatedAt || "") > Date.parse(existing.updatedAt || "")) {
      byProject.set(id, {
        id,
        name: projectNameForCwd(thread.cwd),
        path: normalizeCwd(thread.cwd),
        source: "codex-local-index",
        updatedAt: thread.updatedAt,
        latestThreadTitle: thread.title,
      });
    }
  }

  return { available: true, items: [...byProject.values()].sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || "")) };
}

export async function listCodexThreads(config: AppConfig, projectId: string | null): Promise<DiscoveryResult<CodexThreadInfo>> {
  const threads = loadThreadsForProject(config, projectId);
  if (!threads.length) {
    return { available: false, items: [], message: `没有从 ${config.codexHome} 的本地 Codex 会话目录发现会话。` };
  }

  const items = threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
    projectId: thread.cwd ? projectIdForCwd(thread.cwd) : undefined,
    projectName: thread.cwd ? projectNameForCwd(thread.cwd) : undefined,
    cwd: thread.cwd ? normalizeCwd(thread.cwd) : undefined,
    source: "codex-local-index" as const,
    lastUsedAt: thread.updatedAt,
  }));

  return { available: true, items };
}

export async function sendToCodexThread(config: AppConfig, threadId: string, prompt: string): Promise<DiscoveryResult<string>> {
  const threads = await listCodexThreads(config, null);
  const thread = threads.items.find((item) => item.id === threadId);

  if (config.codexSendMode === "app-server" || config.codexSendMode === "auto") {
    try {
      const output = await sendViaCodexAppServer(config, threadId, prompt, config.defaultModel, config.defaultEffort, thread?.cwd);
      return { available: true, items: [output] };
    } catch (err) {
      if (config.codexSendMode === "app-server") {
        return { available: false, items: [], message: `Codex app-server 发送失败：${err instanceof Error ? err.message : String(err)}` };
      }
      const fallback = await runCodexExecResume(config, threadId, prompt, config.defaultModel, config.defaultEffort, thread?.cwd);
      return { available: true, items: [`${fallback}\n\n（提示：app-server 同步模式失败，已自动回退 CLI。原因：${err instanceof Error ? err.message : String(err)}）`] };
    }
  }

  const output = await runCodexExecResume(config, threadId, prompt, config.defaultModel, config.defaultEffort, thread?.cwd);
  return { available: true, items: [output] };
}


