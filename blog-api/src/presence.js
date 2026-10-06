/**
 * Yaoxi Blog 实时共读 Presence — Durable Object（WebSocket 休眠模式）
 *
 * 每个文章 slug 对应一个常驻房间（idFromName(slug)）：
 * - 接入：WebSocket Hibernation API（消息唤醒、空闲休眠近零开销）
 * - 在线人数：当前 OPEN 连接数；段落热度：各连接 attachment 中的阅读位置聚合
 * - 免持久化存储：人数与热度从 getWebSockets() + serializeAttachment 实时推导，无双写一致性问题
 * - 治理：客户端 25s 心跳；广播合并节流 800ms；僵尸连接 240s 未心跳踢出；单房间上限 120 人
 *
 * 消息协议（客户端 → 服务端）：
 *   { "t": "pos", "p": <段落索引> }   阅读位置上报 / 心跳（p 为 -1 表示未知）
 * 消息协议（服务端 → 客户端，全房间聚合广播）：
 *   { "t": "pr", "n": <在线人数>, "h": { "<段落索引>": <人数> } }
 */

const MAX_ROOM = 120;
const MAX_PARA = 2000;
const MAX_MSG = 512;
const STALE_MS = 240_000;
const BC_MIN_MS = 800;
const IDLE_REFRESH_MS = 45_000;

const CORS = { "Access-Control-Allow-Origin": "*" };

export class PresenceRoom {
	constructor(state, env) {
		this.ctx = state;
		this.env = env;
		this._timer = null;
		this._bcAt = 0;
	}

	async fetch(request) {
		const upgrade = (request.headers.get("Upgrade") || "").toLowerCase();
		if (upgrade !== "websocket") {
			// 非升级请求：HTTP 快照（降级查询 / 调试）
			const open = this._openWs();
			return new Response(JSON.stringify({ ok: true, n: open.length, h: this._heatOf(open) }), {
				headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
			});
		}

		const url = new URL(request.url);
		const rawP = Number.parseInt(url.searchParams.get("p") || "", 10);
		const initP = Number.isFinite(rawP) ? Math.min(Math.max(rawP, -1), MAX_PARA) : -1;

		const open = this._openWs();
		if (open.length >= MAX_ROOM) {
			return new Response(JSON.stringify({ ok: false, error: "room full" }), {
				status: 503,
				headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
			});
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		this.ctx.acceptWebSocket(server);
		const att = { p: initP, t: Date.now() };
		try {
			server.serializeAttachment(att);
		} catch {}

		try {
			server.send(this._payload(open.length + 1, this._heatOf(open, att)));
		} catch {}
		this._schedule(250);

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws, message) {
		if (typeof message !== "string" || message.length > MAX_MSG) return;
		let m = null;
		try {
			m = JSON.parse(message);
		} catch {
			return;
		}
		if (!m || m.t !== "pos") return;

		const p = Number.isInteger(m.p) ? Math.min(Math.max(m.p, -1), MAX_PARA) : -1;
		const now = Date.now();
		const prev = this._att(ws);
		try {
			ws.serializeAttachment({ p, t: now });
		} catch {}

		if (prev.p === p) {
			// 位置未变（心跳）：仅偶尔做一次聚合刷新，顺带清理僵尸连接
			if (now - this._bcAt > IDLE_REFRESH_MS) this._schedule(BC_MIN_MS);
			return;
		}
		this._schedule(BC_MIN_MS);
	}

	async webSocketClose() {
		this._schedule(120);
	}

	async webSocketError(ws) {
		try {
			ws.close(1011, "error");
		} catch {}
		this._schedule(120);
	}

	/** 合并广播：窗口内的多次状态变化只触发一次全房间推送 */
	_schedule(delay) {
		if (this._timer) return;
		this._timer = setTimeout(() => {
			this._timer = null;
			this._broadcast();
		}, delay);
	}

	_broadcast() {
		const now = Date.now();
		const alive = [];
		for (const ws of this.ctx.getWebSockets()) {
			let state = 1;
			try {
				state = ws.readyState;
			} catch {}
			if (state !== 1) continue;
			const att = this._att(ws);
			if (now - (att.t || 0) > STALE_MS) {
				try {
					ws.close(4000, "stale");
				} catch {}
				continue;
			}
			alive.push(ws);
		}
		this._bcAt = now;
		const payload = this._payload(alive.length, this._heatOf(alive));
		for (const ws of alive) {
			try {
				ws.send(payload);
			} catch {}
		}
	}

	_openWs() {
		const out = [];
		for (const ws of this.ctx.getWebSockets()) {
			try {
				if (ws.readyState === 1) out.push(ws);
			} catch {}
		}
		return out;
	}

	_att(ws) {
		let a = null;
		try {
			a = ws.deserializeAttachment();
		} catch {}
		return a && typeof a === "object" ? a : { p: -1, t: 0 };
	}

	/** 段落热度聚合：{ "3": 2, "7": 1 }；extra 用于刚接入、尚未纳入 open 列表的本人连接 */
	_heatOf(sockets, extra) {
		const h = {};
		const add = (att) => {
			if (att && Number.isInteger(att.p) && att.p >= 0) {
				const k = String(att.p);
				h[k] = (h[k] || 0) + 1;
			}
		};
		for (const ws of sockets) add(this._att(ws));
		if (extra) add(extra);
		return h;
	}

	_payload(n, h) {
		return JSON.stringify({ t: "pr", n, h });
	}
}
