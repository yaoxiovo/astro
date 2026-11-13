import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createTmsHeaders,
	moderateTencentText,
} from "../blog-api/src/tencent-tms.js";

const env = {
	TENCENT_TMS_ENABLED: "true",
	TENCENTCLOUD_SECRET_ID: "test-secret-id",
	TENCENTCLOUD_SECRET_KEY: "test-secret-key",
};

const reply = (Suggestion, extra = {}) =>
	Response.json({
		Response: {
			Suggestion,
			RequestId: "req-123",
			Label: "Normal",
			Score: 0,
			...extra,
		},
	});

test("TMS disabled or missing credentials never makes an outbound request", async () => {
	const fetchImpl = () => assert.fail("must not send");
	assert.equal(
		(await moderateTencentText({}, "hello", { fetchImpl })).suggestion,
		"Disabled",
	);
	assert.deepEqual(
		await moderateTencentText({ TENCENT_TMS_ENABLED: "true" }, "hello", {
			fetchImpl,
		}),
		{
			provider: "tencent-tms",
			suggestion: "Error",
			error: "not_configured",
		},
	);
});

test("TC3 signature matches an independently calculated Python hashlib/hmac vector", async () => {
	const body = '{"Content":"5L2g5aW977yM5LiW55WM8J+Mjw==","Type":"TEXT"}';
	const headers = await createTmsHeaders(env, body, 1700000000);
	assert.equal(
		headers.Authorization,
		"TC3-HMAC-SHA256 Credential=test-secret-id/2023-11-14/tms/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=9fbd64870854d5e451afd5ffcf6e7500151219b5dac021a2eb7f45a59ca4e41d",
	);
	assert.equal(headers["X-TC-Timestamp"], "1700000000");
	const changed = await createTmsHeaders(env, `${body} `, 1700000000);
	assert.notEqual(changed.Authorization, headers.Authorization);
});

test("TMS sends UTF-8 Base64, configured policy/region and temporary token to the fixed endpoint", async () => {
	const text = "昵称\n你好，世界🌏";
	const result = await moderateTencentText(
		{
			...env,
			TENCENT_TMS_BIZ_TYPE: "blog-comments",
			TENCENT_TMS_REGION: "ap-shanghai",
			TENCENTCLOUD_TOKEN: "test-session-token",
		},
		text,
		{
			now: () => 1700000000000,
			fetchImpl: async (url, init) => {
				assert.equal(url, "https://tms.tencentcloudapi.com/");
				assert.equal(init.method, "POST");
				assert.equal(init.redirect, "error");
				assert.ok(init.signal instanceof AbortSignal);
				assert.equal(init.headers["X-TC-Version"], "2020-12-29");
				assert.equal(init.headers["X-TC-Action"], "TextModeration");
				assert.equal(init.headers["X-TC-Region"], "ap-shanghai");
				assert.equal(init.headers["X-TC-Token"], "test-session-token");
				const body = JSON.parse(init.body);
				assert.equal(
					Buffer.from(body.Content, "base64").toString("utf8"),
					text,
				);
				assert.equal(body.BizType, "blog-comments");
				assert.equal(body.Type, "TEXT");
				assert.equal("User" in body, false);
				return reply("Pass", { DetailResults: [{ secret: "not-for-audit" }] });
			},
		},
	);
	assert.deepEqual(result, {
		provider: "tencent-tms",
		suggestion: "Pass",
		requestId: "req-123",
		label: "Normal",
		score: 0,
	});
});

for (const suggestion of ["Pass", "Review", "Block"]) {
	test(`TMS recognizes ${suggestion} and omits unspecified BizType`, async () => {
		const result = await moderateTencentText(env, "text", {
			fetchImpl: async (_, init) => {
				assert.equal("BizType" in JSON.parse(init.body), false);
				assert.equal(init.headers["X-TC-Region"], "ap-guangzhou");
				return reply(suggestion);
			},
		});
		assert.equal(result.suggestion, suggestion);
	});
}

for (const [name, fetchImpl, code] of [
	[
		"HTTP failure",
		async () => new Response("sensitive upstream detail", { status: 503 }),
		"http_503",
	],
	[
		"provider error",
		async () =>
			Response.json({
				Response: {
					Error: { Code: "AuthFailure", Message: "sensitive" },
					Suggestion: "Pass",
				},
			}),
		"provider_error",
	],
	["invalid JSON", async () => new Response("not json"), "request_failed"],
	["missing result", async () => Response.json({}), "invalid_response"],
	["unknown suggestion", async () => reply("unknown"), "invalid_response"],
	[
		"network error",
		async () => {
			throw new Error("sensitive");
		},
		"request_failed",
	],
	[
		"timeout",
		async () => {
			throw new DOMException("timed out", "TimeoutError");
		},
		"request_failed",
	],
]) {
	test(`TMS ${name} fails to a safe audit result without leaking upstream data`, async () => {
		assert.deepEqual(await moderateTencentText(env, "text", { fetchImpl }), {
			provider: "tencent-tms",
			suggestion: "Error",
			error: code,
		});
	});
}
