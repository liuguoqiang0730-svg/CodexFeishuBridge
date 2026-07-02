export type Effort = "low" | "medium" | "high" | "xhigh";
export type ProjectSource = "codex-local-index" | "codex-app-server" | "fallback-folder" | "manual";
export type CodexSendMode = "auto" | "app-server" | "cli";

export interface AppConfig {
  host: string;
  port: number;
  projectsRoot: string;
  allowedUserIds: string[];
  codexBin: string;
  codexHome: string;
  defaultModel: string;
  defaultEffort: Effort;
  excludeProjectNames: string[];
  codexAppServerUrl: string | null;
  codexSendMode: CodexSendMode;
  feishuAppId: string | null;
  feishuAppSecret: string | null;
  feishuVerificationToken: string | null;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path?: string;
  source: ProjectSource;
  updatedAt?: string;
  latestThreadTitle?: string;
}

export interface CodexThreadInfo {
  id: string;
  title: string;
  projectId?: string;
  projectName?: string;
  cwd?: string;
  source: "codex-local-index" | "codex-app-server";
  lastUsedAt?: string;
}

export interface DiscoveryResult<T> {
  available: boolean;
  items: T[];
  message?: string;
}

export interface ThreadState {
  name: string;
  project: string;
  model: string;
  effort: Effort;
  codexThreadId?: string;
  lastUsedAt: string;
}

export interface SessionState {
  activeProject: string | null;
  activeThread: string | null;
  activeCodexProjectId?: string | null;
  activeCodexThreadId?: string | null;
  threads: ThreadState[];
}

export interface IncomingMessage {
  userId: string;
  text: string;
  source: "local" | "feishu";
  chatId?: string;
  openId?: string;
  messageId?: string;
}

export interface CommandResult {
  ok: boolean;
  text: string;
}


