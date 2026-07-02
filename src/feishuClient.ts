import type { AppConfig, IncomingMessage } from "./types.js";

interface TenantTokenCache {
  token: string;
  expiresAt: number;
}

let cache: TenantTokenCache | null = null;

async function getTenantAccessToken(config: AppConfig): Promise<string> {
  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error("FEISHU_APP_ID 和 FEISHU_APP_SECRET 未配置，无法调用飞书发送消息接口。");
  }
  const now = Date.now();
  if (cache && cache.expiresAt > now + 60_000) return cache.token;

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: config.feishuAppId, app_secret: config.feishuAppSecret }),
  });
  const data = await response.json() as any;
  if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`获取飞书 tenant_access_token 失败：${data.msg || response.statusText}`);
  }

  cache = {
    token: data.tenant_access_token,
    expiresAt: now + Number(data.expire || 7200) * 1000,
  };
  return cache.token;
}

function splitText(text: string, max = 3500): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += max) chunks.push(text.slice(i, i + max));
  return chunks.length ? chunks : [""];
}

export async function sendFeishuText(config: AppConfig, message: IncomingMessage, text: string): Promise<void> {
  const receiveId = message.chatId || message.openId || message.userId;
  const receiveIdType = message.chatId ? "chat_id" : message.openId ? "open_id" : "user_id";
  const token = await getTenantAccessToken(config);

  for (const chunk of splitText(text)) {
    const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: "text",
        content: JSON.stringify({ text: chunk }),
      }),
    });
    const data = await response.json() as any;
    if (!response.ok || data.code !== 0) {
      throw new Error(`飞书发送消息失败：${data.msg || response.statusText}`);
    }
  }
}

export function canSendFeishu(config: AppConfig): boolean {
  return Boolean(config.feishuAppId && config.feishuAppSecret);
}
