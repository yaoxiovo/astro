/**
 * Site Monitor — 网站存活监控 Worker（免费版快猫星云平替喵）
 *
 * 功能：
 *  - 每 5 分钟拨测站点列表（HTTP 状态码 + 响应时间 + 可选关键字校验）
 *  - 状态机去重：DOWN 时只告警一次，恢复 UP 时再通知（不刷屏）
 *  - 告警主通道：快猫星云 Flashduty 标准告警（故障 Critical / 恢复 Ok，自动恢复）
 *  - 可选旁路：Telegram 通知（配置 BOT_TOKEN/CHAT_ID 即启用）
 *  - GET / 自写状态页（复刻快猫星云 UI，全自动），GET /api/status 状态 JSON
 *  - GET /api/history?days=30&site=xxx 历史数据（uptime% + 曲线 + 故障事件）
 *  - GET /api/run?secret=xxx 手动触发一轮检测
 *
 * 免费额度：Workers Free 10 万请求/天，本监控 5 站点 × 288 次/天 ≈ 1.4k，完全够用
 */

const DEFAULT_SITES = [
	{ name: "博客主站", url: "https://blog.yaoxi.wiki/", expect: 200 },
	{ name: "博客 API", url: "https://blog.yaoxi.wiki/api/moments.json", expect: 200 },
	{ name: "Umami 统计", url: "https://drill-演练-umami.invalid/", expect: 200 },
	{ name: "个人主页", url: "https://yaoxi.wiki/", expect: 200 },
	{ name: "图床", url: "https://png.yaoxi.wiki/", expect: 200 },
	{ name: "状态页", url: "https://status.yaoxi.wiki/", expect: 200 },
];

const TIMEOUT_MS = 10_000;
const MAX_BODY_SCAN = 200_000; // 关键字匹配只扫描响应体前 200KB
const STATE_PREFIX = "site:state:";
const SP_INCIDENT_PREFIX = "sp:incident:";
const SP_DIAG_KEY = "sp:diag";
const FLASHCAT_API_HOST = "https://api.flashcat.cloud";

export default {
	async scheduled(_event, env, ctx) {
		ctx.waitUntil(runChecks(env));
	},

	async fetch(request, env) {
		const url = new URL(request.url);

		// 自写状态页（复刻快猫星云 UI）
		if (url.pathname === "/") {
			return htmlResponse(HISTORY_HTML);
		}

		// 公开状态 JSON（widget 兼容）
		if (url.pathname === "/api/status") {
			return jsonResponse(await collectStatus(env));
		}

		// 历史数据：uptime% + 采样曲线 + 故障事件
		if (url.pathname === "/api/history") {
			const days = parseInt(url.searchParams.get("days") || "30", 10);
			const site = url.searchParams.get("site") || "";
			return jsonResponse(await collectHistory(env, site, days));
		}

		// 快猫星云 widget 兼容 API（博客首页嵌入用）
		if (url.pathname === "/api/widget/v1/summary.json") {
			return jsonResponse(await widgetSummary(env));
		}

		// 诊断端点：状态页自动发布排查（脱敏，不暴露 app_key）
		if (url.pathname === "/api/sp-test") {
			return jsonResponse(await spTest(env));
		}

if (url.pathname === "/api/diag") {
			return jsonResponse(await diagStatusPage(env));
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
				await syncStatusPage(env, alert);
			}
			return { name: site.name, url: site.url, ok: result.ok, status: result.status, ms: result.ms, error: result.error, alert: alerts.length > 0 };
		}),
	);
	await saveSnapshot(env, results);
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

async function widgetSummary(env) {
	const status = await collectStatus(env);
	const anyDown = status.sites.some((s) => s.state === "down");
	const allDown = status.sites.length > 0 && status.sites.every((s) => s.state === "down");
	const overall = allDown ? "major_outage" : anyDown ? "partial_outage" : "operational";
	return {
		schema_version: "1.0",
		generated_at: new Date().toISOString(),
		poll_after_seconds: 30,
		max_stale_seconds: 120,
		page: { name: "Yaoxi", url: "https://status.yaoxi.wiki" },
		overall: { status: overall },
		ongoing_incidents: status.sites.filter((s) => s.state === "down").map((s) => ({
			id: "inc-" + encodeURIComponent(s.name),
			name: s.name + " 故障",
			status: "investigating",
			impact: "minor",
			started_at: new Date(s.since || Date.now()).toISOString(),
		})),
		in_progress_maintenances: [],
		scheduled_maintenances: [],
	};
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

/* ---------- Flashduty 状态页自动发布（故障→组件变红，恢复→resolved） ---------- */

async function syncStatusPage(env, alert) {
	if (!env.FLASHDUTY_APP_KEY) return { skipped: true };
	try {
		const info = await getStatusPageInfo(env);
		if (!info) return { skipped: true, reason: "no-page" };
		const comp = (info.components || []).find((c) => c.name === alert.site.name || (c.name && (c.name.includes(alert.site.name) || alert.site.name.includes(c.name))));
		if (!comp) return { skipped: true, reason: "no-component", site: alert.site.name };
		const nowSec = Math.floor(Date.now() / 1000);
		let res;
		if (alert.kind === "down") {
			const desc = `${alert.site.url} 检测失败：${alert.result.error}（${alert.result.ms}ms）`;
			res = await flashdutyApi(env, "/status-page/change/create", {
				page_id: info.page_id,
				title: `[site-monitor] ${alert.site.name} DOWN`,
				type: "incident",
				status: "investigating",
				description: desc,
				updates: [{
					at_seconds: nowSec,
					status: "investigating",
					description: desc,
					component_changes: [{ component_id: comp.component_id, status: "major_outage" }],
				}],
				notify_subscribers: false,
			});
			const changeId = res?.body?.data?.change_id ?? res?.body?.data?.id ?? res?.body?.change_id ?? res?.body?.id ?? null;
			const result = { kind: "down", httpStatus: res?.httpStatus, body: res?.body, change_id: changeId, at: new Date().toISOString(), site: alert.site.name };
			await env.MONITOR_KV.put(SP_DIAG_KEY, JSON.stringify(result), { expirationTtl: 86400 });
			if (changeId) {
				await env.MONITOR_KV.put(SP_INCIDENT_PREFIX + alert.site.name, String(changeId));
			}
			return { published: true, change_id: changeId };
		}
		let changeId = await env.MONITOR_KV.get(SP_INCIDENT_PREFIX + alert.site.name);
		if (!changeId) {
			const found = await findActiveIncident(env, info.page_id, alert.site.name);
			changeId = found?.change_id ? String(found.change_id) : null;
		}
		if (!changeId) return { skipped: true, reason: "no-incident" };
		const timelineRes = await flashdutyApi(env, "/status-page/change/timeline/create", {
			page_id: info.page_id,
			change_id: Number(changeId),
			description: `已恢复：${alert.site.url} 响应正常（${alert.result.ms}ms），故障持续 ${formatDuration(alert.duration)}`,
			status: "resolved",
			component_changes: [{ component_id: comp.component_id, status: "operational" }],
		});
		await env.MONITOR_KV.put(SP_DIAG_KEY, JSON.stringify({ kind: "up", httpStatus: timelineRes?.httpStatus, body: timelineRes?.body, change_id: Number(changeId), at: new Date().toISOString(), site: alert.site.name }), { expirationTtl: 86400 });
		await env.MONITOR_KV.delete(SP_INCIDENT_PREFIX + alert.site.name);
		return { resolved: true, change_id: Number(changeId) };
	} catch (err) {
		await env.MONITOR_KV.put(SP_DIAG_KEY, JSON.stringify({ error: err?.message ?? String(err), at: new Date().toISOString() }), { expirationTtl: 86400 });
		return { error: err?.message ?? String(err) };
	}
}

async function getStatusPageInfo(env) {
	const resp = await fetch(`https://api.flashcat.cloud/status-page/list?app_key=${encodeURIComponent(env.FLASHDUTY_APP_KEY)}`, {
		headers: { accept: "application/json" },
	});
	if (!resp.ok) return null;
	const data = await resp.json().catch(() => null);
	const items = data?.data?.items || data?.items || [];
	if (!items.length) return null;
	return { page_id: items[0].page_id, components: items[0].components || [] };
}

async function diagStatusPage(env) {
	const out = { hasAppKey: !!env.FLASHDUTY_APP_KEY };
	if (!env.FLASHDUTY_APP_KEY) {
		out.error = "FLASHDUTY_APP_KEY 未配置";
		return out;
	}
	try {
		const resp = await fetch(`https://api.flashcat.cloud/status-page/list?app_key=${encodeURIComponent(env.FLASHDUTY_APP_KEY)}`, {
			headers: { accept: "application/json" },
		});
		out.listHttpStatus = resp.status;
		const raw = await resp.text().catch(() => "");
		let data = null;
		try { data = raw ? JSON.parse(raw) : null; } catch { out.listRaw = raw.slice(0, 400); }
		out.listKeys = data ? Object.keys(data) : [];
		const dataObj = data?.data;
		out.dataKeys = dataObj && typeof dataObj === "object" && !Array.isArray(dataObj) ? Object.keys(dataObj) : [];
		out.dataType = Array.isArray(dataObj) ? "array" : typeof dataObj;
		const items = Array.isArray(dataObj) ? dataObj : dataObj?.items || [];
		out.pageCount = Array.isArray(items) ? items.length : 0;
		if (Array.isArray(items) && items.length) {
			const p = items[0];
			out.pageKeys = Object.keys(p);
			out.pageIdShort = String(p?.page_id ?? p?.id ?? "").slice(0, 12);
			const comps = p?.components || p?.component_items || p?.component || [];
			if (!Array.isArray(comps) && comps && typeof comps === "object") {
				out.componentShape = Object.keys(comps).slice(0, 10);
			}
			out.componentCount = Array.isArray(comps) ? comps.length : 0;
			if (Array.isArray(comps)) {
				out.components = comps.map((c) => ({ name: c?.name ?? c?.component_name ?? "?", idShort: String(c?.component_id ?? c?.id ?? "").slice(0, 12), keys: Object.keys(c).slice(0, 8) }));
			}
		}
	} catch (err) {
		out.error = err?.message ?? String(err);
	}
	const diag = await env.MONITOR_KV.get(SP_DIAG_KEY).catch(() => null);
	if (diag) {
		try { out.lastSync = JSON.parse(diag); } catch { out.lastSyncRaw = diag.slice(0, 300); }
	}
	return out;
}

async function spTest(env) {
	const out = { at: new Date().toISOString(), hasAppKey: !!env.FLASHDUTY_APP_KEY };
	if (!env.FLASHDUTY_APP_KEY) return { ...out, error: "FLASHDUTY_APP_KEY 未配置" };
	try {
		const info = await getStatusPageInfo(env);
		if (!info) return { ...out, error: "无法获取状态页信息" };
		out.pageId = info.page_id;
		const comp = (info.components || [])[0];
		out.firstComponent = comp ? { name: comp.name, id: comp.component_id } : null;
		const nowSec = Math.floor(Date.now() / 1000);
		const desc = "[site-monitor] API 连通性测试（不改变组件状态，自动恢复）";
		const res = await flashdutyApi(env, "/status-page/change/create", {
			page_id: info.page_id,
			title: "[site-monitor] API 连通性测试",
			type: "incident",
			status: "investigating",
			description: desc,
			updates: [{ at_seconds: nowSec, status: "investigating", description: desc, component_changes: comp ? [{ component_id: comp.component_id, status: "operational" }] : [] }],
			notify_subscribers: false,
		});
		out.createStatus = res.httpStatus;
		out.createBody = res.body;
		const changeId = res?.body?.data?.change_id ?? res?.body?.data?.id ?? res?.body?.change_id ?? res?.body?.id ?? null;
		if (changeId) {
			const tl = await flashdutyApi(env, "/status-page/change/timeline/create", {
				page_id: info.page_id,
				change_id: Number(changeId),
				status: "resolved",
				description: "连通性测试完成，自动恢复",
			});
			out.resolveStatus = tl.httpStatus;
			out.resolveBody = tl.body;
		}
		await env.MONITOR_KV.put(SP_DIAG_KEY, JSON.stringify({ kind: "sp-test", httpStatus: res.httpStatus, body: res.body, at: new Date().toISOString() }), { expirationTtl: 86400 });
	} catch (err) {
		out.error = err?.message ?? String(err);
	}
	return out;
}

async function flashdutyApi(env, path, body) {
	const resp = await fetch(`https://api.flashcat.cloud${path}?app_key=${encodeURIComponent(env.FLASHDUTY_APP_KEY)}`, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json" },
		body: JSON.stringify(body),
	});
	const text = await resp.text().catch(() => "");
	let parsed = null;
	try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text.slice(0, 300); }
	return { httpStatus: resp.status, body: parsed };
}

async function findActiveIncident(env, pageId, siteName) {
	const resp = await fetch(`https://api.flashcat.cloud/status-page/change/active/list?app_key=${encodeURIComponent(env.FLASHDUTY_APP_KEY)}&page_id=${pageId}&type=incident`, {
		headers: { accept: "application/json" },
	});
	if (!resp.ok) return null;
	const data = await resp.json().catch(() => null);
	for (const it of data?.data?.items || data?.items || []) {
		const t = it.title || it.change_name || it.name || "";
		if (t.includes(siteName) && t.includes("DOWN")) return { change_id: it.change_id ?? it.id };
	}
	return null;
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
/* ---------- 历史快照（hourly 合并写入，避开 KV 免费写入额度） ---------- */

function histKey(ts) {
	const d = new Date(ts);
	const pad = (n) => String(n).padStart(2, "0");
	return `hist:${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}`;
}

async function saveSnapshot(env, results) {
	try {
		const key = histKey(Date.now());
		const prev = parseJson(await env.MONITOR_KV.get(key));
		const samples = prev?.samples || {};
		const now = Date.now();
		for (const r of results) {
			const arr = samples[r.name] || (samples[r.name] = []);
			arr.push({ ts: now, state: r.ok ? "up" : "down", ms: r.ms });
			if (arr.length > 13) arr.splice(0, arr.length - 13);
		}
		await env.MONITOR_KV.put(key, JSON.stringify({ samples }), { expirationTtl: 2592000 });
	} catch {
		// 快照失败不影响主流程
	}
}

function deriveEvents(samples) {
	const sorted = [...samples].sort((a, b) => a.ts - b.ts);
	const events = [];
	let start = null;
	for (const s of sorted) {
		if (s.state === "down" && start === null) start = s.ts;
		if (s.state === "up" && start !== null) {
			events.push({ from: start, to: s.ts, duration: s.ts - start });
			start = null;
		}
	}
	if (start !== null) events.push({ from: start, to: null, duration: Date.now() - start });
	return events;
}

async function collectHistory(env, siteFilter, days) {
	const sites = parseSites(env.SITES);
	const daysNum = Math.min(Math.max(days || 30, 1), 90);
	const bySite = {};
	for (const s of sites) bySite[s.name] = [];

	const now = Date.now();
	const keys = [];
	for (let d = 0; d < daysNum; d++) {
		const dayStart = now - (now % 86400000) - d * 86400000;
		for (let h = 0; h < 24; h++) keys.push(histKey(dayStart + h * 3600000));
	}
	const raws = await Promise.all(keys.map((k) => env.MONITOR_KV.get(k)));
	for (const raw of raws) {
		if (!raw) continue;
		const parsed = parseJson(raw);
		if (!parsed?.samples) continue;
		for (const [name, arr] of Object.entries(parsed.samples)) {
			if (bySite[name] && (!siteFilter || name === siteFilter)) bySite[name].push(...arr);
		}
	}

	const out = {};
	for (const [name, samples] of Object.entries(bySite)) {
		const count = samples.length;
		const downCount = samples.filter((s) => s.state === "down").length;
		const uptime = count ? Math.round(((count - downCount) / count) * 10000) / 100 : null;
		out[name] = {
			uptime,
			count,
			downCount,
			events: deriveEvents(samples),
			samples: samples.slice(-288),
		};
	}
	return { days: daysNum, generatedAt: Date.now(), sites: out };
}

/* ---------- 状态页 HTML（复刻快猫星云 UI，全自动） ---------- */

const HISTORY_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Yaoxi Status</title>
<style>
:root { --bg:#f5f6f7; --card:#fff; --text:#1c2733; --muted:#6b7683; --green:#26a65b; --red:#e74c3c; --orange:#f39c12; --border:#e3e7ec; --radius:8px; }
@media (prefers-color-scheme: dark) { :root { --bg:#16181d; --card:#1f232b; --text:#e8eaed; --muted:#9aa3ad; --border:#2b3038; } }
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--text); line-height:1.5; }
.wrap { max-width:860px; margin:0 auto; padding:24px 16px 60px; }
header { text-align:center; padding:28px 0 20px; }
header h1 { font-size:26px; letter-spacing:1px; }
header .sub { color:var(--muted); font-size:13px; margin-top:4px; }
.banner { border-radius:var(--radius); padding:18px 22px; color:#fff; text-align:center; margin:14px 0 26px; }
.banner.ok { background:var(--green); }
.banner.bad { background:var(--orange); }
.banner.crit { background:var(--red); }
.banner h2 { font-size:20px; font-weight:600; }
.banner p { font-size:14px; opacity:.92; margin-top:4px; }
.card { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); margin-bottom:16px; padding:18px 20px; }
.card h3 { font-size:15px; margin-bottom:14px; color:var(--muted); font-weight:600; }
.site { display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid var(--border); flex-wrap:wrap; }
.site:last-child { border-bottom:none; }
.dot { width:11px; height:11px; border-radius:50%; flex-shrink:0; }
.dot.up { background:var(--green); }
.dot.down { background:var(--red); }
.dot.unknown { background:var(--muted); }
.s-name { font-weight:600; min-width:110px; }
.s-meta { color:var(--muted); font-size:12px; flex:1; min-width:140px; }
.s-uptime { font-size:13px; font-weight:600; color:var(--muted); min-width:90px; text-align:right; }
.spark { margin-left:auto; }
.spark svg { display:block; }
.ev { padding:10px 0; border-bottom:1px solid var(--border); font-size:14px; }
.ev:last-child { border-bottom:none; }
.ev .t { color:var(--red); font-weight:600; }
.ev .d { color:var(--muted); font-size:12px; margin-top:2px; }
.empty { color:var(--muted); font-size:13px; padding:6px 0; }
footer { text-align:center; color:var(--muted); font-size:12px; margin-top:30px; }
</style>
</head>
<body>
<div class="wrap">
<header>
<h1>Yaoxi Status</h1>
<p class="sub">网站运行状态 · 每 5 分钟自动检测 · Powered by Cloudflare Worker</p>
</header>
<div class="banner" id="banner"><h2>加载中…</h2><p>正在获取最新状态</p></div>
<div class="card"><h3>系统状态 System Status</h3><div id="sites"></div></div>
<div class="card"><h3>响应时间 Response Time（最近 24 小时）</h3><div id="sparks"></div></div>
<div class="card"><h3>故障记录 Incident History（最近 30 天）</h3><div id="events"><div class="empty">加载中…</div></div></div>
<footer>检测：状态码 + 响应时间 + 超时/DNS 故障 · 告警：Flashduty 快猫星云</footer>
</div>
<script>
var STATUS_URL = "/api/status";
var HISTORY_URL = "/api/history?days=30";
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function fmt(ts){ if(!ts) return "-"; var d=new Date(ts+8*3600*1000); var p=function(n){return String(n).padStart(2,"0");}; return d.getUTCFullYear()+"-"+p(d.getUTCMonth()+1)+"-"+p(d.getUTCDate())+" "+p(d.getUTCHours())+":"+p(d.getUTCMinutes()); }
function dur(ms){ if(ms==null) return "进行中"; var m=Math.round(ms/60000); if(m<60) return m+" 分钟"; var h=Math.floor(m/60); var mm=m%60; return mm? h+" 小时 "+mm+" 分" : h+" 小时"; }
function renderBanner(sites){ var arr=Object.keys(sites).map(function(k){return sites[k];}); var anyDown=arr.some(function(s){return s.state==="down";}); var anyUnknown=arr.some(function(s){return s.state==="unknown";}); var el=document.getElementById("banner");
 if(anyDown){ el.className="banner crit"; el.innerHTML="<h2>部分服务异常</h2><p>部分系统运行不正常，请查看下方详情</p>"; }
 else if(anyUnknown){ el.className="banner bad"; el.innerHTML="<h2>数据收集进行中</h2><p>监控器刚部署，等待首轮检测完成</p>"; }
 else { el.className="banner ok"; el.innerHTML="<h2>一切正常 All Systems Operational</h2><p>所有系统均运行正常</p>"; } }
function renderSites(sites){ var el=document.getElementById("sites"); var html=""; Object.keys(sites).forEach(function(name){ var s=sites[name]; var st=s.state||"unknown"; var dot=st==="up"?"up":(st==="down"?"down":"unknown"); var stTxt=st==="up"?"运行正常":(st==="down"?"故障":"未知"); html+='<div class="site"><span class="dot '+dot+'"></span><span class="s-name">'+esc(name)+'</span><span class="s-meta">'+stTxt+' · '+fmt(s.lastCheck)+' · '+s.lastMs+'ms</span><span class="s-uptime">'+((s.uptime!=null)?s.uptime.toFixed(2)+"%":"-")+'</span></div>'; }); el.innerHTML=html; }
function renderSparks(hist){ var el=document.getElementById("sparks"); var html=""; Object.keys(hist.sites||{}).forEach(function(name){ var d=hist.sites[name]; var pts=d.samples||[]; var W=640,H=36; var max=Math.max.apply(null,pts.map(function(p){return p.ms;}).concat([1])); var step=pts.length>1? W/(pts.length-1):W; var poly=pts.map(function(p,i){ var x=i*step; var y=H-2-Math.min(p.ms/max,1)*(H-4); return x.toFixed(1)+","+y.toFixed(1); }).join(" "); var color=(d.uptime!=null&&d.uptime>=99)? "#26a65b" : "#e74c3c"; html+='<div class="site"><span class="s-name">'+esc(name)+'</span><span class="s-meta">'+pts.length+' 个采样点 · 30 天 uptime '+(d.uptime!=null?d.uptime.toFixed(2)+"%":"-")+'</span><span class="spark"><svg width="'+W+'" height="'+H+'"><polyline points="'+poly+'" fill="none" stroke="'+color+'" stroke-width="1.5"/></svg></span></div>'; }); el.innerHTML=html||'<div class="empty">暂无数据（监控器运行满 1 小时后自动出现曲线）</div>'; }
function renderEvents(hist){ var el=document.getElementById("events"); var all=[]; Object.keys(hist.sites||{}).forEach(function(name){ (hist.sites[name].events||[]).forEach(function(e){ all.push({name:name,from:e.from,to:e.to,duration:e.duration}); }); }); all.sort(function(a,b){return b.from-a.from;}); if(!all.length){ el.innerHTML='<div class="empty">过去 30 天没有故障记录 🎉</div>'; return; } var html=""; all.forEach(function(e){ html+='<div class="ev"><span class="t">'+esc(e.name)+' 故障</span><div class="d">'+fmt(e.from)+' → '+(e.to?fmt(e.to):"至今")+' · 持续 '+dur(e.duration)+'</div></div>'; }); el.innerHTML=html; }
function load(){ var banner=document.getElementById("banner");
 fetch(STATUS_URL).then(function(r){return r.json();}).then(function(j){ renderBanner(j.sites); }).catch(function(){ banner.className="banner bad"; banner.innerHTML="<h2>加载失败<\/h2><p>无法连接状态 API，请稍后刷新<\/p>"; });
 fetch(HISTORY_URL).then(function(r){return r.json();}).then(function(j){ renderSites(j.sites); renderSparks(j); renderEvents(j); }).catch(function(){ var el=document.getElementById("sites"); if(!el.children.length) el.innerHTML='<div class="empty">加载失败，请刷新重试<\/div>'; }); }
load(); setInterval(load, 60000);
</script>
</body>
</html>`;

function htmlResponse(html) {
	return new Response(html, {
		headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
	});
}