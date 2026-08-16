/**
 * blog-api Worker 本地模拟测试
 * 运行：node blog-api/test-simulate.mjs
 * mock caches + mock fetch，验证参数化过滤逻辑
 */
import fs from "node:fs";

// 注入 Worker 代码
const src = fs.readFileSync(new URL("./src/index.js", import.meta.url), "utf-8");
const code = src.replace("export default {", "const __worker = {");

// mock 数据源：模拟博客 /api/moments.json
const SAMPLE = {
	updated: "2026-08-14T06:00:00Z",
	moments: [
		{ slug: "m1", published: "2026-08-14T10:00:00+08:00", author: "瑶曦", tags: ["日常", "咖啡"], text: "今天喝了杯手冲咖啡 #日常 #咖啡", pinned: false, replyTo: null, images: [], videos: [] },
		{ slug: "m2", published: "2026-08-10T10:00:00+08:00", author: "瑶曦", tags: ["技术"], text: "重构了博客的图片懒加载", pinned: true, replyTo: null, images: [], videos: [] },
		{ slug: "m3", published: "2026-07-30T10:00:00+08:00", author: "瑶曦网络科技官方", tags: ["公告"], text: "官网正式上线", pinned: false, replyTo: null, images: [], videos: [] },
		{ slug: "m4", published: "2026-08-14T12:00:00+08:00", author: "瑶曦", tags: [], text: "回复：好喝", pinned: false, replyTo: "m1", images: [], videos: [] },
	],
};

// mock 环境
const cacheStore = new Map();
globalThis.caches = {
	default: {
		async match(key) { return cacheStore.get(String(key.url)) || null; },
		async put(key, res) { cacheStore.set(String(key.url), res); },
	},
};
globalThis.fetch = async (url) => {
	if (String(url).includes("blog.yaoxi.wiki/api/moments.json")) {
		return { ok: true, status: 200, json: async () => SAMPLE };
	}
	return { ok: false, status: 404, json: async () => ({}) };
};
globalThis.AbortSignal = { timeout: () => undefined };

const fn = new Function("module", "exports", code + "\n;return __worker;");
const worker = fn({}, {});

let passed = 0;
const assert = (cond, name) => {
	if (cond) { passed++; console.log(`  ✅ ${name}`); }
	else { console.error(`  ❌ ${name}`); process.exitCode = 1; }
};
const call = async (path) => {
	const res = await worker.fetch(new Request(`https://blog-api.test${path}`));
	const body = await res.json();
	return { status: res.status, body };
};

console.log("\n🧪 T1 无参数：返回全部");
{
	const { status, body } = await call("/api/moments");
	assert(status === 200, "HTTP 200");
	assert(body.total === 4 && body.returned === 4, `全部 4 条，实际 ${body.total}`);
}

console.log("\n🧪 T2 limit + offset 分页");
{
	const { body } = await call("/api/moments?limit=2&offset=1");
	assert(body.returned === 2, `返回 2 条，实际 ${body.returned}`);
	assert(body.moments[0].slug === "m2", `偏移后第一条是 m2，实际 ${body.moments[0].slug}`);
}

console.log("\n🧪 T3 tag 过滤");
{
	const { body } = await call("/api/moments?tag=咖啡");
	assert(body.total === 1 && body.moments[0].slug === "m1", `tag=咖啡 命中 1 条，实际 ${body.total}`);
}

console.log("\n🧪 T4 date 精确过滤");
{
	const { body } = await call("/api/moments?date=2026-08-10");
	assert(body.total === 1 && body.moments[0].slug === "m2", `date=2026-08-10 命中 m2，实际 ${body.total}`);
}

console.log("\n🧪 T5 from/to 范围");
{
	const { body } = await call("/api/moments?from=2026-08-01&to=2026-08-14");
	assert(body.total === 3, `8月范围命中 3 条，实际 ${body.total}`);
}

console.log("\n🧪 T6 q 关键词搜索");
{
	const { body } = await call("/api/moments?q=重构");
	assert(body.total === 1 && body.moments[0].slug === "m2", `q=重构 命中 m2，实际 ${body.total}`);
	const { body: b2 } = await call("/api/moments?q=官方");
	assert(b2.total === 1 && b2.moments[0].slug === "m3", "q 也匹配作者名");
}

console.log("\n🧪 T7 replies 过滤");
{
	const { body } = await call("/api/moments?replies=0");
	assert(body.total === 3, `replies=0 排除回复后 3 条，实际 ${body.total}`);
	const { body: b2 } = await call("/api/moments?replies=1");
	assert(b2.total === 1 && b2.moments[0].slug === "m4", "replies=1 仅回复");
}

console.log("\n🧪 T8 pinned + 组合参数");
{
	const { body } = await call("/api/moments?pinned=1");
	assert(body.total === 1 && body.moments[0].slug === "m2", "pinned=1 仅置顶");
	const { body: b2 } = await call("/api/moments?tag=日常&replies=0&limit=1");
	assert(b2.total === 1 && b2.returned === 1 && b2.moments[0].slug === "m1", "tag+replies+limit 组合");
}

console.log("\n🧪 T9 404 / OPTIONS / 文档");
{
	const { status } = await call("/api/nothing");
	assert(status === 404, "未知路径 404");
	const opt = await worker.fetch(new Request("https://blog-api.test/api/moments", { method: "OPTIONS" }));
	assert(opt.status === 204 && opt.headers.get("Access-Control-Allow-Origin") === "*", "OPTIONS 预检 204 + CORS");
	const doc = await call("/");
	assert(doc.body.name === "Yaoxi Blog API" && doc.body.endpoints, "文档端点正常");
}

console.log(`\n📋 结果：${passed} 通过`);
