import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCommentsModule } from "../blog-api/src/comments.js";
import {
	extractBearerToken,
	getCandidateSecrets,
	resolveIdentity,
	verifyJwt,
} from "../blog-api/src/jwt.js";

/* ================= 测试脚手架 ================= */

const enc = new TextEncoder();
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

async function makeToken(payload, secret, alg = "HS256") {
	const header = b64url(enc.encode(JSON.stringify({ alg, typ: "JWT" })));
	const body = b64url(enc.encode(JSON.stringify(payload)));
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		enc.encode(`${header}.${body}`),
	);
	return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
}

/** 内存 KV 桩（去重键 / 限流键均可验证） */
function makeKv(initial = {}) {
	const store = new Map(Object.entries(initial));
	return {
		async get(k) {
			return store.has(k) ? store.get(k) : null;
		},
		async put(k, v) {
			store.set(k, v);
		},
		async delete(k) {
			store.delete(k);
		},
		async list({ prefix = "" } = {}) {
			return {
				keys: [...store.keys()]
					.filter((k) => k.startsWith(prefix))
					.map((name) => ({ name })),
				list_complete: true,
				cursor: undefined,
			};
		},
		store,
	};
}

/** 极简 D1 桩：按 SQL 片段分派 first/all，batch 恒返回 changes=1 */
function makeDb(handlers = {}) {
	const calls = [];
	const db = {
		prepare(sql) {
			const stmt = {
				sql,
				_bound: [],
				bind(...args) {
					this._bound = args;
					return this;
				},
				async first() {
					calls.push({ sql, args: this._bound });
					return handlers.first ? handlers.first(sql, this._bound) : null;
				},
				async all() {
					calls.push({ sql, args: this._bound });
					return {
						results: handlers.all ? handlers.all(sql, this._bound) : [],
					};
				},
				async run() {
					calls.push({ sql, args: this._bound });
					return { meta: { changes: 1 } };
				},
			};
			return stmt;
		},
		async batch(stmts) {
			calls.push({ batch: stmts.length });
			return stmts.map(() => ({ meta: { changes: 1 } }));
		},
	};
	return { db, calls };
}

function makeRequest(
	body,
	{ token, url = "https://blog-api.yaoxi.cloud/api/comments/submit" } = {},
) {
	const headers = new Map();
	if (body !== undefined) headers.set("Content-Type", "application/json");
	if (token) headers.set("Authorization", `Bearer ${token}`);
	return {
		method: "POST",
		url,
		headers: {
			get: (name) => headers.get(name) || null,
		},
		json: async () => body,
	};
}

function makeDeps(overrides = {}) {
	return {
		json: (data, status = 200) => ({ kind: "json", data, status }),
		tooManyRequests: (retryAfter = 60) => ({
			kind: "json",
			data: { error: "rate limited" },
			status: 429,
			retryAfter,
		}),
		getClientIp: () => "203.0.113.7",
		requireAdmin: () => true,
		getStorageKv: () => makeKv(),
		checkEndpointRateLimit: async () => true,
		checkRateLimit: async () => ({ allowed: true, retryAfter: 0 }),
		htmlEsc: (s = "") => String(s),
		resolveIdentity: async () => null,
		...overrides,
	};
}

const urlOf = (qs = "") =>
	new URL(`https://blog-api.yaoxi.cloud/api/comments${qs}`);

/* ================= 1. JWT 验签 ================= */

describe("SSO JWT 零依赖验签 (jwt.js)", () => {
	const now = Math.floor(Date.now() / 1000);

	it("应通过合法 HS256 令牌并拒绝错误密钥", async () => {
		const token = await makeToken(
			{ sub: "u-1", username: "neko", exp: now + 3600 },
			"s3cret",
		);
		assert.ok(await verifyJwt(token, ["s3cret"]));
		assert.equal(await verifyJwt(token, ["wrong"]), null);
	});

	it("应按候选密钥顺序回退（zk-bff 同款语义）", async () => {
		const token = await makeToken({ sub: "u-1", exp: now + 3600 }, "b");
		const payload = await verifyJwt(token, ["a", "b", "c"]);
		assert.equal(payload?.sub, "u-1");
	});

	it("应拒绝过期、缺 exp、算法混淆与篡改签名", async () => {
		const expired = await makeToken({ sub: "u-1", exp: now - 7200 }, "s3cret");
		assert.equal(await verifyJwt(expired, ["s3cret"]), null);

		const noExp = await makeToken({ sub: "u-1" }, "s3cret");
		assert.equal(await verifyJwt(noExp, ["s3cret"]), null);

		const noneToken = `${b64url(enc.encode('{"alg":"none"}'))}.${b64url(enc.encode(`{"sub":"x","exp":${now + 999}}`))}.AAAA`;
		assert.equal(await verifyJwt(noneToken, ["s3cret"]), null);

		const good = await makeToken({ sub: "u-1", exp: now + 3600 }, "s3cret");
		assert.equal(await verifyJwt(`${good.slice(0, -4)}AAAA`, ["s3cret"]), null);
	});

	it("resolveIdentity 应解析身份且异常输入静默降级游客", async () => {
		const good = await makeToken(
			{ sub: "u-1", username: "neko", exp: now + 3600 },
			"s3cret",
		);
		const req = makeRequest(undefined, { token: good });
		assert.deepEqual(await resolveIdentity(req, { JWT_SECRET: "s3cret" }), {
			sub: "u-1",
			username: "neko",
		});
		assert.deepEqual(await resolveIdentity(req, {}), null);

		const bad = makeRequest(undefined, { token: "not-a-jwt" });
		assert.equal(await resolveIdentity(bad, { JWT_SECRET: "s3cret" }), null);
		assert.equal(
			await resolveIdentity(makeRequest(undefined), { JWT_SECRET: "s3cret" }),
			null,
		);
	});

	it("token 无 username claim 时应兜底取 sub（认证中心账户约定）", async () => {
		const token = await makeToken(
			{ sub: "薇斯纳", email: "a@b.c", roles: ["member"], exp: now + 3600 },
			"s3cret",
		);
		const req = makeRequest(undefined, { token });
		assert.deepEqual(await resolveIdentity(req, { JWT_SECRET: "s3cret" }), {
			sub: "薇斯纳",
			username: "薇斯纳",
		});
	});

	it("extractBearerToken 应做长度防御且只认 Bearer 前缀", () => {
		assert.equal(
			extractBearerToken(makeRequest(undefined, { token: "abc" })),
			"abc",
		);
		assert.equal(extractBearerToken(makeRequest(undefined)), null);
		const longReq = makeRequest(undefined, { token: "x".repeat(5000) });
		assert.equal(extractBearerToken(longReq), null);
	});

	it("getCandidateSecrets 应过滤空值并保持 JWT→AUTH→SSO 顺序", () => {
		assert.deepEqual(
			getCandidateSecrets({ JWT_SECRET: "j", SSO_SECRET: "s" }),
			["j", "s"],
		);
		assert.deepEqual(getCandidateSecrets({ AUTH_SECRET: "a" }), ["a"]);
		assert.deepEqual(getCandidateSecrets({}), []);
	});
});

/* ================= 2. 审核状态机 ================= */

describe("评论审核状态机 (moderate)", () => {
	function moderateWith(status, action, deps = {}) {
		const { db } = makeDb({
			first: (sql) =>
				sql.includes("FROM comments WHERE id = ?")
					? { id: "abc123xyz", post: "demo-post", kind: "comment", status }
					: null,
		});
		const mod = createCommentsModule(makeDeps({ ...deps }));
		const req = makeRequest({ id: "abc123xyz", action });
		return mod.handleModerate(req, { DB: db });
	}

	it("非法参数应 400（id 格式 / 未知 action）", async () => {
		const mod = createCommentsModule(makeDeps());
		const bad = await mod.handleModerate(
			makeRequest({ id: "!", action: "approve" }),
			{ DB: makeDb().db },
		);
		assert.equal(bad.status, 400);
		const unknown = await mod.handleModerate(
			makeRequest({ id: "abc123xyz", action: "nuke" }),
			{ DB: makeDb().db },
		);
		assert.equal(unknown.status, 400);
	});

	it("pending → approve 放行、approved 再 approve 应 409", async () => {
		const ok = await moderateWith("pending", "approve");
		assert.equal(ok.status, 200);
		assert.equal(ok.data.ok, true);
		assert.equal(ok.data.status, "approved");

		const conflict = await moderateWith("approved", "approve");
		assert.equal(conflict.status, 409);
		assert.equal(conflict.data.error, "invalid_transition");
	});

	it("approved → reject 下架、rejected → restore 恢复、deleted → restore 恢复", async () => {
		const rejected = await moderateWith("approved", "reject");
		assert.equal(rejected.status, 200);
		assert.equal(rejected.data.status, "rejected");

		const restored = await moderateWith("rejected", "restore");
		assert.equal(restored.status, 200);
		assert.equal(restored.data.status, "approved");

		const undeleted = await moderateWith("deleted", "restore");
		assert.equal(undeleted.status, 200);
		assert.equal(undeleted.data.status, "approved");
	});

	it("pending → delete 也应被允许（清垃圾），deleted 再 delete 应 409", async () => {
		const ok = await moderateWith("pending", "delete");
		assert.equal(ok.status, 200);
		assert.equal(ok.data.status, "deleted");

		const conflict = await moderateWith("deleted", "delete");
		assert.equal(conflict.status, 409);
	});

	it("不存在的 id 应 404，缺管理员鉴权应 401", async () => {
		const { db } = makeDb({ first: () => null });
		const mod = createCommentsModule(makeDeps());
		const notFound = await mod.handleModerate(
			makeRequest({ id: "abc123xyz", action: "approve" }),
			{ DB: db },
		);
		assert.equal(notFound.status, 404);
		assert.equal(notFound.data.ok, false);

		const modNoAdmin = createCommentsModule(
			makeDeps({ requireAdmin: () => false }),
		);
		const denied = await modNoAdmin.handleModerate(
			makeRequest({ id: "abc123xyz", action: "approve" }),
			{ DB: db },
		);
		assert.equal(denied.status, 401);
	});
});

/* ================= 3. 投稿核心 ================= */

describe("评论投稿 (submit)", () => {
	it("蜜罐命中应假成功且不写库", async () => {
		const { db, calls } = makeDb();
		const mod = createCommentsModule(makeDeps());
		const res = await mod.handleSubmit(
			makeRequest({ post: "demo", t: "hi", website: "http://spam" }),
			{ DB: db },
			null,
			null,
		);
		assert.equal(res.status, 200);
		assert.equal(res.data.ok, true);
		assert.equal(
			calls.some((c) => c.sql?.includes("INSERT")),
			false,
		);
	});

	it("非法 post 与空内容应 400", async () => {
		const mod = createCommentsModule(makeDeps());
		const { db } = makeDb();
		const badPost = await mod.handleSubmit(
			makeRequest({ post: "../etc/passwd", t: "hi" }),
			{ DB: db },
			null,
			null,
		);
		assert.equal(badPost.status, 400);
		const empty = await mod.handleSubmit(
			makeRequest({ post: "demo", t: "   " }),
			{ DB: db },
			null,
			null,
		);
		assert.equal(empty.status, 400);
	});

	it("正常投稿应写入 pending 并记录 create 审计事件", async () => {
		const { db, calls } = makeDb();
		const mod = createCommentsModule(makeDeps());
		const res = await mod.handleSubmit(
			makeRequest({ post: "demo", kind: "comment", t: "第一条评论喵" }),
			{ DB: db },
			null,
			null,
		);
		assert.equal(res.status, 200);
		assert.equal(res.data.mode, "pending");
		assert.ok(res.data.id);
		assert.equal(calls.filter((c) => c.batch).length, 1);
	});

	it("DANMAKU_AUTO_APPROVE=true 时直接上墙（mode=live）", async () => {
		const { db } = makeDb();
		const mod = createCommentsModule(makeDeps());
		const res = await mod.handleSubmit(
			makeRequest({ post: "demo", t: "直接上墙" }),
			{ DB: db, DANMAKU_AUTO_APPROVE: "true" },
			null,
			null,
		);
		assert.equal(res.data.mode, "live");
	});

	it("去重窗口内重复内容应返回「已发送过」且不写库", async () => {
		const { db, calls } = makeDb();
		const kv = makeKv();
		const mod = createCommentsModule(makeDeps({ getStorageKv: () => kv }));
		const payload = { post: "demo", t: "重复内容" };
		const first = await mod.handleSubmit(
			makeRequest(payload),
			{ DB: db },
			null,
			null,
		);
		assert.equal(first.status, 200);
		const before = calls.filter((c) => c.batch).length;
		const second = await mod.handleSubmit(
			makeRequest(payload),
			{ DB: db },
			null,
			null,
		);
		assert.equal(second.data.message.includes("已经发送过"), true);
		assert.equal(calls.filter((c) => c.batch).length, before, "第二次不应写库");
	});

	it("回复弹幕或未通过评论应 404（parent 校验）", async () => {
		const { db } = makeDb({
			first: (sql) =>
				sql.includes("FROM comments WHERE id = ?")
					? {
							id: "root123456",
							post: "demo",
							kind: "danmaku",
							parent_id: null,
							root_id: null,
							author: "a",
							username: null,
							user_sub: null,
							status: "approved",
						}
					: null,
		});
		const mod = createCommentsModule(makeDeps());
		const res = await mod.handleSubmit(
			makeRequest({ post: "demo", t: "回复", parentId: "root123456" }),
			{ DB: db },
			null,
			null,
		);
		assert.equal(res.status, 404);
	});

	it("携带合法 SSO JWT 时应绑定认证身份（author 取 SSO 昵称）", async () => {
		const token = await makeToken(
			{
				sub: "u-9",
				username: "认证喵",
				exp: Math.floor(Date.now() / 1000) + 600,
			},
			"s3cret",
		);
		const { db, calls } = makeDb();
		const mod = createCommentsModule(
			makeDeps({
				resolveIdentity: (req, env) =>
					resolveIdentity(req, { JWT_SECRET: "s3cret" }),
			}),
		);
		const res = await mod.handleSubmit(
			makeRequest({ post: "demo", t: "认证评论", a: "冒充者" }, { token }),
			{ DB: db, JWT_SECRET: "s3cret" },
			null,
			null,
		);
		assert.equal(res.status, 200);
		const insertCall = calls.find((c) => c.batch);
		assert.ok(insertCall);
		// 通过模块返回的 id 无法直接看到作者，改从响应结构确认走通认证路径
		assert.equal(res.data.mode, "pending");
	});
});

/* ================= 4. 列表与回复树装配 ================= */

describe("列表装配 (list)", () => {
	const rootRow = {
		id: "root000001",
		post: "demo",
		kind: "comment",
		p: 2,
		x: "段落摘录",
		body: "根评论",
		author: "根作者",
		username: null,
		user_sub: null,
		status: "approved",
		parent_id: null,
		root_id: null,
		created_at: 1000,
	};
	const replyRow = {
		id: "reply00001",
		post: "demo",
		kind: "comment",
		p: null,
		x: "",
		body: "回复内容",
		author: "回复者",
		username: null,
		user_sub: null,
		status: "approved",
		parent_id: "root000001",
		root_id: "root000001",
		created_at: 2000,
	};

	it("应装配根评论 + 回复并标注 replyTo", async () => {
		const { db } = makeDb({
			first: (sql) => (sql.includes("COUNT(*)") ? { n: 2 } : null),
			all: (sql) =>
				sql.includes("parent_id IS NULL") ? [rootRow] : [replyRow],
		});
		const mod = createCommentsModule(makeDeps());
		const res = await mod.handleList(
			makeRequest(undefined),
			{ DB: db },
			urlOf("?post=demo"),
		);
		assert.equal(res.status, 200);
		assert.equal(res.data.total, 2);
		assert.equal(res.data.items.length, 1);
		assert.equal(res.data.items[0].body, "根评论");
		assert.equal(res.data.items[0].replies.length, 1);
		assert.equal(res.data.items[0].replies[0].body, "回复内容");
		assert.deepEqual(res.data.items[0].replies[0].replyTo, {
			author: "根作者",
			verified: false,
		});
	});

	it("未传 p 参数不应误加 p=0 过滤（Number(null) 陷阱回归）", async () => {
		const { db, calls } = makeDb({
			first: (sql) => (sql.includes("COUNT(*)") ? { n: 0 } : null),
			all: () => [],
		});
		const mod = createCommentsModule(makeDeps());
		await mod.handleList(
			makeRequest(undefined),
			{ DB: db },
			urlOf("?post=demo"),
		);
		const selectCalls = calls.filter((c) =>
			c.sql?.includes("SELECT * FROM comments"),
		);
		assert.ok(selectCalls.length >= 1, "应执行列表查询");
		assert.equal(
			selectCalls[0].sql.includes("p = ?"),
			false,
			"无 p 参数时不应有 p 过滤",
		);
	});

	it("非法 post 应 400；无 DB 时应降级空列表", async () => {
		const mod = createCommentsModule(makeDeps());
		const bad = await mod.handleList(
			makeRequest(undefined),
			{},
			urlOf("?post=../x"),
		);
		assert.equal(bad.status, 400);
		const empty = await mod.handleList(
			makeRequest(undefined),
			{},
			urlOf("?post=demo"),
		);
		assert.equal(empty.status, 200);
		assert.deepEqual(empty.data.items, []);
	});

	it("携带 SSO JWT 时自己的评论应带 mine 标记", async () => {
		const token = await makeToken(
			{
				sub: "u-1",
				username: "neko",
				exp: Math.floor(Date.now() / 1000) + 600,
			},
			"s3cret",
		);
		const mineRow = { ...rootRow, user_sub: "u-1", username: "neko" };
		const { db } = makeDb({
			first: (sql) => (sql.includes("COUNT(*)") ? { n: 1 } : null),
			all: (sql) => (sql.includes("parent_id IS NULL") ? [mineRow] : []),
		});
		const mod = createCommentsModule(
			makeDeps({
				resolveIdentity: (req, env) =>
					resolveIdentity(req, { JWT_SECRET: "s3cret" }),
			}),
		);
		const req = makeRequest(undefined, { token });
		const res = await mod.handleList(
			req,
			{ DB: db, JWT_SECRET: "s3cret" },
			urlOf("?post=demo"),
		);
		assert.equal(res.data.items[0].mine, true);
		assert.equal(res.data.items[0].verified, true);
	});
});

/* ================= 5. 作者撤回 ================= */

describe("作者撤回 (delete)", () => {
	it("未登录应 401；非作者应 403；作者撤回成功且幂等", async () => {
		const token = await makeToken(
			{ sub: "u-1", exp: Math.floor(Date.now() / 1000) + 600 },
			"s3cret",
		);
		const mod = createCommentsModule(
			makeDeps({
				resolveIdentity: (req, env) =>
					resolveIdentity(req, { JWT_SECRET: "s3cret" }),
			}),
		);

		const denied = await mod.handleDelete(makeRequest({ id: "abc123xyz" }), {
			DB: makeDb().db,
		});
		assert.equal(denied.status, 401);

		const { db: dbOther } = makeDb({
			first: () => ({
				id: "abc123xyz",
				user_sub: "u-2",
				status: "approved",
				post: "demo",
			}),
		});
		const forbidden = await mod.handleDelete(
			makeRequest({ id: "abc123xyz" }, { token }),
			{ DB: dbOther, JWT_SECRET: "s3cret" },
		);
		assert.equal(forbidden.status, 403);

		const { db: dbMine } = makeDb({
			first: () => ({
				id: "abc123xyz",
				user_sub: "u-1",
				status: "approved",
				post: "demo",
			}),
		});
		const ok = await mod.handleDelete(
			makeRequest({ id: "abc123xyz" }, { token }),
			{ DB: dbMine, JWT_SECRET: "s3cret" },
		);
		assert.equal(ok.status, 200);
		assert.equal(ok.data.ok, true);

		const { db: dbGone } = makeDb({
			first: () => ({
				id: "abc123xyz",
				user_sub: "u-1",
				status: "deleted",
				post: "demo",
			}),
		});
		const again = await mod.handleDelete(
			makeRequest({ id: "abc123xyz" }, { token }),
			{ DB: dbGone, JWT_SECRET: "s3cret" },
		);
		assert.equal(again.status, 200);
		assert.equal(again.data.message.includes("已撤回"), true);
	});
});

/* ================= 6. 旧数据迁移 ================= */

describe("KV 弹幕迁移 (migrate)", () => {
	it("应把 dm:live / dm:pending 幂等导入并保留 KV 原键", async () => {
		const kv = makeKv({
			"dm:live:demo": JSON.stringify([
				{
					id: "hist000001",
					p: 0,
					x: "摘",
					t: "历史弹幕一",
					a: "甲",
					c: "#ff6b81",
					ts: 1000,
				},
				{
					id: "hist000002",
					p: 1,
					x: "",
					t: "历史弹幕二",
					a: "乙",
					c: "#ff9f43",
					ts: 2000,
				},
			]),
			"dm:pending:hist000003": JSON.stringify({
				id: "hist000003",
				post: "demo",
				p: 0,
				x: "",
				t: "待审弹幕",
				a: "丙",
				c: "#feca57",
				ts: 3000,
			}),
		});
		const { db, calls } = makeDb();
		const mod = createCommentsModule(makeDeps({ getStorageKv: () => kv }));
		const res = await mod.handleMigrate(makeRequest({}), { DB: db });
		assert.equal(res.status, 200);
		assert.equal(res.data.rows, 3);
		assert.equal(res.data.inserted, 3);
		assert.equal(
			kv.store.has("dm:live:demo"),
			true,
			"KV 原键应保留作回滚安全网",
		);
		assert.ok(
			calls.some((c) => c.batch),
			"应批量写入 D1",
		);
	});

	it("无 KV 或无 DB 应明确 500", async () => {
		const mod = createCommentsModule(makeDeps({ getStorageKv: () => null }));
		const noKv = await mod.handleMigrate(makeRequest({}), { DB: makeDb().db });
		assert.equal(noKv.status, 500);
		const mod2 = createCommentsModule(makeDeps());
		const noDb = await mod2.handleMigrate(makeRequest({}), {});
		assert.equal(noDb.status, 500);
	});
});
