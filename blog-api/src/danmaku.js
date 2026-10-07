/**
 * ⚠️ DEPRECATED（2026-10）：本模块已由 comments.js（D1 统一评论系统）整体取代，
 * 不再被 index.js 装配；/api/danmaku/* 现由 comments.js 的兼容层承接。
 * 保留本文件作迁移期参考（旧 KV 数据结构文档）。
 * 数据经 POST /api/comments/migrate 迁移并观察稳定后，可整体删除。
 *
 * —— 以下为历史实现说明 ——
 *
 * 瑶曦弹幕 · 段落锚定（Paragraph-anchored Danmaku）存储与审核模块
 *
 * KV-only 设计（复用现有 RATE_LIMIT_KV，零新增绑定）：
 *   dm:live:{post}      已上墙弹幕 JSON 数组（读取 1 次出全量，页面级请求成本恒定）
 *   dm:pending:{id}     待审弹幕单条独立键（写一次无 RMW 竞争，30 天自动过期）
 *   dm:dup:{hash}       10 分钟投稿去重指纹
 *
 * 审核流：投稿默认进入人工审核（Telegram 通知带 ✅/❌ 按钮），
 *       环境变量 DANMAKU_AUTO_APPROVE=true 时免审直接上墙。
 *
 * 依赖注入：本模块通过 createDanmakuModule(deps) 接收 index.js 的
 * json / 限流 / 鉴权 / 存储等基础能力，避免重复实现与循环依赖。
 */

const BLOG_ORIGIN = "https://blog.yaoxi.wiki";

const DM_CONFIG = {
	MIN_TEXT: 1,
	MAX_TEXT: 100, // 弹幕正文长度上限
	MAX_AUTHOR: 20, // 昵称长度上限
	MAX_EXCERPT: 60, // 段落锚定摘录长度上限
	MAX_PARA: 5000, // 段落索引上限
	LIVE_CAP: 600, // 单篇已上墙上限（超限丢弃最旧）
	PENDING_TTL: 2_592_000, // 待审条目 30 天自动过期
	DUP_TTL: 600, // 投稿去重窗口：10 分钟
	SUBMIT_IP_MAX: 5, // 单 IP 10 分钟最多投稿 5 条
	SUBMIT_WINDOW_MS: 600_000,
	PENDING_LIST_MAX: 100, // 待审列表单次返回上限
};

/** 弹幕颜色白名单（前端色板同源，杜绝任意样式注入） */
const DM_COLORS = ["#ff6b81", "#ff9f43", "#feca57", "#48dbfb", "#54a0ff", "#a29bfe", "#1dd1a1"];

/** post slug 白名单：字母数字（含中日韩）、下划线、连字符、点、斜杠 */
const DM_POST_RE = /^[\p{L}\p{N}_\-./]{1,120}$/u;
const DM_ID_RE = /^[a-z0-9]{6,24}$/;
const DM_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function createDanmakuModule(deps) {
	const { json, tooManyRequests, getClientIp, requireAdmin, getStorageKv, checkEndpointRateLimit, checkRateLimit, htmlEsc } =
		deps;

	/** 校验并归一化文章 slug（防路径穿越 / 非法 KV 键字符） */
	function sanitizePost(slug) {
		const s = String(slug || "").trim().replace(/^\/+|\/+$/g, "");
		if (!s || s.includes("..") || !DM_POST_RE.test(s)) return null;
		return s;
	}

	/** 正文净化：剥离控制字符与零宽字符，压缩空白 */
	function sanitizeText(t, maxLen) {
		return String(t ?? "")
			.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, maxLen);
	}

	/** djb2 指纹（用于投稿去重 KV 键） */
	function fingerprint(str) {
		let h = 5381;
		for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
		return h.toString(36);
	}

	function genId() {
		return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	}

	function maskIp(ip = "") {
		if (ip.includes(".")) {
			const p = ip.split(".");
			return p.length === 4 ? `${p[0]}.${p[1]}.***.${p[3]}` : ip;
		}
		if (ip.includes(":")) {
			const p = ip.split(":");
			return p.length > 2 ? `${p[0]}:${p[1]}:****` : ip;
		}
		return ip;
	}

	/** 读取某篇文章的已上墙弹幕（1 次 KV 读） */
	async function readLive(env, post) {
		const kv = getStorageKv(env);
		if (!kv) return [];
		try {
			const raw = await kv.get(`dm:live:${post}`);
			const arr = raw ? JSON.parse(raw) : [];
			return Array.isArray(arr) ? arr : [];
		} catch {
			return [];
		}
	}

	/** 追加到已上墙列表（仅站长审核侧调用，单写者无并发竞争） */
	async function appendLive(env, post, item) {
		const kv = getStorageKv(env);
		if (!kv) return -1;
		const list = await readLive(env, post);
		list.push(item);
		if (list.length > DM_CONFIG.LIVE_CAP) list.splice(0, list.length - DM_CONFIG.LIVE_CAP);
		await kv.put(`dm:live:${post}`, JSON.stringify(list));
		return list.length;
	}

	/**
	 * Telegram 审核通知：待审弹幕推送至站长（带 ✅/❌ 内联按钮）
	 * 未配置 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 时静默跳过（弹幕仍可经 /dm 命令管理）
	 */
	async function notifyTelegram(env, item, mode) {
		const token = env?.TELEGRAM_BOT_TOKEN;
		const chatId = env?.TELEGRAM_CHAT_ID;
		if (!token || !chatId) return;

		const head = mode === "live" ? "💬 <b>新弹幕已自动上墙</b>" : "💬 <b>新弹幕待审核</b>";
		const tail =
			mode === "live"
				? "\n\n✅ 已直接展示（DANMAKU_AUTO_APPROVE 模式）"
				: "\n\n点击下方按钮放行或拒绝喵~";
		const text =
			`${head}\n\n` +
			`📄 ${htmlEsc(item.post)}\n` +
			`📍 第 ${item.p + 1} 段「${htmlEsc(item.x || "（无摘录）")}」\n` +
			`👤 ${htmlEsc(item.a)} · 🎨 <code>${htmlEsc(item.c)}</code>\n` +
			`🔗 <a href="${BLOG_ORIGIN}/posts/${encodeURIComponent(item.post).replace(/%2F/gi, "/")}/">打开文章</a>` +
			`\n\n──────────\n<b>${htmlEsc(item.t)}</b>` +
			tail;

		const payload = {
			chat_id: chatId,
			text,
			parse_mode: "HTML",
			disable_web_page_preview: true,
		};
		if (mode !== "live") {
			payload.reply_markup = {
				inline_keyboard: [
					[
						{ text: "✅ 放行", callback_data: `dm:ok:${item.id}` },
						{ text: "❌ 拒绝", callback_data: `dm:no:${item.id}` },
					],
				],
			};
		}

		try {
			await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(8000),
			});
		} catch (e) {
			console.warn("[danmaku] Telegram 通知失败:", e);
		}
	}

	/** GET /api/danmaku?post=slug — 公开拉取某篇已上墙弹幕 */
	async function handleGet(request, env, url) {
		const post = sanitizePost(url.searchParams.get("post"));
		if (!post) return json({ error: "invalid_post", message: "缺少或非法的 post 参数" }, 400);

		const list = await readLive(env, post);
		const items = list.map((it) => ({
			id: it.id,
			p: it.p,
			x: it.x || "",
			t: it.t,
			a: it.a || "匿名",
			c: it.c || DM_COLORS[0],
			ts: it.ts || 0,
		}));

		return json(
			{ post, total: items.length, items },
			200,
			{ "Cache-Control": "public, max-age=60, s-maxage=180" },
		);
	}

	/** POST /api/danmaku/submit — 读者投稿（蜜罐 + 全局/单 IP 限流 + 去重） */
	async function handleSubmit(request, env, url, ctx) {
		const body = await request.json().catch(() => null);
		if (!body) return json({ error: "invalid_body", message: "无效的请求数据" }, 400);

		// 蜜罐：真实用户不可见字段被填写 → 假装成功丢弃
		if (body.website || body.honeypot) {
			return json({ ok: true, mode: "pending", message: "已提交，等待站长审核后上墙喵~" });
		}

		const ip = getClientIp(request);

		// 全局分钟级熔断 + 单 IP 专项限流（双层保护）
		const global = await checkRateLimit(env, ip);
		if (!global.allowed) return tooManyRequests(global.retryAfter);
		const ipAllowed = await checkEndpointRateLimit(
			env,
			ip,
			"dm",
			DM_CONFIG.SUBMIT_IP_MAX,
			DM_CONFIG.SUBMIT_WINDOW_MS,
		);
		if (!ipAllowed) return tooManyRequests(600, "弹幕发得太快啦，歇一会儿再发喵~");

		const post = sanitizePost(body.post);
		if (!post) return json({ error: "invalid_post", message: "目标文章不存在或非法" }, 400);

		const text = sanitizeText(body.t, DM_CONFIG.MAX_TEXT);
		if (text.length < DM_CONFIG.MIN_TEXT) {
			return json({ error: "invalid_text", message: "弹幕内容不能为空" }, 400);
		}

		const kv = getStorageKv(env);
		if (!kv) return json({ error: "kv_not_configured", message: "后端存储未配置" }, 500);

		// 去重指纹：同篇文章相同内容 10 分钟内只收一次
		const dupKey = `dm:dup:${fingerprint(`${post}|${text}`)}`;
		try {
			if (await kv.get(dupKey)) {
				return json({ ok: true, mode: "pending", message: "刚刚已经发送过相同的弹幕啦喵~" });
			}
			await kv.put(dupKey, "1", { expirationTtl: DM_CONFIG.DUP_TTL });
		} catch {}

		const pRaw = Number(body.p);
		const p = Number.isInteger(pRaw) && pRaw >= 0 && pRaw <= DM_CONFIG.MAX_PARA ? pRaw : 0;
		const author = sanitizeText(body.a, DM_CONFIG.MAX_AUTHOR) || "匿名";
		const color = DM_COLOR_RE.test(String(body.c || "")) && DM_COLORS.includes(String(body.c).toLowerCase())
			? String(body.c).toLowerCase()
			: DM_COLORS[0];
		const excerpt = sanitizeText(body.x, DM_CONFIG.MAX_EXCERPT);

		const id = genId();
		const item = {
			id,
			post,
			p,
			x: excerpt,
			t: text,
			a: author,
			c: color,
			ts: Date.now(),
			ip: maskIp(ip),
		};

		const autoApprove = ["1", "true", "yes"].includes(String(env?.DANMAKU_AUTO_APPROVE || "").toLowerCase());
		const mode = autoApprove ? "live" : "pending";

		if (autoApprove) {
			const total = await appendLive(env, post, { id, p, x: excerpt, t: text, a: author, c: color, ts: item.ts });
			if (total < 0) return json({ error: "kv_not_configured", message: "后端存储未配置" }, 500);
			if (ctx?.waitUntil) ctx.waitUntil(notifyTelegram(env, item, "live"));
			return json({ ok: true, mode: "live", total, message: "弹幕已上墙喵~" });
		}

		await kv.put(`dm:pending:${id}`, JSON.stringify(item), { expirationTtl: DM_CONFIG.PENDING_TTL });
		if (ctx?.waitUntil) ctx.waitUntil(notifyTelegram(env, item, "pending"));

		return json({
			ok: true,
			mode: "pending",
			message: "已提交，等待站长审核后上墙喵~",
		});
	}

	/** GET /api/danmaku/pending — 待审列表（管理员） */
	async function handlePending(request, env) {
		if (!requireAdmin(request, env)) {
			return json({ error: "unauthorized", message: "缺少管理员鉴权令牌" }, 401);
		}
		const kv = getStorageKv(env);
		if (!kv) return json({ error: "kv_not_configured", message: "KV 存储未配置" }, 500);

		let items = [];
		try {
			const listed = await kv.list({ prefix: "dm:pending:", limit: DM_CONFIG.PENDING_LIST_MAX });
			const raws = await Promise.all(
				listed.keys.map((k) => kv.get(k.name).catch(() => null)),
			);
			items = raws
				.filter(Boolean)
				.map((r) => {
					try {
						return JSON.parse(r);
					} catch {
						return null;
					}
				})
				.filter(Boolean);
		} catch (e) {
			console.warn("[danmaku] 待审列表读取失败:", e);
		}

		items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
		return json({ total: items.length, items });
	}

	/** POST /api/danmaku/moderate — 放行 / 拒绝（管理员，Telegram 按钮回调经 Bot 转发） */
	async function handleModerate(request, env) {
		if (!requireAdmin(request, env)) {
			return json({ error: "unauthorized", message: "缺少管理员鉴权令牌" }, 401);
		}

		const body = await request.json().catch(() => null);
		const id = String(body?.id || "").trim();
		const action = String(body?.action || "").trim();
		if (!DM_ID_RE.test(id) || !["approve", "reject"].includes(action)) {
			return json({ error: "invalid_body", message: "参数缺失或非法（id / action）" }, 400);
		}

		const kv = getStorageKv(env);
		if (!kv) return json({ error: "kv_not_configured", message: "KV 存储未配置" }, 500);

		const pendingKey = `dm:pending:${id}`;
		const raw = await kv.get(pendingKey);
		if (!raw) {
			return json({ ok: false, error: "not_found", message: "该弹幕不存在或已被处理" }, 404);
		}

		let item;
		try {
			item = JSON.parse(raw);
		} catch {
			await kv.delete(pendingKey).catch(() => {});
			return json({ ok: false, error: "corrupted", message: "弹幕数据损坏，已清理" }, 410);
		}

		let liveTotal = -1;
		if (action === "approve") {
			liveTotal = await appendLive(env, item.post, {
				id: item.id,
				p: item.p,
				x: item.x || "",
				t: item.t,
				a: item.a || "匿名",
				c: item.c || DM_COLORS[0],
				ts: item.ts || Date.now(),
			});
			if (liveTotal < 0) return json({ error: "kv_not_configured", message: "KV 存储未配置" }, 500);
		}
		await kv.delete(pendingKey).catch(() => {});

		return json({ ok: true, action, post: item.post, live_total: liveTotal });
	}

	return { handleGet, handleSubmit, handlePending, handleModerate };
}
