import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { extname } from "node:path";
import type { AppConfig, Effort } from "./types.js";

interface RpcMessage {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

function resolveCodexAppServerProcess(config: AppConfig): { command: string; args: string[]; shell: boolean } {
  const extension = extname(config.codexBin).toLowerCase();
  if (extension === ".js") {
    return { command: process.execPath, args: [config.codexBin, "app-server"], shell: false };
  }
  if (process.platform === "win32" && (extension === ".cmd" || extension === ".bat")) {
    return { command: config.codexBin, args: ["app-server"], shell: true };
  }
  return { command: config.codexBin, args: ["app-server"], shell: false };
}

class CodexAppServerClient {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private deltas: string[] = [];
  private turnThreadId: string | null = null;
  private turnDone: Promise<string>;
  private finishTurn!: (value: string) => void;
  private failTurn!: (error: Error) => void;
  private stderr = "";

  constructor(config: AppConfig) {
    const command = resolveCodexAppServerProcess(config);
    this.proc = spawn(command.command, command.args, { shell: command.shell, windowsHide: true });
    this.turnDone = new Promise((resolve, reject) => {
      this.finishTurn = resolve;
      this.failTurn = reject;
    });

    const rl = createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => this.handleLine(line));
    this.proc.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString("utf8");
      if (this.stderr.length > 8000) this.stderr = this.stderr.slice(-8000);
    });
    this.proc.on("error", (err) => this.failAll(err));
    this.proc.on("close", (code) => {
      if (code !== 0 && this.pending.size) this.failAll(new Error(`app-server exited ${code}: ${this.stderr.trim()}`));
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "codex_feishu_bridge", title: "Codex Feishu Bridge", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized", {});
  }

  async resumeThread(threadId: string, model: string, effort: Effort, cwd?: string): Promise<string> {
    const response = await this.request("thread/resume", {
      threadId,
      model,
      cwd: cwd || null,
      approvalPolicy: "never",
      config: { model_reasoning_effort: effort },
    });
    return response?.thread?.id || threadId;
  }

  async startTurn(threadId: string, prompt: string, model: string, effort: Effort, cwd?: string): Promise<string> {
    this.turnThreadId = threadId;
    this.deltas = [];
    await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      cwd: cwd || null,
      approvalPolicy: "never",
      model,
      effort,
    });
    return this.withTimeout(this.turnDone, 15 * 60 * 1000, "Codex app-server 执行超时。");
  }

  close(): void {
    this.proc.kill();
  }

  private request(method: string, params: any): Promise<any> {
    const id = this.nextId++;
    const message = { method, id, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  private notify(method: string, params: any): void {
    this.proc.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  private handleLine(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || `JSON-RPC error ${message.error.code}`));
      else pending.resolve(message.result);
      return;
    }

    if (message.method === "item/agentMessage/delta" && message.params?.delta) {
      if (!this.turnThreadId || message.params.threadId === this.turnThreadId) this.deltas.push(String(message.params.delta));
      return;
    }

    if (message.method === "turn/completed") {
      if (this.turnThreadId && message.params?.threadId && message.params.threadId !== this.turnThreadId) return;
      const text = this.deltas.join("").trim();
      this.finishTurn(text || "Codex 已完成，但没有输出。");
      return;
    }

    if (message.method === "error") {
      this.failTurn(new Error(message.params?.message || "Codex app-server error"));
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.failTurn(error);
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
}

export async function sendViaCodexAppServer(config: AppConfig, threadId: string, prompt: string, model: string, effort: Effort, cwd?: string): Promise<string> {
  const client = new CodexAppServerClient(config);
  try {
    await client.initialize();
    const resumedThreadId = await client.resumeThread(threadId, model, effort, cwd);
    return await client.startTurn(resumedThreadId, prompt, model, effort, cwd);
  } finally {
    client.close();
  }
}
