#!/usr/bin/env node

/**
 * 维基百科式特殊页面索引生成器 (Special Pages Indexer)
 * 工业级全站索引管线，产出三类数据集：
 * 1. recent-changes.json —— 全站最近更改流 (Special:RecentChanges)
 * 2. backlinks.json      —— 全站内链反链索引 (What links here / 链入页面)
 * 3. maintenance.json    —— 条目维护巡检报告 (孤立条目/断头路/过时/低质/死链)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const POSTS_DIR = path.join(ROOT_DIR, "src/content/posts");
const DATA_DIR = path.join(ROOT_DIR, "src/data/wiki");
const QUALITY_DIR = path.join(DATA_DIR, "quality");
const PUBLIC_API_DIR = path.join(ROOT_DIR, "public/api/wiki");

export const SITE_HOST = "blog.yaoxi.wiki";
export const STALE_THRESHOLD_DAYS = 180;

function safeDecode(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/**
 * 提取 Markdown 中的站内文章链接 (/posts/<slug>)，返回 [{slug, count}]
 */
export function extractInternalLinks(markdown, selfSlug, siteHost = SITE_HOST) {
	const targets = new Map();
	const linkRegex = /\[([^\]]*)\]\(([^)"]+)(?:(?:\s+["'][^"']*["'])?)\)/g;
	let match;
	while ((match = linkRegex.exec(markdown)) !== null) {
		// 跳过图片语法 ![alt](src)
		if (match.index > 0 && markdown[match.index - 1] === "!") continue;

		let url = match[2].trim();
		url = url.split("#")[0].split("?")[0];
		if (!url) continue;

		let targetSlug = null;
		if (url.startsWith("/posts/")) {
			targetSlug = url.slice("/posts/".length);
		} else {
			try {
				const parsed = new URL(url);
				if (parsed.host === siteHost && parsed.pathname.startsWith("/posts/")) {
					targetSlug = parsed.pathname.slice("/posts/".length);
				}
			} catch {
				// 非绝对 URL，忽略
			}
		}
		if (!targetSlug) continue;

		targetSlug = safeDecode(targetSlug).replace(/\/+$/, "");
		if (!targetSlug || targetSlug === selfSlug) continue;
		targets.set(targetSlug, (targets.get(targetSlug) || 0) + 1);
	}
	return Array.from(targets, ([slug, count]) => ({ slug, count }));
}

/**
 * 反转出链映射为反链索引：{ targetSlug: [{slug: sourceSlug, count}] }
 */
export function invertBacklinks(linkMap) {
	const backlinks = {};
	for (const [sourceSlug, targets] of Object.entries(linkMap)) {
		for (const { slug: target, count } of targets) {
			if (!backlinks[target]) backlinks[target] = [];
			backlinks[target].push({ slug: sourceSlug, count });
		}
	}
	for (const list of Object.values(backlinks)) {
		list.sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
	}
	return backlinks;
}

/**
 * 将 history.json 全量修订展平为全站最近更改流（时间倒序）
 */
export function flattenRecentChanges(historyMap, limit = 0) {
	const entries = [];
	for (const [slug, hist] of Object.entries(historyMap)) {
		const revisions = hist?.revisions || [];
		for (let i = 0; i < revisions.length; i++) {
			const rev = revisions[i];
			entries.push({
				slug,
				sha: rev.sha,
				shortSha: rev.shortSha,
				prevShortSha: revisions[i + 1]?.shortSha ?? null,
				date: rev.date,
				displayDate: rev.displayDate,
				author: rev.author,
				message: rev.message,
				section: rev.section,
				cleanMessage: rev.cleanMessage,
				byteSize: rev.byteSize,
				byteDelta: rev.byteDelta,
				linesAdded: rev.linesAdded,
				linesDeleted: rev.linesDeleted,
				isMinor: rev.isMinor,
				tags: rev.tags || [],
			});
		}
	}
	entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
	return limit > 0 ? entries.slice(0, limit) : entries;
}

/**
 * 生成条目维护巡检报告
 */
export function buildMaintenanceReport({
	posts,
	backlinkIndex,
	outboundMap,
	historyMap,
	qualityMatrix = {},
	qualityReports = {},
	now = new Date(),
	staleThresholdDays = STALE_THRESHOLD_DAYS,
}) {
	const postMap = new Map(posts.map((p) => [p.slug, p]));
	const orphans = [];
	const deadEnds = [];
	const stale = [];

	let totalInternalLinks = 0;

	for (const post of posts) {
		const inbound = (backlinkIndex[post.slug] || []).filter(
			(b) => b.slug !== post.slug,
		);
		const outbound = (outboundMap[post.slug] || []).filter(
			(l) => l.slug !== post.slug,
		);
		totalInternalLinks += outbound.reduce((acc, l) => acc + l.count, 0);

		const hist = historyMap[post.slug];
		const lastUpdated = hist?.lastUpdated || null;
		const totalRevisions = hist?.totalRevisions || 0;

		if (inbound.length === 0) {
			orphans.push({
				slug: post.slug,
				title: post.title,
				lastUpdated,
				totalRevisions,
			});
		}
		if (outbound.length === 0) {
			deadEnds.push({
				slug: post.slug,
				title: post.title,
				lastUpdated,
				totalRevisions,
			});
		}
		if (lastUpdated) {
			const days = Math.floor(
				(now.getTime() - new Date(lastUpdated).getTime()) / 86_400_000,
			);
			if (days >= staleThresholdDays) {
				stale.push({
					slug: post.slug,
					title: post.title,
					lastUpdated,
					daysSinceUpdate: days,
				});
			}
		}
	}

	const byRecency = (a, b) =>
		new Date(b.lastUpdated || 0).getTime() -
		new Date(a.lastUpdated || 0).getTime();
	orphans.sort(byRecency);
	deadEnds.sort(byRecency);
	stale.sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);

	const lowQuality = [];
	for (const [slug, summary] of Object.entries(qualityMatrix)) {
		if (summary && (summary.grade === "C" || summary.grade === "D")) {
			lowQuality.push({
				slug,
				title: summary.title || postMap.get(slug)?.title || slug,
				score: summary.score ?? 0,
				grade: summary.grade,
				issuesCount: summary.issuesCount?.total ?? 0,
			});
		}
	}
	lowQuality.sort((a, b) => a.score - b.score);

	const brokenLinks = [];
	for (const [slug, report] of Object.entries(qualityReports)) {
		for (const issue of report?.issues || []) {
			if (issue.severity === "error") {
				brokenLinks.push({
					slug,
					title: report.title || postMap.get(slug)?.title || slug,
					type: issue.type,
					line: issue.line,
					excerpt: issue.excerpt,
					message: issue.message,
				});
			}
		}
	}

	const totalRevisions = Object.values(historyMap).reduce(
		(acc, h) => acc + (h?.totalRevisions || 0),
		0,
	);

	return {
		generatedAt: now.toISOString(),
		staleThresholdDays,
		stats: {
			totalPosts: posts.length,
			totalRevisions,
			totalInternalLinks,
			totalOrphans: orphans.length,
			totalDeadEnds: deadEnds.length,
			totalStale: stale.length,
			totalLowQuality: lowQuality.length,
			totalBrokenLinks: brokenLinks.length,
		},
		orphans,
		deadEnds,
		stale,
		lowQuality,
		brokenLinks,
	};
}

function loadPosts() {
	const files = fs
		.readdirSync(POSTS_DIR)
		.filter((f) => f.endsWith(".md") && !f.startsWith("."));
	return files.map((file) => {
		const slug = file.replace(/\.md$/, "");
		const raw = fs.readFileSync(path.join(POSTS_DIR, file), "utf-8");
		let title = slug;
		const match = raw.match(/^title:\s*(?:['"]?)(.*?)(?:['"]?)\s*$/m);
		if (match?.[1]) title = match[1].trim();
		return { slug, title, raw };
	});
}

function loadJsonSafe(filePath, fallback) {
	try {
		if (fs.existsSync(filePath)) {
			return JSON.parse(fs.readFileSync(filePath, "utf-8"));
		}
	} catch (e) {
		console.warn(`[Wiki Special] 解析 ${filePath} 失败:`, e.message);
	}
	return fallback;
}

export function runWikiSpecialGeneration(options = {}) {
	const verbose = options.verbose ?? true;
	if (verbose) {
		console.log("🚀 [Wiki Special] 启动特殊页面索引生成管线...");
	}
	const startTime = Date.now();

	fs.mkdirSync(DATA_DIR, { recursive: true });
	fs.mkdirSync(PUBLIC_API_DIR, { recursive: true });

	const posts = loadPosts();
	const historyMap = loadJsonSafe(path.join(DATA_DIR, "history.json"), {});
	const qualityMatrix = loadJsonSafe(path.join(QUALITY_DIR, "matrix.json"), {});

	const qualityReports = {};
	for (const post of posts) {
		const report = loadJsonSafe(
			path.join(QUALITY_DIR, `${post.slug}.json`),
			null,
		);
		if (report) qualityReports[post.slug] = report;
	}

	// 1. 最近更改流
	const allEntries = flattenRecentChanges(historyMap);
	const articles = {};
	for (const post of posts) articles[post.slug] = post.title;
	for (const [slug, hist] of Object.entries(historyMap)) {
		if (!articles[slug] && hist?.title) articles[slug] = hist.title;
	}
	const recentChanges = {
		generatedAt: new Date().toISOString(),
		totalEntries: allEntries.length,
		articles,
		entries: allEntries,
	};

	// 2. 反链索引
	const outboundMap = {};
	for (const post of posts) {
		outboundMap[post.slug] = extractInternalLinks(post.raw, post.slug);
	}
	const backlinkIndex = invertBacklinks(outboundMap);
	for (const list of Object.values(backlinkIndex)) {
		for (const entry of list) {
			entry.title = articles[entry.slug] || entry.slug;
		}
	}
	const backlinks = {
		generatedAt: new Date().toISOString(),
		backlinks: backlinkIndex,
		outbound: outboundMap,
	};

	// 3. 维护巡检报告
	const maintenance = buildMaintenanceReport({
		posts,
		backlinkIndex,
		outboundMap,
		historyMap,
		qualityMatrix,
		qualityReports,
	});

	const outputs = [
		["recent-changes.json", recentChanges],
		["backlinks.json", backlinks],
		["maintenance.json", maintenance],
	];
	for (const [name, payload] of outputs) {
		const serialized = JSON.stringify(payload, null, 2);
		fs.writeFileSync(path.join(DATA_DIR, name), serialized);
		fs.writeFileSync(path.join(PUBLIC_API_DIR, name), serialized);
	}

	if (verbose) {
		const s = maintenance.stats;
		console.log(
			`\n✨ [Wiki Special] 特殊页面索引生成完毕！耗时 ${Date.now() - startTime}ms 喵！` +
				`\n📡 最近更改流: ${recentChanges.totalEntries} 条修订 / ${Object.keys(articles).length} 篇条目` +
				`\n🔗 反链索引: ${Object.keys(backlinkIndex).length} 篇条目存在链入` +
				`\n🛠️ 维护巡检: 孤立 ${s.totalOrphans} · 断头路 ${s.totalDeadEnds} · 过时 ${s.totalStale} · 低质 ${s.totalLowQuality} · 死链 ${s.totalBrokenLinks}` +
				`\n📦 数据已沉淀至 src/data/wiki/ 与 public/api/wiki/ 喵呜~\n`,
		);
	}

	return { recentChanges, backlinks, maintenance };
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	runWikiSpecialGeneration();
}
