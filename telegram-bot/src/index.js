/**
 * Yaoxi Blog Telegram Bot
 * - Webhook 模式：Telegram 消息即时推送到 /webhook → 毫秒级响应命令
 * - Cron 每 10 分钟：检查朋友圈 API + 博客 RSS，有新内容推送给订阅者
 * - 命令：/start /help /subscribe /unsubscribe /latest /random /stats
 * - 指纹去重：KV 存储上次指纹，首次运行只建基线不推送
 * - 敏感配置（BOT_TOKEN / WEBHOOK_SECRET）走 wrangler secret，绝不入库
 */
const BLOG_ORIGIN = "https://blog.yaoxi.wiki";
const TG_API = "https://api.telegram.org/bot";

export default {
	async scheduled(event, env, ctx) {
		ctx.waitUntil(tick(env));
	},
	async fetch(request, env) {
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
			return new Response("Yaoxi Blog Telegram Bot (webhook mode).");
		}

		// POST /webhook：Telegram 更新入口（即时响应）
		if (url.pathname === "/webhook" && request.method === "POST") {
			const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
			if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
				return new Response("unauthorized", { status: 401 });
			}
			const update = await request.json().catch(() => null);
			if (update) {
				// 任何异常都不能让 waitUntil 的 rejection 污染响应（Telegram 会 500）
				ctx.waitUntil(
					handleUpdate(env, update).catch(async (e) => {
						console.error("[webhook-handler]", e);
						await env.BOT_KV.put("webhook_err", String((e && e.stack) || e)).catch(() => {});
					})
				);
			}
			return new Response("ok");
		}

		// GET /err 见上方 GET 分支

		return new Response("not found", { status: 404 });
	},
};

async function tick(env) {
	await checkMoments(env).catch((e) => console.error("[moments]", e));
	await checkPosts(env).catch((e) => console.error("[posts]", e));
}

/* ---------------- 命令处理（webhook 即时） ---------------- */
async function handleUpdate(env, u) {
	const msg = u.message || u.edited_message;
	if (!msg?.text || !msg.chat?.id) return;
	const chatId = msg.chat.id;
	const text = msg.text.trim();
	try {
		if (text.startsWith("/start")) {
			await setSub(env, chatId, true);
			await send(env, chatId, "👋 欢迎订阅瑶曦的博客动态喵~\n\n📷 新朋友圈 / 📝 新文章会第一时间推送给你。\n\n命令：\n/latest — 最近 5 条动态\n/random — 随机一条朋友圈\n/stats — 朋友圈统计\n/subscribe — 订阅推送\n/unsubscribe — 退订\n/help — 帮助");
		} else if (text.startsWith("/help")) {
			await send(env, chatId, "🤖 <b>瑶曦博客 Bot 帮助</b>\n\n/latest — 最近 5 条朋友圈动态\n/random — 随机一条动态\n/stats — 朋友圈统计摘要\n/subscribe — 订阅新动态推送\n/unsubscribe — 退订推送\n\n新朋友圈 / 新文章会自动推送给你喵~");
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
		// 首次运行：建基线，不推送历史
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

/* ---------------- 工具 ---------------- */
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