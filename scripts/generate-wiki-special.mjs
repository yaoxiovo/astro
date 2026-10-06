#!/usr/bin/env node

/**
 * 维基百科式特殊页面索引生成器 (Special Pages Indexer)
 * 工业级全站索引管线，产出五类数据集：
 * 1. recent-changes.json   —— 全站最近更改流 (Special:RecentChanges)
 * 2. backlinks.json        —— 全站内链反链索引 (What links here / 链入页面)
 * 3. maintenance.json      —— 条目维护巡检报告 (孤立条目/断头路/过时/低质/死链)
 * 4. related.json          —— 相关文章推荐（内链邻居余弦 + 标签 ×0.3 降权项）
 * 5. link-suggestions.json —— 补链雷达（正文中未建立链接的标题/副标题提及扫描）
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

const CJK_CHAR_RE = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g;
const ASCII_WORD_CHAR_RE = /[A-Za-z0-9_]/;
// 标签相似度整体降权系数，保证内链信号优先级高于标签信号
const TAG_SIGNAL_WEIGHT = 0.3;

function isAsciiWordChar(ch) {
	return ch !== undefined && ASCII_WORD_CHAR_RE.test(ch);
}

/**
 * 标题是否适合作为补链扫描目标（中文 ≥2 字 / 纯 ASCII ≥4 字符，过滤过短噪音）
 */
function isSuggestableTitle(title) {
	const compact = title.trim();
	if (!compact) return false;
	const cjkCount = (compact.match(CJK_CHAR_RE) || []).length;
	if (cjkCount > 0) return cjkCount >= 2;
	return compact.length >= 4;
}

/**
 * 标题匹配变体：完整标题 + 冒号/破折号分段（剥离「开发日志：」类副标题前缀后
 * 的核心短语）。仅返回通过可扫描性检查的变体；通用短语的跨条目歧义由调用方
 * 通过归属表去重处理。
 */
function buildTitleVariants(title) {
	const trimmed = title.trim();
	const variants = new Set();
	if (isSuggestableTitle(trimmed)) variants.add(trimmed);
	for (const part of trimmed.split(/[：:—–]{1,2}/)) {
		const segment = part.trim();
		if (segment && segment !== trimmed && isSuggestableTitle(segment)) {
			variants.add(segment);
		}
	}
	return Array.from(variants);
}

/**
 * 生成与原文等长的扫描掩码：frontmatter、围栏代码、行内代码、链接/图片语法与
 * HTML 标签区域替换为空格（保留换行），避免在语法结构内误报「未链接提及」
 */
export function buildScanMask(markdown) {
	const chars = markdown.split("");
	const maskRange = (start, end) => {
		const limit = Math.min(end, chars.length);
		for (let i = start; i < limit; i++) {
			if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
		}
	};
	const fm = markdown.match(/^---\r?\n[\s\S]*?\r?\n---/);
	if (fm) maskRange(0, fm[0].length);
	const patterns = [
		/```[\s\S]*?```/g,
		/~~~[\s\S]*?~~~/g,
		/`[^`\n]*`/g,
		/!?\[[^\]]*\]\([^)]*\)/g,
		/<[^>]+>/g,
	];
	for (const pattern of patterns) {
		pattern.lastIndex = 0;
		let match;
		while ((match = pattern.exec(markdown)) !== null) {
			maskRange(match.index, match.index + match[0].length);
		}
	}
	return chars.join("");
}

function extractSnippet(raw, start, end, radius) {
	const from = Math.max(0, start - radius);
	const to = Math.min(raw.length, end + radius);
	const text = raw.slice(from, to).replace(/\s+/g, " ").trim();
	return `${from > 0 ? "…" : ""}${text}${to < raw.length ? "…" : ""}`;
}

/**
 * 补链雷达：扫描已发布文章正文中「提到其他条目标题但未建立站内链接」的位置。
 * 匹配键为完整标题及其副标题变体；同一键归属多篇条目（如通用「开发日志」前缀）
 * 时判为歧义弃用。加密正文作为来源整体排除（样本不得外泄）。
 */
export function computeLinkSuggestions({
	posts,
	outboundMap,
	maxSamples = 2,
	sampleRadius = 36,
}) {
	const targetPool = posts.filter((p) => !p.draft);
	const sourcePool = posts.filter((p) => !p.draft && !p.encrypted);

	const keyOwners = new Map();
	const fullTitles = new Map();
	for (const post of targetPool) {
		if (!post.title) continue;
		fullTitles.set(post.slug, post.title);
		for (const variant of buildTitleVariants(post.title)) {
			keyOwners.set(variant, keyOwners.has(variant) ? null : post.slug);
		}
	}
	const titleEntries = Array.from(keyOwners, ([key, slug]) => ({ key, slug })).filter(
		(entry) => entry.slug,
	);

	const suggestions = {};
	const articles = {};
	let totalSuggestions = 0;
	let totalMentions = 0;

	for (const source of sourcePool) {
		const mask = buildScanMask(source.raw);
		const alreadyLinked = new Set((outboundMap[source.slug] || []).map((l) => l.slug));
		const matches = [];
		for (const { key, slug } of titleEntries) {
			if (slug === source.slug || alreadyLinked.has(slug)) continue;
			let idx = mask.indexOf(key);
			while (idx !== -1) {
				const end = idx + key.length;
				const leftOk = !isAsciiWordChar(key[0]) || !isAsciiWordChar(mask[idx - 1]);
				const rightOk =
					!isAsciiWordChar(key[key.length - 1]) || !isAsciiWordChar(mask[end]);
				if (leftOk && rightOk) matches.push({ start: idx, end, slug, key });
				idx = mask.indexOf(key, idx + 1);
			}
		}
		if (!matches.length) continue;

		// 重叠匹配最长优先（如短标题是长标题前缀时保留长标题）
		matches.sort((a, b) => a.start - b.start || b.end - a.end);
		const kept = [];
		let cursor = -1;
		for (const match of matches) {
			if (match.start >= cursor) {
				kept.push(match);
				cursor = match.end;
			}
		}

		const byTarget = new Map();
		for (const match of kept) {
			if (!byTarget.has(match.slug)) {
				byTarget.set(match.slug, {
					slug: match.slug,
					title: fullTitles.get(match.slug) || match.key,
					count: 0,
					samples: [],
				});
			}
			const entry = byTarget.get(match.slug);
			entry.count++;
			if (entry.samples.length < maxSamples) {
				entry.samples.push(
					extractSnippet(source.raw, match.start, match.end, sampleRadius),
				);
			}
		}

		const list = Array.from(byTarget.values()).sort(
			(a, b) => b.count - a.count || a.slug.localeCompare(b.slug),
		);
		suggestions[source.slug] = list;
		articles[source.slug] = source.title;
		totalSuggestions += list.length;
		for (const item of list) totalMentions += item.count;
	}

	return {
		generatedAt: new Date().toISOString(),
		stats: {
			totalArticles: Object.keys(suggestions).length,
			totalSuggestions,
			totalMentions,
		},
		articles,
		suggestions,
	};
}

/**
 * 相关文章推荐：基于「出链目标 + 链入来源」内链邻居集合的余弦相似度，
 * 叠加标签相似度 ×0.3 降权项。内链语料稀疏时标签兜底，但仍要求至少
 * 存在 1 个共同邻居或 1 个共同标签，避免全站两两配对噪音。
 */
export function computeRelatedArticles({
	posts,
	outboundMap,
	backlinkIndex,
	topN = 5,
	minScore = 0.05,
}) {
	const pool = posts.filter((p) => !p.draft);
	const features = new Map();
	for (const post of pool) {
		const links = new Set();
		for (const l of outboundMap[post.slug] || []) links.add(`p:${l.slug}`);
		for (const b of backlinkIndex[post.slug] || []) links.add(`p:${b.slug}`);
		const tags = new Set((post.tags || []).map((t) => `t:${t}`));
		features.set(post.slug, { links, tags });
	}

	const related = {};
	for (const post of pool) {
		const self = features.get(post.slug);
		if (!self) continue;
		const candidates = [];
		for (const other of pool) {
			if (other.slug === post.slug) continue;
			const target = features.get(other.slug);
			if (!target) continue;
			let sharedPosts = 0;
			for (const item of target.links) {
				if (self.links.has(item)) sharedPosts++;
			}
			let sharedTags = 0;
			for (const item of target.tags) {
				if (self.tags.has(item)) sharedTags++;
			}
			if (sharedPosts === 0 && sharedTags === 0) continue;
			const linkScore =
				self.links.size > 0 && target.links.size > 0
					? sharedPosts / Math.sqrt(self.links.size * target.links.size)
					: 0;
			const tagScore =
				self.tags.size > 0 && target.tags.size > 0
					? sharedTags / Math.sqrt(self.tags.size * target.tags.size)
					: 0;
			const score = linkScore + TAG_SIGNAL_WEIGHT * tagScore;
			if (score < minScore) continue;
			candidates.push({
				slug: other.slug,
				title: other.title,
				score: Math.round(score * 1000) / 1000,
				sharedPosts,
				sharedTags,
			});
		}
		candidates.sort(
			(a, b) =>
				b.score - a.score ||
				b.sharedPosts - a.sharedPosts ||
				a.slug.localeCompare(b.slug),
		);
		const top = candidates.slice(0, topN);
		if (top.length) related[post.slug] = top;
	}

	return {
		generatedAt: new Date().toISOString(),
		topN,
		minScore,
		related,
	};
}

function parseFrontmatterList(frontmatter, key) {
	const lineMatch = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
	if (!lineMatch) return [];
	const inline = lineMatch[1].trim();
	if (inline.startsWith("[")) {
		return inline
			.replace(/^\[|\]$/g, "")
			.split(",")
			.map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
			.filter(Boolean);
	}
	if (inline) return [inline.replace(/^['"]|['"]$/g, "")];
	const items = [];
	const lines = frontmatter.split(/\r?\n/);
	const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*$`).test(line));
	if (start === -1) return [];
	for (let i = start + 1; i < lines.length; i++) {
		const itemMatch = lines[i].match(/^\s+-\s*(.+)$/);
		if (!itemMatch) break;
		items.push(itemMatch[1].trim().replace(/^['"]|['"]$/g, ""));
	}
	return items.filter(Boolean);
}

function loadPosts() {
	const files = fs
		.readdirSync(POSTS_DIR)
		.filter((f) => f.endsWith(".md") && !f.startsWith("."));
	return files.map((file) => {
		const slug = file.replace(/\.md$/, "");
		const raw = fs.readFileSync(path.join(POSTS_DIR, file), "utf-8");
		const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || "";
		let title = slug;
		const match = frontmatter.match(/^title:\s*(?:['"]?)(.*?)(?:['"]?)\s*$/m);
		if (match?.[1]) title = match[1].trim();
		return {
			slug,
			title,
			tags: parseFrontmatterList(frontmatter, "tags"),
			draft: /^draft:\s*true\s*$/m.test(frontmatter),
			encrypted: /^encrypted:\s*true\s*$/m.test(frontmatter),
			raw,
		};
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

	// 4. 相关文章推荐（内链图谱相似度）
	const related = computeRelatedArticles({ posts, outboundMap, backlinkIndex });

	// 5. 补链雷达（未链接提及扫描）
	const linkSuggestions = computeLinkSuggestions({ posts, outboundMap });

	const outputs = [
		["recent-changes.json", recentChanges],
		["backlinks.json", backlinks],
		["maintenance.json", maintenance],
		["related.json", related],
		["link-suggestions.json", linkSuggestions],
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
				`\n🧭 相关文章: ${Object.keys(related.related).length} 篇条目存在相关推荐` +
				`\n🪄 补链雷达: ${linkSuggestions.stats.totalArticles} 篇存在可补链接 · ${linkSuggestions.stats.totalSuggestions} 个目标 · ${linkSuggestions.stats.totalMentions} 处未链接提及` +
				`\n📦 数据已沉淀至 src/data/wiki/ 与 public/api/wiki/ 喵呜~\n`,
		);
	}

	return { recentChanges, backlinks, maintenance, related, linkSuggestions };
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	runWikiSpecialGeneration();
}
