/**
 * Site Monitor — 网站存活监控 Worker（免费版快猫星云平替喵）
 *
 * 功能：
 *  - 每 5 分钟拨测站点列表（HTTP 状态码 + 响应时间 + 可选关键字校验）
 *  - 状态机去重：DOWN 时只告警一次，恢复 UP 时再通知（不刷屏）
 *  - 告警主通道：快猫星云 Flashduty 标准告警（故障 Critical / 恢复 Ok，自动恢复）
 *  - 可选旁路：Telegram 通知（配置 BOT_TOKEN/CHAT_ID 即启用）
 *  - GET / 公开状态 JSON，GET /api/run?secret=xxx 手动触发一轮检测
 *
 * 免费额度：Workers Free 10 万请求/天，本监控 4 站点 × 288 次/天 ≈ 1.2k，完全够用
 */

const DEFAULT_SITES = [
	{ name: "博客主站", url: "https://blog.yaoxi.wiki/", expect: 200 },
	{ name: "博客 API", url: "https://api.blog.yaoxi.cloud/", expect: 200 },
	{ name: "Umami 统计", url: "https://umami.yaoxi.cloud/", expect: 200 },
	{ name: "个人主页", url: "https://yaoxi.wiki/", expect: 200 },
];

const TIMEOUT_MS = 10_000;
const MAX_BODY_SCAN = 200_000; // 关键字匹配只扫描响应体前 200KB
const STATE_PREFIX = "site:state:";
const FLASHCAT_API_HOST = "https://api.flashcat.cloud";

export default {
	async scheduled(_event, env, ctx) {
		ctx.waitUntil(runChecks(env));
	},

	async fetch(request, env) {
		const url = new URL(request.url);

		// 公开状态 JSON
		if (url.pathname === "/" || url.pathname === "/api/status") {
			return jsonResponse(await collectStatus(env));
		}

		// 手动触发一轮检测（需 secret 保护）
		if (url.pathname === "/api/run") {
			if (env.MONITOR_SECRET && url.searchParams.get("secret") !== env.MONITOR_SECRET) {
				return jsonResponse({ error: "unauthorized" }, 401);
			}
			return jsonResponse(await runChecks(env));
		}

		return jsonResponse({ error: "not found" }, 404);
	},
};

/* ---------- 核心检测 ---------- */

async function runChecks(env) {
	const sites = parseSites(env.SITES);
	const results = await Promise.all(
		sites.map(async (site) => {
			const result = await checkSite(site);
			const alerts = await updateState(env, site, result);
			for (const alert of alerts) {
				await notify(env, alert);
			}
			return { name: site.name, url: site.url, ok: result.ok, status: result.status, ms: result.ms, error: result.error, alert: alerts.length > 0 };
		}),
	);
	return { ts: Date.now(), results };
}

async function checkSite(site) {
	const started = Date.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(site.url, {
			signal: controller.signal,
			redirect: "follow",
			headers: { "user-agent": "SiteMonitor/1.0 (+https://blog.yaoxi.wiki)" },
		});
		const ms = Date.now() - started;
		const expect = site.expect ?? 200;
		const okStatus = res.status === expect;
		let okKeyword = true;
		if (site.keyword) {
			const body = (await res.text()).slice(0, MAX_BODY_SCAN);
			okKeyword = body.includes(site.keyword);
		}
		const ok = okStatus && okKeyword;
		return {
			name: site.name, url: site.url, ok, status: res.status, ms,
			error: ok
				? ""
				: okStatus
					? `关键字 "${site.keyword}" 未匹配`
					: `HTTP ${res.status}（期望 ${expect}）`,
		};
	} catch (err) {
		return {
			name: site.name, url: site.url, ok: false, status: 0, ms: Date.now() - started,
			error: err?.name === "AbortError" ? `超时（>${TIMEOUT_MS / 1000}s）` : `网络错误: ${err?.message ?? err}`,
		};
	} finally {
		clearTimeout(timer);
	}
}

/* ---------- 状态机（去重告警） ---------- */

async function updateState(env, site, result) {
	const key = STATE_PREFIX + site.name;
	const prev = parseJson(await env.MONITOR_KV.get(key));
	const now = Date.now();
	const alerts = [];

	if (result.ok) {
		if (prev && prev.state === "down") {
			alerts.push({ kind: "up", site, result, since: prev.since, duration: now - prev.since });
		}
		await env.MONITOR_KV.put(key, JSON.stringify({ state: "up", since: prev?.state === "up" ? prev.since : now, lastCheck: now, lastMs: result.ms }));
	} else {
		if (!prev || prev.state !== "down") {
			alerts.push({ kind: "down", site, result });
		}
		await env.MONITOR_KV.put(key, JSON.stringify({ state: "down", since: prev?.state === "down" ? prev.since : now, lastCheck: now, lastMs: result.ms }));
	}
	return alerts;
}

async function collectStatus(env) {
	const sites = parseSites(env.SITES);
	const list = [];
	for (const site of sites) {
		const st = parseJson(await env.MONITOR_KV.get(STATE_PREFIX + site.name));
		list.push({
			name: site.name,
			url: site.url,
			state: st?.state ?? "unknown",
			since: st?.since ?? null,
			lastCheck: st?.lastCheck ?? null,
			lastMs: st?.lastMs ?? null,
		});
	}
	return { updatedAt: Date.now(), sites: list };
}

/* ---------- 告警消息 ---------- */

function buildDownMessage(alert) {
	const { site, result } = alert;
	return [
		"🔴 <b>故障告警</b>：" + esc(site.name),
		`<a href="${esc(site.url)}">${esc(site.url)}</a>`,
		`原因：${esc(result.error)}`,
		`响应：${result.ms}ms`,
		`时间：${beijingTime(Date.now())}`,
	].join("\n");
}

function buildUpMessage(alert) {
	const { site, result, since, duration } = alert;
	return [
		"🟢 <b>已恢复</b>：" + esc(site.name),
		`<a href="${esc(site.url)}">${esc(site.url)}</a>`,
		`故障时长：${formatDuration(duration)}（${beijingTime(since)} 起）`,
		`恢复响应：${result.ms}ms`,
		`时间：${beijingTime(Date.now())}`,
	].join("\n");
}

async function notify(env, alert) {
	const results = [];
	if (env.FLASHCAT_INTEGRATION_KEY) {
		results.push(await flashcatAlert(env, alert));
	}
	if (env.BOT_TOKEN && env.CHAT_ID) {
		results.push(await tgAlert(env, alert.kind === "down" ? buildDownMessage(alert) : buildUpMessage(alert)));
	}
	return results;
}

async function flashcatAlert(env, alert) {
	const host = env.FLASHCAT_API_HOST || FLASHCAT_API_HOST;
	const url = `${host}/event/push/alert/standard?integration_key=${encodeURIComponent(env.FLASHCAT_INTEGRATION_KEY)}`;
	try {
		const resp = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(buildFlashcatPayload(env, alert)),
		});
		return { ok: resp.ok, status: resp.status };
	} catch (err) {
		return { ok: false, error: err?.message ?? String(err) };
	}
}

function buildFlashcatPayload(env, alert) {
	const { site, result } = alert;
	const down = alert.kind === "down";
	const lines = down
		? [
				`站点: ${site.url}`,
				`原因: ${result.error}`,
				`响应: ${result.ms}ms`,
				`时间: ${beijingTime(Date.now())}`,
		  ]
		: [
				`站点: ${site.url}`,
				`故障时长: ${formatDuration(alert.duration)}（${beijingTime(alert.since)} 起）`,
				`恢复响应: ${result.ms}ms`,
				`时间: ${beijingTime(Date.now())}`,
		  ];
	return {
		title_rule: down ? `【网站监控】${site.name} 故障` : `【网站监控】${site.name} 已恢复`,
		event_status: down ? env.FLASHCAT_SEVERITY || "Critical" : "Ok",
		alert_key: `site-monitor:${site.name}`,
		description: lines.join("\n"),
		labels: {
			site: site.name,
			url: site.url,
			monitor: "cf-site-monitor",
		},
	};
}

async function tgAlert(env, text) {
	if (!env.BOT_TOKEN || !env.CHAT_ID) return { skipped: true };
	try {
		const resp = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ chat_id: env.CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
		});
		return { ok: resp.ok, status: resp.status };
	} catch (err) {
		return { ok: false, error: err?.message ?? String(err) };
	}
}

/* ---------- 工具 ---------- */

function parseSites(raw) {
	if (!raw) return DEFAULT_SITES;
	try {
		const arr = JSON.parse(raw);
		return Array.isArray(arr) && arr.length ? arr : DEFAULT_SITES;
	} catch {
		return DEFAULT_SITES;
	}
}

function parseJson(raw) {
	if (!raw) return null;
	try { return JSON.parse(raw); } catch { return null; }
}

function jsonResponse(data, status = 200) {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	});
}

function esc(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function beijingTime(ts) {
	return new Date(ts + 8 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19) + " (UTC+8)";
}

function formatDuration(ms) {
	const min = Math.round(ms / 60000);
	if (min < 60) return `${min} 分钟`;
	const h = Math.floor(min / 60);
	const m = min % 60;
	return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}