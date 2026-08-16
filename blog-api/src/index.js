/**
 * Yaoxi Blog API — 博客统一查询 API Worker
 *
 * 静态站无法在运行时处理查询参数，本 Worker 提供动态参数化接口：
 * 数据源 = 博客构建产物 https://blog.yaoxi.wiki/api/moments.json（Cache API 缓存 120s）
 *
 * 端点：
 *   GET /                    API 文档（参数说明）
 *   GET /api/moments         参数化朋友圈查询
 *     ?limit=5               返回条数（默认全部）
 *     &offset=10             分页偏移（配合 limit）
 *     &tag=日常              标签过滤（单标签）
 *     &author=瑶曦           作者过滤
 *     &date=2026-08-14       精确日期 YYYY-MM-DD
 *     &from=2026-08-01       日期范围起（含）
 *     &to=2026-08-31         日期范围止（含）
 *     &q=咖啡                关键词搜索（正文/标签/作者）
 *     &replies=0             0=仅顶层动态（排除回复）；1=仅回复；不传=全部
 *     &pinned=1              1=仅置顶
 *
 * 所有响应带 CORS（Access-Control-Allow-Origin: *），第三方可直接跨域调用。
 */
const BLOG_ORIGIN = "https://blog.yaoxi.wiki";
const MOMENTS_INDEX = `${BLOG_ORIGIN}/api/moments.json`;
const CACHE_TTL = 120; // 秒

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Cache-Control": "no-store",
};

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
	});
}

/** 拉取朋友圈索引（带 Cache API 缓存，源不可达时抛出） */
async function fetchMomentsIndex() {
	const cache = caches.default;
	const cacheKey = new Request(MOMENTS_INDEX, { method: "GET" });
	const cached = await cache.match(cacheKey);
	if (cached) {
		const body = await cached.json().catch(() => null);
		if (body?.moments) return body;
	}

	const res = await fetch(MOMENTS_INDEX, { signal: AbortSignal.timeout(10000) });
	if (!res.ok) throw new Error(`源站 ${MOMENTS_INDEX} 返回 HTTP ${res.status}`);
	const data = await res.json();
	if (!data?.moments) throw new Error("源站响应缺少 moments 字段");

	const toCache = new Response(JSON.stringify(data), {
		headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_TTL}` },
	});
	await cache.put(cacheKey, toCache);
	return data;
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
	async fetch(request) {
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
						limit: "返回条数（默认全部）",
						offset: "分页偏移",
						tag: "标签过滤（单标签）",
						author: "作者过滤",
						date: "精确日期 YYYY-MM-DD",
						from: "日期范围起（含）",
						to: "日期范围止（含）",
						q: "关键词搜索（正文/标签/作者）",
						replies: "0=仅顶层；1=仅回复；不传=全部",
						pinned: "1=仅置顶",
					},
				},
			});
		}

		if (url.pathname !== "/api/moments") {
			return json({ error: "not found", path: url.pathname }, 404);
		}

		const sp = url.searchParams;
		const limit = num(sp.get("limit"), null);
		const offset = Math.max(num(sp.get("offset"), 0), 0);
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
			data = await fetchMomentsIndex();
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

		return json({
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
		});
	},
};
