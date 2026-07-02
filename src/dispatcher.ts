import { loadConfig } from "./config.js";
import { handleCommand } from "./commands.js";
import { canSendFeishu, sendFeishuText } from "./feishuClient.js";
import { describeMessageIdentity, isAllowed } from "./security.js";
import { loadState } from "./state.js";
import type { IncomingMessage } from "./types.js";

export const config = loadConfig();
export const state = loadState();

export async function dispatch(message: IncomingMessage): Promise<string> {
  if (!isAllowed(config, message)) {
    return `未授权用户，已拒绝。检测到：${describeMessageIdentity(message)}\n把其中一个 ID 填到 FEISHU_ALLOWED_USER_IDS 后重启服务。`;
  }
  const result = await handleCommand(config, state, message.text);
  return result.text;
}

export async function dispatchFeishu(message: IncomingMessage): Promise<{ reply: string; sent: boolean; sendError?: string }> {
  const reply = await dispatch(message);
  if (!canSendFeishu(config)) return { reply, sent: false };
  try {
    await sendFeishuText(config, message, reply);
    return { reply, sent: true };
  } catch (err) {
    return { reply, sent: false, sendError: err instanceof Error ? err.message : String(err) };
  }
}
