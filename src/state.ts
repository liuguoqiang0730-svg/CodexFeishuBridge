import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Effort, SessionState, ThreadState } from "./types.js";

const configDir = join(process.cwd(), "config");
const sessionsPath = join(configDir, "sessions.json");

function defaultState(): SessionState {
  return { activeProject: null, activeThread: null, threads: [] };
}

function readJsonFile(path: string): any {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

export function loadState(): SessionState {
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  if (!existsSync(sessionsPath)) {
    const initial = defaultState();
    saveState(initial);
    return initial;
  }
  return readJsonFile(sessionsPath) as SessionState;
}

export function saveState(state: SessionState): void {
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(sessionsPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function findActiveThread(state: SessionState): ThreadState | null {
  if (!state.activeProject || !state.activeThread) return null;
  return state.threads.find((item) => item.project === state.activeProject && item.name === state.activeThread) || null;
}

export function ensureThread(state: SessionState, project: string, name: string, model: string, effort: Effort): ThreadState {
  let thread = state.threads.find((item) => item.project === project && item.name === name);
  if (!thread) {
    thread = { name, project, model, effort, lastUsedAt: new Date().toISOString() };
    state.threads.push(thread);
  }
  state.activeProject = project;
  state.activeThread = name;
  thread.lastUsedAt = new Date().toISOString();
  saveState(state);
  return thread;
}
