import type { AppConfig, IncomingMessage } from "./types.js";

export function isAllowed(config: AppConfig, message: IncomingMessage): boolean {
  return config.allowedUserIds.some((id) => id === message.userId || id === message.openId || id === message.chatId);
}

export function describeMessageIdentity(message: IncomingMessage): string {
  return [
    `userId=${message.userId || "unknown"}`,
    message.openId ? `openId=${message.openId}` : null,
    message.chatId ? `chatId=${message.chatId}` : null,
  ].filter(Boolean).join(", ");
}
