import http from "node:http";
import { config, dispatch, dispatchFeishu } from "./dispatcher.js";
import { isFeishuTokenValid, parseFeishuEvent } from "./feishu.js";
import type { IncomingMessage } from "./types.js";

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk.toString(); });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
    });
  });
}

function send(res: http.ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      send(res, 200, { ok: true, service: "CodexFeishuBridge", endpoints: ["GET /health", "POST /local/message", "POST /feishu/events"] });
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      send(res, 200, { ok: true, service: "CodexFeishuBridge" });
      return;
    }

    if (req.method === "POST" && req.url === "/local/message") {
      const body = await readJson(req);
      const message: IncomingMessage = { userId: body.userId || "local-dev", text: body.text || "", source: "local" };
      send(res, 200, { ok: true, reply: await dispatch(message) });
      return;
    }

    if (req.method === "POST" && req.url === "/feishu/events") {
      const body = await readJson(req);
      if (body.challenge) {
        send(res, 200, { challenge: body.challenge });
        return;
      }
      if (!isFeishuTokenValid(body, config.feishuVerificationToken)) {
        send(res, 403, { ok: false, error: "Invalid Feishu verification token" });
        return;
      }
      const message = parseFeishuEvent(body);
      if (!message) {
        send(res, 200, { ok: true, ignored: true });
        return;
      }
      const result = await dispatchFeishu(message);
      send(res, 200, { ok: true, sentToFeishu: result.sent, reply: result.reply, sendError: result.sendError });
      return;
    }

    send(res, 404, { ok: false, error: "Not found" });
  } catch (err) {
    send(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`CodexFeishuBridge listening on http://${config.host}:${config.port}`);
});
