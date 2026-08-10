/**
 * Yaoxi Blog Telegram Bot v2
 * - Webhook 模式：Telegram 消息即时推送到 /webhook → 毫秒级响应命令
 * - Cron 每 10 分钟：新动态/新文章推送 + 时间胶囊到期提醒 + 每周日周报
 * - 命令：/start /help /subscribe /unsubscribe /latest /random /stats /search
 * - 创作：主人（CHAT_ID）直接发文字 → 自动生成 markdown 提交 GitHub → 自动部署上线
 * - 敏感配置（BOT_TOKEN / WEBHOOK_SECRET / GITHUB_PAT）走 wrangler secret，绝不入库
 */
const BLOG_ORIGIN = "https://blog.yaoxi.wiki";
const TG_API = "https://api.telegram.org/bot";
const GITHUB_API = "https://api.github.com";
const GITHUB_REPO = "yaoxiovo/astro";
const MOMENTS_DIR = "src/content/moments";

export default {
	async scheduled(event, env, ctx) {
		ctx.waitUntil(tick(env));
	},
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		// GET：健康检查 / 手动触发 / 诊断
		if (request.method === "GET") {
			if (url.pathname === "/tick") {
				await tick(env);
				return new Response("ticked");
			}
			if (url.pathname === "/err") {
				const err = (await env.BOT_KV.get("webhook_err")) || "(no error recorded)";
				return new Response(err, { headers: { "content-type": "text/plain" } });
			}
			return new Response("Yaoxi Blog Telegram Bot v2 (webhook mode).");
		}

		// POST /webhook：Telegram 更新入口（即时响应）
		if (url.pathname === "/webhook" && request.method === "POST") {
			const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
			if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
				return new Response("unauthorized", { status: 401 });
			}
			const update = await request.json().catch(() => null);
			if (update) {
				ctx.waitUntil(
					handleUpdate(env, update).catch(async (e) => {
						console.error("[webhook-handler]", e);
						await env.BOT_KV.put("webhook_err", String((e && e.stack) || e)).catch(() => {});
					})
				);
			}
			return new Response("ok");
		}

		return new Response("not found", { status: 404 });
	},
};

async function tick(env) {
	await checkMoments(env).catch((e) => console.error("[moments]", e));
	await checkPosts(env).catch((e) => console.error("[posts]", e));
	await checkCapsules(env).catch((e) => console.error("[capsules]", e));
	await checkWeekly(env).catch((e) => console.error("[weekly]", e));
}

/* ---------------- 命令处理（webhook 即时） ---------------- */
async function handleUpdate(env, u) {
	const msg = u.message || u.edited_message;
	if (!msg?.text || !msg.chat?.id) return;
	const chatId = msg.chat.id;
	const text = msg.text.trim();
	const isOwner = String(chatId) === String(env.CHAT_ID || "");
	try {
		if (text.startsWith("/start")) {
			await setSub(env, chatId, true);
			await send(env, chatId, "👋 欢迎订阅瑶曦的博客动态喵~\n\n📷 新朋友圈 / 📝 新文章会第一时间推送给你。\n\n命令：\n/latest — 最近 5 条动态\n/random — 随机一条朋友圈\n/stats — 朋友圈统计\n/search — 搜索朋友圈\n/subscribe — 订阅推送\n/unsubscribe — 退订\n/help — 帮助");
		} else if (text.startsWith("/help")) {
			await send(env, chatId, "🤖 <b>瑶曦博客 Bot 帮助</b>\n\n/latest — 最近 5 条朋友圈动态\n/random — 随机一条动态\n/stats — 朋友圈统计摘要\n/search 关键词 — 搜索朋友圈\n/subscribe — 订阅新动态推送\n/unsubscribe — 退订推送\n\n新朋友圈 / 新文章会自动推送给你喵~");
		} else if (text.startsWith("/subscribe")) {
			await setSub(env, chatId, true);
			await send(env, chatId, "✅ 已订阅推送，有新动态会第一时间通知你喵~");
		} else if (text.startsWith("/unsubscribe")) {
			await setSub(env, chatId, false);
			await send(env, chatId, "🚫 已退订。想重新订阅发 /subscribe 即可喵~");
		} else if (text.startsWith("/latest")) {
			await cmdLatest(env, chatId);
		} else if (text.startsWith("/random")) {
			await cmdRandom(env, chatId);
		} else if (text.startsWith("/stats")) {
			await cmdStats(env, chatId);
		} else if (text.startsWith("/search")) {
			await cmdSearch(env, chatId, text.replace(/^\/search\s*/, "").trim());
		} else if (text.startsWith("/")) {
			await send(env, chatId, "🤔 未知命令，发 /help 查看可用命令喵~");
		} else if (isOwner) {
			// 主人发普通文字 → 创建朋友圈动态
			await cmdCreate(env, chatId, text);
		} else {
			await send(env, chatId, "😿 只有主人可以在这里发动态喵~ 想订阅推送请发 /subscribe");
		}
	} catch (e) {
		console.error("[cmd]", chatId, text, e);
	}
}

/* ---------------- 新内容检查（Cron） ---------------- */
async function checkMoments(env) {
	const res = await fetch(`${BLOG_ORIGIN}/api/moments.json`, { signal: AbortSignal.timeout(10000) });
	const data = await res.json();
	if (!data?.moments?.length) return;
	const updated = data.updated || "";
	const latest = data.moments[0];
	const key = "last_moment";
	const prev = await env.BOT_KV.get(key);
	if (!prev) {
		await env.BOT_KV.put(key, `${updated}|${latest.slug}`);
		console.log("[moments] baseline set", latest.slug);
		return;
	}
	const [prevUpdated, prevSlug] = prev.split("|");
	if (prevUpdated === updated && prevSlug === latest.slug) return;

	const who = latest.author ? `👤 ${esc(latest.author)}\n` : "";
	const tags = tagsLine(latest.tags);
	if (latest.slug !== prevSlug) {
		const text = `📷 <b>新朋友圈动态</b>\n\n📅 ${fmtDate(latest.published)}\n${who}${esc(clip(latest.text, 220))}\n${tags}`;
		for (const cid of await recipients(env)) {
			await sendWithButton(env, cid, text, "🔗 查看详情", `${BLOG_ORIGIN}/moment/${latest.slug}/`);
		}
	} else {
		const text = `✏️ <b>动态更新</b>\n\n📅 ${fmtDate(latest.published)}\n\n${esc(clip(latest.text, 220))}`;
		for (const cid of await recipients(env)) await send(env, cid, text);
	}
	await env.BOT_KV.put(key, `${updated}|${latest.slug}`);
	console.log("[moments] pushed", latest.slug);
}

async function checkPosts(env) {
	const res = await fetch(`${BLOG_ORIGIN}/rss.xml`, { signal: AbortSignal.timeout(10000) });
	const xml = await res.text();
	const item = xml.match(/<item>([\s\S]*?)<\/item>/);
	if (!item) return;
	const block = item[1];
	const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
	const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
	const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
	if (!title || !link) return;
	const key = "last_post";
	const prev = await env.BOT_KV.get(key);
	if (!prev) {
		await env.BOT_KV.put(key, link);
		console.log("[posts] baseline set", link);
		return;
	}
	if (prev === link) return;
	const text = `📝 <b>新文章发布</b>\n\n📰 ${esc(htmlDecode(title))}\n🗓️ ${pubDate}\n\n点击下方按钮阅读全文喵~`;
	for (const cid of await recipients(env)) {
		await sendWithButton(env, cid, text, "📖 阅读文章", link);
	}
	await env.BOT_KV.put(key, link);
	console.log("[posts] pushed", link);
}

/** 时间胶囊到期提醒：每天第一次 tick 时检查，胶囊日期 <= 今天 → 推送 */
async function checkCapsules(env) {
	const res = await fetch(`${BLOG_ORIGIN}/api/moments/capsules.json`, { signal: AbortSignal.timeout(10000) });
	const data = await res.json();
	const list = data?.capsules || [];
	if (!list.length) return;
	const today = beijingDate();
	const dayKey = await env.BOT_KV.get("capsule_day");
	if (dayKey === today) return; // 今天已检查过
	for (const c of list) {
		if (!c.capsule) continue;
		const due = String(c.capsule).slice(0, 10);
		if (due <= today && !(await env.BOT_KV.get(`cap_${c.slug}`))) {
			const text = `⏳ <b>时间胶囊开启！</b>\n\n📦 你于 ${fmtDate(c.published)} 写给未来的动态，今天解封啦：\n\n${esc(clip(c.text, 200))}\n${tagsLine(c.tags)}`;
			for (const cid of await recipients(env)) {
				await sendWithButton(env, cid, text, "🔗 打开胶囊", `${BLOG_ORIGIN}/moment/${c.slug}/`);
			}
			await env.BOT_KV.put(`cap_${c.slug}`, today);
		}
	}
	await env.BOT_KV.put("capsule_day", today);
	console.log("[capsules] checked", today);
}

/** 周报：北京时间每周日推送本周动态汇总 */
async function checkWeekly(env) {
	const monday = beijingMonday(); // 本周一 YYYY-MM-DD
	const key = `weekly_${monday}`;
	if (await env.BOT_KV.get(key)) return;

	const res = await fetch(`${BLOG_ORIGIN}/api/moments.json`, { signal: AbortSignal.timeout(10000) });
	const data = await res.json();
	const moments = data?.moments || [];
	const week = moments.filter((m) => {
		try {
			return String(m.published).slice(0, 10) >= monday;
		} catch {
			return false;
		}
	});

	const tagCount = {};
	for (const m of week) for (const t of m.tags || []) tagCount[t] = (tagCount[t] || 0) + 1;
	const topTags = Object.entries(tagCount)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([t, n]) => `#${t}(${n})`)
		.join(" ");
	const imgs = week.reduce((n, m) => n + (m.images?.length || 0), 0);
	const vids = week.reduce((n, m) => n + (m.videos?.length || 0), 0);
	const latest = week[0];

	let text = `📊 <b>本周朋友圈周报</b>（${monday} ~ ${beijingDate()}）\n\n📝 新增动态 ${week.length} 条\n`;
	if (topTags) text += `🏷️ Top 标签：${topTags}\n`;
	if (imgs || vids) text += `🖼️ 图片 ${imgs} 张 · 🎬 视频 ${vids} 个\n`;
	if (latest) text += `\n🔗 最新：${esc(clip(latest.text, 60))}`;

	for (const cid of await recipients(env)) {
		if (latest) await sendWithButton(env, cid, text, "📖 查看最新", `${BLOG_ORIGIN}/moment/${latest.slug}/`);
		else await send(env, cid, text);
	}
	await env.BOT_KV.put(key, beijingDate());
	console.log("[weekly] pushed", monday, week.length);
}

/* ---------------- 命令实现 ---------------- */
async function cmdLatest(env, chatId) {
	const res = await fetch(`${BLOG_ORIGIN}/api/moments.json`, { signal: AbortSignal.timeout(10000) });
	const data = await res.json();
	const items = (data?.moments || []).slice(0, 5);
	if (!items.length) return send(env, chatId, "还没有动态喵~");
	const lines = items.map((x) => `• <a href="${BLOG_ORIGIN}/moment/${x.slug}/">${fmtDate(x.published)}</a> ${esc(clip(x.text, 50))}`);
	await send(env, chatId, `🕐 <b>最近动态</b>\n\n${lines.join("\n")}`);
}

async function cmdRandom(env, chatId) {
	const res = await fetch(`${BLOG_ORIGIN}/api/moments.json`, { signal: AbortSignal.timeout(10000) });
	const data = await res.json();
	const arr = data?.moments || [];
	if (!arr.length) return send(env, chatId, "还没有动态喵~");
	const x = arr[Math.floor(Math.random() * arr.length)];
	const who = x.author ? `👤 ${esc(x.author)}\n` : "";
	const text = `🎲 <b>随机一条</b>\n\n📅 ${fmtDate(x.published)}\n${who}${esc(clip(x.text, 220))}\n${tagsLine(x.tags)}`;
	await sendWithButton(env, chatId, text, "🔗 查看详情", `${BLOG_ORIGIN}/moment/${x.slug}/`);
}

async function cmdStats(env, chatId) {
	const res = await fetch(`${BLOG_ORIGIN}/api/moments/stats.json`, { signal: AbortSignal.timeout(10000) });
	const s = await res.json();
	const topTags = (s.tags || [])
		.slice(0, 3)
		.map((t) => `#${t.tag}(${t.count})`)
		.join(" ");
	const topMonth = [...(s.months || [])].sort((a, b) => b.count - a.count)[0];
	await send(
		env,
		chatId,
		`📊 <b>朋友圈统计</b>\n\n📝 动态 ${s.total ?? 0} 条（回复 ${s.replies ?? 0} 条）\n🔤 总字数 ${s.totalWords ?? 0}（平均 ${s.avgWords ?? 0} 字/条）\n🖼️ 图片 ${s.totalImages ?? 0} 张 · 🎬 视频 ${s.totalVideos ?? 0} 个\n🗓️ 最活跃月份：${topMonth?.month ?? "-"}（${topMonth?.count ?? 0} 条）\n🏷️ Top 标签：${topTags || "-"}`
	);
}

async function cmdSearch(env, chatId, q) {
	if (!q) return send(env, chatId, "🔍 用法：/search 关键词\n例如：/search 咖啡\n\n支持匹配正文、标签、作者喵~");
	const res = await fetch(`${BLOG_ORIGIN}/api/moments.json`, { signal: AbortSignal.timeout(10000) });
	const data = await res.json();
	const ql = q.toLowerCase();
	const hits = (data?.moments || [])
		.filter((x) => {
			return (
				(x.text || "").toLowerCase().includes(ql) ||
				(x.tags || []).some((t) => String(t).toLowerCase().includes(ql)) ||
				(x.author || "").toLowerCase().includes(ql)
			);
		})
		.slice(0, 5);
	if (!hits.length) return send(env, chatId, `😿 没有找到与「${esc(q)}」相关的动态喵~`);
	const lines = hits.map(
		(x) => `• <a href="${BLOG_ORIGIN}/moment/${x.slug}/">${fmtDate(x.published)}</a> ${esc(clip(x.text, 60))}`
	);
	await send(env, chatId, `🔍 <b>搜索结果</b>（${hits.length} 条）\n\n${lines.join("\n")}`);
}

/** 主人发文字 → 自动创建朋友圈动态（提交 GitHub → 触发部署上线） */
async function cmdCreate(env, chatId, text) {
	const tags = extractTags(text);
	const body = text.replace(/#[\p{L}\p{N}_-]+/gu, "").replace(/\n{3,}/g, "\n\n").trim();
	if (!body) return send(env, chatId, "😿 动态内容不能为空喵~（纯标签不算内容）");

	const slug = `m-${beijingStamp()}`;
	const published = new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace("Z", "+08:00");
	const tagYaml = tags.length ? tags.map((t) => `  - ${t}`).join("\n") : "";
	const content = `---\npublished: ${published}\ntags:\n${tagYaml}\n---\n${body}\n`;

	try {
		await githubPutFile(env, `${MOMENTS_DIR}/${slug}.md`, content, `feat(moments): 新增动态 ${slug} [via Bot]`);
		await sendWithButton(env, chatId, `📝 <b>动态已创建！</b>\n\n📅 ${fmtDate(published)}\n${esc(clip(body, 80))}\n${tagsLine(tags)}\n\n⏳ 部署中，约 1-2 分钟上线喵~`, "🔗 查看详情", `${BLOG_ORIGIN}/moment/${slug}/`);
		console.log("[create] pushed", slug);
	} catch (e) {
		console.error("[create] fail", e);
		await send(env, chatId, `😿 动态创建失败：${esc(e.message || String(e))}\n\n请检查 GITHUB_PAT 配置喵~`);
	}
}

/* ---------------- 工具 ---------------- */
async function githubPutFile(env, path, content, message) {
	if (!env.GITHUB_PAT) throw new Error("GITHUB_PAT 未配置");
	const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/contents/${path}`, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${env.GITHUB_PAT}`,
			Accept: "application/vnd.github+json",
			"content-type": "application/json",
			"User-Agent": "yaoxi-blog-bot",
		},
		body: JSON.stringify({
			message,
			content: Buffer.from(content, "utf-8").toString("base64"),
			branch: "main",
		}),
		signal: AbortSignal.timeout(15000),
	});
	const j = await res.json().catch(() => null);
	if (!res.ok) throw new Error((j && (j.message || JSON.stringify(j))) || `HTTP ${res.status}`);
	return j;
}

/** 提取 #标签（与博客端正则一致） */
function extractTags(text) {
	const re = /#[\p{L}\p{N}_-]+/gu;
	const out = [];
	for (const m of String(text || "").matchAll(re)) {
		const t = m[0].slice(1);
		if (t && !out.includes(t)) out.push(t);
	}
	return out;
}

/** 北京时间 YYYY-MM-DD */
function beijingDate() {
	const d = new Date(Date.now() + 8 * 3600 * 1000);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 本周一（北京时间）YYYY-MM-DD */
function beijingMonday() {
	const now = new Date(Date.now() + 8 * 3600 * 1000);
	const day = (now.getUTCDay() + 6) % 7; // 周一=0
	const monday = new Date(now.getTime() - day * 86400000);
	return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
}

/** 北京时间时间戳 m-YYYYMMDD-HHmmss */
function beijingStamp() {
	const d = new Date(Date.now() + 8 * 3600 * 1000);
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

async function recipients(env) {
	const subs = JSON.parse((await env.BOT_KV.get("subs")) || "[]");
	const list = new Set(subs);
	if (env.CHAT_ID) list.add(String(env.CHAT_ID));
	return [...list];
}

async function setSub(env, chatId, on) {
	const subs = JSON.parse((await env.BOT_KV.get("subs")) || "[]");
	const has = subs.includes(chatId);
	if (on && !has) subs.push(chatId);
	if (!on && has) subs.splice(subs.indexOf(chatId), 1);
	await env.BOT_KV.put("subs", JSON.stringify(subs));
}

async function send(env, chatId, text) {
	try {
		const res = await fetch(`${TG_API}${env.BOT_TOKEN}/sendMessage`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: false }),
			signal: AbortSignal.timeout(8000),
		});
		const j = await res.json().catch(() => null);
		if (!j?.ok) console.log("[send] fail", chatId, JSON.stringify(j));
	} catch (e) {
		console.error("[send] err", chatId, e);
	}
}

async function sendWithButton(env, chatId, text, buttonText, url) {
	try {
		const res = await fetch(`${TG_API}${env.BOT_TOKEN}/sendMessage`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				chat_id: chatId,
				text,
				parse_mode: "HTML",
				disable_web_page_preview: false,
				reply_markup: { inline_keyboard: [[{ text: buttonText, url }]] },
			}),
			signal: AbortSignal.timeout(8000),
		});
		const j = await res.json().catch(() => null);
		if (!j?.ok) console.log("[sendbtn] fail", chatId, JSON.stringify(j));
	} catch (e) {
		console.error("[sendbtn] err", chatId, e);
	}
}

function clip(s, n) {
	return (s || "").length > n ? s.slice(0, n) + "…" : s;
}
function esc(s) {
	return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function htmlDecode(s) {
	return String(s ?? "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}
function fmtDate(iso) {
	if (!iso) return "";
	try {
		const d = new Date(iso);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	} catch {
		return iso;
	}
}
function tagsLine(tags) {
	const arr = (tags || []).filter(Boolean).map((t) => `#${t}`);
	return arr.length ? `🏷️ ${arr.join(" ")}` : "";
}