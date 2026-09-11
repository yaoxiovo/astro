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
 *
 * 限流：单 IP 60 次/分钟，全局 600 次/分钟；敏感发信端点独立计数防刷。
 * 所有 API 响应带 CORS（Access-Control-Allow-Origin: *）。
 */

import {
	buildBroadcastHtml,
	buildContactAutoReplyHtml,
	buildContactNotificationHtml,
	buildVerificationHtml,
	buildWeeklyDigestHtml,
	sendEmail,
} from "./email-client.js";

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

/** 统一成功/失败 HTML 状态页展示 */
function htmlPage({ title, heading, message, buttonText = "返回博客", buttonUrl = BLOG_ORIGIN, isSuccess = true }) {
	const color = isSuccess ? "#2563eb" : "#dc2626";
	const icon = isSuccess ? "✅" : "⚠️";
	return new Response(
		`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Yaoxi Blog</title>
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
    <h1>${heading}</h1>
    <p>${message}</p>
    <a href="${buttonUrl}" class="btn">${buttonText}</a>
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

/** 管理员鉴权 */
function requireAdmin(request, env) {
	const token = env?.ADMIN_TOKEN;
	if (!token) return false;
	const auth = request.headers.get("Authorization") || "";
	if (auth.startsWith("Bearer ") && auth.slice(7) === token) return true;
	const url = new URL(request.url);
	return url.searchParams.get("secret") === token;
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

/** 通用限流检查（单 IP + 全局） */
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
		} else {
			globalCount = globalData.count;
			globalWindowStart = globalData.windowStart;
		}
	}

	if (ipCount >= RATE_LIMIT.IP_MAX || globalCount >= RATE_LIMIT.GLOBAL_MAX) {
		return { allowed: false, retryAfter: 60, ipCount, globalCount };
	}

	const shouldWrite = ipCount % 5 === 0 || ipCount >= RATE_LIMIT.IP_MAX - 5 || globalCount % 5 === 0;

	if (shouldWrite) {
		const ttl = RATE_LIMIT.KV_TTL;
		await Promise.all([
			setRateCount(env, ipKey, { count: ipCount + 1, windowStart: ipWindowStart }, ttl),
			setRateCount(env, globalKey, { count: globalCount + 1, windowStart: globalWindowStart }, ttl),
		]);
	}

	return { allowed: true, retryAfter: 0, ipCount: ipCount + 1, globalCount: globalCount + 1 };
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

	for (const sub of list) {
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

		const res = await sendEmail(env, {
			to: sub.email,
			subject: `【新文章】${body.title} - 瑶曦 Blog`,
			html,
			prefix: "notify",
			headers: {
				"List-Unsubscribe": `<${unsubUrl}>`,
				"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
			},
		});

		if (res.ok) {
			sentCount++;
		} else {
			failCount++;
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

	// 批量发送给活跃订阅者
	let list = [];
	try {
		const rawList = await kv.get("sub:list");
		list = rawList ? JSON.parse(rawList) : [];
	} catch {}

	let sentCount = 0;
	let failCount = 0;

	for (const sub of list) {
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

		const res = await sendEmail(env, {
			to: sub.email,
			subject: `📊【每周精选】瑶曦 Blog 周报 (${weekRange})`,
			html,
			prefix: "bot",
			headers: {
				"List-Unsubscribe": `<${unsubUrl}>`,
				"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
			},
		});

		if (res.ok) sentCount++;
		else failCount++;
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
					"POST /api/newsletter/subscribe": "读者邮箱订阅（发送 Double Opt-in 激活邮件）",
					"GET /api/newsletter/verify": "激活订阅链接（通过邮件中的 Token 激活）",
					"GET /api/newsletter/unsubscribe": "一键退订链接",
					"POST /api/newsletter/broadcast": "批量向订阅者广播新文章通知（需 ADMIN_TOKEN）",
					"POST /api/newsletter/weekly-digest": "批量向订阅者发送每周精选周报（需 ADMIN_TOKEN）",
					"POST /api/contact": "访客留言提交（站长工单通报 + 访客自动回执）",
				},
				rateLimit: {
					ip: `${RATE_LIMIT.IP_MAX} 次 / ${RATE_LIMIT.IP_WINDOW_MS / 1000} 秒`,
					global: `${RATE_LIMIT.GLOBAL_MAX} 次 / ${RATE_LIMIT.GLOBAL_WINDOW_MS / 1000} 秒`,
				},
			});
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

		return json({ error: "not found", path: url.pathname }, 404);
	},
};
