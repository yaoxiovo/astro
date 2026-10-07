/**
 * 瑶曦评论系统 · 统一互动存储与审核模块（D1）
 *
 * 数据模型（见 migrations/0001_comments.sql）：
 *   comments       弹幕（kind=danmaku）与评论（kind=comment）统一存储，楼中楼两层
 *   comment_events 全量审计流水（create/approve/reject/delete/restore/migrate）
 *
 * 身份：投稿可选携带认证中心 SSO 的 Bearer JWT（见 jwt.js），验签通过即绑定
 *       sub/username 并打「已认证」徽标；验签失败静默降级游客（不打断投稿）。
 *
 * 审核状态机（transitions 表）：
 *   pending  → approve → approved / reject → rejected
 *   approved → reject  → rejected / delete → deleted（作者撤回或管理员下架）
 *   rejected → restore → approved（误杀恢复）
 *   deleted  → restore → approved（误删恢复）
 *   所有流转均写入 comment_events，杜绝「reject 即蒸发」的黑箱。
 *
 * 迁移：POST /api/comments/migrate 一次性把旧 KV 弹幕（dm:live:/dm:pending:）
 *       幂等导入 D1（INSERT OR IGNORE，KV 原键保留作回滚安全网）。
 *
 * 依赖注入：createCommentsModule(deps) 接收 index.js 的 json / 限流 / 鉴权 /
 *           存储等基础能力，resolveIdentity 为 jwt.js 的 SSO 身份解析。
 */

const BLOG_ORIGIN = "https://blog.yaoxi.wiki";

const CM_CONFIG = {
	MAX_DANMAKU: 100, // 弹幕正文长度上限
	MAX_COMMENT: 500, // 评论正文长度上限
	MAX_AUTHOR: 20, // 昵称长度上限
	MAX_EXCERPT: 60, // 段落锚定摘录长度上限
	MAX_PARA: 5000, // 段落索引上限
	PAGE_DEFAULT: 30, // 列表默认页大小
	PAGE_MAX: 50, // 列表页大小上限
	LEGACY_MAX: 1000, // 旧接口单篇返回上限（防御性）
	PENDING_LIST_MAX: 100, // 待审列表单次返回上限
	EVENTS_LIST_MAX: 200, // 审计流水单次返回上限
	SUBMIT_IP_MAX: 5, // 单 IP 10 分钟最多投稿 5 条
	SUBMIT_WINDOW_MS: 600_000,
	DUP_TTL: 600, // 投稿去重窗口：10 分钟
	MIGRATE_BATCH: 50, // 迁移写库批大小
	MIGRATE_CONCURRENCY: 20, // 迁移 KV 读取并发
};

/** 弹幕颜色白名单（前端色板同源，杜绝任意样式注入） */
const CM_COLORS = ["#ff6b81", "#ff9f43", "#feca57", "#48dbfb", "#54a0ff", "#a29bfe", "#1dd1a1"];

/** post slug 白名单：字母数字（含中日韩）、下划线、连字符、点、斜杠 */
const CM_POST_RE = /^[\p{L}\p{N}_\-./]{1,120}$/u;
const CM_ID_RE = /^[a-z0-9]{6,24}$/;
const CM_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** 审核状态机：action → { from 合法前置状态, to 目标状态 } */
const CM_TRANSITIONS = {
	approve: { from: ["pending", "rejected"], to: "approved" },
	reject: { from: ["pending", "approved"], to: "rejected" },
	delete: { from: ["pending", "approved", "rejected"], to: "deleted" },
	restore: { from: ["rejected", "deleted"], to: "approved" },
};

export function createCommentsModule(deps) {
	const {
		json,
		tooManyRequests,
		getClientIp,
		requireAdmin,
		getStorageKv,
		checkEndpointRateLimit,
		checkRateLimit,
		htmlEsc,
		resolveIdentity,
	} = deps;

	/** 校验并归一化文章 slug（防路径穿越 / 非法值） */
	function sanitizePost(slug) {
		const s = String(slug || "").trim().replace(/^\/+|\/+$/g, "");
		if (!s || s.includes("..") || !CM_POST_RE.test(s)) return null;
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

	/** IP 隐私哈希：sha256(salt|ip) 截断 24 hex，仅用于审计与反滥用 */
	async function hashIp(env, ip) {
		const salt = String(env?.COMMENT_IP_SALT || "yaoxi-comment");
		const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${ip}`));
		return Array.from(new Uint8Array(digest).slice(0, 12))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	function getDb(env) {
		return env?.DB || null;
	}

	/** DB 行 → 公开 API 条目（不泄露 ip_hash / ua / user_sub） */
	function rowToItem(row) {
		const item = {
			id: row.id,
			kind: row.kind,
			p: row.p == null ? null : row.p,
			x: row.x || "",
			body: row.body,
			author: row.author,
			username: row.username || null,
			verified: !!row.user_sub,
			ts: row.created_at,
			parentId: row.parent_id || null,
			rootId: row.root_id || null,
		};
		if (row.kind === "danmaku") item.color = row.color || CM_COLORS[0];
		return item;
	}

	/** 并发受限的批量映射（迁移读 KV 用） */
	async function mapLimit(items, limit, fn) {
		const out = [];
		for (let i = 0; i < items.length; i += limit) {
			out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
		}
		return out;
	}

	/**
	 * Telegram 审核通知：待审内容推送至站长（cm:ok / cm:no 内联按钮）
	 * 未配置 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 时静默跳过（仍可经 /dm 命令管理）
	 */
	async function notifyTelegram(env, row, mode, parentAuthor) {
		const token = env?.TELEGRAM_BOT_TOKEN;
		const chatId = env?.TELEGRAM_CHAT_ID;
		if (!token || !chatId) return;

		const kindBadge = row.kind === "danmaku" ? "💨 弹幕" : "💬 评论";
		const head =
			mode === "live"
				? `${kindBadge} <b>新内容已自动上墙</b>`
				: `${kindBadge} <b>新内容待审核</b>`;
		const identityLine = row.user_sub
			? `✅ 已认证 <code>${htmlEsc(row.username || "reader")}</code>`
			: `👤 ${htmlEsc(row.author)}`;
		const replyLine = parentAuthor ? `\n↩️ 回复 <b>${htmlEsc(parentAuthor)}</b>` : "";
		const anchorLine =
			row.kind === "danmaku"
				? `\n📍 第 ${(row.p || 0) + 1} 段「${htmlEsc(row.x || "（无摘录）")}」`
				: row.p != null
					? `\n📍 锚定第 ${row.p + 1} 段`
					: "";
		const colorLine = row.kind === "danmaku" ? ` · 🎨 <code>${htmlEsc(row.color || CM_COLORS[0])}</code>` : "";
		const tail =
			mode === "live"
				? "\n\n✅ 已直接展示（DANMAKU_AUTO_APPROVE 模式）"
				: "\n\n点击下方按钮放行或拒绝喵~";
		const text =
			`${head}\n\n` +
			`📄 ${htmlEsc(row.post)}\n` +
			`${identityLine}${colorLine}${replyLine}${anchorLine}\n` +
			`🔗 <a href="${BLOG_ORIGIN}/posts/${encodeURIComponent(row.post).replace(/%2F/gi, "/")}/">打开文章</a>` +
			`\n\n──────────\n<b>${htmlEsc(row.body)}</b>` +
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
						{ text: "✅ 放行", callback_data: `cm:ok:${row.id}` },
						{ text: "❌ 拒绝", callback_data: `cm:no:${row.id}` },
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
			console.warn("[comments] Telegram 通知失败:", e);
		}
	}

	/** GET /api/comments?post=&kind=&p=&limit=&before= — 公开拉取已通过内容（根分页 + 回复全量装配） */
	async function handleList(request, env, url) {
		const post = sanitizePost(url.searchParams.get("post"));
		if (!post) return json({ error: "invalid_post", message: "缺少或非法的 post 参数" }, 400);

		const db = getDb(env);
		if (!db) return json({ post, total: 0, items: [] });

		const kindRaw = String(url.searchParams.get("kind") || "all");
		const kind = kindRaw === "danmaku" || kindRaw === "comment" ? kindRaw : "all";
		// 注意：Number(null) === 0，缺参必须显式判空，否则会误加 p=0 过滤条件
		const pParam = url.searchParams.get("p");
		const pNum = pParam === null ? Number.NaN : Number(pParam);
		const pFilter = Number.isInteger(pNum) && pNum >= 0 && pNum <= CM_CONFIG.MAX_PARA ? pNum : null;
		const limitParam = url.searchParams.get("limit");
		const limitNum = limitParam === null ? Number.NaN : Number(limitParam);
		const limit = Number.isInteger(limitNum) && limitNum > 0 ? Math.min(limitNum, CM_CONFIG.PAGE_MAX) : CM_CONFIG.PAGE_DEFAULT;
		const before = Number(url.searchParams.get("before")) || 0;

		const where = ["post = ?", "status = 'approved'", "parent_id IS NULL"];
		const args = [post];
		if (kind !== "all") {
			where.push("kind = ?");
			args.push(kind);
		}
		if (pFilter !== null) {
			where.push("p = ?");
			args.push(pFilter);
		}
		if (before > 0) {
			where.push("created_at < ?");
			args.push(before);
		}

		const totalWhere = ["post = ?", "status = 'approved'"];
		const totalArgs = [post];
		if (kind !== "all") {
			totalWhere.push("kind = ?");
			totalArgs.push(kind);
		}

		// 可选身份：携带 SSO JWT 时给「自己的评论」打 mine 标记，供前端显示撤回按钮
		const identity = await resolveIdentity(request, env);

		const [rootsRes, totalRow] = await Promise.all([
			db
				.prepare(`SELECT * FROM comments WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
				.bind(...args, limit)
				.all(),
			db.prepare(`SELECT COUNT(*) AS n FROM comments WHERE ${totalWhere.join(" AND ")}`).bind(...totalArgs).first(),
		]);

		const rootRows = rootsRes.results || [];
		const items = rootRows.map((r) => {
			const it = rowToItem(r);
			if (identity && r.user_sub === identity.sub) it.mine = true;
			return it;
		});

		// 楼中楼装配：根下回复一次性全量拉取（回复量级小），并标注「回复 @谁」
		if (rootRows.length > 0) {
			const ids = rootRows.map((r) => r.id);
			const placeholders = ids.map(() => "?").join(",");
			const repliesRes = await db
				.prepare(
					`SELECT * FROM comments WHERE root_id IN (${placeholders}) AND parent_id IS NOT NULL AND status = 'approved' ORDER BY created_at ASC`,
				)
				.bind(...ids)
				.all();
			const replyRows = repliesRes.results || [];

			const authorById = new Map();
			for (const r of rootRows) authorById.set(r.id, { author: r.username || r.author, verified: !!r.user_sub });
			for (const r of replyRows) authorById.set(r.id, { author: r.username || r.author, verified: !!r.user_sub });

			const byRoot = new Map();
			for (const r of replyRows) {
				const item = rowToItem(r);
				const target = authorById.get(r.parent_id);
				if (target) item.replyTo = { author: target.author, verified: target.verified };
				if (identity && r.user_sub === identity.sub) item.mine = true;
				if (!byRoot.has(r.root_id)) byRoot.set(r.root_id, []);
				byRoot.get(r.root_id).push(item);
			}
			for (const it of items) it.replies = byRoot.get(it.id) || [];
		}

		// 携带身份时响应含 per-user 的 mine 标记，禁止任何共享缓存
		const cacheControl = identity ? "private, no-store" : "public, max-age=30, s-maxage=60";
		return json({ post, total: Number(totalRow?.n || 0), items }, 200, { "Cache-Control": cacheControl });
	}

	/** 提交核心（新端点与旧 /api/danmaku/submit 兼容层共用） */
	async function processSubmit(request, env, ctx, body) {
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
			"cm",
			CM_CONFIG.SUBMIT_IP_MAX,
			CM_CONFIG.SUBMIT_WINDOW_MS,
		);
		if (!ipAllowed) return tooManyRequests(600, "内容发得太快啦，歇一会儿再发喵~");

		const db = getDb(env);
		if (!db) return json({ error: "db_not_configured", message: "评论存储未配置" }, 500);

		const post = sanitizePost(body.post);
		if (!post) return json({ error: "invalid_post", message: "目标文章不存在或非法" }, 400);

		const kind = body.kind === "danmaku" ? "danmaku" : "comment";
		const maxLen = kind === "danmaku" ? CM_CONFIG.MAX_DANMAKU : CM_CONFIG.MAX_COMMENT;
		const text = sanitizeText(body.t ?? body.body, maxLen);
		if (text.length < 1) {
			return json({ error: "invalid_text", message: "内容不能为空" }, 400);
		}

		const identity = await resolveIdentity(request, env);

		// 回复目标（仅评论支持楼中楼；弹幕不可回复）
		let parentId = null;
		let rootId = null;
		let parentAuthor = null;
		const rawParent = String(body.parentId || "").trim();
		if (rawParent && kind !== "comment") {
			return json({ error: "invalid_parent", message: "弹幕不支持回复喵" }, 400);
		}
		if (rawParent) {
			if (!CM_ID_RE.test(rawParent)) {
				return json({ error: "invalid_parent", message: "回复目标非法" }, 400);
			}
			const parent = await db
				.prepare("SELECT id, post, kind, parent_id, root_id, author, username, user_sub, status FROM comments WHERE id = ?")
				.bind(rawParent)
				.first();
			if (!parent || parent.post !== post || parent.status !== "approved" || parent.kind !== "comment") {
				return json({ error: "parent_not_found", message: "回复目标不存在或不可回复" }, 404);
			}
			parentId = parent.id;
			rootId = parent.parent_id ? parent.root_id || parent.id : parent.id;
			parentAuthor = parent.username || parent.author;
		}

		// 昵称与身份：认证用户固定使用 SSO 昵称（防冒充），游客自填
		let author;
		let userSub = null;
		let username = null;
		if (identity) {
			userSub = identity.sub;
			username = identity.username || "";
			author = (identity.username || "已认证读者").slice(0, CM_CONFIG.MAX_AUTHOR);
		} else {
			author = sanitizeText(body.a, CM_CONFIG.MAX_AUTHOR) || "匿名";
		}

		// 段落锚定：弹幕必有段落（默认首段），评论可选
		const pRaw = Number(body.p);
		let p = Number.isInteger(pRaw) && pRaw >= 0 && pRaw <= CM_CONFIG.MAX_PARA ? pRaw : null;
		if (kind === "danmaku" && p === null) p = 0;
		const excerpt = sanitizeText(body.x, CM_CONFIG.MAX_EXCERPT);

		// 颜色仅弹幕有意义（白名单校验）
		const color =
			kind === "danmaku" && CM_COLOR_RE.test(String(body.c || "")) && CM_COLORS.includes(String(body.c).toLowerCase())
				? String(body.c).toLowerCase()
				: kind === "danmaku"
					? CM_COLORS[0]
					: null;

		// 去重指纹：同文章 + 同类型 + 同回复目标 + 同内容，10 分钟内只收一次
		const kv = getStorageKv(env);
		if (kv) {
			const dupKey = `cm:dup:${fingerprint(`${post}|${kind}|${parentId || ""}|${text}`)}`;
			try {
				if (await kv.get(dupKey)) {
					return json({ ok: true, mode: "pending", message: "刚刚已经发送过相同内容啦喵~" });
				}
				await kv.put(dupKey, "1", { expirationTtl: CM_CONFIG.DUP_TTL });
			} catch {}
		}

		const autoApprove = ["1", "true", "yes"].includes(String(env?.DANMAKU_AUTO_APPROVE || "").toLowerCase());
		const status = autoApprove ? "approved" : "pending";
		const id = genId();
		const now = Date.now();
		const ipHash = await hashIp(env, ip);
		const ua = String(request.headers.get("User-Agent") || "").slice(0, 200);

		try {
			await db.batch([
				db
					.prepare(
						"INSERT INTO comments (id, post, kind, p, x, body, author, color, user_sub, username, status, parent_id, root_id, ip_hash, ua, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
					)
					.bind(id, post, kind, p, excerpt, text, author, color, userSub, username, status, parentId, rootId, ipHash, ua, now),
				db
					.prepare("INSERT INTO comment_events (comment_id, action, actor, meta, created_at) VALUES (?, 'create', ?, ?, ?)")
					.bind(id, userSub || "guest", JSON.stringify({ kind, mode: autoApprove ? "auto-approved" : "pending" }), now),
			]);
		} catch (e) {
			console.warn("[comments] 提交写库失败:", e);
			return json({ error: "db_error", message: "存储故障，稍后再试喵" }, 500);
		}

		const notifyRow = { id, post, kind, p, x: excerpt, body: text, author, color, username, user_sub: userSub };
		if (ctx?.waitUntil) ctx.waitUntil(notifyTelegram(env, notifyRow, autoApprove ? "live" : "pending", parentAuthor));

		return json({
			ok: true,
			mode: autoApprove ? "live" : "pending",
			id,
			message: autoApprove ? "已上墙喵~" : "已提交，等待站长审核后上墙喵~",
		});
	}

	/** POST /api/comments/submit — 读者投稿（蜜罐 + 双层限流 + 去重 + SSO 身份绑定） */
	async function handleSubmit(request, env, url, ctx) {
		const body = await request.json().catch(() => null);
		if (!body) return json({ error: "invalid_body", message: "无效的请求数据" }, 400);
		return processSubmit(request, env, ctx, body);
	}

	/** POST /api/danmaku/submit — 旧弹幕投稿兼容层（字段映射为 kind=danmaku） */
	async function handleLegacySubmit(request, env, url, ctx) {
		const body = await request.json().catch(() => null);
		if (!body) return json({ error: "invalid_body", message: "无效的请求数据" }, 400);
		return processSubmit(request, env, ctx, { ...body, kind: "danmaku" });
	}

	/** POST /api/comments/delete — 作者撤回自己的评论（软删 + 审计） */
	async function handleDelete(request, env) {
		const identity = await resolveIdentity(request, env);
		if (!identity) return json({ error: "unauthorized", message: "请先登录再撤回评论喵" }, 401);

		const body = await request.json().catch(() => null);
		const id = String(body?.id || "").trim();
		if (!CM_ID_RE.test(id)) return json({ error: "invalid_body", message: "参数缺失或非法（id）" }, 400);

		const db = getDb(env);
		if (!db) return json({ error: "db_not_configured", message: "评论存储未配置" }, 500);

		const row = await db.prepare("SELECT id, user_sub, status, post FROM comments WHERE id = ?").bind(id).first();
		if (!row) return json({ error: "not_found", message: "评论不存在" }, 404);
		if (row.user_sub !== identity.sub) {
			return json({ error: "forbidden", message: "只能撤回自己的评论喵" }, 403);
		}
		if (row.status === "deleted") {
			return json({ ok: true, action: "delete", post: row.post, message: "该评论已撤回" });
		}

		const now = Date.now();
		await db.batch([
			db
				.prepare("UPDATE comments SET status = 'deleted', updated_at = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?")
				.bind(now, `author:${identity.sub}`, now, id),
			db
				.prepare("INSERT INTO comment_events (comment_id, action, actor, meta, created_at) VALUES (?, 'delete', ?, ?, ?)")
				.bind(id, identity.sub, JSON.stringify({ by: "author" }), now),
		]);

		return json({ ok: true, action: "delete", post: row.post, message: "已撤回喵~" });
	}

	/** GET /api/comments/pending — 待审列表（管理员） */
	async function handlePending(request, env, url) {
		if (!requireAdmin(request, env)) {
			return json({ error: "unauthorized", message: "缺少管理员鉴权令牌" }, 401);
		}
		const db = getDb(env);
		if (!db) return json({ error: "db_not_configured", message: "评论存储未配置" }, 500);

		const kindRaw = String(url?.searchParams?.get("kind") || "");
		const where = ["status = 'pending'"];
		const args = [];
		if (kindRaw === "danmaku" || kindRaw === "comment") {
			where.push("kind = ?");
			args.push(kindRaw);
		}

		const res = await db
			.prepare(`SELECT * FROM comments WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
			.bind(...args, CM_CONFIG.PENDING_LIST_MAX)
			.all();

		return json({ total: (res.results || []).length, items: (res.results || []).map(rowToItem) });
	}

	/** POST /api/comments/moderate — 状态机流转：approve / reject / delete / restore（管理员） */
	async function handleModerate(request, env) {
		if (!requireAdmin(request, env)) {
			return json({ error: "unauthorized", message: "缺少管理员鉴权令牌" }, 401);
		}

		const body = await request.json().catch(() => null);
		const id = String(body?.id || "").trim();
		const action = String(body?.action || "").trim();
		if (!CM_ID_RE.test(id) || !CM_TRANSITIONS[action]) {
			return json({ error: "invalid_body", message: "参数缺失或非法（id / action）" }, 400);
		}

		const db = getDb(env);
		if (!db) return json({ error: "db_not_configured", message: "评论存储未配置" }, 500);

		const row = await db.prepare("SELECT id, post, kind, status FROM comments WHERE id = ?").bind(id).first();
		if (!row) {
			return json({ ok: false, error: "not_found", message: "该内容不存在或已被处理" }, 404);
		}

		const rule = CM_TRANSITIONS[action];
		if (!rule.from.includes(row.status)) {
			return json(
				{ ok: false, error: "invalid_transition", message: `当前状态（${row.status}）不允许执行 ${action}`, status: row.status },
				409,
			);
		}

		const now = Date.now();
		await db.batch([
			db
				.prepare("UPDATE comments SET status = ?, updated_at = ?, reviewed_by = 'admin', reviewed_at = ? WHERE id = ?")
				.bind(rule.to, now, now, id),
			db
				.prepare("INSERT INTO comment_events (comment_id, action, actor, meta, created_at) VALUES (?, ?, 'admin', ?, ?)")
				.bind(id, action, JSON.stringify({ from: row.status, to: rule.to }), now),
		]);

		return json({ ok: true, action, post: row.post, kind: row.kind, status: rule.to });
	}

	/** GET /api/comments/events — 审计流水（管理员，可按 comment_id 过滤） */
	async function handleEvents(request, env, url) {
		if (!requireAdmin(request, env)) {
			return json({ error: "unauthorized", message: "缺少管理员鉴权令牌" }, 401);
		}
		const db = getDb(env);
		if (!db) return json({ error: "db_not_configured", message: "评论存储未配置" }, 500);

		const commentId = String(url.searchParams.get("comment_id") || "").trim();
		let res;
		if (commentId && CM_ID_RE.test(commentId)) {
			res = await db
				.prepare(
					"SELECT id, comment_id, action, actor, meta, created_at FROM comment_events WHERE comment_id = ? ORDER BY created_at DESC LIMIT ?",
				)
				.bind(commentId, CM_CONFIG.EVENTS_LIST_MAX)
				.all();
		} else {
			res = await db
				.prepare(
					"SELECT id, comment_id, action, actor, meta, created_at FROM comment_events ORDER BY id DESC LIMIT ?",
				)
				.bind(CM_CONFIG.EVENTS_LIST_MAX)
				.all();
		}

		return json({ total: (res.results || []).length, items: res.results || [] });
	}

	/** POST /api/comments/migrate — 旧 KV 弹幕一次性迁移（管理员，幂等） */
	async function handleMigrate(request, env) {
		if (!requireAdmin(request, env)) {
			return json({ error: "unauthorized", message: "缺少管理员鉴权令牌" }, 401);
		}
		const kv = getStorageKv(env);
		if (!kv) return json({ error: "kv_not_configured", message: "KV 存储未配置" }, 500);
		const db = getDb(env);
		if (!db) return json({ error: "db_not_configured", message: "评论存储未配置" }, 500);

		const now = Date.now();

		// 1) 收集全部 dm:live: / dm:pending: 键（游标分页防截断）
		async function listAllKeys(prefix) {
			const keys = [];
			let cursor;
			do {
				const page = await kv.list({ prefix, cursor, limit: 1000 });
				keys.push(...page.keys.map((k) => k.name));
				cursor = page.list_complete ? undefined : page.cursor;
			} while (cursor);
			return keys;
		}

		const [liveKeys, pendingKeys] = await Promise.all([listAllKeys("dm:live:"), listAllKeys("dm:pending:")]);

		// 2) 拉取并归一化为待插入行
		function legacyRow(post, item, status) {
			const bodyText = sanitizeText(item?.t, CM_CONFIG.MAX_DANMAKU);
			if (!bodyText) return null;
			const ts = Number(item?.ts) > 0 ? Number(item.ts) : now;
			const pNum = Number(item?.p);
			return {
				id: CM_ID_RE.test(String(item?.id || "")) ? String(item.id) : genId(),
				post,
				p: Number.isInteger(pNum) && pNum >= 0 && pNum <= CM_CONFIG.MAX_PARA ? pNum : 0,
				x: sanitizeText(item?.x, CM_CONFIG.MAX_EXCERPT),
				body: bodyText,
				author: sanitizeText(item?.a, CM_CONFIG.MAX_AUTHOR) || "匿名",
				color: CM_COLORS.includes(String(item?.c || "").toLowerCase()) ? String(item.c).toLowerCase() : CM_COLORS[0],
				status,
				created_at: ts,
			};
		}

		const rows = [];

		// live：整篇数组
		const liveRaws = await mapLimit(liveKeys, CM_CONFIG.MIGRATE_CONCURRENCY, (key) =>
			kv.get(key).catch(() => null),
		);
		liveKeys.forEach((key, i) => {
			const post = key.slice("dm:live:".length);
			let arr = null;
			try {
				arr = JSON.parse(liveRaws[i] || "null");
			} catch {}
			if (!Array.isArray(arr)) return;
			for (const item of arr) {
				const row = legacyRow(item?.post || post, item, "approved");
				if (row) rows.push(row);
			}
		});

		// pending：单条独立键
		const pendingRaws = await mapLimit(pendingKeys, CM_CONFIG.MIGRATE_CONCURRENCY, (key) =>
			kv.get(key).catch(() => null),
		);
		pendingKeys.forEach((key, i) => {
			let item = null;
			try {
				item = JSON.parse(pendingRaws[i] || "null");
			} catch {}
			if (!item) return;
			const row = legacyRow(item.post, item, "pending");
			if (row) rows.push(row);
		});

		// 3) 分批写入（INSERT OR IGNORE 保证幂等；每条附带 migrate 审计事件）
		let inserted = 0;
		let skipped = 0;
		for (let i = 0; i < rows.length; i += CM_CONFIG.MIGRATE_BATCH) {
			const chunk = rows.slice(i, i + CM_CONFIG.MIGRATE_BATCH);
			const stmts = [];
			for (const r of chunk) {
				stmts.push(
					db
						.prepare(
							"INSERT OR IGNORE INTO comments (id, post, kind, p, x, body, author, color, user_sub, username, status, parent_id, root_id, ip_hash, ua, created_at, reviewed_by, reviewed_at) VALUES (?,?,?,?,?,?,?,?,NULL,NULL,?,NULL,NULL,NULL,NULL,?,?,?)",
						)
						.bind(
							r.id,
							r.post,
							"danmaku",
							r.p,
							r.x,
							r.body,
							r.author,
							r.color,
							r.status,
							r.created_at,
							r.status === "approved" ? "migrate" : null,
							r.status === "approved" ? r.created_at : null,
						),
					db
						.prepare("INSERT INTO comment_events (comment_id, action, actor, meta, created_at) VALUES (?, 'migrate', 'admin', ?, ?)")
						.bind(r.id, JSON.stringify({ from: r.status === "approved" ? "dm:live" : "dm:pending", status: r.status }), now),
				);
			}
			try {
				const results = await db.batch(stmts);
				for (let j = 0; j < results.length; j += 2) {
					if ((results[j]?.meta?.changes || 0) > 0) inserted++;
					else skipped++;
				}
			} catch (e) {
				console.warn("[comments] 迁移批次写入失败:", e);
			}
		}

		return json({
			ok: true,
			live_scanned: liveKeys.length,
			pending_scanned: pendingKeys.length,
			rows: rows.length,
			inserted,
			skipped,
			message: `迁移完成：命中 ${rows.length} 条，新增 ${inserted}，跳过（已存在）${skipped}。KV 原键保留。`,
		});
	}

	/** GET /api/danmaku?post= — 旧弹幕读取兼容层（字段名映射，供页面缓存旧脚本使用） */
	async function handleLegacyGet(request, env, url) {
		const post = sanitizePost(url.searchParams.get("post"));
		if (!post) return json({ error: "invalid_post", message: "缺少或非法的 post 参数" }, 400);

		const db = getDb(env);
		if (!db) return json({ post, total: 0, items: [] });

		const res = await db
			.prepare(
				"SELECT * FROM comments WHERE post = ? AND status = 'approved' AND kind = 'danmaku' ORDER BY created_at ASC LIMIT ?",
			)
			.bind(post, CM_CONFIG.LEGACY_MAX)
			.all();
		const items = (res.results || []).map((r) => ({
			id: r.id,
			p: r.p == null ? 0 : r.p,
			x: r.x || "",
			t: r.body,
			a: r.author,
			c: r.color || CM_COLORS[0],
			ts: r.created_at,
		}));

		return json(
			{ post, total: items.length, items },
			200,
			{ "Cache-Control": "public, max-age=60, s-maxage=180" },
		);
	}

	return {
		handleList,
		handleSubmit,
		handleLegacySubmit,
		handleLegacyGet,
		handleDelete,
		handlePending,
		handleModerate,
		handleEvents,
		handleMigrate,
	};
}
