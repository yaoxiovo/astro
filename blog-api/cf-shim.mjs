import { DatabaseSync } from "node:sqlite";

/**
 * Cloudflare D1 本地 SQLite 适配器
 */
export function createD1Adapter(dbPath) {
	const db = new DatabaseSync(dbPath);
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA synchronous = NORMAL;");
	db.exec("PRAGMA foreign_keys = ON;");

	return {
		_raw: db,
		prepare(sql) {
			return {
				_sql: sql,
				_params: [],
				bind(...params) {
					this._params = params;
					return this;
				},
				async first(column) {
					const stmt = db.prepare(sql);
					const row = stmt.get(...this._params);
					if (!row) return null;
					return column ? row[column] : row;
				},
				async all() {
					const stmt = db.prepare(sql);
					const results = stmt.all(...this._params);
					return { results, success: true };
				},
				async run() {
					const stmt = db.prepare(sql);
					const info = stmt.run(...this._params);
					return {
						success: true,
						meta: {
							changes: info.changes,
							last_row_id: Number(info.lastInsertRowid),
						},
					};
				},
			};
		},
		async batch(statements) {
			const results = [];
			// Node.js SQLite 同步执行事务
			db.exec("BEGIN TRANSACTION;");
			try {
				for (const s of statements) {
					const sql = s._sql || s.sql;
					const params = s._params || s.params || [];
					const stmt = db.prepare(sql);
					const info = stmt.run(...params);
					results.push({
						success: true,
						meta: {
							changes: info.changes,
							last_row_id: Number(info.lastInsertRowid),
						},
					});
				}
				db.exec("COMMIT;");
				return results;
			} catch (err) {
				db.exec("ROLLBACK;");
				throw err;
			}
		},
		async exec(sql) {
			return db.exec(sql);
		},
	};
}

/**
 * Cloudflare KV 键值存储本地 SQLite 适配器
 */
export function createKVAdapter(rawDb, namespace = "default") {
	rawDb.exec(`
		CREATE TABLE IF NOT EXISTS _cf_kv_store (
			namespace TEXT NOT NULL,
			key       TEXT NOT NULL,
			value     TEXT NOT NULL,
			metadata  TEXT,
			expires_at INTEGER,
			PRIMARY KEY (namespace, key)
		);
		CREATE INDEX IF NOT EXISTS idx_cf_kv_expire ON _cf_kv_store (expires_at);
	`);

	const cleanup = () => {
		try {
			const now = Math.floor(Date.now() / 1000);
			rawDb.prepare("DELETE FROM _cf_kv_store WHERE expires_at IS NOT NULL AND expires_at < ?").run(now);
		} catch {}
	};

	return {
		async get(key, type = "text") {
			cleanup();
			const now = Math.floor(Date.now() / 1000);
			const row = rawDb
				.prepare("SELECT value FROM _cf_kv_store WHERE namespace = ? AND key = ? AND (expires_at IS NULL OR expires_at >= ?)")
				.get(namespace, key, now);
			if (!row) return null;
			if (type === "json") {
				try {
					return JSON.parse(row.value);
				} catch {
					return null;
				}
			}
			return row.value;
		},
		async put(key, value, options = {}) {
			const valStr = typeof value === "string" ? value : JSON.stringify(value);
			const metaStr = options.metadata ? JSON.stringify(options.metadata) : null;
			let expiresAt = null;
			if (options.expirationTtl) {
				expiresAt = Math.floor(Date.now() / 1000) + Number(options.expirationTtl);
			} else if (options.expiration) {
				expiresAt = Number(options.expiration);
			}
			rawDb
				.prepare(
					`INSERT INTO _cf_kv_store (namespace, key, value, metadata, expires_at)
					 VALUES (?, ?, ?, ?, ?)
					 ON CONFLICT(namespace, key) DO UPDATE SET
						value = excluded.value,
						metadata = excluded.metadata,
						expires_at = excluded.expires_at`,
				)
				.run(namespace, key, valStr, metaStr, expiresAt);
		},
		async delete(key) {
			rawDb.prepare("DELETE FROM _cf_kv_store WHERE namespace = ? AND key = ?").run(namespace, key);
		},
		async list(options = {}) {
			cleanup();
			const prefix = options.prefix || "";
			const limit = options.limit || 1000;
			const now = Math.floor(Date.now() / 1000);
			const rows = rawDb
				.prepare(
					"SELECT key, metadata FROM _cf_kv_store WHERE namespace = ? AND key LIKE ? AND (expires_at IS NULL OR expires_at >= ?) LIMIT ?",
				)
				.all(namespace, `${prefix}%`, now, limit);
			return {
				keys: rows.map((r) => {
					let metadata;
					if (r.metadata) {
						try {
							metadata = JSON.parse(r.metadata);
						} catch {}
					}
					return { name: r.key, metadata };
				}),
				list_complete: true,
			};
		},
	};
}

/**
 * 实时共读单房间管理器 (Local Presence Room)
 */
class LocalPresenceRoom {
	constructor(slug) {
		this.slug = slug;
		this.clients = new Set();
		this._broadcastTimer = null;
		this._lastBroadcast = 0;
	}

	addClient(ws, initP = -1) {
		if (this.clients.size >= 120) {
			try {
				ws.close(1013, "Room full");
			} catch {}
			return;
		}
		const meta = { ws, p: initP, lastSeen: Date.now() };
		this.clients.add(meta);

		ws.on("message", (data) => {
			try {
				const msg = JSON.parse(data.toString());
				if (msg.t === "pos" && typeof msg.p === "number") {
					meta.p = Math.min(Math.max(msg.p, -1), 2000);
					meta.lastSeen = Date.now();
					this.scheduleBroadcast();
				}
			} catch {}
		});

		ws.on("close", () => {
			this.clients.delete(meta);
			this.scheduleBroadcast();
		});

		ws.on("error", () => {
			this.clients.delete(meta);
			this.scheduleBroadcast();
		});

		this.scheduleBroadcast(true);
	}

	getSnapshot() {
		this.cleanupStale();
		return {
			ok: true,
			n: this.clients.size,
			h: this.calcHeatmap(),
		};
	}

	calcHeatmap() {
		const heat = {};
		for (const c of this.clients) {
			if (c.p >= 0) {
				heat[c.p] = (heat[c.p] || 0) + 1;
			}
		}
		return heat;
	}

	cleanupStale() {
		const now = Date.now();
		for (const c of this.clients) {
			if (now - c.lastSeen > 240_000) {
				try {
					c.ws.close(1000, "Inactive timeout");
				} catch {}
				this.clients.delete(c);
			}
		}
	}

	scheduleBroadcast(immediate = false) {
		const now = Date.now();
		const delay = immediate ? 0 : Math.max(0, 800 - (now - this._lastBroadcast));
		if (this._broadcastTimer) clearTimeout(this._broadcastTimer);
		this._broadcastTimer = setTimeout(() => {
			this.cleanupStale();
			this._lastBroadcast = Date.now();
			const payload = JSON.stringify({
				t: "pr",
				n: this.clients.size,
				h: this.calcHeatmap(),
			});
			for (const c of this.clients) {
				try {
					if (c.ws.readyState === 1 /* OPEN */) {
						c.ws.send(payload);
					}
				} catch {}
			}
		}, delay);
	}
}

/**
 * 实时共读全局管理器
 */
export function createPresenceManager() {
	const rooms = new Map();

	return {
		getRoom(slug) {
			if (!rooms.has(slug)) rooms.set(slug, new LocalPresenceRoom(slug));
			return rooms.get(slug);
		},
		idFromName(slug) {
			return slug;
		},
		get(slug) {
			const room = this.getRoom(slug);
			return {
				async fetch(request) {
					const snap = room.getSnapshot();
					return new Response(JSON.stringify(snap), {
						status: 200,
						headers: {
							"Content-Type": "application/json; charset=utf-8",
							"Cache-Control": "no-cache",
						},
					});
				},
			};
		},
	};
}
