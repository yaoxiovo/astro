/**
 * ddos-auth.test.mjs — /api/ddos 端点鉴权回归测试
 *
 * 背景：/api/ddos 的真实查询分支会在没有请求头凭据时回退到 Worker 自身的
 * CF_API_TOKEN / CLOUDFLARE_API_TOKEN。此前该端点完全无鉴权，任何匿名访客
 * 都能借本站配额去查询 Cloudflare 安全日志（凭据滥用 + 配额消耗）。
 *
 * 修复后语义：
 *   - ?demo=true  → 返回合成演示数据，公开可访问（不消耗任何真实凭据）
 *   - 无 demo     → 必须携带有效 ADMIN_TOKEN，否则 401
 * 本测试锁定该语义，防止回退。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import blogApi from "../blog-api/src/index.js";

const ADMIN_TOKEN = "test-admin-token";

/** 最小 env：不提供任何 CF 凭据，确保真实分支不会外呼 */
function makeEnv(overrides = {}) {
	return {
		ADMIN_TOKEN,
		ENVIRONMENT: "production",
		...overrides,
	};
}

function callDdos({ query = "", headers = {}, env = makeEnv() } = {}) {
	return blogApi.fetch(
		new Request(`https://blog-api.yaoxi.cloud/api/ddos${query}`, {
			method: "GET",
			headers,
		}),
		env,
		{ waitUntil() {} },
	);
}

describe("/api/ddos 鉴权边界", () => {
	it("匿名请求真实日志应被拒绝（401），且不得回退到 Worker 自身凭据", async () => {
		const res = await callDdos();
		assert.equal(res.status, 401, "无凭据的真实查询必须 401");

		const body = await res.json();
		assert.equal(body.error, "unauthorized");
		// 错误信息应引导使用者改用 demo，而不是泄露内部实现
		assert.ok(
			typeof body.message === "string" && body.message.includes("demo"),
			"401 响应应提示可用 ?demo=true 查看演示数据",
		);
	});

	it("携带错误 ADMIN_TOKEN 应被拒绝（401）", async () => {
		const res = await callDdos({
			headers: { Authorization: "Bearer wrong-token" },
		});
		assert.equal(res.status, 401);
	});

	it("demo 模式无需鉴权即可访问（合成数据不消耗凭据）", async () => {
		const res = await callDdos({ query: "?demo=true" });
		assert.equal(res.status, 200, "demo 模式应保持公开");

		const body = await res.json();
		assert.equal(body.isDemo, true);
		assert.equal(body.hasAttack, true);
	});

	it("demo=1 等价于 demo=true", async () => {
		const res = await callDdos({ query: "?demo=1" });
		assert.equal(res.status, 200);
		assert.equal((await res.json()).isDemo, true);
	});

	it("携带正确 ADMIN_TOKEN 时通过鉴权（进入真实查询分支）", async () => {
		const res = await callDdos({
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		assert.notEqual(res.status, 401, "有效管理员凭据不得被 401 拒绝");
		assert.equal(res.status, 200);
	});

	it("X-Admin-Token 头同样通过鉴权", async () => {
		const res = await callDdos({ headers: { "X-Admin-Token": ADMIN_TOKEN } });
		assert.notEqual(res.status, 401);
		assert.equal(res.status, 200);
	});

	it("生产环境不接受 ?secret= 查询串鉴权（防凭据进日志/Referer）", async () => {
		const res = await callDdos({ query: `?secret=${ADMIN_TOKEN}` });
		assert.equal(res.status, 401, "生产环境不得通过查询串授权");
	});

	it("未配置 ADMIN_TOKEN 时真实查询保持关闭（fail-closed）", async () => {
		const res = await callDdos({ env: makeEnv({ ADMIN_TOKEN: undefined }) });
		assert.equal(res.status, 401, "缺少 ADMIN_TOKEN 配置必须拒绝而非放行");
	});
});
