/**
 * Yaoxi Blog API — 博客统一查询与自动化邮件 API Worker
 *
 * 直连自建邮件网关：https://mail-api.yaoxi.cloud
 *
 * 端点：
 *   GET /                                 API 文档
 *   GET /api/moments                      参数化朋友圈查询
 *   POST /api/newsletter/subscribe        读者邮箱订阅（发送 Double Opt-in 激活邮件，/api/send/notify）
 *   GET /api/newsletter/verify            激活订阅确认链接
 *   GET /api/newsletter/unsubscribe       一键退订链接
 *   POST /api/newsletter/broadcast        新文章/动态批量邮件广播（需 ADMIN_TOKEN，/api/send/notify）
 *   POST /api/newsletter/weekly-digest    每周数据与精选周报推送（需 ADMIN_TOKEN，/api/send/bot）
 *   POST /api/contact                     访客留言提交（站长工单通报 + 访客自动回执，/api/send/service）
 *   GET  /api/comments                    某篇文章已上墙内容（?post=slug&kind=&p=&limit=&before=）
 *   POST /api/comments/submit             读者评论/弹幕投稿（蜜罐 + 限流 + 去重 + SSO 身份绑定，默认人工审核流）
 *   POST /api/comments/delete             作者撤回自己的评论（Bearer SSO JWT，软删 + 审计）
 *   GET  /api/comments/pending            待审列表（需 ADMIN_TOKEN）
 *   POST /api/comments/moderate           状态机流转 approve/reject/delete/restore（需 ADMIN_TOKEN，TG 按钮经 Bot 转发）
 *   GET  /api/comments/events             审计流水（需 ADMIN_TOKEN）
 *   POST /api/comments/migrate            旧 KV 弹幕一次性迁移（需 ADMIN_TOKEN，幂等）
 *   GET  /api/danmaku                     旧弹幕读取兼容层（thin alias → /api/comments）
 *   POST /api/danmaku/submit              旧弹幕投稿兼容层（字段映射 kind=danmaku）
 *   GET  /api/presence                    实时共读快照（在线人数 + 段落热度）
 *   GET  /api/presence/ws                 实时共读 WebSocket 房间（Durable Object）
 *
 * 限流：单 IP 60 次/分钟，全局 600 次/分钟；敏感发信端点独立计数防刷。
 * 所有 API 响应带 CORS（Access-Control-Allow-Origin: *）。
 */

import { createCommentsModule } from "./comments.js";
import { resolveIdentity } from "./jwt.js";
import {
	buildBroadcastHtml,
	buildContactAutoReplyHtml,
	buildContactNotificationHtml,
	buildVerificationHtml,
	buildWeeklyDigestHtml,
	sendEmail,
} from "./email-client.js";

// Durable Object 类必须从 Worker 入口模块导出（wrangler migrations 绑定）
export { PresenceRoom } from "./presence.js";

const BLOG_ORIGIN = "https://blog.yaoxi.wiki";
const MOMENTS_INDEX = `${BLOG_ORIGIN}/api/moments.json`;
const CACHE_TTL = 120; // 秒

// ---- 限流配置 ----
const RATE_LIMIT = {
	IP_WINDOW_MS: 60_000, // 单 IP 窗口：60 秒
	IP_MAX: 60, // 单 IP 窗口内最多 60 次
	GLOBAL_WINDOW_MS: 60_000, // 全局窗口：60 秒
	GLOBAL_MAX: 600, // 全局窗口内最多 600 次
	KV_TTL: 120, // 限流计数 key 过期时间
	MAX_LIMIT: 100, // limit 参数上限
	MAX_OFFSET: 10_000, // offset 上限
	UPSTREAM_FAIL_THRESHOLD: 5, // 连续失败多少次后熔断
	UPSTREAM_BREAKER_TTL: 300, // 熔断锁定 5 分钟
	SUBSCRIBE_LIMIT_WINDOW_MS: 600_000, // 订阅端点窗口：10 分钟
	SUBSCRIBE_IP_MAX: 5, // 10 分钟最多订阅尝试 5 次
	CONTACT_IP_MAX: 3, // 10 分钟最多留言 3 次
};

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

function json(data, status = 200, extraHeaders = {}) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS, ...extraHeaders },
	});
}

function tooManyRequests(retryAfter = 60, message = "请求过于频繁，请稍后再试") {
	return json({ error: "rate limited", message }, 429, { "Retry-After": String(retryAfter) });
}

/** HTML 字符安全转义防范 XSS */
function htmlEsc(str = "") {
	return String(str)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** 统一成功/失败 HTML 状态页展示（严格转义输入，URL 限白名单协议） */
function htmlPage({ title, heading, message, buttonText = "返回博客", buttonUrl = BLOG_ORIGIN, isSuccess = true }) {
	const color = isSuccess ? "#2563eb" : "#dc2626";
	const icon = isSuccess ? "✅" : "⚠️";
	const safeButtonUrl = (buttonUrl.startsWith("https://") || buttonUrl.startsWith("/") || buttonUrl.startsWith("http://localhost"))
		? htmlEsc(buttonUrl)
		: htmlEsc(BLOG_ORIGIN);

	return new Response(
		`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${htmlEsc(title)} - Yaoxi Blog</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; color: #1e293b; }
    .card { background: #ffffff; max-width: 460px; width: 88%; padding: 36px 30px; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.06), 0 8px 10px -6px rgba(0,0,0,0.04); border: 1px solid #e2e8f0; text-align: center; }
    .icon { font-size: 46px; margin-bottom: 14px; }
    h1 { font-size: 21px; margin: 0 0 12px 0; color: #0f172a; font-weight: 700; }
    p { font-size: 14.5px; color: #64748b; line-height: 1.65; margin: 0 0 24px 0; }
    .btn { display: inline-block; background: ${color}; color: #ffffff !important; text-decoration: none; padding: 11px 26px; border-radius: 8px; font-weight: 600; font-size: 14px; transition: opacity 0.2s; }
    .btn:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${htmlEsc(heading)}</h1>
    <p>${htmlEsc(message)}</p>
    <a href="${safeButtonUrl}" class="btn">${htmlEsc(buttonText)}</a>
  </div>
</body>
</html>`,
		{
			status: isSuccess ? 200 : 400,
			headers: { "Content-Type": "text/html; charset=utf-8" },
		},
	);
}

/** 获取客户端 IP */
function getClientIp(request) {
	const headers = ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"];
	for (const h of headers) {
		const v = request.headers.get(h);
		if (v) return v.split(",")[0].trim();
	}
	return "unknown";
}

/** 获取可用的 KV 存储实例 */
function getStorageKv(env) {
	return env?.NEWSLETTER_KV || env?.RATE_LIMIT_KV || null;
}

/** 管理员鉴权（加固：优先从 Authorization 或 X-Admin-Token 请求头验证，杜绝 URL 明文传参泄露） */
function requireAdmin(request, env) {
	const token = env?.ADMIN_TOKEN;
	if (!token) return false;
	const auth = request.headers.get("Authorization") || "";
	if (auth.startsWith("Bearer ") && auth.slice(7).trim() === token) return true;
	const customHeader = request.headers.get("X-Admin-Token") || "";
	if (customHeader.trim() === token) return true;
	// 仅在本地开发模式下允许 query 参数兜底
	if (env?.ENVIRONMENT === "development") {
		const url = new URL(request.url);
		return url.searchParams.get("secret") === token;
	}
	return false;
}

/** 安全读取 KV 计数 */
async function getRateCount(env, key) {
	if (!env?.RATE_LIMIT_KV) return null;
	try {
		const v = await env.RATE_LIMIT_KV.get(key);
		return v ? JSON.parse(v) : null;
	} catch {
		return null;
	}
}

/** 安全写入 KV 计数 */
async function setRateCount(env, key, data, ttl) {
	if (!env?.RATE_LIMIT_KV) return;
	try {
		await env.RATE_LIMIT_KV.put(key, JSON.stringify(data), { expirationTtl: ttl });
	} catch {}
}

/** 通用限流检查（单 IP + 全局：修复原子累加与计数器停滞死锁 Bug） */
async function checkRateLimit(env, ip) {
	if (!env?.RATE_LIMIT_KV) return { allowed: true, retryAfter: 0, ipCount: 0, globalCount: 0 };

	const now = Date.now();
	const ipKey = `rate:ip:${ip}`;
	const globalKey = "rate:global";

	const [ipData, globalData] = await Promise.all([getRateCount(env, ipKey), getRateCount(env, globalKey)]);

	let ipCount = 0;
	let ipWindowStart = now;
	if (ipData) {
		if (now - ipData.windowStart > RATE_LIMIT.IP_WINDOW_MS) {
			ipCount = 0;
			ipWindowStart = now;
		} else {
			ipCount = ipData.count;
			ipWindowStart = ipData.windowStart;
		}
	}

	let globalCount = 0;
	let globalWindowStart = now;
	if (globalData) {
		if (now - globalData.windowStart > RATE_LIMIT.GLOBAL_WINDOW_MS) {
			globalCount = 0;
			globalWindowStart = now;
		} else {
			globalCount = globalData.count;
			globalWindowStart = globalData.windowStart;
		}
	}

	if (ipCount >= RATE_LIMIT.IP_MAX || globalCount >= RATE_LIMIT.GLOBAL_MAX) {
		return { allowed: false, retryAfter: 60, ipCount, globalCount };
	}

	const newIpCount = ipCount + 1;
	const newGlobalCount = globalCount + 1;
	const ttl = RATE_LIMIT.KV_TTL;

	// 每次有效请求必须真实递增 KV 计数，坚决杜绝采样判断导致 count 永久卡死在 1 的重大逻辑缺陷！
	await Promise.all([
		setRateCount(env, ipKey, { count: newIpCount, windowStart: ipWindowStart }, ttl),
		setRateCount(env, globalKey, { count: newGlobalCount, windowStart: globalWindowStart }, ttl),
	]);

	return { allowed: true, retryAfter: 0, ipCount: newIpCount, globalCount: newGlobalCount };
}

/** 检查特定敏感接口的独立 IP 限流 */
async function checkEndpointRateLimit(env, ip, prefix, maxCount, windowMs) {
	const kv = getStorageKv(env);
	if (!kv) return true;
	const key = `rate:${prefix}:${ip}`;
	try {
		const raw = await kv.get(key);
		const count = raw ? Number.parseInt(raw, 10) : 0;
		if (count >= maxCount) return false;
		await kv.put(key, String(count + 1), { expirationTtl: Math.ceil(windowMs / 1000) });
		return true;
	} catch {
		return true;
	}
}

/** 获取源站朋友圈 JSON（带 Cache API + 熔断保护） */
async function fetchMomentsIndex(env) {
	const cache = caches.default;
	const cacheKey = new Request(MOMENTS_INDEX);

	let failCount = 0;
	if (env?.RATE_LIMIT_KV) {
		try {
			const v = await env.RATE_LIMIT_KV.get("upstream:fail");
			if (v) failCount = Number.parseInt(v, 10) || 0;
		} catch {}
	}

	if (failCount >= RATE_LIMIT.UPSTREAM_FAIL_THRESHOLD) {
		const cached = await cache.match(cacheKey);
		if (cached) {
			const body = await cached.json().catch(() => null);
			if (body?.moments) return body;
		}
		throw new Error("源站连续失败，已熔断");
	}

	const cached = await cache.match(cacheKey);
	if (cached) {
		const body = await cached.json().catch(() => null);
		if (body?.moments) return body;
	}

	try {
		const res = await fetch(MOMENTS_INDEX, { signal: AbortSignal.timeout(10000) });
		if (!res.ok) throw new Error(`源站 ${MOMENTS_INDEX} 返回 HTTP ${res.status}`);
		const data = await res.json();
		if (!data?.moments) throw new Error("源站响应缺少 moments 字段");

		const toCache = new Response(JSON.stringify(data), {
			headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_TTL}` },
		});
		await cache.put(cacheKey, toCache);

		if (env?.RATE_LIMIT_KV) {
			try {
				await env.RATE_LIMIT_KV.delete("upstream:fail");
			} catch {}
		}
		return data;
	} catch (err) {
		if (env?.RATE_LIMIT_KV) {
			try {
				await env.RATE_LIMIT_KV.put("upstream:fail", String(failCount + 1), {
					expirationTtl: RATE_LIMIT.UPSTREAM_BREAKER_TTL,
				});
			} catch {}
		}
		throw err;
	}
}

function parseDate(s) {
	if (!s) return null;
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (!m) return null;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return Number.isNaN(d.getTime()) ? null : d;
}

const num = (v, dft) => {
	if (v === null || v === undefined || v === "") return dft;
	const n = Number(v);
	return Number.isFinite(n) ? n : dft;
};

/* ================= 评论系统（D1 统一互动存储，取代原 KV 弹幕模块） =================
 * 旧 danmaku.js 已退役（仅保留文件作迁移期参考），/api/danmaku/* 由下方兼容层承接。
 */

const comments = createCommentsModule({
	json,
	tooManyRequests,
	getClientIp,
	requireAdmin,
	getStorageKv,
	checkEndpointRateLimit,
	checkRateLimit,
	htmlEsc,
	resolveIdentity,
});

/* ================= 实时共读（Durable Objects Presence） ================= */

const PRESENCE_POST_RE = /^[\p{L}\p{N}_\-./]{1,120}$/u;

/** 实时共读：WebSocket 房间接入 / HTTP 快照（转发到 slug 对应的 Durable Object） */
async function handlePresence(request, env, url) {
	const slug = (url.searchParams.get("post") || "").trim();
	if (!PRESENCE_POST_RE.test(slug)) {
		return json({ error: "invalid post", message: "post 参数非法" }, 400);
	}
	if (url.pathname === "/api/presence/ws" && (request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
		return json({ error: "upgrade required", message: "该端点仅接受 WebSocket 连接" }, 426);
	}
	if (!env.PRESENCE) {
		return json({ ok: false, error: "presence unavailable", message: "实时共读未启用" }, 503);
	}
	const ip = getClientIp(request);
	if (!(await checkEndpointRateLimit(env, ip, "presence", 20, 60_000))) {
		return tooManyRequests(30, "连接过于频繁，请稍后再试");
	}
	const stub = env.PRESENCE.get(env.PRESENCE.idFromName(slug));
	return stub.fetch(request);
}

/* ================= 业务路由处理器 ================= */

/** 处理朋友圈列表查询 */
async function handleMoments(request, env, url) {
	const ip = getClientIp(request);
	const { allowed, retryAfter, ipCount } = await checkRateLimit(env, ip);
	if (!allowed) {
		return tooManyRequests(retryAfter);
	}

	const sp = url.searchParams;
	const rawLimit = num(sp.get("limit"), null);
	const limit = rawLimit === null ? null : Math.min(Math.max(rawLimit, 0), RATE_LIMIT.MAX_LIMIT);
	const offset = Math.min(Math.max(num(sp.get("offset"), 0), 0), RATE_LIMIT.MAX_OFFSET);
	const tag = sp.get("tag")?.trim() || "";
	const author = sp.get("author")?.trim() || "";
	const date = parseDate(sp.get("date"));
	const from = parseDate(sp.get("from"));
	const to = parseDate(sp.get("to"));
	const q = sp.get("q")?.trim().toLowerCase() || "";
	const repliesRaw = sp.get("replies");
	const pinned = sp.get("pinned");

	let data;
	try {
		data = await fetchMomentsIndex(env);
	} catch (err) {
		return json({ error: "upstream unavailable", message: String(err?.message || err) }, 502);
	}

	let moments = data.moments || [];

	if (tag) moments = moments.filter((m) => (m.tags || []).includes(tag));
	if (author) moments = moments.filter((m) => (m.author || "") === author);
	if (date) {
		moments = moments.filter((m) => {
			const d = parseDate(String(m.published || "").slice(0, 10));
			return d && d.getTime() === date.getTime();
		});
	}
	if (from || to) {
		const fromT = from?.getTime() ?? -Infinity;
		const toT = to?.getTime() ?? Infinity;
		moments = moments.filter((m) => {
			const d = parseDate(String(m.published || "").slice(0, 10));
			if (!d) return false;
			const t = d.getTime();
			return t >= fromT && t <= toT;
		});
	}
	if (q) {
		moments = moments.filter((m) => {
			const text = (m.text || "").toLowerCase();
			const tags = (m.tags || []).some((t) => String(t).toLowerCase().includes(q));
			const who = (m.author || "").toLowerCase();
			return text.includes(q) || tags || who.includes(q);
		});
	}
	if (repliesRaw === "0") moments = moments.filter((m) => !m.replyTo);
	if (repliesRaw === "1") moments = moments.filter((m) => !!m.replyTo);
	if (pinned === "1") moments = moments.filter((m) => !!m.pinned);

	const total = moments.length;
	if (offset > 0) moments = moments.slice(offset);
	if (limit !== null && limit >= 0) moments = moments.slice(0, limit);

	return json(
		{
			updated: data.updated,
			params: {
				limit: limit === null ? null : limit,
				offset,
				tag: tag || null,
				author: author || null,
				date: sp.get("date") || null,
				from: sp.get("from") || null,
				to: sp.get("to") || null,
				q: q || null,
				replies: repliesRaw || null,
				pinned: pinned || null,
			},
			total,
			returned: moments.length,
			moments,
		},
		200,
		{
			"Cache-Control": "public, max-age=60, s-maxage=120",
			"X-RateLimit-Limit": String(RATE_LIMIT.IP_MAX),
			"X-RateLimit-Remaining": String(Math.max(0, RATE_LIMIT.IP_MAX - ipCount)),
		},
	);
}

/** 读者订阅申请（Double Opt-in） */
async function handleSubscribe(request, env, url) {
	const ip = getClientIp(request);
	const allowed = await checkEndpointRateLimit(
		env,
		ip,
		"sub",
		RATE_LIMIT.SUBSCRIBE_IP_MAX,
		RATE_LIMIT.SUBSCRIBE_LIMIT_WINDOW_MS,
	);
	if (!allowed) {
		return tooManyRequests(600, "订阅尝试次数过多，请稍后再试");
	}

	const body = await request.json().catch(() => null);
	if (!body) return json({ error: "invalid_body", message: "无效的请求数据" }, 400);

	// 蜜罐防机器人
	if (body.website || body.honeypot) {
		return json({ ok: true, message: "订阅确认邮件已发送，请查收" });
	}

	const email = String(body.email || "").trim().toLowerCase();
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	if (!email || !emailRegex.test(email) || email.length > 100) {
		return json({ error: "invalid_email", message: "请输入有效的邮箱地址" }, 400);
	}

	const kv = getStorageKv(env);
	if (!kv) {
		return json({ error: "kv_not_configured", message: "后端存储未配置" }, 500);
	}

	// 检查是否已经在活跃订阅中
	const active = await kv.get(`sub:active:${email}`);
	if (active) {
		return json({ ok: true, message: "该邮箱已处于订阅状态中，无需重复订阅" });
	}

	// 生成 24 小时有效的确认 Token
	const token = crypto.randomUUID();
	await kv.put(
		`sub:pending:${token}`,
		JSON.stringify({
			email,
			token,
			createdAt: Date.now(),
		}),
		{ expirationTtl: 86400 },
	);

	const verifyUrl = `${url.origin}/api/newsletter/verify?token=${encodeURIComponent(token)}`;
	const html = buildVerificationHtml({
		email,
		verifyUrl,
		siteName: "瑶曦 Blog",
		siteUrl: BLOG_ORIGIN,
	});

	const result = await sendEmail(env, {
		to: email,
		subject: "【瑶曦 Blog】请确认激活您的博客订阅",
		html,
		prefix: "notify",
	});

	if (!result.ok) {
		return json({ error: "email_failed", message: "发送验证邮件失败，请稍后重试" }, 502);
	}

	return json({
		ok: true,
		message: "订阅确认邮件已发送，请前往您的邮箱点击激活链接（24小时内有效）",
	});
}

/** 激活订阅验证 */
async function handleVerify(request, env, url) {
	const token = url.searchParams.get("token")?.trim();
	if (!token) {
		return htmlPage({
			title: "激活失败",
			heading: "参数缺失",
			message: "激活链接缺少有效 Token，请从邮件中重新点击链接。",
			isSuccess: false,
		});
	}

	const kv = getStorageKv(env);
	if (!kv) {
		return htmlPage({
			title: "服务不可用",
			heading: "存储错误",
			message: "系统存储未初始化，请联系站长。",
			isSuccess: false,
		});
	}

	const pendingRaw = await kv.get(`sub:pending:${token}`);
	if (!pendingRaw) {
		// 检查是否已经激活过了
		const existingEmail = await kv.get(`sub:token:${token}`);
		if (existingEmail) {
			return htmlPage({
				title: "已经激活",
				heading: "您的订阅此前已激活成功",
				message: `邮箱 ${existingEmail} 已经是活跃订阅者，感谢您的支持！`,
				isSuccess: true,
			});
		}
		return htmlPage({
			title: "激活失效",
			heading: "链接已过期或失效",
			message: "该激活链接不存在或已超过 24 小时有效期，请重新在博客提交订阅申请。",
			isSuccess: false,
		});
	}

	const pending = JSON.parse(pendingRaw);
	const email = pending.email;

	// 存入订阅列表
	let list = [];
	try {
		const rawList = await kv.get("sub:list");
		list = rawList ? JSON.parse(rawList) : [];
	} catch {}

	if (!list.some((s) => s.email === email)) {
		list.push({ email, token, subscribedAt: Date.now() });
		await kv.put("sub:list", JSON.stringify(list));
	}

	await kv.put(`sub:active:${email}`, JSON.stringify({ token, subscribedAt: Date.now() }));
	await kv.put(`sub:token:${token}`, email);
	await kv.delete(`sub:pending:${token}`);

	return htmlPage({
		title: "订阅成功",
		heading: "🎉 订阅成功！",
		message: `已成功为您（${email}）激活 瑶曦 Blog 的更新推送。当发布新文章或重要动态时，您将第一时间收到邮件通知。`,
		buttonText: "前往博客逛逛",
		buttonUrl: BLOG_ORIGIN,
		isSuccess: true,
	});
}

/** 一键退订处理 */
async function handleUnsubscribe(request, env, url) {
	const token = url.searchParams.get("token")?.trim();
	if (!token) {
		return htmlPage({
			title: "退订链接无效",
			heading: "缺少退订标识",
			message: "退订链接不完整，请从邮件底部的退订链接进入。",
			isSuccess: false,
		});
	}

	const kv = getStorageKv(env);
	if (!kv) {
		return htmlPage({
			title: "退订失败",
			heading: "服务异常",
			message: "存储服务不可用，请稍后重试。",
			isSuccess: false,
		});
	}

	const email = await kv.get(`sub:token:${token}`);
	if (!email) {
		return htmlPage({
			title: "退订完成",
			heading: "您已处于未订阅状态",
			message: "该订阅记录已不存在或此前已退订，无需重复操作。",
			isSuccess: true,
		});
	}

	// 从列表中剔除
	let list = [];
	try {
		const rawList = await kv.get("sub:list");
		list = rawList ? JSON.parse(rawList) : [];
	} catch {}

	list = list.filter((s) => s.email !== email && s.token !== token);
	await kv.put("sub:list", JSON.stringify(list));
	await kv.delete(`sub:active:${email}`);
	await kv.delete(`sub:token:${token}`);

	return htmlPage({
		title: "退订成功",
		heading: "已成功取消订阅",
		message: `您（${email}）已退订 瑶曦 Blog 的邮件推送。今后不会再向您发送更新邮件。若有需要，随时欢迎重新订阅！`,
		buttonText: "返回博客",
		buttonUrl: BLOG_ORIGIN,
		isSuccess: true,
	});
}

/** 批量向订阅者广播新文章/动态 */
async function handleBroadcast(request, env, url) {
	if (!requireAdmin(request, env)) {
		return json({ error: "unauthorized", message: "缺少管理员鉴权令牌" }, 401);
	}

	const body = await request.json().catch(() => null);
	if (!body || !body.title || !body.url) {
		return json({ error: "invalid_body", message: "缺少必要字段：title 和 url" }, 400);
	}

	const kv = getStorageKv(env);
	if (!kv) {
		return json({ error: "kv_not_configured", message: "KV 存储未配置" }, 500);
	}

	// 仅预览测试模式
	if (body.preview || body.testEmail) {
		const testTarget = body.testEmail || env.OWNER_EMAIL || "yaoxiovo@gmail.com";
		const html = buildBroadcastHtml({
			title: body.title,
			summary: body.summary || body.title,
			url: body.url,
			pubDate: body.pubDate,
			tags: body.tags || [],
			author: body.author || "瑶曦",
			type: body.type || "post",
			unsubscribeUrl: `${url.origin}/api/newsletter/unsubscribe?token=test-token`,
			siteName: "瑶曦 Blog",
			siteUrl: BLOG_ORIGIN,
		});

		const res = await sendEmail(env, {
			to: testTarget,
			subject: `【测试预览】${body.type === "post" ? "新文章" : "新动态"}：${body.title}`,
			html,
			prefix: "notify",
		});

		return json({
			ok: res.ok,
			mode: "preview",
			target: testTarget,
			id: res.id,
			error: res.error,
		});
	}

	// 批量群发给所有活跃订阅者
	let list = [];
	try {
		const rawList = await kv.get("sub:list");
		list = rawList ? JSON.parse(rawList) : [];
	} catch {}

	if (!list.length) {
		return json({ ok: true, message: "当前暂无活跃订阅者", sent: 0 });
	}

	let sentCount = 0;
	let failCount = 0;

	// 并发批次控制（每次并发 5 封，避免 Worker 30s Wall-clock 超时或网关熔断）
	const BATCH_SIZE = 5;
	for (let i = 0; i < list.length; i += BATCH_SIZE) {
		const chunk = list.slice(i, i + BATCH_SIZE);
		const results = await Promise.allSettled(
			chunk.map(async (sub) => {
				const unsubUrl = `${url.origin}/api/newsletter/unsubscribe?token=${encodeURIComponent(sub.token)}`;
				const html = buildBroadcastHtml({
					title: body.title,
					summary: body.summary || body.title,
					url: body.url,
					pubDate: body.pubDate,
					tags: body.tags || [],
					author: body.author || "瑶曦",
					type: body.type || "post",
					unsubscribeUrl: unsubUrl,
					siteName: "瑶曦 Blog",
					siteUrl: BLOG_ORIGIN,
				});

				return sendEmail(env, {
					to: sub.email,
					subject: `【新文章】${body.title} - 瑶曦 Blog`,
					html,
					prefix: "notify",
					headers: {
						"List-Unsubscribe": `<${unsubUrl}>`,
						"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
					},
				});
			}),
		);

		for (const r of results) {
			if (r.status === "fulfilled" && r.value?.ok) sentCount++;
			else failCount++;
		}
	}

	return json({
		ok: true,
		total: list.length,
		sent: sentCount,
		failed: failCount,
	});
}

/** 批量向订阅者发送每周运营与精选周报 */
async function handleWeeklyDigest(request, env, url) {
	if (!requireAdmin(request, env)) {
		return json({ error: "unauthorized", message: "缺少管理员鉴权令牌" }, 401);
	}

	const body = await request.json().catch(() => ({}));
	const kv = getStorageKv(env);
	if (!kv) {
		return json({ error: "kv_not_configured", message: "KV 存储未配置" }, 500);
	}

	const weekRange = body.weekRange || "本周";
	const posts = body.posts || [];
	const momentsCount = body.momentsCount || 0;
	const topTags = body.topTags || [];

	// 预览测试模式
	if (body.preview || body.testEmail) {
		const target = body.testEmail || env.OWNER_EMAIL || "yaoxiovo@gmail.com";
		const html = buildWeeklyDigestHtml({
			weekRange,
			posts,
			momentsCount,
			topTags,
			unsubscribeUrl: `${url.origin}/api/newsletter/unsubscribe?token=test-token`,
			siteName: "瑶曦 Blog",
			siteUrl: BLOG_ORIGIN,
		});

		const res = await sendEmail(env, {
			to: target,
			subject: `【周报预览】瑶曦 Blog 每周精选 (${weekRange})`,
			html,
			prefix: "bot",
		});

		return json({ ok: res.ok, mode: "preview", target, id: res.id, error: res.error });
	}

	// 批量发送给活跃订阅者（分批并发）
	let list = [];
	try {
		const rawList = await kv.get("sub:list");
		list = rawList ? JSON.parse(rawList) : [];
	} catch {}

	let sentCount = 0;
	let failCount = 0;

	const BATCH_SIZE = 5;
	for (let i = 0; i < list.length; i += BATCH_SIZE) {
		const chunk = list.slice(i, i + BATCH_SIZE);
		const results = await Promise.allSettled(
			chunk.map(async (sub) => {
				const unsubUrl = `${url.origin}/api/newsletter/unsubscribe?token=${encodeURIComponent(sub.token)}`;
				const html = buildWeeklyDigestHtml({
					weekRange,
					posts,
					momentsCount,
					topTags,
					unsubscribeUrl: unsubUrl,
					siteName: "瑶曦 Blog",
					siteUrl: BLOG_ORIGIN,
				});

				return sendEmail(env, {
					to: sub.email,
					subject: `📊【每周精选】瑶曦 Blog 周报 (${weekRange})`,
					html,
					prefix: "bot",
					headers: {
						"List-Unsubscribe": `<${unsubUrl}>`,
						"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
					},
				});
			}),
		);

		for (const r of results) {
			if (r.status === "fulfilled" && r.value?.ok) sentCount++;
			else failCount++;
		}
	}

	return json({ ok: true, total: list.length, sent: sentCount, failed: failCount });
}

/** 访客留言提交（站长通报 + 访客自动回执） */
async function handleContact(request, env, url) {
	const ip = getClientIp(request);
	const allowed = await checkEndpointRateLimit(
		env,
		ip,
		"contact",
		RATE_LIMIT.CONTACT_IP_MAX,
		RATE_LIMIT.SUBSCRIBE_LIMIT_WINDOW_MS,
	);
	if (!allowed) {
		return tooManyRequests(600, "留言提交过于频繁，请稍后再试");
	}

	const body = await request.json().catch(() => null);
	if (!body) return json({ error: "invalid_body", message: "无效的请求内容" }, 400);

	// 蜜罐
	if (body.website || body.honeypot) {
		return json({ ok: true, message: "留言已成功送达！" });
	}

	const name = String(body.name || "热心读者").trim().slice(0, 50);
	const email = String(body.email || "").trim().toLowerCase();
	const message = String(body.message || "").trim();
	const pageUrl = String(body.pageUrl || "").trim().slice(0, 200);

	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	if (!email || !emailRegex.test(email)) {
		return json({ error: "invalid_email", message: "请输入用于接收回复的有效邮箱" }, 400);
	}
	if (!message || message.length < 5 || message.length > 3000) {
		return json({ error: "invalid_message", message: "留言内容需在 5 到 3000 字之间" }, 400);
	}

	const ownerEmail = env.OWNER_EMAIL || "yaoxiovo@gmail.com";

	// 1. 发信给站长 (service 前缀)
	const notifyHtml = buildContactNotificationHtml({
		name,
		email,
		message,
		pageUrl,
		ip,
		siteName: "瑶曦 Blog",
		siteUrl: BLOG_ORIGIN,
	});

	const notifyResult = await sendEmail(env, {
		to: ownerEmail,
		replyTo: email,
		subject: `📬【博客新留言】来自 ${name} 的消息`,
		html: notifyHtml,
		prefix: "service",
	});

	// 2. 自动回执给访客 (service 前缀)
	const autoReplyHtml = buildContactAutoReplyHtml({
		name,
		message,
		siteName: "瑶曦 Blog",
		siteUrl: BLOG_ORIGIN,
	});

	await sendEmail(env, {
		to: email,
		subject: "【瑶曦 Blog】已收到您的留言与反馈",
		html: autoReplyHtml,
		prefix: "service",
	});

	return json({
		ok: true,
		message: "留言已成功送达！站长已收到通知，我们已向您的邮箱发送了自动回执。",
		id: notifyResult?.id,
	});
}

/**
 * 处理 DDoS 告警与实时安全日志查询
 * GET /api/ddos?hours=24&limit=50&demo=0&domain=blog.yaoxi.wiki
 */
async function handleDDoS(request, env, url) {
	const hours = Math.min(168, Math.max(1, parseInt(url.searchParams.get("hours") || "24", 10)));
	const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
	const isDemo = url.searchParams.get("demo") === "true" || url.searchParams.get("demo") === "1";
	const targetDomain = url.searchParams.get("domain") || "blog.yaoxi.wiki";

	// 1. 如果请求模拟演示数据（攻防演练模式）
	if (isDemo) {
		const now = Date.now();
		const demoEvents = [
			{
				id: "cf-ray-8ccd1049281a",
				timestamp: new Date(now - 2 * 60 * 1000).toISOString(),
				action: "drop",
				source: "l7ddos",
				ruleId: "cloudflare-http-ddos-mitigation-standard",
				rayId: "8ccd1049281a",
				ip: "198.51.100.***",
				country: "United States",
				countryCode: "US",
				asn: "AS13335",
				asnDesc: "CLOUDFLARENET",
				method: "GET",
				host: targetDomain,
				path: "/api/moments.json",
				ua: "Go-http-client/1.1 (Flood-Botnet/2.4)",
				attackType: "HTTP Flood (Layer 7)"
			},
			{
				id: "cf-ray-8ccd0f93a11b",
				timestamp: new Date(now - 5 * 60 * 1000).toISOString(),
				action: "block",
				source: "rateLimit",
				ruleId: "rate-limit-sensitive-endpoints",
				rayId: "8ccd0f93a11b",
				ip: "114.248.***.***",
				country: "China",
				countryCode: "CN",
				asn: "AS4134",
				asnDesc: "CHINANET-BACKBONE",
				method: "POST",
				host: targetDomain,
				path: "/api/newsletter/subscribe",
				ua: "python-requests/2.31.0",
				attackType: "Rate Limit Triggered (API Abuse)"
			},
			{
				id: "cf-ray-8ccd0e88c03c",
				timestamp: new Date(now - 9 * 60 * 1000).toISOString(),
				action: "drop",
				source: "l7ddos",
				ruleId: "cloudflare-http-ddos-mitigation-high-rate",
				rayId: "8ccd0e88c03c",
				ip: "54.210.***.***",
				country: "United States",
				countryCode: "US",
				asn: "AS16509",
				asnDesc: "AMAZON-02",
				method: "GET",
				host: targetDomain,
				path: "/",
				ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) (Bot Attack Engine)",
				attackType: "Volumetric HTTP Flood"
			},
			{
				id: "cf-ray-8ccd0d712fa9",
				timestamp: new Date(now - 14 * 60 * 1000).toISOString(),
				action: "managed_challenge",
				source: "waf",
				ruleId: "waf-bot-fight-mode",
				rayId: "8ccd0d712fa9",
				ip: "144.76.***.***",
				country: "Germany",
				countryCode: "DE",
				asn: "AS24940",
				asnDesc: "HETZNER-AS",
				method: "GET",
				host: targetDomain,
				path: "/api/moments.json",
				ua: "curl/8.1.2",
				attackType: "Automated Scraping Bot"
			},
			{
				id: "cf-ray-8ccd0b201cd5",
				timestamp: new Date(now - 22 * 60 * 1000).toISOString(),
				action: "block",
				source: "waf",
				ruleId: "waf-anomaly-useragent-block",
				rayId: "8ccd0b201cd5",
				ip: "185.220.***.***",
				country: "Netherlands",
				countryCode: "NL",
				asn: "AS60729",
				asnDesc: "Zwiebelfreunde",
				method: "POST",
				host: targetDomain,
				path: "/api/contact",
				ua: "Masscan/1.3.2",
				attackType: "Automated Probe & Injection"
			}
		];

		return json({
			status: "attack",
			hasAttack: true,
			isDemo: true,
			target: targetDomain,
			zone: "yaoxi.wiki",
			activeAttacks: 3,
			totalEvents: 148,
			peakRate: "18,450 req/s",
			timeRange: {
				since: new Date(now - hours * 3600 * 1000).toISOString(),
				until: new Date(now).toISOString(),
				hours,
			},
			summary: {
				dropped: 92,
				blocked: 44,
				challenged: 12,
				topCountries: [
					{ name: "United States", code: "US", count: 68, percentage: 46 },
					{ name: "China", code: "CN", count: 35, percentage: 24 },
					{ name: "Germany", code: "DE", count: 21, percentage: 14 },
					{ name: "Netherlands", code: "NL", count: 14, percentage: 9 },
					{ name: "Others", code: "UN", count: 10, percentage: 7 }
				],
				topASNs: [
					{ asn: "AS13335", desc: "CLOUDFLARENET", count: 52 },
					{ asn: "AS4134", desc: "CHINANET-BACKBONE", count: 35 },
					{ asn: "AS16509", desc: "AMAZON-02", count: 28 },
					{ asn: "AS24940", desc: "HETZNER-AS", count: 21 }
				],
				topTargets: [
					{ path: "/api/moments.json", count: 76 },
					{ path: "/", count: 48 },
					{ path: "/api/newsletter/subscribe", count: 24 }
				]
			},
			events: demoEvents,
			cfConnected: true,
			updatedAt: new Date().toISOString()
		});
	}

	// 2. 真实查询 Cloudflare 日志 (支持请求头透传 Token 与 Worker Secrets 自动回退)
	const clientToken = request?.headers ? (request.headers.get("x-cf-token") || request.headers.get("cf-api-token")) : null;
	const clientZoneId = request?.headers ? (request.headers.get("x-cf-zone-id") || request.headers.get("cf-zone-id")) : null;
	const cfToken = clientToken || env.CF_API_TOKEN || env.CLOUDFLARE_API_TOKEN;
	let cfZoneId = clientZoneId || env.CF_ZONE_ID || env.CLOUDFLARE_ZONE_ID;

	if (!cfToken) {
		return json({
			status: "normal",
			hasAttack: false,
			isDemo: false,
			target: targetDomain,
			zone: "yaoxi.wiki",
			activeAttacks: 0,
			totalEvents: 0,
			timeRange: {
				since: new Date(Date.now() - hours * 3600 * 1000).toISOString(),
				until: new Date().toISOString(),
				hours,
			},
			summary: {
				dropped: 0,
				blocked: 0,
				challenged: 0,
				topCountries: [],
				topASNs: [],
				topTargets: []
			},
			events: [],
			cfConnected: false,
			message: "Cloudflare API Token 未配置在 Worker Secrets 中喵~",
			updatedAt: new Date().toISOString()
		});
	}

	// 尝试从 KV 缓存中获取（TTL 60秒，携带个性化 Token 时旁路缓存）
	const tokenHash = cfToken ? cfToken.slice(-6) : "env";
	const cacheKey = `ddos:cache:${tokenHash}:${hours}:${limit}:${cfZoneId || "all"}`;
	if (env.RATE_LIMIT_KV && !clientToken) {
		try {
			const cached = await env.RATE_LIMIT_KV.get(cacheKey, "json");
			if (cached) {
				return json({ ...cached, _fromCache: true });
			}
		} catch (e) {
			console.warn("[ddos] 读取 KV 缓存失败:", e);
		}
	}

	// 动态解析 Zone 列表 (优先使用指定 Zone ID，未指定时自动探测名下全部活跃 Zone 并聚合)
	let targetZones = [];
	if (cfZoneId) {
		targetZones = [{ id: cfZoneId, name: targetDomain }];
	} else {
		try {
			const zoneRes = await fetch("https://api.cloudflare.com/client/v4/zones?status=active", {
				headers: {
					Authorization: `Bearer ${cfToken}`,
					"Content-Type": "application/json"
				}
			});
			if (zoneRes.ok) {
				const zoneData = await zoneRes.json();
				if (Array.isArray(zoneData.result) && zoneData.result.length > 0) {
					targetZones = zoneData.result.map(z => ({ id: z.id, name: z.name }));
				}
			}
		} catch (e) {
			console.warn("[ddos] 动态获取活跃 Zone 列表失败:", e);
		}

		// 回退兼容：若 status=active 为空，尝试查找 yaoxi.wiki
		if (targetZones.length === 0) {
			try {
				const fallbackRes = await fetch("https://api.cloudflare.com/client/v4/zones?name=yaoxi.wiki", {
					headers: {
						Authorization: `Bearer ${cfToken}`,
						"Content-Type": "application/json"
					}
				});
				if (fallbackRes.ok) {
					const fbData = await fallbackRes.json();
					if (fbData.result && fbData.result[0]) {
						targetZones = [{ id: fbData.result[0].id, name: fbData.result[0].name || "yaoxi.wiki" }];
					}
				}
			} catch (e) {
				console.warn("[ddos] 回退获取 yaoxi.wiki Zone 失败:", e);
			}
		}
	}

	if (targetZones.length === 0) {
		return json({
			status: "normal",
			hasAttack: false,
			isDemo: false,
			target: targetDomain,
			zone: "未知",
			activeAttacks: 0,
			totalEvents: 0,
			events: [],
			summary: { dropped: 0, blocked: 0, challenged: 0, topCountries: [], topASNs: [], topTargets: [] },
			cfConnected: false,
			message: "未能定位任何可用的 Cloudflare Zone ID，请检查 API Token 权限或配置 CF_ZONE_ID 喵~",
			updatedAt: new Date().toISOString()
		});
	}

	// 构造 GraphQL 查询
	const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
	const until = new Date().toISOString();

	const gqlQuery = `
		query GetSecurityEvents($zoneTag: String!, $since: String!, $until: String!, $limit: Int!) {
			viewer {
				zones(filter: { zoneTag: $zoneTag }) {
					securityEventsAdaptive(
						filter: {
							datetime_geq: $since,
							datetime_leq: $until
						},
						limit: $limit,
						orderBy: [datetime_DESC]
					) {
						action
						clientASNDescription
						clientAsn
						clientCountryName
						clientIP
						clientRequestHTTPHost
						clientRequestHTTPMethodName
						clientRequestHTTPProtocol
						clientRequestPath
						clientRequestQuery
						datetime
						rayName
						ruleId
						rulesetId
						source
						userAgent
					}
					securityEventsAdaptiveGroups(
						filter: {
							datetime_geq: $since,
							datetime_leq: $until
						},
						limit: 15,
						orderBy: [count_DESC]
					) {
						count
						dimensions {
							action
							source
							clientCountryName
						}
					}
				}
			}
		}
	`;

	const isMitigationEvent = (e) => {
		const a = String(e.action || "").toLowerCase();
		const s = String(e.source || "").toLowerCase();
		if (a === "allow" || a === "log" || a === "skip" || a === "bypass") return false;
		if (
			a.includes("drop") ||
			a.includes("block") ||
			a.includes("challenge") ||
			a.includes("close") ||
			a.includes("mitigate")
		) {
			return true;
		}
		if (
			s.includes("ddos") ||
			s.includes("dos") ||
			s.includes("rate") ||
			s.includes("waf") ||
			s.includes("securitylevel") ||
			s.includes("underattack") ||
			s.includes("botmanagement")
		) {
			return true;
		}
		return false;
	};

	try {
		const zoneQueries = targetZones.slice(0, 5).map(async (zone) => {
			try {
				const cfRes = await fetch("https://api.cloudflare.com/client/v4/graphql", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${cfToken}`,
						"Content-Type": "application/json"
					},
					body: JSON.stringify({
						query: gqlQuery,
						variables: {
							zoneTag: zone.id,
							since,
							until,
							limit
						}
					})
				});

				if (!cfRes.ok) {
					const errText = await cfRes.text();
					console.warn(`[ddos] Cloudflare GraphQL 报错 (Zone ${zone.name}):`, errText);
					return [];
				}

				const cfData = await cfRes.json();
				const rawEvents = cfData?.data?.viewer?.zones?.[0]?.securityEventsAdaptive || [];
				return rawEvents.map(e => ({ ...e, zoneName: zone.name }));
			} catch (err) {
				console.warn(`[ddos] 请求 Cloudflare GraphQL 异常 (Zone ${zone.name}):`, err);
				return [];
			}
		});

		const zoneResults = await Promise.all(zoneQueries);
		const allRawEvents = zoneResults.flat();

		// 筛选拦截防护与 DDoS 防御事件
		const ddosEvents = allRawEvents.filter(isMitigationEvent);
		ddosEvents.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());

		const getAttackType = (e) => {
			const s = String(e.source || "").toLowerCase();
			const a = String(e.action || "").toLowerCase();
			if (s.includes("rate")) return "频率限制熔断 (Rate Limit)";
			if (s.includes("l7ddos") || s.includes("ddos")) return "HTTP DDoS 自动清洗";
			if (s.includes("securitylevel") || s.includes("underattack")) return "Under Attack 攻击防御模式";
			if (s.includes("waf")) return "WAF 规则拦截防护";
			if (s.includes("bot")) return "恶意爬虫检测拦截";
			if (a.includes("challenge")) return "验证码/质询防御 (Challenge)";
			if (a.includes("drop")) return "流量静默丢弃 (Drop)";
			if (a.includes("block")) return "IP/访问阻断 (Block)";
			return "边缘防御拦截 (Edge Mitigation)";
		};

		// 格式化事件列表
		const formattedEvents = ddosEvents.map((e, idx) => {
			const ip = e.clientIP ? maskIp(e.clientIP) : "未知";
			const attackType = getAttackType(e);

			return {
				id: e.rayName || `event-${idx}`,
				timestamp: e.datetime,
				action: e.action || "drop",
				source: e.source || "l7ddos",
				ruleId: e.ruleId || e.rulesetId || "Cloudflare Edge Mitigation",
				rayId: e.rayName || "",
				ip,
				country: e.clientCountryName || "未知国家/地区",
				countryCode: getCountryCode(e.clientCountryName),
				asn: e.clientAsn ? `AS${e.clientAsn}` : "未知网络",
				asnDesc: e.clientASNDescription || "",
				method: e.clientRequestHTTPMethodName || "GET",
				host: e.clientRequestHTTPHost || (e.zoneName ? `*.${e.zoneName}` : targetDomain),
				path: e.clientRequestPath || "/",
				ua: e.userAgent || "",
				attackType
			};
		});

		// 汇总计算
		let dropped = 0;
		let blocked = 0;
		let challenged = 0;
		const countryMap = new Map();
		const asnMap = new Map();
		const pathMap = new Map();
		const nowMs = Date.now();
		let activeAttacks = 0;

		for (const ev of formattedEvents) {
			const a = ev.action.toLowerCase();
			if (a.includes("drop")) dropped++;
			else if (a.includes("block")) blocked++;
			else challenged++;

			const evTime = new Date(ev.timestamp).getTime();
			if (nowMs - evTime <= 15 * 60 * 1000) {
				activeAttacks++;
			}

			countryMap.set(ev.country, (countryMap.get(ev.country) || 0) + 1);
			if (ev.asn) {
				const key = `${ev.asn} - ${ev.asnDesc || ""}`.trim();
				asnMap.set(key, (asnMap.get(key) || 0) + 1);
			}
			if (ev.path) {
				pathMap.set(ev.path, (pathMap.get(ev.path) || 0) + 1);
			}
		}

		const totalCount = formattedEvents.length;
		const topCountries = Array.from(countryMap.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([name, count]) => ({
				name,
				code: getCountryCode(name),
				count,
				percentage: totalCount > 0 ? Math.round((count / totalCount) * 100) : 0
			}));

		const topASNs = Array.from(asnMap.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([asn, count]) => ({
				asn: asn.split(" - ")[0],
				desc: asn.split(" - ")[1] || "",
				count
			}));

		const topTargets = Array.from(pathMap.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([path, count]) => ({ path, count }));

		let status = "normal";
		if (activeAttacks > 0) {
			status = "attack";
		} else if (totalCount > 0) {
			status = "elevated";
		}

		const targetDisplay = targetZones.map(z => z.name).join(", ");
		const resultPayload = {
			status,
			hasAttack: totalCount > 0,
			isDemo: false,
			target: targetDisplay,
			zone: targetDisplay,
			activeAttacks,
			totalEvents: totalCount,
			timeRange: { since, until, hours },
			summary: {
				dropped,
				blocked,
				challenged,
				topCountries,
				topASNs,
				topTargets
			},
			events: formattedEvents,
			cfConnected: true,
			updatedAt: new Date().toISOString()
		};

		if (env.RATE_LIMIT_KV && !clientToken) {
			try {
				await env.RATE_LIMIT_KV.put(cacheKey, JSON.stringify(resultPayload), { expirationTtl: 60 });
			} catch (e) {
				console.warn("[ddos] 写入 KV 缓存失败:", e);
			}
		}

		return json(resultPayload);
	} catch (err) {
		console.error("[ddos] 请求失败:", err);
		return json({
			status: "normal",
			hasAttack: false,
			isDemo: false,
			target: targetDomain,
			zone: targetZones.map(z => z.name).join(", ") || "yaoxi.wiki",
			activeAttacks: 0,
			totalEvents: 0,
			events: [],
			summary: { dropped: 0, blocked: 0, challenged: 0, topCountries: [], topASNs: [], topTargets: [] },
			cfConnected: false,
			error: err.message,
			updatedAt: new Date().toISOString()
		});
	}
}

/** 辅助函数：IP 脱敏 */
function maskIp(ip = "") {
	if (!ip) return "";
	if (ip.includes(".")) {
		const parts = ip.split(".");
		if (parts.length === 4) return `${parts[0]}.${parts[1]}.***.${parts[3]}`;
	}
	if (ip.includes(":")) {
		const parts = ip.split(":");
		if (parts.length > 2) return `${parts[0]}:${parts[1]}:****:****:${parts[parts.length - 1]}`;
	}
	return ip;
}

/** 辅助函数：国家代码映射（用于 Flag 呈现） */
function getCountryCode(countryName = "") {
	const map = {
		"United States": "US",
		"China": "CN",
		"Germany": "DE",
		"Netherlands": "NL",
		"United Kingdom": "GB",
		"Japan": "JP",
		"Hong Kong": "HK",
		"Taiwan": "TW",
		"Singapore": "SG",
		"France": "FR",
		"Russia": "RU",
		"Canada": "CA",
		"Australia": "AU",
		"Korea": "KR",
		"South Korea": "KR",
		"India": "IN",
		"Brazil": "BR"
	};
	return map[countryName] || "UN";
}

/* ================= Worker Fetch 入口 ================= */

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		// API 文档
		if (url.pathname === "/" || url.pathname === "/api") {
			return json({
				name: "Yaoxi Blog API & Automation Dispatcher",
				source: BLOG_ORIGIN,
				mailGateway: "https://mail-api.yaoxi.cloud",
				endpoints: {
					"GET /api/moments": "参数化朋友圈查询",
					"GET /api/ddos": "Cloudflare DDoS 实时告警与安全防御日志查询",
					"POST /api/newsletter/subscribe": "读者邮箱订阅（发送 Double Opt-in 激活邮件）",
					"GET /api/newsletter/verify": "激活订阅链接（通过邮件中的 Token 激活）",
					"GET /api/newsletter/unsubscribe": "一键退订链接",
					"POST /api/newsletter/broadcast": "批量向订阅者广播新文章通知（需 ADMIN_TOKEN）",
					"POST /api/newsletter/weekly-digest": "批量向订阅者发送每周精选周报（需 ADMIN_TOKEN）",
					"POST /api/contact": "访客留言提交（站长工单通报 + 访客自动回执）",
					"GET /api/danmaku": "某篇文章的已上墙弹幕列表（?post=slug）",
					"POST /api/danmaku/submit": "读者弹幕投稿（蜜罐 + 限流 + 去重，默认人工审核流）",
					"GET /api/danmaku/pending": "待审核弹幕列表（需 ADMIN_TOKEN）",
					"POST /api/danmaku/moderate": "弹幕放行 / 拒绝（需 ADMIN_TOKEN）",
					"GET /api/presence": "实时共读快照（在线人数 + 段落热度）",
					"GET /api/presence/ws": "实时共读 WebSocket 房间（Durable Object）",
				},
				rateLimit: {
					ip: `${RATE_LIMIT.IP_MAX} 次 / ${RATE_LIMIT.IP_WINDOW_MS / 1000} 秒`,
					global: `${RATE_LIMIT.GLOBAL_MAX} 次 / ${RATE_LIMIT.GLOBAL_WINDOW_MS / 1000} 秒`,
				},
			});
		}

		// DDoS 告警与安全防御日志查询
		if (url.pathname === "/api/ddos" && request.method === "GET") {
			return handleDDoS(request, env, url);
		}

		// 朋友圈查询
		if (url.pathname === "/api/moments" && request.method === "GET") {
			return handleMoments(request, env, url);
		}

		// 邮箱订阅申请
		if (url.pathname === "/api/newsletter/subscribe" && request.method === "POST") {
			return handleSubscribe(request, env, url);
		}

		// 订阅激活链接
		if (url.pathname === "/api/newsletter/verify" && request.method === "GET") {
			return handleVerify(request, env, url);
		}

		// 一键退订链接
		if (url.pathname === "/api/newsletter/unsubscribe" && request.method === "GET") {
			return handleUnsubscribe(request, env, url);
		}

		// 批量文章广播
		if (url.pathname === "/api/newsletter/broadcast" && request.method === "POST") {
			return handleBroadcast(request, env, url);
		}

		// 每周周报广播
		if (url.pathname === "/api/newsletter/weekly-digest" && request.method === "POST") {
			return handleWeeklyDigest(request, env, url);
		}

		// 访客留言
		if (url.pathname === "/api/contact" && request.method === "POST") {
			return handleContact(request, env, url);
		}

		// 评论系统：列表 / 投稿 / 撤回 / 待审 / 状态机 / 审计 / 迁移
		if (url.pathname === "/api/comments" && request.method === "GET") {
			return comments.handleList(request, env, url);
		}
		if (url.pathname === "/api/comments/submit" && request.method === "POST") {
			return comments.handleSubmit(request, env, url, ctx);
		}
		if (url.pathname === "/api/comments/delete" && request.method === "POST") {
			return comments.handleDelete(request, env);
		}
		if (url.pathname === "/api/comments/pending" && request.method === "GET") {
			return comments.handlePending(request, env, url);
		}
		if (url.pathname === "/api/comments/moderate" && request.method === "POST") {
			return comments.handleModerate(request, env);
		}
		if (url.pathname === "/api/comments/events" && request.method === "GET") {
			return comments.handleEvents(request, env, url);
		}
		if (url.pathname === "/api/comments/migrate" && request.method === "POST") {
			return comments.handleMigrate(request, env);
		}

		// 旧弹幕端点兼容层（thin alias，供页面缓存中的旧脚本过渡使用）
		if (url.pathname === "/api/danmaku" && request.method === "GET") {
			return comments.handleLegacyGet(request, env, url);
		}
		if (url.pathname === "/api/danmaku/submit" && request.method === "POST") {
			return comments.handleLegacySubmit(request, env, url, ctx);
		}
		if (url.pathname === "/api/danmaku/pending" && request.method === "GET") {
			return comments.handlePending(request, env, url);
		}
		if (url.pathname === "/api/danmaku/moderate" && request.method === "POST") {
			return comments.handleModerate(request, env);
		}

		// 实时共读：WebSocket 房间接入 / HTTP 快照
		if ((url.pathname === "/api/presence/ws" || url.pathname === "/api/presence") && request.method === "GET") {
			return handlePresence(request, env, url);
		}

		return json({ error: "not found", path: url.pathname }, 404);
	},
};
