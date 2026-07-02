import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig, Effort } from "./types.js";

function decodeChunk(chunk: Buffer): string {
  return chunk.toString("utf8");
}

function explainCodexFailure(text: string): string {
  if (/Access is denied|拒绝访问/i.test(text) || /�/.test(text)) {
    return [
      "Codex 执行失败：当前 codex.exe 来自 WindowsApps，外部进程没有权限直接启动它。",
      "这不是会话选择问题，而是 Windows 桌面版 Codex CLI 的启动权限问题。",
      "已支持通过 CODEX_BIN 指向项目本地 @openai/codex 的 JS 入口来绕过该限制。",
    ].join("\n");
  }
  return text;
}

function resolveCodexProcess(config: AppConfig, args: string[]): { command: string; args: string[]; shell: boolean } {
  const extension = extname(config.codexBin).toLowerCase();
  if (extension === ".js") {
    return { command: process.execPath, args: [config.codexBin, ...args], shell: false };
  }
  if (process.platform === "win32" && (extension === ".cmd" || extension === ".bat")) {
    return { command: config.codexBin, args, shell: true };
  }
  return { command: config.codexBin, args, shell: false };
}

function addLastMessageOutput(args: string[], outputFile: string): string[] {
  if (args.length === 0) return ["-o", outputFile];
  return [...args.slice(0, -1), "-o", outputFile, args[args.length - 1]];
}

function readAndRemove(path: string): string | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8").trim();
  rmSync(path, { force: true });
  return text || null;
}

function runCodex(config: AppConfig, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve) => {
    const outputFile = join(tmpdir(), `codex-feishu-${randomUUID()}.txt`);
    const argsWithOutput = addLastMessageOutput(args, outputFile);
    const proc = resolveCodexProcess(config, argsWithOutput);
    const child = spawn(proc.command, proc.args, { cwd, shell: proc.shell, windowsHide: true });
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk: Buffer) => { output += decodeChunk(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { error += decodeChunk(chunk); });
    child.on("error", (err) => {
      rmSync(outputFile, { force: true });
      resolve(explainCodexFailure(`Codex 启动失败：${err.message}`));
    });
    child.on("close", (code) => {
      const lastMessage = readAndRemove(outputFile);
      if (code === 0) {
        resolve(lastMessage || output.trim() || "Codex 已完成，但没有输出。");
        return;
      }
      const text = [lastMessage, output.trim(), error.trim()].filter(Boolean).join("\n");
      resolve(explainCodexFailure(`Codex 执行失败，退出码 ${code}\n${text}`));
    });
  });
}

export function runCodexExec(config: AppConfig, cwd: string, prompt: string, model: string, effort: Effort): Promise<string> {
  return runCodex(config, ["exec", "--model", model, "--config", `model_reasoning_effort=${effort}`, prompt], cwd);
}

export function runCodexExecResume(config: AppConfig, sessionId: string, prompt: string, model: string, effort: Effort, cwd?: string): Promise<string> {
  return runCodex(config, ["exec", "resume", sessionId, "--model", model, "--config", `model_reasoning_effort=${effort}`, prompt], cwd);
}
