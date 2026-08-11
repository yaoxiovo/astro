/**
 * v3.3 冒烟测试：mock Worker 环境，验证 订阅/查询/推送 + 新命令(13) + 媒体推送 + 回复提醒 + 每日一言
 * 运行：node test-smoke.mjs （仅本地验证，不参与部署）
 */
import fs from "node:fs";

// 1. 把 ESM worker 代码注入作用域（替换 export default 为局部对象）
const src = fs.readFileSync(new URL("./src/index.js", import.meta.url), "utf-8");
const code = src.replace("export default {", "const __worker = {");

const calls = [];
const kvStore = new Map();
let sent = []; // [chatId, text]
let media = []; // [kind, chatId, url, caption]
let momentUpdated = "2026-08-11T10:00:00+08:00";
let momentSlug = "m-20260811-100000";
let momentImages = [];
let momentVideos = [];
let momentReplyTo = null;

// 2. mock env
const env = {
	BOT_TOKEN: "123456:TEST",
	CHAT_ID: "7950928200",
	BOT_KV: {
		async get(k) { return kvStore.get(k) ?? null; },
		async put(k, v) { kvStore.set(k, v); },
		async delete(k) { kvStore.delete(k); },
	},
};

// 3. mock fetch
globalThis.fetch = async (url, opts = {}) => {
	const u = String(url);
	calls.push([u, opts.method || "GET"]);
	const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });

	// 博客 API：moments.json 固定返回两条（最新 + 一条旧动态供回复引用）
	if (u.includes("blog.yaoxi.wiki/api/moments.json")) {
		return json({
			updated: momentUpdated,
			moments: [
				{ slug: momentSlug, published: "2026-08-12T10:00:00+08:00", text: "测试动态 #日常", tags: ["日常"], author: "", images: momentImages, videos: momentVideos, replyTo: momentReplyTo },
				{ slug: "old-one", published: "2026-08-11T10:00:00+08:00", text: "被回复的旧动态", tags: [], author: "", images: [], videos: [], replyTo: null },
			],
		});
	}
	// 胶囊 API
	if (u.includes("blog.yaoxi.wiki/api/moments/capsules.json")) {
		return json({
			updated: "x",
			capsules: [
				{ slug: "cap1", published: "2026-07-01T10:00:00+08:00", text: "写给未来的自己", capsule: "2099-12-31", tags: [] },
				{ slug: "cap2", published: "2026-06-01T10:00:00+08:00", text: "早就开过的", capsule: "2000-01-01", tags: [] },
			],
		});
	}
	// 一言
	if (u.includes("v1.hitokoto.cn")) {
		return json({ hitokoto: "喵生苦短，及时行乐", from: "测试喵" });
	}
	// 天气
	if (u.includes("wttr.in")) {
		return json({ current_condition: [{ temp_C: "26", FeelsLikeC: "27", humidity: "60", weatherDesc: [{ value: "晴" }] }] });
	}
	// Telegram API
	if (u.includes("api.telegram.org/bot") && opts.method === "POST") {
		const body = JSON.parse(opts.body || "{}");
		if (u.includes("/sendMessage")) {
			sent.push([body.chat_id, body.text || ""]);
			return json({ ok: true, result: { message_id: sent.length } });
		}
		if (u.includes("/sendPhoto")) {
			media.push(["photo", body.chat_id, body.photo, body.caption || ""]);
			return json({ ok: true, result: { message_id: 1 } });
		}
		if (u.includes("/sendVideo")) {
			media.push(["video", body.chat_id, body.video, body.caption || ""]);
			return json({ ok: true, result: { message_id: 1 } });
		}
		if (u.includes("/setMyCommands")) return json({ ok: true, result: true });
		return json({ ok: true, result: {} });
	}
	return { ok: false, status: 404, json: async () => ({}) };
};

globalThis.setTimeout = (fn) => { fn(); return 0; };
globalThis.AbortSignal = { timeout: () => undefined };
globalThis.Buffer = Buffer;

// 4. 注入代码并执行
const module = { exports: {} };
const fn = new Function("module", "exports", "env", "Buffer", code + "\n;return { worker: __worker, checkMoments, syncCommands, checkDaily };");
const api = fn(module, module.exports, env, Buffer);

let passed = 0;
const assert = (cond, name) => {
	if (cond) { passed++; console.log(`  ✅ ${name}`); }
	else { console.error(`  ❌ ${name}`); process.exitCode = 1; }
};

const reset = () => { kvStore.clear(); calls.length = 0; sent.length = 0; media.length = 0; };
const githubPuts = () => calls.filter((c) => c[0].includes("api.github.com/repos") && c[1] === "PUT");
const lastSent = () => (sent[sent.length - 1] || [])[1] || "";
const lastMedia = () => media[media.length - 1] || [];
const upd = (o) => ({ message: { chat: { id: "7950928200" }, ...o } });

// 测试 1：代码不包含发布残留
console.log("\n🧪 T1 发布功能已移除");
{
	reset();
	const s = fs.readFileSync(new URL("./src/index.js", import.meta.url), "utf-8");
	assert(!s.includes("publishDraft"), "无 publishDraft 残留");
	assert(!s.includes("cmdAddImage"), "无 cmdAddImage 残留");
	assert(!s.includes("GITHUB_PAT"), "无 GITHUB_PAT 依赖");
}

// 测试 2：命令菜单 13 项
console.log("\n🧪 T2 命令菜单");
{
	const src2 = fs.readFileSync(new URL("./src/index.js", import.meta.url), "utf-8");
	const m = src2.match(/const COMMANDS = (\[[\s\S]*?\]);/);
	const cmds = eval(m[1]);
	assert(cmds.length === 12, `COMMANDS 共 12 项，实际 ${cmds.length}`);
	assert(!cmds.some((c) => ["publish", "cancel"].includes(c.command)), "不含 publish/cancel");
	for (const c of ["capsules", "weekly", "daily", "broadcast"]) {
		assert(cmds.some((x) => x.command === c), `菜单含 /${c}`);
	}
}

// 测试 3：checkMoments 推送（基线 → 新动态 → 订阅者）
console.log("\n🧪 T3 新动态推送");
{
	reset();
	kvStore.set("subs", JSON.stringify(["111", "222"]));
	await api.checkMoments(env);
	assert(sent.length === 0, "首次运行仅建基线不推送历史");
	momentUpdated = "2026-08-12T11:00:00+08:00";
	momentSlug = "m-20260812-120000";
	await api.checkMoments(env);
	assert(sent.length === 3, `3 个接收者（2 订阅者 + 主人）都收到推送，实际 ${sent.length}`);
	assert(lastSent().includes("新朋友圈动态"), "推送文案为「新朋友圈动态」");
	assert(sent.filter(([cid]) => ["111", "222"].includes(cid)).length === 2, "2 个订阅者均收到推送");
	const kv = kvStore.get("last_moment");
	assert(kv && kv.includes("m-20260812-120000"), "推送后记录指纹防重复");
	sent.length = 0;
	await api.checkMoments(env);
	assert(sent.length === 0, "指纹相同不重复推送");
}

// 测试 4：setMyCommands 菜单同步（hash 感知节流）
console.log("\n🧪 T4 命令菜单同步");
{
	reset();
	await api.syncCommands(env);
	let syncCalls = calls.filter((c) => c[0].includes("/setMyCommands"));
	assert(syncCalls.length === 1, "首次触发调用 setMyCommands 一次");
	await api.syncCommands(env);
	syncCalls = calls.filter((c) => c[0].includes("/setMyCommands"));
	assert(syncCalls.length === 1, "命令未变时 12h 节流内不重复调用");
	const meta = JSON.parse(kvStore.get("cmd_menu_meta"));
	assert(meta && meta.hash && meta.t, "KV 保存菜单 hash + 时间戳");
	// 回归测试：命令列表变化（如新部署增加命令）→ 必须立即重新同步
	kvStore.set("cmd_menu_meta", JSON.stringify({ hash: "OLD-HASH", t: Date.now() }));
	await api.syncCommands(env);
	syncCalls = calls.filter((c) => c[0].includes("/setMyCommands"));
	assert(syncCalls.length === 2, "命令列表变化时立即重新同步（修复菜单不更新的 Bug）");
}

// 测试 5：handleUpdate 基础分支
console.log("\n🧪 T5 handleUpdate 基础分支");
{
	reset();
	const fn2 = new Function("module", "exports", "env", "Buffer", code + "\n;return { worker: __worker, handleUpdate };");
	const api2 = fn2(module, module.exports, env, Buffer);

	await api2.handleUpdate(env, upd({ text: "今天好开心" }));
	assert(sent.length === 1, "主人发文字收到 1 条回复");
	assert(lastSent().includes("已下线"), "回复提示发布功能已下线");
	assert(githubPuts().length === 0, "未提交任何 GitHub 内容");

	reset();
	await api2.handleUpdate(env, upd({ photo: [{ file_id: "F1", width: 100, height: 100 }], caption: "图" }));
	assert(sent.length === 1 && lastSent().includes("已下线"), "发照片提示已下线");

	reset();
	await api2.handleUpdate(env, { message: { chat: { id: "999" }, text: "hello" } });
	assert(sent.length === 1 && lastSent().includes("/subscribe"), "非主人收到订阅引导");

	reset();
	await api2.handleUpdate(env, upd({ text: "/foo" }));
	assert(sent.length === 1 && lastSent().includes("未知命令"), "未知命令提示");

	reset();
	await api2.handleUpdate(env, upd({ text: "/subscribe" }));
	assert(sent.length === 1 && lastSent().includes("已订阅"), "/subscribe 正常工作");
}

// 测试 6：新命令分支
console.log("\n🧪 T6 新命令");
{
	reset();
	const fn3 = new Function("module", "exports", "env", "Buffer", code + "\n;return { worker: __worker, handleUpdate };");
	const api3 = fn3(module, module.exports, env, Buffer);

	await api3.handleUpdate(env, upd({ text: "/latest 3" }));
	assert(sent.length === 1 && lastSent().includes("最近"), "/latest 带数量参数");

	reset();
	await api3.handleUpdate(env, upd({ text: "/random 2" }));
	assert(sent.length === 1 && lastSent().includes("随机"), "/random 带数量参数");

	reset();
	await api3.handleUpdate(env, upd({ text: "/capsules" }));
	const cap = lastSent();
	assert(cap.includes("时间胶囊") && cap.includes("未解封") && cap.includes("2099-12-31"), "/capsules 列出未解封胶囊");
	assert(cap.includes("已解封") && cap.includes("2000-01-01"), "/capsules 列出已解封胶囊");

	reset();
	await api3.handleUpdate(env, upd({ text: "/weekly" }));
	assert(sent.length === 1 && lastSent().includes("周报"), "/weekly 手动周报");

	reset();
	await api3.handleUpdate(env, upd({ text: "/daily 上海" }));
	const daily = lastSent();
	assert(daily.includes("每日一言") && daily.includes("喵生苦短"), "/daily 一言内容");
	assert(daily.includes("上海") && daily.includes("26"), "/daily 天气信息");

	reset();
	kvStore.set("subs", JSON.stringify(["111", "222"]));
	await api3.handleUpdate(env, upd({ text: "/broadcast 大家好" }));
	assert(sent.length === 4 && lastSent().includes("广播完成"), "/broadcast 广播给 2 订阅者+主人并回执");

	reset();
	await api3.handleUpdate(env, { message: { chat: { id: "999" }, text: "/broadcast hi" } });
	assert(sent.length === 1 && lastSent().includes("仅主人"), "/broadcast 非主人拒绝");

	reset();
	await api3.handleUpdate(env, upd({ text: "/stats" }));
	assert(lastSent().includes("订阅者"), "/stats 含订阅人数");
}

// 测试 7：媒体推送 + 回复提醒
console.log("\n🧪 T7 媒体推送与回复");
{
	const clearOut = () => { sent.length = 0; media.length = 0; calls.length = 0; };
	clearOut();
	kvStore.set("subs", JSON.stringify([]));
	momentUpdated = "2026-08-12T01:00:00+08:00";
	momentSlug = "m-photo";
	momentImages = ["10.jpg"];
	await api.checkMoments(env);
	assert(media.length === 0, "首次运行仅建基线不发媒体");

	momentUpdated = "2026-08-12T02:00:00+08:00";
	momentSlug = "m-photo2";
	await api.checkMoments(env);
	assert(media.length === 1, "带图动态推送 sendPhoto");
	assert(lastMedia()[0] === "photo" && lastMedia()[2].includes("png.yaoxi.wiki/astro/raw/2026-08-12/10.jpg"), "文件名拼成 CDN 完整地址");
	assert(lastMedia()[3].includes("新朋友圈动态"), "caption 含新动态标题");
	assert(sent.length === 0, "sendPhoto 成功时不 fallback sendMessage");

	clearOut();
	momentUpdated = "2026-08-12T03:00:00+08:00";
	momentSlug = "m-reply";
	momentImages = [];
	momentReplyTo = "old-one";
	await api.checkMoments(env);
	const r = lastSent();
	assert(r.includes("新回复"), "replyTo 动态推送标记为「新回复」");
	assert(r.includes("被回复的旧动态"), "附上被回复动态摘要");

	clearOut();
	momentUpdated = "2026-08-12T04:00:00+08:00";
	momentSlug = "m-video";
	momentVideos = ["1.mp4"];
	momentReplyTo = null;
	await api.checkMoments(env);
	assert(media.length === 1 && lastMedia()[0] === "video", "视频动态推送 sendVideo");
	assert(lastMedia()[2].includes("/astro/video/2026-08-12/1.mp4"), "视频拼 CDN 完整地址");
}

// 测试 8：每日一言定时推送
console.log("\n🧪 T8 每日一言 cron");
{
	reset();
	await api.checkDaily(env);
	assert(sent.length === 1, "每日一言推送给主人");
	assert(lastSent().includes("每日一言") && lastSent().includes("北京"), "文案含每日一言 + 默认北京天气");
	sent.length = 0;
	await api.checkDaily(env);
	assert(sent.length === 0, "同一天不重复推送");
}

console.log(`\n📋 结果：${passed} 通过`);