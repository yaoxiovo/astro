import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import { createD1Adapter, createKVAdapter, createPresenceManager } from "./cf-shim.mjs";
import worker from "./src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 加载 .env 环境变量
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
	try {
		process.loadEnvFile(envPath);
	} catch (e) {
		console.warn("[server] 读取 .env 失败:", e.message);
	}
}

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || "127.0.0.1";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "yaoxi-blog.sqlite");

// 确保数据库目录存在
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
	fs.mkdirSync(dbDir, { recursive: true });
}

// 初始化适配器
const dbAdapter = createD1Adapter(DB_PATH);
const kvAdapter = createKVAdapter(dbAdapter._raw, "blog_kv");
const presenceMgr = createPresenceManager();

// 构建 Cloudflare Worker 兼容环境变量
const env = {
	DB: dbAdapter,
	RATE_LIMIT_KV: kvAdapter,
	NEWSLETTER_KV: kvAdapter,
	PRESENCE: presenceMgr,
	ADMIN_TOKEN: process.env.ADMIN_TOKEN || "admin_yaoxi_secret",
	AUTH_SECRET: process.env.AUTH_SECRET || "auth_yaoxi_secret",
	JWT_SECRET: process.env.JWT_SECRET || "jwt_yaoxi_secret",
	SSO_SECRET: process.env.SSO_SECRET,
	OWNER_EMAIL: process.env.OWNER_EMAIL || "admin@yaoxi.wiki",
	EMAIL_FROM: process.env.EMAIL_FROM || "no-reply@yaoxi.wiki",
	MAIL_GATEWAY_URL: process.env.MAIL_GATEWAY_URL || "https://mail-api.yaoxi.cloud",
	MAIL_GATEWAY_TOKEN: process.env.MAIL_GATEWAY_TOKEN,
	RESEND_API_KEY: process.env.RESEND_API_KEY,
	TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
	TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
	DANMAKU_AUTO_APPROVE: process.env.DANMAKU_AUTO_APPROVE || "true",
	COMMENT_IP_SALT: process.env.COMMENT_IP_SALT || "salt_yaoxi_blog",
	ENVIRONMENT: "production",
};

// 创建 HTTP 服务器
const server = http.createServer(async (req, res) => {
	try {
		const host = req.headers.host || `localhost:${PORT}`;
		const proto = req.headers["x-forwarded-proto"] || "http";
		const fullUrl = `${proto}://${host}${req.url}`;
		const parsedUrl = new URL(fullUrl);

		// 客户端真实 IP 映射 (透传给 Worker 的 getClientIp)
		const clientIp = req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
		const headers = new Headers();
		for (const [key, value] of Object.entries(req.headers)) {
			if (value !== undefined) {
				if (Array.isArray(value)) {
					for (const v of value) headers.append(key, v);
				} else {
					headers.set(key, value);
				}
			}
		}
		if (!headers.has("cf-connecting-ip")) {
			headers.set("cf-connecting-ip", clientIp.split(",")[0].trim());
		}

		// 读取请求体
		let body;
		if (!["GET", "HEAD"].includes(req.method.toUpperCase())) {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			body = Buffer.concat(chunks);
		}

		// 构建标准 Web Request
		const webRequest = new Request(fullUrl, {
			method: req.method,
			headers,
			body,
			duplex: body ? "half" : undefined,
		});

		const ctx = {
			waitUntil(promise) {
				Promise.resolve(promise).catch((err) => console.error("[ctx.waitUntil error]:", err));
			},
		};

		// 调度 Worker 核心路由
		const webResponse = await worker.fetch(webRequest, env, ctx);

		res.statusCode = webResponse.status;
		webResponse.headers.forEach((val, key) => {
			res.setHeader(key, val);
		});

		const arrayBuf = await webResponse.arrayBuffer();
		res.end(Buffer.from(arrayBuf));
	} catch (err) {
		console.error("[server error]:", err);
		res.statusCode = 500;
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.end(JSON.stringify({ error: "internal_server_error", message: err.message }));
	}
});

// 处理 WebSocket 升级
let wssInstance = null;
try {
	const wsMod = await import("ws");
	const WebSocketServer = wsMod.WebSocketServer || wsMod.default?.WebSocketServer;
	if (WebSocketServer) {
		wssInstance = new WebSocketServer({ noServer: true });
		server.on("upgrade", (req, socket, head) => {
			const host = req.headers.host || `localhost:${PORT}`;
			const fullUrl = `http://${host}${req.url}`;
			const url = new URL(fullUrl);

			if (url.pathname === "/api/presence/ws") {
				const slug = (url.searchParams.get("post") || "").trim();
				if (!slug) {
					socket.destroy();
					return;
				}
				wssInstance.handleUpgrade(req, socket, head, (ws) => {
					presenceMgr.getRoom(slug).addClient(ws);
				});
			} else {
				socket.destroy();
			}
		});
		console.log("[server] ✅ WebSocket 实时共读引擎就绪喵！");
	}
} catch {
	console.log("[server] 提示: ws 模块未安装，WebSocket 升级旁路降级，HTTP API 完全正常喵~");
}

server.listen(PORT, HOST, () => {
	console.log(`[server] 🚀 Yaoxi Blog API 独立服务端已在 http://${HOST}:${PORT} 启动喵！`);
	console.log(`[server] 📦 数据库持久化路径: ${DB_PATH}`);
});
