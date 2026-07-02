import type { IncomingMessage } from "./types.js";

export function isFeishuTokenValid(body: any, expectedToken: string | null): boolean {
  if (!expectedToken) return true;
  return body?.token === expectedToken || body?.header?.token === expectedToken;
}

export function parseFeishuEvent(body: any): IncomingMessage | null {
  if (body?.challenge) return null;
  const event = body?.event || body?.schema?.event || body;
  const sender = event?.sender?.sender_id || event?.sender_id || {};
  const message = event?.message || event;
  const userId = sender.user_id || sender.open_id || event?.user_id || "";
  const openId = sender.open_id || undefined;
  const chatId = message.chat_id || event?.chat_id || undefined;
  const messageId = message.message_id || event?.message_id || undefined;

  let text = "";
  const content = message.content || event?.content;
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      text = parsed.text || content;
    } catch {
      text = content;
    }
  } else if (content?.text) {
    text = content.text;
  }

  if (!userId || !text) return null;
  return { userId, openId, chatId, messageId, text: text.trim(), source: "feishu" };
}
