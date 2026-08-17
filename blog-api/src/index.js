/**
 * Yaoxi Blog API — 博客统一查询 API Worker
 *
 * 静态站无法在运行时处理查询参数，本 Worker 提供动态参数化接口：
 * 数据源 = 博客构建产物 https://blog.yaoxi.wiki/api/moments.json（Cache API 缓存 120s）
 *
 * 端点：
 *   GET /                    API 文档（参数说明）
 *   GET /api/moments         参数化朋友圈查询
 *     ?limit=5               返回条数（默认全部，上限 100）
 *     &offset=10             分页偏移（上限 10000）
 *     &tag=日常              标签过滤（单标签）
 *     &author=瑶曦           作者过滤
 *     &date=2026-08-14       精确日期 YYYY-MM-DD
 *     &from=2026-08-01       日期范围起（含）
 *     &to=2026-08-31         日期范围止（含）
 *     &q=咖啡                关键词搜索（正文/标签/作者）
 *     &replies=0             0=仅顶层动态（排除回复）；1=仅回复；不传=全部
 *     &pinned=1              1=仅置顶
 *
 * 限流：单 IP 60 次/分钟，全局 600 次/分钟，超限 429。
 * 所有响应带 CORS（Access-Control-Allow-Origin: *），第三方可直接跨域调用。
 */
const BLOG_ORIGIN = "https://blog.yaoxi.wiki";
const MOMENTS_INDEX = `${BLOG_ORIGIN}/api/moments.json`;
const CACHE_TTL = 120; // 秒

// ---- 限流配置（防别人刷爆 + 防自己回源风暴） ----
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
};

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200, extraHeaders = {}) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS, ...extraHeaders },
	});
}

function tooManyRequests(retryAfter = 60) {
	return json(
		{ error: "rate limited", message: "请求过于频繁，请稍后再试" },
		429,
		{ "Retry-After": String(retryAfter) },
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

/** 安全读取 KV 计数（失败返回 null，fail open） */
async function getRateCount(env, key) {
	if (!env?.RATE_LIMIT_KV) return null;
	try {
		const v = await env.RATE_LIMIT_KV.get(key);
		return v ? JSON.parse(v) : null;
	} catch {
		return null;
	}
}

/** 安全写入 KV 计数（失败不影响主流程） */
async function setRateCount(env, key, data, ttl) {
	if (!env?.RATE_LIMIT_KV) return;
	try {
		await env.RATE_LIMIT_KV.put(key, JSON.stringify(data), { expirationTtl: ttl });
	} catch {
		// fail open：限流计数写失败不阻塞请求
	}
}

/**
 * 限流检查（单 IP + 全局）
 * - 未配置 RATE_LIMIT_KV 时不限流（本地开发兼容）
 * - KV 故障时 fail open，允许请求
 * - 采用近似计数：每 5 次才写一次，牺牲少量精度换 KV 写入额度
 * 返回 { allowed, retryAfter, ipCount, globalCount }
 */
async function checkRateLimit(env, ip) {
	if (!env?.RATE_LIMIT_KV) return { allowed: true, retryAfter: 0, ipCount: 0, globalCount: 0 };

	const now = Date.now();
	const ipKey = `rate:ip:${ip}`;
	const globalKey = "rate:global";

	const [ipData, globalData] = await Promise.all([
		getRateCount(env, ipKey),
		getRateCount(env, globalKey),
	]);

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

	// 近似写入：每 5 次或接近阈值时才落盘，控制 KV 写入量
	const shouldWrite =
		ipCount % 5 === 0 ||
		globalCount % 5 === 0 ||
		ipCount > RATE_LIMIT.IP_MAX - 10 ||
		globalCount > RATE_LIMIT.GLOBAL_MAX - 50;

	if (shouldWrite) {
		await Promise.all([
			setRateCount(env, ipKey, { count: ipCount + 5, windowStart: ipWindowStart }, RATE_LIMIT.KV_TTL),
			setRateCount(env, globalKey, { count: globalCount + 5, windowStart: globalWindowStart }, RATE_LIMIT.KV_TTL),
		]);
	}

	return { allowed: true, retryAfter: 0, ipCount: ipCount + 1, globalCount: globalCount + 1 };
}

/** 拉取朋友圈索引（带 Cache API 缓存 + 源站熔断） */
async function fetchMomentsIndex(env) {
	const cache = caches.default;
	const cacheKey = new Request(MOMENTS_INDEX, { method: "GET" });

	// ---- 熔断：源站连续失败次数过多时，短期不再回源 ----
	let failCount = 0;
	if (env?.RATE_LIMIT_KV) {
		try {
			failCount = Number(await env.RATE_LIMIT_KV.get("upstream:fail")) || 0;
		} catch {}
	}
	if (failCount >= RATE_LIMIT.UPSTREAM_FAIL_THRESHOLD) {
		// 熔断期内优先返回缓存（即使过期）
		const cached = await cache.match(cacheKey);
		if (cached) {
			const body = await cached.json().catch(() => null);
			if (body?.moments) return body;
		}
		throw new Error("源站连续失败，已熔断");
	}

	// 优先用缓存
	const cached = await cache.match(cacheKey);
	if (cached) {
		const body = await cached.json().catch(() => null);
		if (body?.moments) return body;
	}

	// 回源
	try {
		const res = await fetch(MOMENTS_INDEX, { signal: AbortSignal.timeout(10000) });
		if (!res.ok) throw new Error(`源站 ${MOMENTS_INDEX} 返回 HTTP ${res.status}`);
		const data = await res.json();
		if (!data?.moments) throw new Error("源站响应缺少 moments 字段");

		const toCache = new Response(JSON.stringify(data), {
			headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_TTL}` },
		});
		await cache.put(cacheKey, toCache);

		// 成功：清零失败计数
		if (env?.RATE_LIMIT_KV) {
			try {
				await env.RATE_LIMIT_KV.delete("upstream:fail");
			} catch {}
		}
		return data;
	} catch (err) {
		// 失败：累加计数，到期自动过期
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

/** YYYY-MM-DD -> Date（无效返回 null） */
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

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		// 文档
		if (url.pathname === "/" || url.pathname === "/api") {
			return json({
				name: "Yaoxi Blog API",
				source: BLOG_ORIGIN,
				endpoints: {
					"GET /api/moments": "参数化朋友圈查询",
					params: {
						limit: "返回条数（默认全部，上限 100）",
						offset: "分页偏移（上限 10000）",
						tag: "标签过滤（单标签）",
						author: "作者过滤",
						date: "精确日期 YYYY-MM-DD",
						from: "日期范围起（含）",
						to: "日期范围止（含）",
						q: "关键词搜索（正文/标签/作者）",
						replies: "0=仅顶层；1=仅回复；不传=全部",
						pinned: "1=仅置顶",
					},
					rateLimit: {
						ip: `${RATE_LIMIT.IP_MAX} 次 / ${RATE_LIMIT.IP_WINDOW_MS / 1000} 秒`,
						global: `${RATE_LIMIT.GLOBAL_MAX} 次 / ${RATE_LIMIT.GLOBAL_WINDOW_MS / 1000} 秒`,
					},
				},
			});
		}

		if (url.pathname !== "/api/moments") {
			return json({ error: "not found", path: url.pathname }, 404);
		}

		// ---- 限流：防别人 + 防自己 ----
		const ip = getClientIp(request);
		const { allowed, retryAfter, ipCount } = await checkRateLimit(env, ip);
		if (!allowed) {
			return tooManyRequests(retryAfter);
		}

		// ---- 参数上限保护 ----
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

		// ---- 参数过滤 ----
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

		// ---- 分页 ----
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
	},
};
