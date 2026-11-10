/**
 * 漫画板块纯函数核心库（无运行时平台耦合）
 * 同时服务于：
 * - scripts/import-comic.mjs（数据导入与校验）
 * - src/utils/comic-utils.ts（Astro 页面静态生成）
 * - src/components/comic/*.svelte（前端筛选、分卷、路径构建）
 * - tests/comic.test.mjs（Node 原生单元测试）
 */

/**
 * RFC-4180 兼容 CSV 解析器（自动剔除 UTF-8 BOM）
 * @param {string} text
 * @returns {Array<Record<string, string>>}
 */
export function parseCsvRecords(text) {
	if (typeof text !== "string" || !text.trim()) return [];
	const clean = text.replace(/^﻿/, "");
	/** @type {string[][]} */
	const rows = [];
	/** @type {string[]} */
	let currentRow = [];
	let currentField = "";
	let inQuotes = false;

	for (let i = 0; i < clean.length; i++) {
		const ch = clean[i];
		if (inQuotes) {
			if (ch === '"' && clean[i + 1] === '"') {
				currentField += '"';
				i++;
			} else if (ch === '"') {
				inQuotes = false;
			} else {
				currentField += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === ",") {
			currentRow.push(currentField);
			currentField = "";
		} else if (ch === "\n") {
			currentRow.push(currentField);
			rows.push(currentRow);
			currentRow = [];
			currentField = "";
		} else if (ch !== "\r") {
			currentField += ch;
		}
	}

	if (currentField.length > 0 || currentRow.length > 0) {
		currentRow.push(currentField);
		rows.push(currentRow);
	}

	if (rows.length < 2) return [];
	const headers = rows[0].map((h) => h.trim());
	/** @type {Array<Record<string, string>>} */
	const records = [];

	for (let r = 1; r < rows.length; r++) {
		const row = rows[r];
		if (row.length === 1 && row[0].trim() === "") continue;
		/** @type {Record<string, string>} */
		const record = {};
		for (let c = 0; c < headers.length; c++) {
			const key = headers[c];
			if (key) {
				record[key] = row[c] ?? "";
			}
		}
		records.push(record);
	}

	return records;
}

/**
 * 将章节序号格式化为固定 4 位 ASCII slug（如 1 -> "0001"）
 * @param {number | string} chapterIndex
 * @returns {string}
 */
export function padChapterSlug(chapterIndex) {
	const num = Number.parseInt(String(chapterIndex), 10);
	if (!Number.isFinite(num) || num < 0) {
		return "0000";
	}
	return String(num).padStart(4, "0");
}

/**
 * 将页码格式化为标准文件名（如 1 -> "page-0001.webp"）
 * @param {number | string} pageNumber
 * @param {string} [ext="webp"]
 * @returns {string}
 */
export function padPageFilename(pageNumber, ext = "webp") {
	const num = Number.parseInt(String(pageNumber), 10);
	const safeNum = Number.isFinite(num) && num > 0 ? num : 1;
	const cleanExt = String(ext || "webp")
		.toLowerCase()
		.replace(/^\.+/, "");
	return `page-${String(safeNum).padStart(4, "0")}.${cleanExt || "webp"}`;
}

/**
 * 构建漫画单页本地静态 URL
 * @param {string} comicSlug
 * @param {string} chapterSlug
 * @param {string} filename
 * @returns {string}
 */
export function buildLocalComicImagePath(comicSlug, chapterSlug, filename) {
	return `/comics/${comicSlug}/chapters/${chapterSlug}/${filename}`;
}

/**
 * 校验图片或来源 URL 是否安全（仅允许 http(s) 与站内根相对路径）
 * @param {unknown} rawUrl
 * @returns {string}
 */
export function sanitizeComicUrl(rawUrl) {
	if (typeof rawUrl !== "string") return "";
	const trimmed = rawUrl.trim();
	if (!trimmed) return "";
	if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
		return trimmed;
	}
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol === "https:" || parsed.protocol === "http:") {
			return trimmed;
		}
	} catch {
		return "";
	}
	return "";
}

/**
 * 根据章节标题与页数识别章节类别：正篇 (main) / 番外 (extra) / 公告休刊 (notice)
 * @param {string} title
 * @param {number} [pageCount=0]
 * @returns {"main" | "extra" | "notice"}
 */
export function classifyComicChapter(title, pageCount = 0) {
	const text = String(title || "").trim();
	if (!text) return "main";

	const isNoticeTitle =
		/(休刊|延迟|公告|通知|请假|病假|停更|致歉|声明|重要提示|动画PV|抽奖|携程旅拍|天窗)/.test(
			text,
		);
	if (isNoticeTitle && pageCount <= 6) {
		return "notice";
	}
	// 纯短公告（不含章节编号、且页数 <= 3）
	if (
		pageCount > 0 &&
		pageCount <= 3 &&
		!/(^\d+|总第?\d+|第\d+回|第\d+话)/.test(text)
	) {
		return "notice";
	}

	if (/(番外|小剧场|彩蛋|KFC|美年达|唯品会|果粒奶优|博物馆)/.test(text)) {
		return "extra";
	}

	return "main";
}

/**
 * 格式化文件体积为可读字符串
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
	const value = Number(bytes);
	if (!Number.isFinite(value) || value <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const idx = Math.min(
		Math.floor(Math.log(value) / Math.log(1024)),
		units.length - 1,
	);
	const scaled = value / 1024 ** idx;
	return `${scaled >= 100 || idx === 0 ? scaled.toFixed(0) : scaled.toFixed(2)} ${units[idx]}`;
}

/**
 * 过滤并排序章节列表
 * @template {{ index: number, slug: string, title: string, kind: string }} T
 * @param {T[]} chapters
 * @param {{ keyword?: string, kind?: string, sort?: "asc" | "desc" }} [options]
 * @returns {T[]}
 */
export function filterAndSortChapters(chapters, options = {}) {
	const list = Array.isArray(chapters) ? chapters : [];
	const keyword = String(options.keyword || "")
		.trim()
		.toLowerCase();
	const kind = options.kind && options.kind !== "all" ? options.kind : null;
	const sort = options.sort === "desc" ? "desc" : "asc";

	const filtered = list.filter((ch) => {
		if (kind && ch.kind !== kind) return false;
		if (keyword) {
			const matchTitle = ch.title.toLowerCase().includes(keyword);
			const matchIndex = String(ch.index).includes(keyword);
			const matchSlug = ch.slug.toLowerCase().includes(keyword);
			if (!matchTitle && !matchIndex && !matchSlug) return false;
		}
		return true;
	});

	return filtered.slice().sort((a, b) => {
		return sort === "desc" ? b.index - a.index : a.index - b.index;
	});
}

/**
 * 按区间分卷（每 chunkSize 话一组），便于 700+ 话高效跳转
 * @template {{ index: number }} T
 * @param {T[]} chapters
 * @param {number} [chunkSize=100]
 * @returns {Array<{ id: string, label: string, startIndex: number, endIndex: number, chapters: T[] }>}
 */
export function groupChaptersByRange(chapters, chunkSize = 100) {
	const list = Array.isArray(chapters) ? chapters : [];
	if (list.length === 0) return [];
	const size = Math.max(10, Number(chunkSize) || 100);
	const sortedAsc = list.slice().sort((a, b) => a.index - b.index);
	/** @type {Map<number, T[]>} */
	const buckets = new Map();

	for (const item of sortedAsc) {
		const bucketIdx = Math.floor((Math.max(1, item.index) - 1) / size);
		const arr = buckets.get(bucketIdx);
		if (arr) {
			arr.push(item);
		} else {
			buckets.set(bucketIdx, [item]);
		}
	}

	return Array.from(buckets.entries())
		.sort((a, b) => a[0] - b[0])
		.map(([bucketIdx, items]) => {
			const startIndex = bucketIdx * size + 1;
			const endIndex = Math.max(
				startIndex,
				items[items.length - 1]?.index ?? (bucketIdx + 1) * size,
			);
			const rangeEnd = Math.max((bucketIdx + 1) * size, endIndex);
			const displayEnd = Math.min(
				rangeEnd,
				items[items.length - 1]?.index ?? rangeEnd,
			);
			return {
				id: `range-${startIndex}-${displayEnd}`,
				label: `${startIndex} - ${displayEnd} 话`,
				startIndex,
				endIndex: displayEnd,
				chapters: items,
			};
		});
}

/**
 * 格式化章节号标签（自动处理未编号话或带“第/总”前缀标题）
 * @param {{ index: number, title: string }} chapter
 * @returns {string}
 */
export function formatChapterLabel(chapter) {
	if (!chapter) return "";
	const seq = String(chapter.index).padStart(3, "0");
	return `#${seq} · ${chapter.title}`;
}
