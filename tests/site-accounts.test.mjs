import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createCommentsModule } from "../blog-api/src/comments.js";
import { getAvatarUrl, resolveIdentity } from "../blog-api/src/jwt.js";
import {
	checkAccountSubmission,
	createSiteAccountsModule,
	decorateAccountRows,
	ensureSiteAccounts,
	syncSiteAccount,
} from "../blog-api/src/site-accounts.js";

const secret = "site-accounts-unit-test";
const picture = `https://account.yaoxi.wiki/avatar/${"a".repeat(64)}.webp`;
function token(sub = "reader", role = "member", extra = {}) {
	const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
		"base64url",
	);
	const p = Buffer.from(
		JSON.stringify({
			sub,
			username: sub,
			role,
			exp: Math.floor(Date.now() / 1000) + 300,
			...extra,
		}),
	).toString("base64url");
	return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
}
function db() {
	const sql = new DatabaseSync(":memory:");
	sql.exec(
		fs.readFileSync(
			new URL("../blog-api/migrations/0001_comments.sql", import.meta.url),
			"utf8",
		),
	);
	function prepare(query) {
		return {
			params: [],
			bind(...params) {
				this.params = params;
				return this;
			},
			async first() {
				return sql.prepare(query).get(...this.params) || null;
			},
			async all() {
				return { results: sql.prepare(query).all(...this.params) };
			},
			async run() {
				return {
					meta: {
						changes: Number(sql.prepare(query).run(...this.params).changes),
					},
				};
			},
		};
	}
	return {
		raw: sql,
		prepare,
		async batch(statements) {
			sql.exec("BEGIN");
			try {
				const results = [];
				for (const statement of statements) results.push(await statement.run());
				sql.exec("COMMIT");
				return results;
			} catch (error) {
				sql.exec("ROLLBACK");
				throw error;
			}
		},
	};
}
function setup(t) {
	const DB = db();
	t.after(() => DB.raw.close());
	const env = { DB, JWT_SECRET: secret };
	const module = createSiteAccountsModule({
		json: (data, status = 200, headers = {}) => ({ data, status, headers }),
		requireAdmin: () => false,
	});
	async function call(path, credential, body) {
		const req = new Request(`https://blog-api.yaoxi.cloud${path}`, {
			method: body !== undefined ? "POST" : "GET",
			headers: {
				...(credential ? { Authorization: `Bearer ${credential}` } : {}),
				"Content-Type": "application/json",
			},
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
		return module.handle(req, env, new URL(req.url));
	}
	return { DB, env, call };
}
test("site accounts sync trusts signed identity and the provider avatar, not submitted profile fields", async (t) => {
	const { call, env } = setup(t);
	const r = await call(
		"/api/account/sync",
		token("reader", "member", { picture, name: "读者昵称" }),
		{ verified: true, isAdmin: true, avatarUrl: "https://evil.test/a.png" },
	);
	assert.equal(r.status, 200);
	assert.equal(r.data.profile.verified, false);
	assert.equal(r.data.profile.avatarUrl, picture);
	assert.equal(r.data.profile.displayName, "读者昵称");
	assert.equal(r.data.profile.isAdmin, undefined);
	assert.equal(r.data.profile.note, undefined);
	assert.equal((await call("/api/admin/accounts", token())).status, 401);
	assert.equal((await call("/api/admin/accounts", null)).status, 401);
	assert.equal((await call("/api/account/sync", "invalid", {})).status, 401);
	assert.equal(getAvatarUrl("javascript:alert(1)"), "");
	assert.equal(getAvatarUrl("https://evil.test/avatar/a.webp"), "");
	assert.equal(getAvatarUrl(`${picture}?track=1`), "");
	const identity = await resolveIdentity(
		new Request("https://example.test", {
			headers: {
				Authorization: `Bearer ${token("reader", "member", { picture })}`,
			},
		}),
		env,
	);
	assert.equal(identity.picture, picture);
});
test("admin can set granular policy and audit; login/profile synchronization cannot reset restrictions", async (t) => {
	const { call, env, DB } = setup(t);
	await call("/api/account/sync", token(), {});
	const patch = {
		verified: true,
		verificationLabel: "创作者",
		mutedUntil: -1,
		allowDanmaku: false,
		requireReview: true,
		note: "人工复核",
	};
	const changed = await call(
		"/api/admin/accounts/update",
		token("owner", "admin"),
		{ sub: "reader", version: 0, patch },
	);
	assert.equal(changed.status, 200);
	assert.equal(changed.data.profile.version, 1);
	const again = await call(
		"/api/account/sync",
		token("reader", "member", { picture }),
		{},
	);
	assert.equal(again.data.profile.mutedUntil, -1);
	assert.equal(again.data.profile.verified, true);
	assert.equal(again.data.profile.allowDanmaku, false);
	assert.equal(
		(
			await call("/api/admin/accounts/update", token(), {
				sub: "reader",
				version: 1,
				patch: { mutedUntil: 0 },
			})
		).status,
		401,
	);
	assert.equal(
		(
			await call("/api/admin/accounts/update", token("owner", "admin"), {
				sub: "reader",
				version: 0,
				patch: { mutedUntil: 0 },
			})
		).status,
		409,
	);
	const history = await call(
		"/api/admin/accounts/events?sub=reader",
		token("owner", "admin"),
	);
	assert.equal(history.data.items.length, 1);
	assert.equal(history.data.items[0].actor, "owner");
	assert.equal(history.data.items[0].changes.mutedUntil.to, -1);
	const rows = await decorateAccountRows(env, [
		{ user_sub: "reader", body: "old comment" },
	]);
	assert.equal(rows[0].avatar_url, picture);
	assert.equal(rows[0].site_verified, true);
	assert.equal(rows[0].verification_label, "创作者");
	const search = await call(
		"/api/admin/accounts?q=reader&filter=muted",
		token("owner", "admin"),
	);
	assert.equal(search.data.items.length, 1);
	assert.equal(search.headers["Cache-Control"], "private, no-store");
	assert.equal(
		DB.raw.prepare("SELECT COUNT(*) AS n FROM site_account_events").get().n,
		1,
	);
});
test("backend enforces permanent/timed mute, expiry, permissions and suspended state; guests cannot bypass", async (t) => {
	const { env, DB } = setup(t);
	const identity = { sub: "reader", username: "reader" };
	assert.equal(
		(await checkAccountSubmission(null, env, null, "comment")).status,
		401,
	);
	await syncSiteAccount(env, identity);
	for (const [sql, kind, expected] of [
		["muted_until=-1", "comment", "account_muted"],
		[`muted_until=${Date.now() + 60000}`, "danmaku", "account_muted"],
		["muted_until=1", "comment", undefined],
		["muted_until=0,allow_comment=0", "comment", "permission_denied"],
		["allow_comment=1,allow_danmaku=0", "danmaku", "permission_denied"],
		["allow_danmaku=1,state='suspended'", "comment", "account_suspended"],
		["state='active',require_review=1", "comment", undefined],
	]) {
		DB.raw.exec(`UPDATE site_accounts SET ${sql} WHERE sub='reader'`);
		const result = await checkAccountSubmission(null, env, identity, kind);
		assert.equal(result.error, expected);
		if (!expected) assert.equal(result.allowed, true);
	}
	assert.equal(
		(await checkAccountSubmission(null, env, identity, "comment")).forceReview,
		true,
	);
});
test("account update validates input, protects administrators and imports only existing blog identities", async (t) => {
	const { call, env, DB } = setup(t);
	await syncSiteAccount(env, {
		sub: "owner",
		username: "owner",
		isAdmin: true,
	});
	for (const patch of [
		{ state: "suspended" },
		{ mutedUntil: -1 },
		{ allowComment: false },
	])
		assert.equal(
			(
				await call("/api/admin/accounts/update", token("owner", "admin"), {
					sub: "owner",
					version: 0,
					patch,
				})
			).status,
			403,
		);
	for (const patch of [
		{ role: "admin" },
		{ mutedUntil: "forever" },
		{ verified: "true" },
		{ note: "a".repeat(501) },
	])
		assert.equal(
			(
				await call("/api/admin/accounts/update", token("owner", "admin"), {
					sub: "owner",
					version: 0,
					patch,
				})
			).status,
			400,
		);
	DB.raw
		.prepare(
			"INSERT INTO comments (id,post,body,user_sub,username,author,created_at) VALUES ('abc123','demo','hello','legacy','legacy','旧账号',1)",
		)
		.run();
	const list = await call("/api/admin/accounts", token("owner", "admin"));
	assert.deepEqual(
		list.data.items.map((x) => x.sub),
		["legacy", "owner"],
	);
	assert.equal(
		(
			await call(
				"/api/admin/accounts?filter=no-such-filter",
				token("owner", "admin"),
			)
		).status,
		400,
	);
});
test("forced review wins over Tencent Pass, and backend policy runs before moderation or writes", async (t) => {
	const { env, DB } = setup(t);
	const identity = { sub: "reader", username: "reader" };
	await syncSiteAccount(env, identity);
	DB.raw.exec("UPDATE site_accounts SET require_review=1 WHERE sub='reader'");
	let checks = 0;
	const module = createCommentsModule({
		json: (data, status = 200) => ({ data, status }),
		tooManyRequests: () => ({ status: 429 }),
		getClientIp: () => "127.0.0.1",
		requireAdmin: () => false,
		getStorageKv: () => null,
		checkEndpointRateLimit: async () => true,
		checkRateLimit: async () => ({ allowed: true }),
		htmlEsc: String,
		resolveIdentity: async (request) =>
			request.headers.get("Authorization") ? identity : null,
		moderateText: async () => {
			checks++;
			return { suggestion: "Pass" };
		},
	});
	const request = () =>
		new Request("https://example.test/api/comments/submit", {
			method: "POST",
			headers: {
				Authorization: "Bearer signed-test-identity",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ post: "demo", t: "hello" }),
		});
	let response = await module.handleSubmit(request(), env);
	assert.equal(response.data.mode, "pending");
	assert.equal(checks, 1);
	DB.raw.exec("UPDATE site_accounts SET muted_until=-1 WHERE sub='reader'");
	response = await module.handleSubmit(request(), env);
	assert.equal(response.status, 403);
	assert.equal(checks, 1);
	assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM comments").get().n, 1);
	response = await module.handleLegacySubmit(
		new Request("https://example.test/api/danmaku/submit", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ post: "demo", t: "guest" }),
		}),
		env,
	);
	assert.equal(response.status, 401);
});
test("schema initialization is repeatable and does not overwrite accounts", async (t) => {
	const { env } = setup(t);
	await ensureSiteAccounts(env.DB);
	await ensureSiteAccounts(env.DB);
	await syncSiteAccount(env, { sub: "reader", username: "reader" });
	assert.equal(
		(await syncSiteAccount(env, { sub: "reader", username: "new name" }))
			.username,
		"new name",
	);
});
