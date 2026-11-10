import fs from "node:fs";
import path from "node:path";
import type {
	ComicChapterDetail,
	ComicChapterSummary,
	ComicSeriesIndex,
	ComicSeriesManifest,
	ComicSeriesMeta,
} from "../types/comic";
import {
	buildLocalComicImagePath,
	classifyComicChapter,
	filterAndSortChapters,
	formatBytes,
	formatChapterLabel,
	groupChaptersByRange,
	padChapterSlug,
	padPageFilename,
	parseCsvRecords,
	resolveComicImageUrl,
	sanitizeComicUrl,
} from "./comic-core.mjs";

export {
	buildLocalComicImagePath,
	classifyComicChapter,
	filterAndSortChapters,
	formatBytes,
	formatChapterLabel,
	groupChaptersByRange,
	padChapterSlug,
	padPageFilename,
	parseCsvRecords,
	sanitizeComicUrl,
};

const COMICS_DATA_DIR = path.resolve(process.cwd(), "src/data/comics");

function resolveImageMeta(meta: ComicSeriesMeta): ComicSeriesMeta {
	return {
		...meta,
		cover: resolveComicImageUrl(meta.cover, meta.imageBaseUrl),
		...(meta.banner
			? { banner: resolveComicImageUrl(meta.banner, meta.imageBaseUrl) }
			: {}),
	};
}

/**
 * 读取漫画书架总目录（构建时服务端读取）
 */
export function getComicCatalog(): ComicSeriesMeta[] {
	const catalogPath = path.join(COMICS_DATA_DIR, "catalog.json");
	if (!fs.existsSync(catalogPath)) return [];
	try {
		const raw = fs.readFileSync(catalogPath, "utf-8");
		const parsed = JSON.parse(raw) as ComicSeriesMeta[];
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map(resolveImageMeta)
			.sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
	} catch (error) {
		console.warn("[comic-utils] 读取 catalog.json 失败:", error);
		return [];
	}
}

/**
 * 读取指定漫画的轻量索引（元数据 + 章节概要列表，不含每页明细）
 */
export function getComicIndex(slug: string): ComicSeriesIndex | null {
	if (!slug) return null;
	const indexPath = path.join(COMICS_DATA_DIR, slug, "index.json");
	if (!fs.existsSync(indexPath)) return null;
	try {
		const raw = fs.readFileSync(indexPath, "utf-8");
		const index = JSON.parse(raw) as ComicSeriesIndex;
		return { ...index, meta: resolveImageMeta(index.meta) };
	} catch (error) {
		console.warn(`[comic-utils] 读取漫画索引失败 (${slug}):`, error);
		return null;
	}
}

/**
 * 读取指定漫画的完整清单（包含每一话的全部页数据，仅用于 SSG 静态路径生成）
 */
export function getComicManifest(slug: string): ComicSeriesManifest | null {
	if (!slug) return null;
	const manifestPath = path.join(COMICS_DATA_DIR, slug, "manifest.json");
	if (!fs.existsSync(manifestPath)) return null;
	try {
		const raw = fs.readFileSync(manifestPath, "utf-8");
		const manifest = JSON.parse(raw) as ComicSeriesManifest;
		return {
			...manifest,
			meta: resolveImageMeta(manifest.meta),
			chapters: manifest.chapters.map((chapter) => ({
				...chapter,
				pages: chapter.pages.map((page) => ({
					...page,
					src: resolveComicImageUrl(page.src, manifest.meta.imageBaseUrl),
				})),
			})),
		};
	} catch (error) {
		console.warn(`[comic-utils] 读取漫画完整清单失败 (${slug}):`, error);
		return null;
	}
}

/**
 * 获取单话上下文（当前话详情 + 前后话轻量索引，避免冗余数据注入 HTML）
 */
export function getComicChapterContext(
	manifest: ComicSeriesManifest,
	chapterSlug: string,
): {
	chapter: ComicChapterDetail | null;
	prevChapter: ComicChapterSummary | null;
	nextChapter: ComicChapterSummary | null;
} {
	const idx = manifest.chapters.findIndex((c) => c.slug === chapterSlug);
	if (idx === -1) {
		return { chapter: null, prevChapter: null, nextChapter: null };
	}
	const chapter = manifest.chapters[idx];
	const toSummary = (
		item: ComicChapterDetail | undefined,
	): ComicChapterSummary | null => {
		if (!item) return null;
		return {
			index: item.index,
			slug: item.slug,
			title: item.title,
			kind: item.kind,
			pageCount: item.pageCount,
		};
	};
	return {
		chapter,
		prevChapter: toSummary(manifest.chapters[idx - 1]),
		nextChapter: toSummary(manifest.chapters[idx + 1]),
	};
}
