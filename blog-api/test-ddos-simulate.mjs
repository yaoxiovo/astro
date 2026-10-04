/**
 * DDoS API 全链路模拟与单元测试 (TDD)
 * 运行：node blog-api/test-ddos-simulate.mjs
 */

// 模拟 KV 内存存储
class MockKV {
	constructor() {
		this.store = new Map();
	}
	async get(key, type = "text") {
		const val = this.store.get(key);
		if (!val) return null;
		if (type === "json") return JSON.parse(val);
		return val;
	}
	async put(key, val) {
		this.store.set(key, String(val));
	}
	async delete(key) {
		this.store.delete(key);
	}
}

// 模拟 Fetch
let mockCFRoutes = new Map();
globalThis.fetch = async (url, opts = {}) => {
	const urlStr = String(url);
	if (mockCFRoutes.has(urlStr)) {
		return mockCFRoutes.get(urlStr)(opts);
	}
	if (urlStr.includes("api.cloudflare.com/client/v4/zones?status=active")) {
		return {
			ok: true,
			status: 200,
			json: async () => ({
				success: true,
				result: [
					{ id: "mock-zone-123456", name: "yaoxi.wiki" },
					{ id: "mock-zone-cloud", name: "yaoxi.cloud" },
				],
			}),
		};
	}
	if (urlStr.includes("api.cloudflare.com/client/v4/zones?name=yaoxi.wiki")) {
		return {
			ok: true,
			status: 200,
			json: async () => ({
				success: true,
				result: [{ id: "mock-zone-123456", name: "yaoxi.wiki" }],
			}),
		};
	}
	if (urlStr.includes("api.cloudflare.com/client/v4/graphql")) {
		const bodyJson = opts.body ? JSON.parse(opts.body) : {};
		const zoneTag = bodyJson?.variables?.zoneTag;

		let events = [];
		if (zoneTag === "mock-zone-cloud") {
			events = [
				{
					action: "managed_challenge",
					clientASNDescription: "CHINANET",
					clientAsn: 4134,
					clientCountryName: "China",
					clientIP: "114.248.55.12",
					clientRequestHTTPHost: "accounts.yaoxi.cloud",
					clientRequestHTTPMethodName: "POST",
					clientRequestHTTPProtocol: "HTTP/2",
					clientRequestPath: "/api/auth/token",
					clientRequestQuery: "",
					datetime: new Date(Date.now() - 3600 * 1000).toISOString(),
					rayName: "8ccd112233445566",
					ruleId: "under-attack-challenge",
					rulesetId: "",
					source: "securityLevel",
					userAgent: "Bot/2.0",
				},
			];
		} else {
			events = [
				{
					action: "drop",
					clientASNDescription: "CLOUDFLARENET",
					clientAsn: 13335,
					clientCountryName: "United States",
					clientIP: "198.51.100.42",
					clientRequestHTTPHost: "blog.yaoxi.wiki",
					clientRequestHTTPMethodName: "GET",
					clientRequestHTTPProtocol: "HTTP/2",
					clientRequestPath: "/api/moments.json",
					clientRequestQuery: "",
					datetime: new Date().toISOString(),
					rayName: "8ccd99887766aabb",
					ruleId: "cloudflare-l7-ddos-mitigation",
					rulesetId: "",
					source: "l7ddos",
					userAgent: "BotEngine/1.0",
				},
			];
		}

		return {
			ok: true,
			status: 200,
			json: async () => ({
				data: {
					viewer: {
						zones: [
							{
								securityEventsAdaptive: events,
							},
						],
					},
				},
			}),
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

// 动态载入 Worker
const workerModule = await import("./src/index.js");
const worker = workerModule.default;

let passed = 0;
let failed = 0;
const assert = (cond, name) => {
	if (cond) {
		passed++;
		console.log(`  ✅ ${name}`);
	} else {
		failed++;
		console.error(`  ❌ ${name}`);
		process.exitCode = 1;
	}
};

const call = async (path, env = {}, headers = {}) => {
	const req = new Request(`https://blog-api.test${path}`, { headers });
	const res = await worker.fetch(req, env, {});
	const body = await res.json();
	return { status: res.status, body, headers: res.headers };
};

console.log("\n🧪 [测试 1] 未配置 Cloudflare Token 时的降级防护");
{
	const { status, body } = await call("/api/ddos", { RATE_LIMIT_KV: new MockKV() });
	assert(status === 200, "HTTP 200 正常响应");
	assert(body.status === "normal", "默认报告状态 normal");
	assert(body.hasAttack === false, "hasAttack 为 false");
	assert(body.totalEvents === 0, "totalEvents 为 0");
	assert(body.cfConnected === false, "cfConnected 标记未连通");
}

console.log("\n🧪 [测试 2] 攻防演练模式 (Demo Mode)");
{
	const { status, body } = await call("/api/ddos?demo=1");
	assert(status === 200, "HTTP 200");
	assert(body.status === "attack", "演练模式下状态判定为 attack");
	assert(body.hasAttack === true, "hasAttack 为 true");
	assert(body.isDemo === true, "isDemo 为 true");
	assert(body.events.length > 0, "返回模拟攻击日志流水");
	assert(body.events[0].ip.includes("***"), "IP 地址严格脱敏脱水");
	assert(body.summary.dropped > 0, "包含丢弃与阻断统计");
}

console.log("\n🧪 [测试 3] 直连 Cloudflare GraphQL 攻击日志查询");
{
	const mockKv = new MockKV();
	const env = {
		CF_API_TOKEN: "mock-token-xyz",
		CF_ZONE_ID: "mock-zone-123456",
		RATE_LIMIT_KV: mockKv,
	};
	const { status, body } = await call("/api/ddos?hours=24", env);
	assert(status === 200, "HTTP 200");
	assert(body.cfConnected === true, "cfConnected 为 true");
	assert(body.totalEvents === 1, "准确拉取到 1 条攻击日志");
	assert(body.events[0].source === "l7ddos", "识别源为 l7ddos");
	assert(body.events[0].action === "drop", "处置动作为 drop");
	assert(body.events[0].rayId === "8ccd99887766aabb", "Ray ID 正确注入");
	assert(body.events[0].countryCode === "US", "国家代码正确映射");

	// 测试缓存生效
	const cachedCall = await call("/api/ddos?hours=24", env);
	assert(cachedCall.body._fromCache === true, "第二次请求命中 KV 缓存");
}

console.log("\n🧪 [测试 4] 随认证中心请求头携带 x-cf-token 透传与动态多 Zone 自动发现");
{
	// 即使 Worker 环境变量未配置任何 Token，客户端只要携带 x-cf-token 即可自动生效并发现所有域名
	const emptyEnv = { RATE_LIMIT_KV: new MockKV() };
	const clientHeaders = { "x-cf-token": "cf-client-downstream-token" };
	const { status, body } = await call("/api/ddos?hours=24", emptyEnv, clientHeaders);
	assert(status === 200, "HTTP 200");
	assert(body.cfConnected === true, "透传 Token 成功连通 Cloudflare");
	assert(body.target.includes("yaoxi.wiki") && body.target.includes("yaoxi.cloud"), "自动探测并聚合所有活跃域名");
	assert(body.totalEvents === 2, "跨多 Zone 聚合拉取到全部 2 条防御事件");
	assert(body.events.some((e) => e.host.includes("accounts.yaoxi.cloud")), "成功捕获 yaoxi.cloud 域名的防御日志");
	assert(body.events.some((e) => e.host.includes("blog.yaoxi.wiki")), "成功捕获 yaoxi.wiki 域名的防御日志");
}

console.log("\n🧪 [测试 5] 深度防御动作过滤与攻击类型智能判定");
{
	const emptyEnv = { RATE_LIMIT_KV: new MockKV() };
	const clientHeaders = { "x-cf-token": "cf-client-downstream-token" };
	const { body } = await call("/api/ddos?hours=24", emptyEnv, clientHeaders);
	const managedEv = body.events.find((e) => e.action === "managed_challenge");
	assert(!!managedEv, "成功识别 managed_challenge 质询事件");
	assert(managedEv.attackType.includes("Under Attack"), "准确映射 securityLevel 规则为 Under Attack 攻击防御模式");
	assert(body.hasAttack === true, "24h 内存在攻击时 hasAttack 判定为 true");
}

console.log("\n========================================");
console.log(`DDoS 模块全链路测试完成：共 ${passed + failed} 项，通过 ${passed}，失败 ${failed}`);

