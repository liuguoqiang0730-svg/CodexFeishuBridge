import { createLarkChannel, LoggerLevel, type NormalizedMessage } from "@larksuiteoapi/node-sdk";
import { config, dispatch } from "./dispatcher.js";
import type { IncomingMessage } from "./types.js";

const ASK_TIMEOUT_MS = Number(process.env.FEISHU_ASK_TIMEOUT_MS || 60 * 1000);

function requireFeishuConfig(): { appId: string; appSecret: string } {
  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error("请先在 .env 中配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET。 ");
  }
  return { appId: config.feishuAppId, appSecret: config.feishuAppSecret };
}

function toIncomingMessage(msg: NormalizedMessage): IncomingMessage {
  return {
    userId: msg.senderId,
    openId: msg.senderId,
    chatId: msg.chatId,
    messageId: msg.messageId,
    text: msg.content.trim(),
    source: "feishu",
  };
}

function shouldRunSilently(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("/ask ") || trimmed.startsWith("/ask-ui ");
}

async function withTimeout<T>(task: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
}

async function safeSend(channel: ReturnType<typeof createLarkChannel>, chatId: string, text: string, replyTo?: string): Promise<void> {
  try {
    await channel.send(chatId, { text }, replyTo ? { replyTo } : undefined);
  } catch (err) {
    console.error("Feishu send failed:", err instanceof Error ? err.message : err);
  }
}

const feishu = requireFeishuConfig();
const channel = createLarkChannel({
  ...feishu,
  transport: "websocket",
  loggerLevel: LoggerLevel.info,
  source: "codex-feishu-bridge",
  safety: {
    dedup: { ttl: 10 * 60 * 1000 },
    chatQueue: { enabled: true },
  },
});

channel.on("message", async (msg) => {
  const message = toIncomingMessage(msg);
  if (!message.text) return;

  if (shouldRunSilently(message.text)) {
    void withTimeout(dispatch(message), ASK_TIMEOUT_MS, "Codex 超时未回复，可能是执行卡住、网络断开或桥接进程异常。")
      .then((reply) => safeSend(channel, msg.chatId, reply, msg.messageId))
      .catch((err) => safeSend(channel, msg.chatId, `执行失败：${err instanceof Error ? err.message : String(err)}`, msg.messageId));
    return;
  }

  try {
    const reply = await dispatch(message);
    await safeSend(channel, msg.chatId, reply, msg.messageId);
  } catch (err) {
    await safeSend(channel, msg.chatId, `执行失败：${err instanceof Error ? err.message : String(err)}`, msg.messageId);
  }
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, disconnecting Feishu channel...`);
  await channel.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });

await channel.connect();
console.log("CodexFeishuBridge Feishu websocket connected. Send /status to the bot.");

