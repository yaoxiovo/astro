/**
 * Site Monitor 冒烟测试（node:test）
 * 运行：node --test test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

/* ---------- 测试基建 ---------- */

function memoryKV() {
	const m = new Map();
	return {
		get: async (k) => m.get(k) ?? null,
		put: async (k, v) => m.set(k, v),
		delete: async (k) => m.delete(k),
	};
}

const tgCalls = [];
const flashcatCalls = [];
const siteResponses = new Map(); // url -> () => Response | throw

globalThis.fetch = async (url, opts = {}) => {
	const u = String(url);
	if (u.startsWith("https://api.telegram.org/")) {
		tgCalls.push(JSON.parse(opts.body ?? "{}"));
		return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
	}
	if (u.includes("/event/push/alert/standard")) {
		flashcatCalls.push(JSON.parse(opts.body ?? "{}"));
		return new Response(JSON.stringify({ request_id: "r1", data: { alert_key: "k1" } }), { status: 200, headers: { "content-type": "application/json" } });
	}
	const handler = siteResponses.get(u);
	if (!handler) throw new Error(`Unexpected fetch: ${u}`);
	return handler(opts);
};

function makeEnv(kv = memoryKV()) {
	return {
		MONITOR_KV: kv,
		BOT_TOKEN: "123456:TESTTOKEN",
		CHAT_ID: "7950928200",
		FLASHCAT_API_HOST: "https://api.flashcat.cloud",
		FLASHCAT_INTEGRATION_KEY: "test-int-key",
		SITES: JSON.stringify([
			{ name: "博客主站", url: "https://blog.yaoxi.wiki/", expect: 200 },
			{ name: "关键字站", url: "https://example.com/", expect: 200, keyword: "yaoxi" },
		]),
	};
}

function okResp(status = 200, body = "hello yaoxi") {
	return new Response(body, { status, headers: { "content-type": "text/html" } });
}

function reset() {
	tgCalls.length = 0;
	flashcatCalls.length = 0;
	siteResponses.clear();
}

// waitUntil 收集任务并 await（否则 scheduled 里的 runChecks 不会真正执行）
async function scheduledRun(env) {
	const tasks = [];
	await worker.scheduled({}, env, { waitUntil: (p) => tasks.push(p) });
	await Promise.all(tasks);
}

/* ---------- 用例 ---------- */

test("T1 全部站点正常：不产生告警", async () => {
	reset();
	siteResponses.set("https://blog.yaoxi.wiki/", () => okResp());
	siteResponses.set("https://example.com/", () => okResp(200, "welcome to yaoxi wiki"));
	const env = makeEnv();
	await scheduledRun(env);
	assert.equal(tgCalls.length, 0, "正常状态不应告警");
	assert.equal(flashcatCalls.length, 0, "正常状态不应上报快猫星云");
	const st = JSON.parse(await env.MONITOR_KV.get("site:state:博客主站"));
	assert.equal(st.state, "up", "KV 应记录检测结果");
});

test("T2 首次故障：立即告警一次（含原因）", async () => {
	reset();
	siteResponses.set("https://blog.yaoxi.wiki/", () => new Response("boom", { status: 503 }));
	siteResponses.set("https://example.com/", () => okResp(200, "welcome to yaoxi wiki"));
	const env = makeEnv();
	await scheduledRun(env);
	assert.equal(tgCalls.length, 1, "应恰好告警一次");
	assert.match(tgCalls[0].text, /🔴/);
	assert.match(tgCalls[0].text, /故障告警/);
	assert.match(tgCalls[0].text, /HTTP 503/);
	assert.equal(tgCalls[0].chat_id, "7950928200");
	// Flashduty 标准告警
	assert.equal(flashcatCalls.length, 1, "应上报快猫星云一次");
	const fc = flashcatCalls[0];
	assert.equal(fc.event_status, "Critical");
	assert.equal(fc.alert_key, "site-monitor:博客主站");
	assert.match(fc.title_rule, /故障/);
	assert.match(fc.description, /HTTP 503/);
	assert.equal(fc.labels.site, "博客主站");
	assert.equal(fc.labels.monitor, "cf-site-monitor");
});

test("T3 持续故障：不重复刷屏告警", async () => {
	reset();
	siteResponses.set("https://blog.yaoxi.wiki/", () => new Response("boom", { status: 503 }));
	siteResponses.set("https://example.com/", () => okResp(200, "welcome to yaoxi wiki"));
	const env = makeEnv();
	await scheduledRun(env); // 第一次：告警
	await scheduledRun(env); // 第二次：静默
	await scheduledRun(env); // 第三次：静默
	assert.equal(tgCalls.length, 1, "持续故障只告警一次");
	assert.equal(flashcatCalls.length, 1, "持续故障只上报快猫星云一次");
});

test("T4 故障恢复：发送恢复通知 + 故障时长", async () => {
	reset();
	const env = makeEnv();
	// 先打故障
	siteResponses.set("https://blog.yaoxi.wiki/", () => new Response("boom", { status: 500 }));
	siteResponses.set("https://example.com/", () => okResp(200, "welcome to yaoxi wiki"));
	await scheduledRun(env);
	// 恢复
	siteResponses.set("https://blog.yaoxi.wiki/", () => okResp());
	await scheduledRun(env);
	assert.equal(tgCalls.length, 2, "故障 + 恢复 = 2 条告警");
	const upMsg = tgCalls[1].text;
	assert.match(upMsg, /🟢/);
	assert.match(upMsg, /已恢复/);
	assert.match(upMsg, /故障时长/);
	// Flashduty：恢复事件 Ok + 相同 alert_key（自动恢复）
	assert.equal(flashcatCalls.length, 2, "故障 + 恢复 = 2 次上报");
	assert.equal(flashcatCalls[1].event_status, "Ok");
	assert.equal(flashcatCalls[1].alert_key, flashcatCalls[0].alert_key, "恢复必须使用相同 alert_key");
	assert.match(flashcatCalls[1].title_rule, /已恢复/);
});

test("T5 关键字未匹配：判定为故障", async () => {
	reset();
	siteResponses.set("https://blog.yaoxi.wiki/", () => okResp());
	siteResponses.set("https://example.com/", () => okResp(200, "nothing to see here"));
	const env = makeEnv();
	await scheduledRun(env);
	assert.equal(tgCalls.length, 1);
	assert.match(tgCalls[0].text, /关键字 &quot;yaoxi&quot; 未匹配/);
	assert.equal(flashcatCalls.length, 1);
});

test("T6 网络超时：AbortError 判定为故障", async () => {
	reset();
	siteResponses.set("https://blog.yaoxi.wiki/", () => okResp());
	siteResponses.set("https://example.com/", () => {
		const err = new Error("This operation was aborted");
		err.name = "AbortError";
		throw err;
	});
	const env = makeEnv();
	await scheduledRun(env);
	assert.equal(tgCalls.length, 1);
	assert.match(tgCalls[0].text, /超时/);
	assert.equal(flashcatCalls.length, 1);
});

test("T7 网络错误：判定为故障", async () => {
	reset();
	siteResponses.set("https://blog.yaoxi.wiki/", () => okResp());
	siteResponses.set("https://example.com/", () => { throw new Error("getaddrinfo ENOTFOUND"); });
	const env = makeEnv();
	await scheduledRun(env);
	assert.equal(tgCalls.length, 1);
	assert.match(tgCalls[0].text, /网络错误/);
	assert.equal(flashcatCalls.length, 1);
});

test("T8 状态查询 API：返回各站点状态", async () => {
	reset();
	const env = makeEnv();
	// 先跑一轮，让 KV 有状态
	siteResponses.set("https://blog.yaoxi.wiki/", () => okResp());
	siteResponses.set("https://example.com/", () => new Response("boom", { status: 500 }));
	await scheduledRun(env);
	// 查状态
	const resp = await worker.fetch(new Request("https://site-monitor.workers.dev/api/status"), env);
	assert.equal(resp.status, 200);
	const data = await resp.json();
	assert.equal(data.sites.length, 2);
	const blog = data.sites.find((s) => s.name === "博客主站");
	const kw = data.sites.find((s) => s.name === "关键字站");
	assert.equal(blog.state, "up");
	assert.equal(kw.state, "down");
});

test("T9 手动触发需要 secret", async () => {
	reset();
	const env = makeEnv();
	env.MONITOR_SECRET = "s3cret";
	const denied = await worker.fetch(new Request("https://site-monitor.workers.dev/api/run"), env);
	assert.equal(denied.status, 401);
	siteResponses.set("https://blog.yaoxi.wiki/", () => okResp());
	siteResponses.set("https://example.com/", () => okResp(200, "welcome to yaoxi wiki"));
	const allowed = await worker.fetch(new Request("https://site-monitor.workers.dev/api/run?secret=s3cret"), env);
	assert.equal(allowed.status, 200);
	const data = await allowed.json();
	assert.ok(data.results.every((r) => r.ok));
});

test("T10 告警消息 HTML 转义安全", async () => {
	reset();
	// 站点名带 <>& 字符的场景
	const env = makeEnv();
	env.SITES = JSON.stringify([
		{ name: "A&B <站>", url: "https://blog.yaoxi.wiki/?a=1&b=2", expect: 200 },
	]);
	siteResponses.set("https://blog.yaoxi.wiki/?a=1&b=2", () => new Response("boom", { status: 502 }));
	await scheduledRun(env);
	assert.equal(tgCalls.length, 1);
	const text = tgCalls[0].text;
	assert.ok(!text.includes("<站>"), "原始尖括号必须被转义");
	assert.ok(text.includes("&lt;站&gt;"), "应包含转义后的实体");
	// Flashduty 是纯文本 JSON 通道：标题保留原始站点名（不需要 HTML 转义）
	assert.equal(flashcatCalls.length, 1);
	assert.ok(flashcatCalls[0].title_rule.includes("A&B <站>"), "Flashduty 标题应为原文");
	assert.equal(flashcatCalls[0].labels.site, "A&B <站>");
});

test("T11 状态页 HTML：/ 返回自写状态页", async () => {
	reset();
	const env = makeEnv();
	const resp = await worker.fetch(new Request("https://site-monitor.workers.dev/"), env);
	assert.equal(resp.status, 200);
	const text = await resp.text();
	assert.match(text, /<!DOCTYPE html>/);
	assert.match(text, /Yaoxi Status/);
	assert.match(text, /All Systems Operational/);
	assert.match(text, /Incident History/);
	assert.match(text, /\/api\/status/);
});

test("T12 历史 API：uptime% + 采样曲线 + 故障事件推导", async () => {
	reset();
	const env = makeEnv();
	// 预置历史快照：当前小时 key，含 up/up/down/down/up 采样
	const now = Date.now();
	const d = new Date(now);
	const pad = (n) => String(n).padStart(2, "0");
	const hourKey = `hist:${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}`;
	await env.MONITOR_KV.put(
		hourKey,
		JSON.stringify({
			samples: {
				博客主站: [
					{ ts: now - 20000, state: "up", ms: 100 },
					{ ts: now - 15000, state: "up", ms: 120 },
					{ ts: now - 10000, state: "down", ms: 0 },
					{ ts: now - 5000, state: "down", ms: 0 },
					{ ts: now, state: "up", ms: 90 },
				],
			},
		}),
		{ expirationTtl: 2592000 },
	);
	const resp = await worker.fetch(new Request("https://site-monitor.workers.dev/api/history?days=1"), env);
	assert.equal(resp.status, 200);
	const data = await resp.json();
	const blog = data.sites["博客主站"];
	assert.equal(blog.count, 5, "应读取到 5 个采样点");
	assert.equal(blog.downCount, 2);
	assert.equal(blog.uptime, 60, "uptime = 3/5 = 60%");
	assert.equal(blog.events.length, 1, "应推导出 1 次故障事件");
	assert.ok(blog.events[0].duration >= 5000 && blog.events[0].duration <= 15000, "故障时长应在 5-15s 之间");
});

test("T13 历史快照：scheduled 后写入 hourly KV", async () => {
	reset();
	siteResponses.set("https://blog.yaoxi.wiki/", () => okResp());
	siteResponses.set("https://example.com/", () => okResp(200, "welcome to yaoxi wiki"));
	const env = makeEnv();
	await scheduledRun(env);
	const now = Date.now();
	const d = new Date(now);
	const pad = (n) => String(n).padStart(2, "0");
	const hourKey = `hist:${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}`;
	const raw = await env.MONITOR_KV.get(hourKey);
	assert.ok(raw, "应写入 hourly 快照");
	const parsed = JSON.parse(raw);
	assert.ok(parsed.samples["博客主站"].length >= 1, "快照应包含博客主站采样");
	assert.equal(parsed.samples["博客主站"][0].state, "up");
	assert.ok(typeof parsed.samples["博客主站"][0].ms === "number");
});