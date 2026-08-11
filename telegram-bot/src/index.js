/**
 * Yaoxi Blog Telegram Bot v3.3
 * - Webhook 模式：Telegram 消息即时推送到 /webhook → 毫秒级响应命令
 * - Cron 每 10 分钟：新动态/新文章推送 + 时间胶囊到期提醒 + 每周日周报
 * - 命令：/start /help /subscribe /unsubscribe /latest /random /stats /search /capsules /weekly /daily /broadcast
 * - 菜单：setMyCommands 自动同步 Telegram 命令菜单（输入框 / 弹出，KV 节流 12h）
 * - 纯订阅/查询/推送 Bot：v3.2 起移除在 Bot 内直接发布动态（文字/图片创作）的能力
 * - 敏感配置（BOT_TOKEN / WEBHOOK_SECRET）走 wrangler secret，绝不入库
 */
const BLOG_ORIGIN = "https://blog.yaoxi.wiki";
const TG_API = "https://api.telegram.org/bot";
const GITHUB_API = "https://api.github.com";

/** Telegram 命令菜单（/ 弹出），setMyCommands 同步 */
const COMMANDS = [
	{ command: "start", description: "开始使用 / 订阅推送" },
	{ command: "latest", description: "最近动态：/latest 5" },
	{ command: "random", description: "随机动态：/random 3" },
	{ command: "stats", description: "朋友圈统计 + 订阅人数" },
	{ command: "search", description: "搜索朋友圈：/search 关键词" },
	{ command: "capsules", description: "时间胶囊列表" },
	{ command: "weekly", description: "本周朋友圈周报" },
	{ command: "daily", description: "每日一言：/daily 城市" },
	{ command: "broadcast", description: "主人广播公告" },
	{ command: "subscribe", description: "订阅新动态推送" },
	{ command: "unsubscribe", description: "退订推送" },
	{ command: "help", description: "帮助与全部命令" },
];

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
	await checkDaily(env).catch((e) => console.error("[daily]", e));
}

/* ---------------- 命令处理（webhook 即时） ---------------- */
async function handleUpdate(env, u) {
	await syncCommands(env).catch(() => {}); // 懒触发：任意消息时同步命令菜单（KV 节流）
	const msg = u.message || u.edited_message;
	if (!msg?.chat?.id) return;
	const chatId = msg.chat.id;
	const text = (msg.text || "").trim();
	const isOwner = String(chatId) === String(env.CHAT_ID || "");

	// 媒体消息（无 text）：发布功能已下线，礼貌提示；sticker / voice 等忽略
	if (!text) {
		if (msg.photo?.length || msg.document || msg.video || msg.video_note || msg.animation) {
			return send(
				env,
				chatId,
				isOwner
					? "📭 在 Bot 内发布动态的功能已下线喵~ 本 Bot 现在专注订阅推送与查询（/latest /random /stats /search）"
					: "😸 想订阅瑶曦的博客动态请发 /subscribe 喵~"
			);
		}
		return; // sticker / voice 等忽略
	}

	try {
		if (text.startsWith("/start")) {
			await setSub(env, chatId, true);
			await send(env, chatId, "👋 欢迎订阅瑶曦的博客动态喵~\n\n📷 新朋友圈 / 📝 新文章会第一时间推送给你。\n\n命令：\n/latest 5 — 最近动态\n/random — 随机一条\n/stats — 统计 + 订阅人数\n/search 词 — 搜索\n/capsules — 时间胶囊\n/weekly — 本周周报\n/daily 城市 — 每日一言+天气\n/subscribe — 订阅推送\n/unsubscribe — 退订\n/help — 帮助");
		} else if (text.startsWith("/help")) {
			await send(env, chatId, "🤖 <b>瑶曦博客 Bot 帮助</b>\n\n/latest 5 — 最近动态（可加数量）\n/random 3 — 随机动态（可加数量）\n/stats — 统计 + 订阅人数\n/search 关键词 — 搜索朋友圈\n/capsules — 时间胶囊列表\n/weekly — 本周周报\n/daily 城市 — 每日一言 + 天气\n/broadcast 内容 — 主人广播\n/subscribe — 订阅推送\n/unsubscribe — 退订推送\n\n📭 在 Bot 内发布动态已下线，本 Bot 专注订阅推送与查询喵~");
		} else if (text.startsWith("/subscribe")) {
			await setSub(env, chatId, true);
			await send(env, chatId, "✅ 已订阅推送，有新动态会第一时间通知你喵~");
		} else if (text.startsWith("/unsubscribe")) {
			await setSub(env, chatId, false);
			await send(env, chatId, "🚫 已退订。想重新订阅发 /subscribe 即可喵~");
		} else if (text.startsWith("/latest")) {
			await cmdLatest(env, chatId, parseIntArg(text, "/latest"));
		} else if (text.startsWith("/random")) {
			await cmdRandom(env, chatId, parseIntArg(text, "/random"));
		} else if (text.startsWith("/stats")) {
			await cmdStats(env, chatId);
		} else if (text.startsWith("/search")) {
			await cmdSearch(env, chatId, text.replace(/^\/search\s*/, "").trim());
		} else if (text.startsWith("/capsules")) {
			await cmdCapsules(env, chatId);
		} else if (text.startsWith("/weekly")) {
			await cmdWeekly(env, chatId);
		} else if (text.startsWith("/daily")) {
			await cmdDaily(env, chatId, text.replace(/^\/daily\s*/, "").trim());
		} else if (text.startsWith("/broadcast")) {
			await cmdBroadcast(env, chatId, text.replace(/^\/broadcast\s*/, "").trim());
		} else if (text.startsWith("/")) {
			await send(env, chatId, "🤔 未知命令，发 /help 查看可用命令喵~");
		} else if (isOwner) {
			await send(env, chatId, "📭 在 Bot 内发布动态的功能已下线喵~ 发 /help 查看全部可用命令（订阅 / 查询 / 推送）");
		} else {
			await send(env, chatId, "😸 想订阅瑶曦的博客动态请发 /subscribe 喵~");
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
		const isReply = !!latest.replyTo;
		let text = `${isReply ? "💬 <b>新回复</b>" : "📷 <b>新朋友圈动态</b>"}\n\n📅 ${fmtDate(latest.published)}\n${who}${esc(clip(latest.text, 220))}\n${tags}`;
		if (isReply) {
			const target = data.moments.find((m) => m.slug === latest.replyTo);
			if (target) text += `\n↩️ 回复：${esc(clip(target.text, 80))}`;
		}
		const media = momentMedia(latest);
		const url = `${BLOG_ORIGIN}/moment/${latest.slug}/`;
		for (const cid of await recipients(env)) {
			if (media) {
				const ok = await sendMedia(env, cid, media, `${text}\n\n🔗 ${url}`);
				if (!ok) await sendWithButton(env, cid, text, "🔗 查看详情", url);
			} else {
				await sendWithButton(env, cid, text, "🔗 查看详情", url);
			}
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
	const { text, latest } = await buildWeeklyReport(env);
	for (const cid of await recipients(env)) {
		if (latest) await sendWithButton(env, cid, text, "📖 查看最新", `${BLOG_ORIGIN}/moment/${latest.slug}/`);
		else await send(env, cid, text);
	}
	await env.BOT_KV.put(key, beijingDate());
	console.log("[weekly] pushed", monday);
}

/** 生成本周周报文本（cron 广播与 /weekly 手动共用） */
async function buildWeeklyReport(env) {
	const monday = beijingMonday();
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
	return { text, latest };
}

/* ---------------- 命令实现 ---------------- */
async function cmdLatest(env, chatId, n) {
	const count = Math.min(Math.max(n || 5, 1), 20);
	const res = await fetch(`${BLOG_ORIGIN}/api/moments.json`, { signal: AbortSignal.timeout(10000) });
	const data = await res.json();
	const items = (data?.moments || []).slice(0, count);
	if (!items.length) return send(env, chatId, "还没有动态喵~");
	const lines = items.map((x) => `• <a href="${BLOG_ORIGIN}/moment/${x.slug}/">${fmtDate(x.published)}</a> ${esc(clip(x.text, 50))}`);
	await send(env, chatId, `🕐 <b>最近 ${items.length} 条动态</b>\n\n${lines.join("\n")}`);
}

async function cmdRandom(env, chatId, n) {
	const count = Math.min(Math.max(n || 1, 1), 10);
	const res = await fetch(`${BLOG_ORIGIN}/api/moments.json`, { signal: AbortSignal.timeout(10000) });
	const data = await res.json();
	const arr = data?.moments || [];
	if (!arr.length) return send(env, chatId, "还没有动态喵~");
	if (count === 1) {
		const x = arr[Math.floor(Math.random() * arr.length)];
		const who = x.author ? `👤 ${esc(x.author)}\n` : "";
		const text = `🎲 <b>随机一条</b>\n\n📅 ${fmtDate(x.published)}\n${who}${esc(clip(x.text, 220))}\n${tagsLine(x.tags)}`;
		return sendWithButton(env, chatId, text, "🔗 查看详情", `${BLOG_ORIGIN}/moment/${x.slug}/`);
	}
	const pool = [...arr];
	const picks = [];
	while (picks.length < Math.min(count, pool.length)) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
	const lines = picks.map((x) => `• <a href="${BLOG_ORIGIN}/moment/${x.slug}/">${fmtDate(x.published)}</a> ${esc(clip(x.text, 50))}`);
	await send(env, chatId, `🎲 <b>随机 ${picks.length} 条</b>\n\n${lines.join("\n")}`);
}

async function cmdStats(env, chatId) {
	const res = await fetch(`${BLOG_ORIGIN}/api/moments/stats.json`, { signal: AbortSignal.timeout(10000) });
	const s = await res.json();
	const topTags = (s.tags || [])
		.slice(0, 3)
		.map((t) => `#${t.tag}(${t.count})`)
		.join(" ");
	const topMonth = [...(s.months || [])].sort((a, b) => b.count - a.count)[0];
	const subs = JSON.parse((await env.BOT_KV.get("subs")) || "[]");
	const subCount = new Set([...subs, env.CHAT_ID].filter(Boolean)).size;
	await send(
		env,
		chatId,
		`📊 <b>朋友圈统计</b>\n\n📝 动态 ${s.total ?? 0} 条（回复 ${s.replies ?? 0} 条）\n👥 订阅者 ${subCount} 人\n🔤 总字数 ${s.totalWords ?? 0}（平均 ${s.avgWords ?? 0} 字/条）\n🖼️ 图片 ${s.totalImages ?? 0} 张 · 🎬 视频 ${s.totalVideos ?? 0} 个\n🗓️ 最活跃月份：${topMonth?.month ?? "-"}（${topMonth?.count ?? 0} 条）\n🏷️ Top 标签：${topTags || "-"}`
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

/** 解析命令数量参数：/latest 10 → 10；无效 → null */
function parseIntArg(text, cmd) {
	const n = parseInt(text.replace(new RegExp(`^\\${cmd}\\s*`), ""), 10);
	return Number.isFinite(n) ? n : null;
}

/** 时间胶囊列表：未解封 + 已解封 */
async function cmdCapsules(env, chatId) {
	const res = await fetch(`${BLOG_ORIGIN}/api/moments/capsules.json`, { signal: AbortSignal.timeout(10000) });
	const data = await res.json();
	const list = (data?.capsules || []).filter((c) => c.capsule);
	if (!list.length) return send(env, chatId, "📦 还没有时间胶囊喵~ 未来的某一天会有的！");
	const today = beijingDate();
	const locked = [];
	const opened = [];
	for (const c of list) {
		const due = String(c.capsule).slice(0, 10);
		(due > today ? locked : opened).push({ c, due });
	}
	locked.sort((a, b) => a.due.localeCompare(b.due));
	let text = `📦 <b>时间胶囊</b>（共 ${list.length} 个）`;
	if (locked.length) {
		text += `\n\n🔒 <b>未解封</b>`;
		for (const { c, due } of locked) text += `\n• ${fmtDate(c.published)} 封存 → <b>${due}</b> 解封：${esc(clip(c.text, 40))}`;
	}
	if (opened.length) {
		text += `\n\n🔓 <b>已解封</b>`;
		for (const { c, due } of opened) text += `\n• ${fmtDate(c.published)} 封存，${due} 解封：${esc(clip(c.text, 40))}`;
	}
	await send(env, chatId, text);
}

/** 手动周报：仅发给调用者（cron 版走 checkWeekly 广播） */
async function cmdWeekly(env, chatId) {
	const { text, latest } = await buildWeeklyReport(env);
	if (latest) await sendWithButton(env, chatId, text, "📖 查看最新", `${BLOG_ORIGIN}/moment/${latest.slug}/`);
	else await send(env, chatId, text);
}

/** 主人广播：给所有订阅者群发公告 */
async function cmdBroadcast(env, chatId, msg) {
	if (String(chatId) !== String(env.CHAT_ID || "")) return send(env, chatId, "🔒 广播仅主人可用喵~");
	if (!msg) return send(env, chatId, "📣 用法：/broadcast 消息内容\n\n会给所有订阅者群发这条消息喵~");
	const list = await recipients(env);
	let ok = 0;
	for (const cid of list) {
		if (await send(env, cid, `📣 <b>公告</b>\n\n${esc(msg)}`)) ok++;
	}
	await send(env, chatId, `✅ 广播完成：${ok}/${list.length} 人送达喵~`);
}

/** 每日一言（+可选天气） */
async function cmdDaily(env, chatId, city) {
	await send(env, chatId, await buildDaily(city));
}

async function buildDaily(city) {
	let text = `🌅 <b>每日一言</b> · ${beijingDate()}\n\n`;
	const hito = await fetch("https://v1.hitokoto.cn/?c=d&c=i&c=k", { signal: AbortSignal.timeout(8000) })
		.then((r) => r.json())
		.catch(() => null);
	if (hito?.hitokoto) text += `“${esc(hito.hitokoto)}”\n— ${esc(hito.from || "佚名")}`;
	else text += "（一言服务暂时打盹了喵~）";
	if (city) {
		const w = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { signal: AbortSignal.timeout(8000) })
			.then((r) => r.json())
			.catch(() => null);
		const cur = w?.current_condition?.[0];
		if (cur) text += `\n\n🌤️ <b>${esc(city)}</b>：${cur.weatherDesc?.[0]?.value ?? "—"} ${cur.temp_C}°C（体感 ${cur.FeelsLikeC}°C · 湿度 ${cur.humidity}%）`;
	}
	return text;
}

/** 每日一言定时推送：北京时间每天首个 tick 触发，仅发主人 */
async function checkDaily(env) {
	if (!env.CHAT_ID) return;
	const today = beijingDate();
	if ((await env.BOT_KV.get("daily_day")) === today) return;
	const text = await buildDaily("北京");
	await send(env, String(env.CHAT_ID), text);
	await env.BOT_KV.put("daily_day", today);
	console.log("[daily] pushed", today);
}

/* ---------------- 工具 ---------------- */

/** 媒体前缀（与博客端 momentsImageConfig 保持一致） */
const RAW_URL = "https://png.yaoxi.wiki/astro/raw";
const WEBP_URL = "https://png.yaoxi.wiki/astro/webp";
const VIDEO_URL = "https://png.yaoxi.wiki/astro/video";

/** 复刻博客端智能媒体 URL 转换：文件名 → CDN 完整地址（按发布时间补日期目录） */
function momentMedia(m) {
	const dateStr = String(m.published || "").slice(0, 10);
	const resolve = (v, prefix) => {
		if ((v.startsWith("http://") || v.startsWith("https://")) && !v.startsWith(prefix)) return v;
		let clean = v;
		if (v.startsWith(prefix)) clean = v.substring(prefix.length);
		if (clean.startsWith("/")) clean = clean.substring(1);
		const m2 = clean.match(/^(\d{4}-\d{2}-\d{2})\/(.+)$/);
		const folder = m2 ? m2[1] : dateStr;
		const filename = m2 ? m2[2] : clean;
		return `${prefix}/${folder}/${filename}`;
	};
	const img = (m.images || [])[0];
	if (img) return { kind: "photo", url: resolve(img, RAW_URL) };
	const vid = (m.videos || [])[0];
	if (vid) return { kind: "video", url: resolve(vid, VIDEO_URL) };
	return null;
}

/** 推送媒体（图片/视频），失败返回 false 由调用方 fallback */
async function sendMedia(env, chatId, media, caption) {
	if (media.kind === "video") return sendVideo(env, chatId, media.url, caption);
	return sendPhoto(env, chatId, media.url, caption);
}

async function sendPhoto(env, chatId, url, caption) {
	try {
		const res = await fetch(`${TG_API}${env.BOT_TOKEN}/sendPhoto`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ chat_id: chatId, photo: url, caption, parse_mode: "HTML" }),
			signal: AbortSignal.timeout(10000),
		});
		const j = await res.json().catch(() => null);
		if (!j?.ok) console.log("[sendphoto] fail", chatId, JSON.stringify(j));
		return !!j?.ok;
	} catch (e) {
		console.error("[sendphoto] err", chatId, e);
		return false;
	}
}

async function sendVideo(env, chatId, url, caption) {
	try {
		const res = await fetch(`${TG_API}${env.BOT_TOKEN}/sendVideo`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ chat_id: chatId, video: url, caption, parse_mode: "HTML" }),
			signal: AbortSignal.timeout(10000),
		});
		const j = await res.json().catch(() => null);
		if (!j?.ok) console.log("[sendvideo] fail", chatId, JSON.stringify(j));
		return !!j?.ok;
	} catch (e) {
		console.error("[sendvideo] err", chatId, e);
		return false;
	}
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
		if (!j?.ok) {
			console.log("[send] fail", chatId, JSON.stringify(j));
			return false;
		}
		return true;
	} catch (e) {
		console.error("[send] err", chatId, e);
		return false;
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

/** 同步 Telegram 命令菜单（setMyCommands），KV 节流 12 小时，避免每次请求都调 API */
async function syncCommands(env) {
	try {
		const last = await env.BOT_KV.get("cmd_menu_synced");
		if (last && Date.now() - Number(last) < 12 * 3600 * 1000) return;
		const res = await fetch(`${TG_API}${env.BOT_TOKEN}/setMyCommands`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ commands: COMMANDS }),
			signal: AbortSignal.timeout(8000),
		});
		const j = await res.json().catch(() => null);
		if (j && j.ok) {
			await env.BOT_KV.put("cmd_menu_synced", String(Date.now()));
			console.log("[menu] synced", COMMANDS.length, "commands");
		} else {
			console.log("[menu] sync fail", JSON.stringify(j));
		}
	} catch (e) {
		console.error("[menu] sync err", e);
	}
}