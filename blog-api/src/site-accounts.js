import { getAvatarUrl, isCommentAdmin, resolveIdentity } from "./jwt.js";

// Additive and idempotent: initialize on the same D1/SQLite database as comments.
const schemas = new WeakMap();
const DDL = [
	`CREATE TABLE IF NOT EXISTS site_accounts (
 sub TEXT PRIMARY KEY, username TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', avatar_url TEXT NOT NULL DEFAULT '',
 is_admin INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0, verification_label TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','suspended')),
 muted_until INTEGER NOT NULL DEFAULT 0, allow_comment INTEGER NOT NULL DEFAULT 1, allow_danmaku INTEGER NOT NULL DEFAULT 1,
 require_review INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0)`,
	`CREATE TABLE IF NOT EXISTS site_account_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, sub TEXT NOT NULL, actor TEXT NOT NULL, changes TEXT NOT NULL, created_at INTEGER NOT NULL)`,
	"CREATE INDEX IF NOT EXISTS idx_site_account_events_sub ON site_account_events(sub, id DESC)",
];
export async function ensureSiteAccounts(db) {
	if (!db) throw new Error("Account database unavailable");
	if (!schemas.has(db)) {
		const ready = (async () => {
			for (const sql of DDL) await db.prepare(sql).run();
		})();
		schemas.set(db, ready);
		ready.catch(() => schemas.delete(db));
	}
	await schemas.get(db);
}
function privateAccount(row) {
	return {
		sub: row.sub,
		username: row.username,
		displayName: row.display_name,
		avatarUrl: getAvatarUrl(row.avatar_url),
		isAdmin: !!row.is_admin,
		verified: !!row.verified,
		verificationLabel: row.verification_label,
		state: row.state,
		mutedUntil: row.muted_until,
		allowComment: !!row.allow_comment,
		allowDanmaku: !!row.allow_danmaku,
		requireReview: !!row.require_review,
		note: row.note,
		version: row.version,
		createdAt: row.created_at,
		lastSeen: row.last_seen,
	};
}
export async function syncSiteAccount(env, identity) {
	await ensureSiteAccounts(env.DB);
	const now = Date.now();
	await env.DB.prepare(`INSERT INTO site_accounts (sub,username,display_name,avatar_url,is_admin,created_at,last_seen)
 VALUES (?,?,?,?,?,?,?) ON CONFLICT(sub) DO UPDATE SET username=excluded.username, display_name=excluded.display_name,
 avatar_url=excluded.avatar_url, is_admin=MAX(site_accounts.is_admin,excluded.is_admin), last_seen=excluded.last_seen`)
		.bind(
			identity.sub,
			identity.username,
			identity.displayName || identity.username,
			getAvatarUrl(identity.picture),
			identity.isAdmin ? 1 : 0,
			now,
			now,
		)
		.run();
	return env.DB.prepare("SELECT * FROM site_accounts WHERE sub = ?")
		.bind(identity.sub)
		.first();
}
export async function checkAccountSubmission(request, env, identity, kind) {
	if (!identity)
		return {
			allowed: false,
			status: 401,
			error: "login_required",
			message: "请先登录账号后再发表内容",
		};
	const row = await syncSiteAccount(env, identity);
	if (!row) throw new Error("Account profile unavailable");
	if (row.state !== "active")
		return {
			allowed: false,
			status: 403,
			error: "account_suspended",
			message: "当前账号的本站互动权限已停用",
		};
	if (row.muted_until === -1 || row.muted_until > Date.now())
		return {
			allowed: false,
			status: 403,
			error: "account_muted",
			message:
				row.muted_until === -1
					? "当前账号已被永久禁言"
					: `当前账号禁言至 ${new Date(row.muted_until).toISOString()}`,
		};
	if (!(kind === "danmaku" ? row.allow_danmaku : row.allow_comment))
		return {
			allowed: false,
			status: 403,
			error: "permission_denied",
			message: `当前账号没有发表${kind === "danmaku" ? "弹幕" : "评论"}的权限`,
		};
	return { allowed: true, forceReview: !!row.require_review };
}
export async function decorateAccountRows(env, rows) {
	const subs = [...new Set(rows.map((row) => row.user_sub).filter(Boolean))];
	if (!subs.length) return rows;
	await ensureSiteAccounts(env.DB);
	const found = await env.DB.prepare(
		`SELECT sub, avatar_url, verified, verification_label FROM site_accounts WHERE sub IN (${subs.map(() => "?").join(",")})`,
	)
		.bind(...subs)
		.all();
	const profiles = new Map((found.results || []).map((row) => [row.sub, row]));
	return rows.map((row) => {
		const p = profiles.get(row.user_sub);
		return {
			...row,
			avatar_url: getAvatarUrl(p?.avatar_url),
			site_verified: !!p?.verified,
			verification_label: p?.verification_label || "",
		};
	});
}

export function createSiteAccountsModule({ json, requireAdmin }) {
	const response = (data, status = 200) =>
		json(data, status, { "Cache-Control": "private, no-store" });
	async function admin(request, env) {
		return (
			(await requireAdmin(request, env)) || (await isCommentAdmin(request, env))
		);
	}
	async function handle(request, env, url) {
		if (!env?.DB)
			return response(
				{ error: "storage_unavailable", message: "账号存储暂不可用" },
				503,
			);
		if (url.pathname === "/api/account/sync" && request.method === "POST") {
			const identity = await resolveIdentity(request, env);
			if (!identity)
				return response(
					{ error: "unauthorized", message: "请先登录账号" },
					401,
				);
			const row = await syncSiteAccount(env, identity);
			const {
				note: _note,
				isAdmin: _isAdmin,
				version: _version,
				...profile
			} = privateAccount(row);
			return response({ ok: true, profile });
		}
		if (!(await admin(request, env)))
			return response(
				{ error: "unauthorized", message: "仅管理员可以管理本站账号" },
				401,
			);
		await ensureSiteAccounts(env.DB);
		if (url.pathname === "/api/admin/accounts" && request.method === "GET") {
			// Import only identities that have already used this blog, never the global account directory.
			await env.DB.prepare(`INSERT OR IGNORE INTO site_accounts (sub, username, display_name, created_at, last_seen)
    SELECT user_sub, COALESCE(MAX(username),user_sub), COALESCE(MAX(author),user_sub), MIN(created_at), MAX(created_at)
    FROM comments WHERE user_sub IS NOT NULL AND user_sub != '' GROUP BY user_sub`).run();
			const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
			const cursor = url.searchParams.get("after") || "";
			const filter = url.searchParams.get("filter") || "all";
			const filters = {
				all: "1=1",
				verified: "verified=1",
				muted: "(muted_until=-1 OR muted_until>?)",
				suspended: "state='suspended'",
				review: "require_review=1",
			};
			if (!Object.hasOwn(filters, filter))
				return response(
					{ error: "invalid_filter", message: "筛选条件无效" },
					400,
				);
			const args = [cursor, q.toLowerCase(), q.toLowerCase()];
			if (filter === "muted") args.push(Date.now());
			const result = await env.DB.prepare(
				`SELECT * FROM site_accounts WHERE sub > ? AND (? = '' OR instr(lower(sub || ' ' || username || ' ' || display_name), ?) > 0) AND ${filters[filter]} ORDER BY sub LIMIT 51`,
			)
				.bind(...args)
				.all();
			return response({
				items: (result.results || []).slice(0, 50).map(privateAccount),
				hasMore: (result.results || []).length > 50,
			});
		}
		if (
			url.pathname === "/api/admin/accounts/events" &&
			request.method === "GET"
		) {
			const sub = url.searchParams.get("sub");
			if (!sub || sub.length > 64)
				return response(
					{ error: "invalid_subject", message: "请选择账号" },
					400,
				);
			const result = await env.DB.prepare(
				"SELECT id, actor, changes, created_at FROM site_account_events WHERE sub = ? ORDER BY id DESC LIMIT 100",
			)
				.bind(sub)
				.all();
			return response({
				items: (result.results || []).map((row) => ({
					id: row.id,
					actor: row.actor,
					changes: JSON.parse(row.changes),
					createdAt: row.created_at,
				})),
			});
		}
		if (
			url.pathname === "/api/admin/accounts/update" &&
			request.method === "POST"
		) {
			const body = await request.json().catch(() => null);
			if (
				!body ||
				typeof body.sub !== "string" ||
				!body.sub ||
				body.sub.length > 64 ||
				!Number.isSafeInteger(body.version)
			)
				return response(
					{ error: "invalid_body", message: "账号或版本参数无效" },
					400,
				);
			const fields = {
				verified: "verified",
				verificationLabel: "verification_label",
				state: "state",
				mutedUntil: "muted_until",
				allowComment: "allow_comment",
				allowDanmaku: "allow_danmaku",
				requireReview: "require_review",
				note: "note",
			};
			const patch = body.patch;
			if (
				!patch ||
				typeof patch !== "object" ||
				Array.isArray(patch) ||
				!Object.keys(patch).length ||
				Object.keys(patch).some((key) => !Object.hasOwn(fields, key))
			)
				return response(
					{ error: "invalid_patch", message: "不支持的账号设置" },
					400,
				);
			for (const [key, value] of Object.entries(patch)) {
				if (
					[
						"verified",
						"allowComment",
						"allowDanmaku",
						"requireReview",
					].includes(key) &&
					typeof value !== "boolean"
				)
					return response(
						{ error: "invalid_value", message: "权限值必须为布尔值" },
						400,
					);
				if (key === "state" && !["active", "suspended"].includes(value))
					return response(
						{ error: "invalid_value", message: "账号状态无效" },
						400,
					);
				if (
					key === "mutedUntil" &&
					(!Number.isSafeInteger(value) ||
						value < -1 ||
						value > 8640000000000000)
				)
					return response(
						{ error: "invalid_value", message: "禁言期限无效" },
						400,
					);
				if (
					["verificationLabel", "note"].includes(key) &&
					(typeof value !== "string" ||
						value.length > (key === "note" ? 500 : 40) ||
						[...value].some(
							(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
						))
				)
					return response(
						{ error: "invalid_value", message: "认证说明或备注格式无效" },
						400,
					);
			}
			const row = await env.DB.prepare(
				"SELECT * FROM site_accounts WHERE sub = ?",
			)
				.bind(body.sub)
				.first();
			if (!row)
				return response({ error: "not_found", message: "本站账号不存在" }, 404);
			if (
				row.is_admin &&
				(patch.state === "suspended" ||
					(patch.mutedUntil !== undefined && patch.mutedUntil !== 0) ||
					patch.allowComment === false ||
					patch.allowDanmaku === false)
			)
				return response(
					{ error: "protected_admin", message: "不能禁言或停用认证中心管理员" },
					403,
				);
			const actor =
				(await resolveIdentity(request, env))?.sub || "service-admin";
			const now = Date.now();
			const changes = {};
			const values = Object.entries(patch).map(([key, value]) => {
				changes[key] = { from: row[fields[key]], to: value };
				return typeof value === "boolean" ? Number(value) : value;
			});
			const result = await env.DB.batch([
				env.DB.prepare(
					`UPDATE site_accounts SET ${Object.keys(patch)
						.map((key) => `${fields[key]} = ?`)
						.join(
							",",
						)}, version=version+1, updated_at=? WHERE sub=? AND version=?`,
				).bind(...values, now, body.sub, body.version),
				env.DB.prepare(
					"INSERT INTO site_account_events (sub,actor,changes,created_at) SELECT ?,?,?,? WHERE changes() = 1",
				).bind(body.sub, actor, JSON.stringify(changes), now),
			]);
			if (result[0]?.meta?.changes !== 1)
				return response(
					{
						error: "version_conflict",
						message: "账号设置已更新，请刷新后重试",
					},
					409,
				);
			return response({
				ok: true,
				profile: privateAccount(
					await env.DB.prepare("SELECT * FROM site_accounts WHERE sub = ?")
						.bind(body.sub)
						.first(),
				),
			});
		}
		return response({ error: "not_found", message: "接口不存在" }, 404);
	}
	return { handle };
}
