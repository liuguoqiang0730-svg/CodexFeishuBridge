import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppConfig, CodexSendMode, Effort } from "./types.js";

function loadDotEnv(root: string): void {
  const path = join(root, ".env");
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function env(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function splitCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function readJsonFile(path: string): any {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function sendMode(value: string): CodexSendMode {
  return value === "app-server" || value === "cli" ? value : "auto";
}

export function loadConfig(): AppConfig {
  const root = process.cwd();
  loadDotEnv(root);

  const exampleConfigPath = join(root, "config", "projects.example.json");
  let excludeProjectNames = ["CodexFeishuBridge"];
  if (existsSync(exampleConfigPath)) {
    const parsed = readJsonFile(exampleConfigPath);
    excludeProjectNames = parsed.excludeProjectNames || excludeProjectNames;
  }

  return {
    host: env("HOST", "127.0.0.1"),
    port: Number(env("PORT", "8787")),
    projectsRoot: env("CODEX_PROJECTS_ROOT", "E:\\Codex-AI-Coding"),
    allowedUserIds: splitCsv(env("FEISHU_ALLOWED_USER_IDS", "local-dev")),
    codexBin: env("CODEX_BIN", "codex"),
    codexHome: env("CODEX_HOME", join(homedir(), ".codex")),
    defaultModel: env("DEFAULT_MODEL", "gpt-5.5"),
    defaultEffort: env("DEFAULT_EFFORT", "medium") as Effort,
    excludeProjectNames,
    codexAppServerUrl: optionalEnv("CODEX_APP_SERVER_URL"),
    codexSendMode: sendMode(env("CODEX_SEND_MODE", "auto")),
    feishuAppId: optionalEnv("FEISHU_APP_ID"),
    feishuAppSecret: optionalEnv("FEISHU_APP_SECRET"),
    feishuVerificationToken: optionalEnv("FEISHU_VERIFICATION_TOKEN"),
  };
}



