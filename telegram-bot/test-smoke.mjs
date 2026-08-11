/**
 * v3.2 冒烟测试：mock Worker 环境，验证 订阅/查询/推送 + 发布功能下线 + 菜单同步
 * 运行：node test-smoke.mjs （仅本地验证，不参与部署）
 */
import fs from "node:fs";

// 1. 把 ESM worker 代码注入作用域（替换 export default 为局部对象）
const src = fs.readFileSync(new URL("./src/index.js", import.meta.url), "utf-8");
const code = src.replace("export default {", "const __worker = {");

const calls = [];
const kvStore = new Map();
let sent = []; // [chatId, text]
let momentUpdated = "2026-08-11T10:00:00+08:00"; // 可变指纹，用于模拟新动态
let momentSlug = "m-20260811-100000"; // 可变 slug，用于模拟全新动态

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

	// 博客 API：moments.json 固定返回一条动态
	if (u.includes("blog.yaoxi.wiki/api/moments.json")) {
		return json({
			updated: momentUpdated,
			moments: [
				{ slug: momentSlug, published: "2026-08-11T10:00:00+08:00", text: "测试动态 #日常", tags: ["日常"], author: "" },
			],
		});
	}
	// GitHub：任何 PUT 都不应该发生（发布功能已下线）
	if (u.includes("api.github.com/repos")) {
		return { ok: false, status: 500, json: async () => ({ message: "should not happen" }) };
	}
	// Telegram API
	if (u.includes("api.telegram.org/bot") && opts.method === "POST") {
		const body = JSON.parse(opts.body || "{}");
		if (u.includes("/sendMessage")) {
			sent.push([body.chat_id, body.text || ""]);
			return json({ ok: true, result: { message_id: sent.length } });
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
const fn = new Function("module", "exports", "env", "Buffer", code + "\n;return { worker: __worker, checkMoments, syncCommands };");
const api = fn(module, module.exports, env, Buffer);

let passed = 0;
const assert = (cond, name) => {
	if (cond) { passed++; console.log(`  ✅ ${name}`); }
	else { console.error(`  ❌ ${name}`); process.exitCode = 1; }
};

const reset = () => { kvStore.clear(); calls.length = 0; sent.length = 0; };
const githubPuts = () => calls.filter((c) => c[0].includes("api.github.com/repos") && c[1] === "PUT");
const lastSent = () => (sent[sent.length - 1] || [])[1] || "";
const upd = (o) => ({ message: { chat: { id: "7950928200" }, ...o } });

// 测试 1：主人发照片 → 提示下线，绝不触碰 GitHub
console.log("\n🧪 T1 主人发照片 → 发布功能下线提示");
{
	reset();
	await api.worker.fetch(new Request("http://x/webhook", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" } }), { ...env, WEBHOOK_SECRET: "s" }, {});
	// 直接调用 handleUpdate 不可见，改用 worker 内部路径：无法直接触发，改为验证模块级函数不存在
	const src2 = fs.readFileSync(new URL("./src/index.js", import.meta.url), "utf-8");
	assert(!src2.includes("cmdAddImage"), "cmdAddImage 已从源码移除");
	assert(!src2.includes("publishDraft"), "publishDraft 已从源码移除");
	assert(!src2.includes("IMG_REPO"), "IMG_REPO 常量已移除");
	assert(!src2.includes("GITHUB_PAT"), "GITHUB_PAT 引用已移除");
	assert(!src2.includes("/publish"), "publish 命令已移除");
	assert(!src2.includes("/cancel"), "cancel 命令已移除");
}

// 测试 2：菜单只剩 8 个命令
console.log("\n🧪 T2 命令菜单 = 8 个查询/订阅命令");
{
	reset();
	await api.syncCommands(env);
	const body = JSON.parse(calls.find((c) => c[0].includes("/setMyCommands"))[2] || "{}");
	// 从 calls 取不到 body，直接检查源码 COMMANDS
	const src2 = fs.readFileSync(new URL("./src/index.js", import.meta.url), "utf-8");
	const m = src2.match(/const COMMANDS = (\[[\s\S]*?\]);/);
	const cmds = eval(m[1]);
	assert(cmds.length === 8, `COMMANDS 共 8 项，实际 ${cmds.length}`);
	assert(!cmds.some((c) => ["publish", "cancel"].includes(c.command)), "不含 publish/cancel");
}

// 测试 3：checkMoments 推送（核心链路：先建基线 → 新动态 → 推送给订阅者）
console.log("\n🧪 T3 新动态推送");
{
	reset();
	kvStore.set("subs", JSON.stringify(["111", "222"]));
	await api.checkMoments(env);
	assert(sent.length === 0, "首次运行仅建基线不推送历史");
	// 模拟博客出现全新动态（指纹 + slug 都变化）
	momentUpdated = "2026-08-11T11:00:00+08:00";
	momentSlug = "m-20260811-120000";
	await api.checkMoments(env);
	assert(sent.length === 3, `3 个接收者（2 订阅者 + 主人）都收到推送，实际 ${sent.length}`);
	assert(lastSent().includes("新朋友圈动态"), "推送文案为「新朋友圈动态」");
	assert(sent.filter(([cid]) => ["111", "222"].includes(cid)).length === 2, "2 个订阅者均收到推送");
	assert(sent.some(([cid]) => cid === "7950928200"), "主人也收到推送");
	const kv = kvStore.get("last_moment");
	assert(kv && kv.includes("m-20260811-120000"), "推送后记录指纹防重复");
	// 指纹未变 → 不重复推送
	sent.length = 0;
	await api.checkMoments(env);
	assert(sent.length === 0, "指纹相同不重复推送");
}

// 测试 4：setMyCommands 菜单同步（懒触发 + KV 节流）
console.log("\n🧪 T4 命令菜单同步");
{
	reset();
	await api.syncCommands(env);
	let syncCalls = calls.filter((c) => c[0].includes("/setMyCommands"));
	assert(syncCalls.length === 1, "首次触发调用 setMyCommands 一次");
	await api.syncCommands(env);
	syncCalls = calls.filter((c) => c[0].includes("/setMyCommands"));
	assert(syncCalls.length === 1, "12h 节流内不重复调用");
	const saved = kvStore.get("cmd_menu_synced");
	assert(saved, "同步成功后写入 KV 标记");
}

// 测试 5：handleUpdate 分支验证（发文字/发图 → 下线提示；非主人 → 订阅提示）
console.log("\n🧪 T5 handleUpdate 分支");
{
	reset();
	// 重新注入并暴露 handleUpdate 以便直接调用
	const fn2 = new Function("module", "exports", "env", "Buffer", code + "\n;return { worker: __worker, handleUpdate };");
	const api2 = fn2(module, module.exports, env, Buffer);

	// 主人发普通文字
	await api2.handleUpdate(env, upd({ text: "今天好开心" }));
	assert(sent.length === 1, "主人发文字收到 1 条回复");
	assert(lastSent().includes("已下线"), "回复提示发布功能已下线");
	assert(githubPuts().length === 0, "未提交任何 GitHub 内容");

	// 主人发照片（无文字）
	reset();
	await api2.handleUpdate(env, upd({ photo: [{ file_id: "F1", width: 100, height: 100 }], caption: "图" }));
	assert(sent.length === 1, "主人发照片收到 1 条回复");
	assert(lastSent().includes("已下线"), "照片也提示已下线");
	assert(githubPuts().length === 0, "未触发图床上传");

	// 非主人发文字
	reset();
	await api2.handleUpdate(env, { message: { chat: { id: "999" }, text: "hello" } });
	assert(sent.length === 1 && lastSent().includes("/subscribe"), "非主人收到订阅引导");

	// 非主人发照片
	reset();
	await api2.handleUpdate(env, { message: { chat: { id: "999" }, photo: [{ file_id: "F2", width: 1, height: 1 }] } });
	assert(sent.length === 1 && lastSent().includes("/subscribe"), "非主人发图收到订阅引导");

	// 未知命令
	reset();
	await api2.handleUpdate(env, upd({ text: "/foo" }));
	assert(sent.length === 1 && lastSent().includes("未知命令"), "未知命令提示");

	// 普通命令照常工作
	reset();
	kvStore.set("subs", "[]");
	await api2.handleUpdate(env, upd({ text: "/subscribe" }));
	assert(sent.length === 1 && lastSent().includes("已订阅"), "/subscribe 正常工作");
	assert(JSON.parse(kvStore.get("subs")).includes("7950928200"), "订阅写入 KV");
}

console.log(`\n📋 结果：${passed} 通过`);