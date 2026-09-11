/**
 * 博客四大自动化邮件场景本地全链路模拟测试
 * 运行：node blog-api/test-email-simulate.mjs
 */

// 模拟 KV 内存存储
class MockKV {
	constructor() {
		this.store = new Map();
	}
	async get(key) {
		return this.store.get(key) || null;
	}
	async put(key, val) {
		this.store.set(key, String(val));
	}
	async delete(key) {
		this.store.delete(key);
	}
}

const interceptedCalls = [];

// 模拟 Fetch (直连 mail-api.yaoxi.cloud 网关)
globalThis.fetch = async (url, opts = {}) => {
	const urlStr = String(url);
	// 模拟邮件网关 mail-api.yaoxi.cloud
	if (urlStr.includes("mail-api.yaoxi.cloud")) {
		const body = JSON.parse(opts.body || "{}");
		const auth = opts.headers?.Authorization || opts.headers?.["x-api-key"] || "";
		interceptedCalls.push({ url: urlStr, body, auth });
		return {
			ok: true,
			status: 200,
			json: async () => ({ ok: true, id: "gw_msg_" + Math.random().toString(36).slice(2, 9) }),
		};
	}
	// 模拟博客源站
	if (urlStr.includes("/api/moments.json")) {
		return {
			ok: true,
			status: 200,
			json: async () => ({ updated: "2026-09-11T00:00:00Z", moments: [] }),
		};
	}
	return { ok: false, status: 404, json: async () => ({}) };
};

globalThis.caches = {
	default: {
		async match() {
			return null;
		},
		async put() {},
	},
};

globalThis.AbortSignal = { timeout: () => undefined };

// 动态载入 Worker 代码
const workerModule = await import("./src/index.js");
const worker = workerModule.default;

const mockKv = new MockKV();
const env = {
	RATE_LIMIT_KV: mockKv,
	ADMIN_TOKEN: "yaoxi-admin-token-12345",
	MAIL_GATEWAY_TOKEN: "gw-token-xyz",
	MAIL_GATEWAY_URL: "https://mail-api.yaoxi.cloud",
	OWNER_EMAIL: "yaoxi@yaoxi.wiki",
};

let passed = 0;
let failed = 0;

function assert(cond, name) {
	if (cond) {
		passed++;
		console.log(`  ✅ ${name}`);
	} else {
		failed++;
		console.error(`  ❌ ${name}`);
	}
}

async function call(path, method = "GET", body = null, headers = {}) {
	const req = new Request(`https://blog-api.test${path}`, {
		method,
		headers: {
			...(body ? { "Content-Type": "application/json" } : {}),
			...headers,
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	const res = await worker.fetch(req, env);
	const contentType = res.headers.get("Content-Type") || "";
	let data;
	if (contentType.includes("application/json")) {
		data = await res.json();
	} else {
		data = await res.text();
	}
	return { status: res.status, headers: res.headers, data };
}

console.log("\n🧪 [场景 0] API 路由与网关元信息检测");
{
	const res = await call("/");
	assert(res.status === 200, "HTTP 200");
	assert(res.data.mailGateway === "https://mail-api.yaoxi.cloud", "网关指向 mail-api.yaoxi.cloud");
	assert(!!res.data.endpoints["POST /api/newsletter/subscribe"], "注册订阅端点");
	assert(!!res.data.endpoints["POST /api/newsletter/broadcast"], "注册文章广播端点");
	assert(!!res.data.endpoints["POST /api/newsletter/weekly-digest"], "注册周报广播端点");
	assert(!!res.data.endpoints["POST /api/contact"], "注册留言与回执端点");
}

let verificationToken = null;

console.log("\n🧪 [场景 1] 读者邮件订阅与新文章广播推送 (Newsletter & Broadcast)");
{
	interceptedCalls.length = 0;
	// 1.1 发起订阅请求
	const subRes = await call("/api/newsletter/subscribe", "POST", { email: "fan@yaoxi.club" });
	assert(subRes.status === 200 && subRes.data.ok === true, "订阅申请成功 200");
	assert(
		interceptedCalls.some((c) => c.url.endsWith("/api/send/notify")),
		"激活邮件通过 /api/send/notify 路由投递",
	);

	for (const [k, v] of mockKv.store.entries()) {
		if (k.startsWith("sub:pending:")) {
			verificationToken = k.replace("sub:pending:", "");
			break;
		}
	}
	assert(!!verificationToken, `成功生成双重验证 Token: ${verificationToken}`);

	// 1.2 点击激活链接
	const verifyRes = await call(`/api/newsletter/verify?token=${verificationToken}`);
	assert(verifyRes.status === 200 && verifyRes.data.includes("订阅成功"), "激活成功并返回前端页面");

	// 1.3 发布新文章广播
	interceptedCalls.length = 0;
	const broadcastRes = await call(
		"/api/newsletter/broadcast",
		"POST",
		{
			title: "Astro 5 全新动态与自动化工作流实践",
			summary: "本文分享了我们如何通过 Cloudflare Worker 接入自动化邮件系统...",
			url: "https://blog.yaoxi.wiki/posts/astro-email/",
			tags: ["Astro", "Serverless", "Automation"],
		},
		{ Authorization: "Bearer yaoxi-admin-token-12345" },
	);
	assert(broadcastRes.status === 200 && broadcastRes.data.sent === 1, "广播发信成功送达 1 位订阅者");
	assert(
		interceptedCalls.some((c) => c.url.endsWith("/api/send/notify") && c.body.to === "fan@yaoxi.club"),
		"广播发信成功调用 /api/send/notify 向订阅者投递",
	);
}

console.log("\n🧪 [场景 2] 访客留言与双向通报回执 (Contact & Auto-Reply)");
{
	interceptedCalls.length = 0;
	const contactRes = await call("/api/contact", "POST", {
		name: "小李",
		email: "xiaoli@example.com",
		message: "瑶曦你好，博客的排版真好看，请问是用什么主题改的呀？",
		pageUrl: "https://blog.yaoxi.wiki/posts/astro-email/",
	});
	assert(contactRes.status === 200 && contactRes.data.ok === true, "留言提交成功");

	// 验证双向发信：一封给站长，一封自动回执给访客
	const toOwner = interceptedCalls.find(
		(c) => c.url.endsWith("/api/send/service") && c.body.to === "yaoxi@yaoxi.wiki",
	);
	const toVisitor = interceptedCalls.find(
		(c) => c.url.endsWith("/api/send/service") && c.body.to === "xiaoli@example.com",
	);

	assert(!!toOwner, "留言工单通过 /api/send/service 送达站长邮箱");
	assert(!!toVisitor, "自动确认回执通过 /api/send/service 送达访客邮箱");
}

console.log("\n🧪 [场景 3] 每周数据与精选周报广播 (Weekly Digest)");
{
	interceptedCalls.length = 0;
	const weeklyRes = await call(
		"/api/newsletter/weekly-digest",
		"POST",
		{
			weekRange: "2026-09-05 ~ 2026-09-12",
			posts: [{ title: "Astro 5 实践", url: "https://blog.yaoxi.wiki/posts/astro-email/", description: "实践心得" }],
			momentsCount: 5,
			topTags: ["日常", "技术"],
		},
		{ Authorization: "Bearer yaoxi-admin-token-12345" },
	);
	assert(weeklyRes.status === 200 && weeklyRes.data.sent === 1, "周报成功群发");
	assert(
		interceptedCalls.some((c) => c.url.endsWith("/api/send/bot")),
		"周报通过 /api/send/bot 路由投递",
	);
}

console.log("\n🧪 [场景 4] 读者一键退订 (Unsubscribe)");
{
	const unsubRes = await call(`/api/newsletter/unsubscribe?token=${verificationToken}`);
	assert(unsubRes.status === 200 && unsubRes.data.includes("退订成功"), "退订成功并展示反馈页");

	const listRaw = await mockKv.get("sub:list");
	const list = JSON.parse(listRaw || "[]");
	assert(!list.some((s) => s.email === "fan@yaoxi.club"), "订阅列表中已无该邮箱");
}

console.log(`\n========================================`);
console.log(`全链路测试完成：共 ${passed + failed} 项，通过 ${passed}，失败 ${failed}`);
if (failed > 0) process.exit(1);
