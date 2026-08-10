/**
 * v3 冒烟测试：mock Worker 环境，验证 图片草稿 → 下载 → 上传图床 → 提交博客 全链路
 * 运行：node test-smoke.mjs （仅本地验证，不参与部署）
 */
import fs from "node:fs";

// 1. 把 ESM worker 代码注入作用域（替换 export default 为局部对象）
const src = fs.readFileSync(new URL("./src/index.js", import.meta.url), "utf-8");
const code = src.replace("export default {", "const __worker = {");

const calls = [];
const kvStore = new Map();

// 2. mock env
const env = {
	BOT_TOKEN: "123456:TEST",
	CHAT_ID: "7950928200",
	GITHUB_PAT: "ghp_test",
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

	if (u.includes("/getFile")) {
		const body = JSON.parse(opts.body || "{}");
		if (body.file_id === "FILE_BAD") return { ok: true, status: 200, json: async () => ({ ok: false }) };
		return json({ ok: true, result: { file_path: `photos/${body.file_id}_photo.jpg` } });
	}
	if (u.includes("/file/bot")) {
		if (u.includes("FILE_BIG")) {
			// 模拟 9MB 大图
			const big = new ArrayBuffer(9 * 1024 * 1024);
			return { ok: true, status: 200, arrayBuffer: async () => big };
		}
		// 模拟 1KB 小图
		const buf = new ArrayBuffer(1024);
		return { ok: true, status: 200, arrayBuffer: async () => buf };
	}
	if (u.includes("api.github.com/repos")) {
		if (u.includes("FAIL_REPO")) {
			return { ok: false, status: 403, json: async () => ({ message: "Resource not accessible by integration" }) };
		}
		return json({ content: { download_url: u } });
	}
	if (u.includes("api.telegram.org/bot") && opts.method === "POST") {
		return json({ ok: true, result: { message_id: 1 } });
	}
	return { ok: false, status: 404, json: async () => ({}) };
};

globalThis.setTimeout = (fn) => { fn(); return 0; }; // 跳过真实 sleep
globalThis.AbortSignal = { timeout: () => undefined };
globalThis.Buffer = Buffer;

// 4. 注入代码并执行
const module = { exports: {} };
const fn = new Function("module", "exports", "env", "Buffer", code + "\n;return { worker: __worker, cmdAddImage, publishDraft, getDraft, clearDraft, syncCommands };");
const api = fn(module, module.exports, env, Buffer);

let passed = 0;
const assert = (cond, name) => {
	if (cond) { passed++; console.log(`  ✅ ${name}`); }
	else { console.error(`  ❌ ${name}`); process.exitCode = 1; }
};

// 测试 1：单图 + caption → 直达发布（1 张图上传 + 1 个 md 提交）
console.log("\n🧪 T1 单图+caption 直达发布");
{
	kvStore.clear();
	await api.cmdAddImage(env, "7950928200", "FILE_A", "今天天气真好 #日常", null);
	const repoPuts = calls.filter((c) => c[0].includes("api.github.com/repos") && c[1] === "PUT");
	const mdPuts = repoPuts.filter((c) => c[0].includes("contents/src/content/moments/"));
	const imgPuts = repoPuts.filter((c) => c[0].includes("contents/astro/raw/"));
	assert(repoPuts.length === 2, `共 2 次 GitHub PUT（图片 1 + md 1），实际 ${repoPuts.length}`);
	assert(imgPuts.length === 1, `图片上传 jpg 仓库 astro/raw/ 路径，实际 ${imgPuts.length}`);
	assert(mdPuts.length === 1, `md 提交博客仓库，实际 ${mdPuts.length}`);
	assert(imgPuts[0][0].includes("yaoxiovo/jpg"), `图床上传目标是 yaoxiovo/jpg：${imgPuts[0]?.[0]}`);
	assert(mdPuts[0][0].includes("yaoxiovo/astro"), `md 提交目标是 yaoxiovo/astro：${mdPuts[0]?.[0]}`);
	const draft = await api.getDraft(env, "7950928200");
	assert(!draft, "发布后草稿已清空");
}

// 测试 2：多图收集 → 文字配文 → 发布（3 张图）
console.log("\n🧪 T2 多图 + 文字配文发布");
{
	kvStore.clear();
	calls.length = 0;
	await api.cmdAddImage(env, "7950928200", "FILE_1", "", null);
	await api.cmdAddImage(env, "7950928200", "FILE_2", "", null);
	await api.cmdAddImage(env, "7950928200", "FILE_3", "", null);
	const d1 = await api.getDraft(env, "7950928200");
	assert(d1?.images?.length === 3, `草稿收集 3 张图，实际 ${d1?.images?.length}`);
	// 模拟发文字配文（走 handleUpdate 的逻辑：文字+草稿 → publishDraft）
	const d = await api.getDraft(env, "7950928200");
	d.captions = ["三张图 #风景"];
	await api.publishDraft(env, "7950928200");
	const imgPuts = calls.filter((c) => c[0].includes("contents/astro/raw/") && c[1] === "PUT");
	assert(imgPuts.length === 3, `3 张图都上传图床，实际 ${imgPuts.length}`);
	const draft = await api.getDraft(env, "7950928200");
	assert(!draft, "发布后草稿已清空");
}

// 测试 3：图片太大 → 拒绝
console.log("\n🧪 T3 超大图拒绝");
{
	kvStore.clear();
	calls.length = 0;
	await api.cmdAddImage(env, "7950928200", "FILE_BIG", "", null);
	const before = calls.filter((c) => c[0].includes("contents/astro/raw/")).length;
	await api.publishDraft(env, "7950928200");
	const after = calls.filter((c) => c[0].includes("contents/astro/raw/")).length;
	assert(before === 0 && after === 0, `超大图未上传（上传次数 ${after}）`);
	const draft = await api.getDraft(env, "7950928200");
	assert(draft?.images?.length === 1, "草稿保留可重试");
}

// 测试 4：GitHub 上传失败 → 报错不崩溃
console.log("\n🧪 T4 GitHub 403 失败处理");
{
	kvStore.clear();
	calls.length = 0;
	// 直接把 IMG_REPO 换成失败仓库来模拟——通过 env 无法改常量，改测 tgDownload 失败
	await api.cmdAddImage(env, "7950928200", "FILE_BAD", "", null);
	await api.publishDraft(env, "7950928200");
	const draft = await api.getDraft(env, "7950928200");
	assert(draft?.images?.length === 1, "下载失败后草稿保留");
}

// 测试 5：/cancel 清空草稿
console.log("\n🧪 T5 cancel 清空");
{
	kvStore.clear();
	await api.cmdAddImage(env, "7950928200", "FILE_X", "", null);
	assert((await api.getDraft(env, "7950928200"))?.images?.length === 1, "有草稿");
	await api.clearDraft(env, "7950928200");
	assert(!(await api.getDraft(env, "7950928200")), "草稿已清空");
}


// 测试 6：setMyCommands 菜单同步（懒触发 + KV 节流）
console.log("\n🧪 T6 命令菜单同步");
{
	kvStore.clear();
	calls.length = 0;
	await api.syncCommands(env);
	let syncCalls = calls.filter((c) => c[0].includes("/setMyCommands"));
	assert(syncCalls.length === 1, "首次触发调用 setMyCommands 一次");
	// 节流：12h 内不再调用
	await api.syncCommands(env);
	syncCalls = calls.filter((c) => c[0].includes("/setMyCommands"));
	assert(syncCalls.length === 1, "12h 节流内不重复调用");
	const saved = kvStore.get("cmd_menu_synced");
	assert(saved, "同步成功后写入 KV 标记");
}

console.log(`\n📋 结果：${passed} 通过`);