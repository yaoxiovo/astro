#!/usr/bin/env node

/**
 * 漫画数据集导入工具 (Comic Importer)
 *
 * 将 kk-image-check / 结构化漫画下载目录导入到 Astro 静态站点中：
 * 1. 读取 _reports/chapters.csv 与 _reports/downloads.csv（完整校验无缺失）
 * 2. 以硬链接（同盘零额外占用，跨盘自动回退 copy）方式组织至纯净 ASCII 路径：
 *    public/comics/<slug>/chapters/<0001>/page-<0001>.webp
 * 3. 提取封面图 (cover.webp) 与横幅图 (banner.webp)
 * 4. 生成构建与前端所需数据清单：
 *    - src/data/comics/catalog.json
 *    - src/data/comics/<slug>/index.json
 *    - src/data/comics/<slug>/manifest.json
 *    - public/api/comics/<slug>/chapters.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildLocalComicImagePath,
	classifyComicChapter,
	formatBytes,
	padChapterSlug,
	padPageFilename,
	parseCsvRecords,
	sanitizeComicUrl,
} from "../src/utils/comic-core.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

function parseCliArgs(argv) {
	/** @type {Record<string, string | boolean>} */
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith("--")) continue;
		const eqIdx = token.indexOf("=");
		if (eqIdx !== -1) {
			const key = token.slice(2, eqIdx);
			const val = token.slice(eqIdx + 1);
			args[key] = val;
		} else {
			const key = token.slice(2);
			const next = argv[i + 1];
			if (next && !next.startsWith("--")) {
				args[key] = next;
				i++;
			} else {
				args[key] = true;
			}
		}
	}
	return args;
}

/**
 * 硬链接文件（同文件系统零占用），若目标已指向同一 inode 则跳过，跨盘自动降级复制
 */
function linkOrCopyFile(srcPath, destPath, forceCopy = false) {
	fs.mkdirSync(path.dirname(destPath), { recursive: true });
	const srcStat = fs.statSync(srcPath);

	if (fs.existsSync(destPath)) {
		const destStat = fs.statSync(destPath);
		if (
			!forceCopy &&
			srcStat.ino === destStat.ino &&
			srcStat.dev === destStat.dev
		) {
			return "skipped";
		}
		if (
			forceCopy &&
			srcStat.size === destStat.size &&
			Math.abs(srcStat.mtimeMs - destStat.mtimeMs) < 1000
		) {
			return "skipped";
		}
		fs.unlinkSync(destPath);
	}

	if (!forceCopy) {
		try {
			fs.linkSync(srcPath, destPath);
			return "linked";
		} catch (err) {
			if (
				err &&
				typeof err === "object" &&
				"code" in err &&
				err.code !== "EXDEV" &&
				err.code !== "EPERM"
			) {
				throw err;
			}
		}
	}

	fs.copyFileSync(srcPath, destPath);
	return "copied";
}

function getLatestDateFromSource(srcDir) {
	const summaryPath = path.join(srcDir, "_reports/download_summary.json");
	if (fs.existsSync(summaryPath)) {
		const stat = fs.statSync(summaryPath);
		return stat.mtime.toISOString().slice(0, 10);
	}
	return new Date().toISOString().slice(0, 10);
}

export function importComicDataset(options = {}) {
	const srcDir = path.resolve(
		String(options.src || "/root/kk-image-check/狐妖小红娘"),
	);
	const slug = String(options.slug || "huyao-xiaohongniang")
		.trim()
		.toLowerCase();
	const forceCopy = Boolean(options.copy);
	const dryRun = Boolean(options.dryRun);

	if (!fs.existsSync(srcDir)) {
		throw new Error(`源漫画目录不存在: ${srcDir}`);
	}

	const chaptersCsvPath = path.join(srcDir, "_reports/chapters.csv");
	const downloadsCsvPath = path.join(srcDir, "_reports/downloads.csv");
	if (!fs.existsSync(chaptersCsvPath) || !fs.existsSync(downloadsCsvPath)) {
		throw new Error(`缺少 _reports/chapters.csv 或 downloads.csv: ${srcDir}`);
	}

	const chapterRows = parseCsvRecords(
		fs.readFileSync(chaptersCsvPath, "utf-8"),
	);
	const downloadRows = parseCsvRecords(
		fs.readFileSync(downloadsCsvPath, "utf-8"),
	);

	if (chapterRows.length === 0 || downloadRows.length === 0) {
		throw new Error("CSV 数据为空，无法导入");
	}

	/** @type {Map<number, Array<{ page: number, width: number, height: number, bytes: number, ext: string, srcFile: string, fallbackUrl: string, sha256: string }>>} */
	const pagesByChapter = new Map();

	for (const row of downloadRows) {
		const chapterIndex = Number.parseInt(row.chapter_index || "", 10);
		const pageNum = Number.parseInt(row.page || "", 10);
		const width = Number.parseInt(row.width || "", 10);
		const height = Number.parseInt(row.height || "", 10);
		const bytes = Number.parseInt(row.bytes || "0", 10);
		const success = String(row.success || "").toLowerCase() === "true";

		if (
			!success ||
			!Number.isFinite(chapterIndex) ||
			!Number.isFinite(pageNum)
		) {
			continue;
		}
		if (
			!Number.isFinite(width) ||
			width <= 0 ||
			!Number.isFinite(height) ||
			height <= 0
		) {
			throw new Error(`图片尺寸异常: chapter=${chapterIndex}, page=${pageNum}`);
		}

		const srcFile =
			row.file && fs.existsSync(row.file)
				? row.file
				: path.resolve(srcDir, row.file || "");
		if (!fs.existsSync(srcFile)) {
			throw new Error(`图片源文件不存在: ${srcFile}`);
		}

		const ext = (row.format || path.extname(srcFile).slice(1) || "webp")
			.toLowerCase()
			.replace(/[^a-z0-9]/g, "");
		const fallbackUrl = sanitizeComicUrl(row.url);

		const list = pagesByChapter.get(chapterIndex) || [];
		list.push({
			page: pageNum,
			width,
			height,
			bytes:
				Number.isFinite(bytes) && bytes > 0 ? bytes : fs.statSync(srcFile).size,
			ext: ext || "webp",
			srcFile,
			fallbackUrl,
			sha256: (row.sha256 || "").trim(),
		});
		pagesByChapter.set(chapterIndex, list);
	}

	const publicComicDir = path.join(ROOT_DIR, "public/comics", slug);
	const dataDir = path.join(ROOT_DIR, "src/data/comics");
	const comicDataDir = path.join(dataDir, slug);
	const publicApiDir = path.join(ROOT_DIR, "public/api/comics", slug);

	let linkedCount = 0;
	let copiedCount = 0;
	let skippedCount = 0;
	let totalBytes = 0;
	let totalPages = 0;
	let mainChapters = 0;
	let extraChapters = 0;
	let noticeChapters = 0;

	/** @type {import("../src/types/comic").ComicChapterDetail[]} */
	const detailedChapters = [];
	/** @type {import("../src/types/comic").ComicChapterSummary[]} */
	const summaryChapters = [];

	const sortedChapterRows = chapterRows
		.map((r) => ({
			index: Number.parseInt(r.chapter_index || "", 10),
			title: (r.chapter_title || "").trim(),
			sourceUrl: sanitizeComicUrl(r.chapter_url),
		}))
		.filter((c) => Number.isFinite(c.index) && c.index > 0)
		.sort((a, b) => a.index - b.index);

	for (const ch of sortedChapterRows) {
		const rawPages = (pagesByChapter.get(ch.index) || []).sort(
			(a, b) => a.page - b.page,
		);
		if (rawPages.length === 0) {
			throw new Error(`章节缺少有效图片页: #${ch.index} ${ch.title}`);
		}

		const chapterSlug = padChapterSlug(ch.index);
		const kind = classifyComicChapter(ch.title, rawPages.length);
		if (kind === "main") mainChapters++;
		else if (kind === "extra") extraChapters++;
		else noticeChapters++;

		/** @type {import("../src/types/comic").ComicPage[]} */
		const pages = [];
		for (const p of rawPages) {
			const filename = padPageFilename(p.page, p.ext);
			const destFile = path.join(
				publicComicDir,
				"chapters",
				chapterSlug,
				filename,
			);
			if (!dryRun) {
				const action = linkOrCopyFile(p.srcFile, destFile, forceCopy);
				if (action === "linked") linkedCount++;
				else if (action === "copied") copiedCount++;
				else skippedCount++;
			}

			totalBytes += p.bytes;
			totalPages++;

			pages.push({
				page: p.page,
				width: p.width,
				height: p.height,
				src: buildLocalComicImagePath(slug, chapterSlug, filename),
				...(p.fallbackUrl ? { fallbackUrl: p.fallbackUrl } : {}),
				bytes: p.bytes,
				...(p.sha256 ? { sha256: p.sha256 } : {}),
			});
		}

		const summary = {
			index: ch.index,
			slug: chapterSlug,
			title: ch.title || `第 ${ch.index} 话`,
			kind,
			pageCount: pages.length,
			...(ch.sourceUrl ? { sourceUrl: ch.sourceUrl } : {}),
		};
		summaryChapters.push(summary);
		detailedChapters.push({
			...summary,
			pages,
		});
	}

	// 挑选封面与横幅图（优先指定章节与页码，默认第 2 话第 1 页作封面、第 1 话第 1 页作横幅）
	const coverChapterIdx = Number.parseInt(
		String(options.coverChapter || 2),
		10,
	);
	const coverPageNum = Number.parseInt(String(options.coverPage || 1), 10);
	const bannerChapterIdx = Number.parseInt(
		String(options.bannerChapter || 1),
		10,
	);
	const bannerPageNum = Number.parseInt(String(options.bannerPage || 1), 10);

	const pickSourcePage = (chIdx, pNum) => {
		const list = pagesByChapter.get(chIdx) || pagesByChapter.get(1) || [];
		return list.find((it) => it.page === pNum) || list[0] || null;
	};

	const coverSource = pickSourcePage(coverChapterIdx, coverPageNum);
	const bannerSource = pickSourcePage(bannerChapterIdx, bannerPageNum);

	if (!dryRun) {
		fs.mkdirSync(publicComicDir, { recursive: true });
		if (coverSource) {
			fs.copyFileSync(
				coverSource.srcFile,
				path.join(publicComicDir, "cover.webp"),
			);
		}
		if (bannerSource) {
			fs.copyFileSync(
				bannerSource.srcFile,
				path.join(publicComicDir, "banner.webp"),
			);
		}
	}

	const tags = options.tags
		? String(options.tags)
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean)
		: ["国漫经典", "纯爱玄幻", "全彩条漫", "转世续缘"];

	/** @type {import("../src/types/comic").ComicSeriesMeta} */
	const meta = {
		slug,
		title: String(options.title || "狐妖小红娘"),
		subtitle: String(options.subtitle || "Fox Spirit Matchmaker"),
		author: String(options.author || "小新（编绘）/ 盘丝大仙（后期主笔）"),
		studio: String(options.studio || "腾讯动漫 · 夏天岛工作室"),
		status: /** @type {"ongoing" | "completed" | "hiatus"} */ (
			options.status || "ongoing"
		),
		category: String(options.category || "玄幻恋爱"),
		tags,
		description: String(
			options.description ||
				"根据古典小说记载，世上有人有妖，妖会与人相恋。妖寿命千万年，人的寿命有限；人会投胎转世，但投胎以后不记得上辈子的爱。痴情的妖便会前往涂山向狐妖“购买”转世续缘之术，令转世后的恋人回忆起前世记忆。全彩典藏版完整收录全篇正传、番外剧场与创作公告。",
		),
		cover: `/comics/${slug}/cover.webp`,
		...(coverSource?.fallbackUrl
			? { coverFallback: coverSource.fallbackUrl }
			: {}),
		banner: `/comics/${slug}/banner.webp`,
		...(bannerSource?.fallbackUrl
			? { bannerFallback: bannerSource.fallbackUrl }
			: {}),
		totalChapters: summaryChapters.length,
		mainChapters,
		extraChapters,
		noticeChapters,
		totalPages,
		totalBytes,
		updatedAt: String(options.updatedAt || getLatestDateFromSource(srcDir)),
		source: "kkwebtoon 全彩条漫典藏镜像",
		order: Number.parseInt(String(options.order || 100), 10) || 100,
	};

	if (!dryRun) {
		fs.mkdirSync(comicDataDir, { recursive: true });
		fs.mkdirSync(publicApiDir, { recursive: true });

		// 1. 更新书架总目录 catalog.json（保留其他已收录漫画）
		const catalogPath = path.join(dataDir, "catalog.json");
		/** @type {import("../src/types/comic").ComicSeriesMeta[]} */
		let catalog = [];
		if (fs.existsSync(catalogPath)) {
			try {
				const prev = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
				if (Array.isArray(prev)) catalog = prev;
			} catch {
				catalog = [];
			}
		}
		const nextCatalog = catalog.filter((item) => item.slug !== slug);
		nextCatalog.push(meta);
		nextCatalog.sort((a, b) => (b.order ?? 0) - (a.order ?? 0));

		fs.writeFileSync(
			catalogPath,
			`${JSON.stringify(nextCatalog, null, 2)}\n`,
			"utf-8",
		);

		// 2. 轻量章节目录索引（供目录页和阅读器按需请求）
		const indexPayload = { meta, chapters: summaryChapters };
		fs.writeFileSync(
			path.join(comicDataDir, "index.json"),
			`${JSON.stringify(indexPayload, null, 2)}\n`,
			"utf-8",
		);
		fs.writeFileSync(
			path.join(publicApiDir, "chapters.json"),
			JSON.stringify(indexPayload),
			"utf-8",
		);

		// 3. 完整逐页清单（供 Astro SSG 构建全量阅读页）
		const manifestPayload = { meta, chapters: detailedChapters };
		fs.writeFileSync(
			path.join(comicDataDir, "manifest.json"),
			JSON.stringify(manifestPayload),
			"utf-8",
		);
	}

	return {
		slug,
		title: meta.title,
		totalChapters: summaryChapters.length,
		mainChapters,
		extraChapters,
		noticeChapters,
		totalPages,
		totalBytes,
		linkedCount,
		copiedCount,
		skippedCount,
		dryRun,
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
	const cli = parseCliArgs(process.argv.slice(2));
	const summary = importComicDataset({
		src: typeof cli.src === "string" ? cli.src : undefined,
		slug: typeof cli.slug === "string" ? cli.slug : undefined,
		title: typeof cli.title === "string" ? cli.title : undefined,
		subtitle: typeof cli.subtitle === "string" ? cli.subtitle : undefined,
		author: typeof cli.author === "string" ? cli.author : undefined,
		studio: typeof cli.studio === "string" ? cli.studio : undefined,
		status: typeof cli.status === "string" ? cli.status : undefined,
		category: typeof cli.category === "string" ? cli.category : undefined,
		tags: typeof cli.tags === "string" ? cli.tags : undefined,
		description:
			typeof cli.description === "string" ? cli.description : undefined,
		coverChapter:
			typeof cli["cover-chapter"] === "string"
				? cli["cover-chapter"]
				: undefined,
		coverPage:
			typeof cli["cover-page"] === "string" ? cli["cover-page"] : undefined,
		bannerChapter:
			typeof cli["banner-chapter"] === "string"
				? cli["banner-chapter"]
				: undefined,
		bannerPage:
			typeof cli["banner-page"] === "string" ? cli["banner-page"] : undefined,
		updatedAt:
			typeof cli["updated-at"] === "string" ? cli["updated-at"] : undefined,
		order: typeof cli.order === "string" ? cli.order : undefined,
		copy: Boolean(cli.copy),
		dryRun: Boolean(cli["dry-run"]),
	});

	console.log(
		`[import-comic] 导入完成: 《${summary.title}》 (${summary.slug})`,
	);
	console.log(
		`  章节统计: 共 ${summary.totalChapters} 话（正篇 ${summary.mainChapters} / 番外 ${summary.extraChapters} / 公告 ${summary.noticeChapters}）`,
	);
	console.log(
		`  页面资源: ${summary.totalPages} 页 (${formatBytes(summary.totalBytes)})`,
	);
	console.log(
		`  文件落盘: 硬链接 ${summary.linkedCount} / 复制 ${summary.copiedCount} / 复用 ${summary.skippedCount}`,
	);
}
