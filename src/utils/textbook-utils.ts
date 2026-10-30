import { getCollection } from "astro:content";
import type { CollectionEntry } from "astro:content";
import type {
	DifficultyLevel,
	SubjectCategory,
	SubjectMeta,
	SubjectType,
	TextbookFilterOptions,
	TextbookFrontmatter,
	TextbookItem,
	TextbookStats,
	TextbookType,
} from "../types/textbook";
import {
	DEFAULT_FALLBACK_IMAGE,
	SUBJECT_METADATA_MAP,
	SUBJECT_METAS,
	calculateTextbookStats,
	getSubjectCategories as coreGetSubjectCategories,
	countTextbookWords,
	estimateTextbookReadingTime,
	extractAllTextbookTags,
	filterTextbooks,
	filterTextbooksBySubject,
	filterTextbooksByType,
	formatTextbookDate,
	getSubjectMeta,
	groupTextbooksBySubject,
	sortTextbooks,
	stripTextbookSlug,
	validateImageUrl,
	validateTextbookSchema,
} from "./textbook-core.mjs";

export {
	DEFAULT_FALLBACK_IMAGE,
	SUBJECT_METADATA_MAP,
	SUBJECT_METAS,
	calculateTextbookStats,
	countTextbookWords,
	estimateTextbookReadingTime,
	extractAllTextbookTags,
	filterTextbooks,
	filterTextbooksBySubject,
	filterTextbooksByType,
	formatTextbookDate,
	getSubjectMeta,
	groupTextbooksBySubject,
	sortTextbooks,
	stripTextbookSlug,
	validateImageUrl,
	validateTextbookSchema,
};

/**
 * 将 Astro CollectionEntry 转换为统一强类型 TextbookItem
 */
export function mapEntryToTextbookItem(
	entry: CollectionEntry<"textbooks">,
): TextbookItem {
	const rawData = entry.data;
	const frontmatter: TextbookFrontmatter = {
		title: String(rawData.title || "未命名知识点"),
		subject: (rawData.subject || "other") as SubjectType,
		grade: rawData.grade || "",
		chapter: rawData.chapter || "",
		type: (rawData.type || "hybrid") as TextbookType,
		imageUrl: rawData.imageUrl || "",
		imageAlt: rawData.imageAlt || "",
		tags: Array.isArray(rawData.tags) ? rawData.tags : [],
		description: rawData.description || "",
		externalUrl: rawData.externalUrl || "",
		published: rawData.published ? new Date(rawData.published) : new Date(),
		updated: rawData.updated ? new Date(rawData.updated) : undefined,
		order: typeof rawData.order === "number" ? rawData.order : 0,
		difficulty: (rawData.difficulty || "intermediate") as DifficultyLevel,
		draft: Boolean(rawData.draft),
		icon: rawData.icon || "",
	};

	const wordCount = countTextbookWords(entry.body || "");
	const readingTime = estimateTextbookReadingTime(wordCount);
	const slug = entry.slug || stripTextbookSlug(entry.id);
	const subjectMeta = getSubjectMeta(frontmatter.subject);
	const formattedDate = formatTextbookDate(frontmatter.published);

	return {
		id: entry.id,
		slug,
		title: frontmatter.title,
		subject: frontmatter.subject,
		subjectLabel: subjectMeta.label || subjectMeta.name,
		type: frontmatter.type || "hybrid",
		grade: frontmatter.grade,
		chapter: frontmatter.chapter,
		summary: frontmatter.description,
		description: frontmatter.description,
		tags: frontmatter.tags,
		coverImage: frontmatter.imageUrl,
		imageUrl: frontmatter.imageUrl,
		imageAlt: frontmatter.imageAlt,
		articleUrl: `/textbook/${slug}`,
		externalUrl: frontmatter.externalUrl,
		body: entry.body || "",
		content: entry.body || "",
		data: frontmatter,
		formattedDate,
		readingTime,
		wordCount,
		subjectMeta,
		order: frontmatter.order,
		difficulty: frontmatter.difficulty,
		draft: frontmatter.draft,
	};
}

/**
 * 纯函数：将知识点按章节归类
 */
export function groupTextbooksByChapter(
	items: TextbookItem[],
): Record<string, TextbookItem[]> {
	const record: Record<string, TextbookItem[]> = {};

	for (const item of items) {
		const chapterName = item.chapter || item.data?.chapter || "未分章节";
		const cleanChapter = chapterName.trim() || "未分章节";
		if (!record[cleanChapter]) {
			record[cleanChapter] = [];
		}
		record[cleanChapter].push(item);
	}

	for (const ch of Object.keys(record)) {
		record[ch] = sortTextbooks(record[ch], "order");
	}

	return record;
}

/**
 * 异步获取全量教材知识点（支持多维过滤与安全容错）
 * 供 Astro 页面与静态生成器直接调用
 */
export async function getTextbooks(
	options: TextbookFilterOptions = {},
): Promise<TextbookItem[]> {
	try {
		const rawEntries = await getCollection("textbooks");
		const items = rawEntries.map(mapEntryToTextbookItem);
		return filterTextbooks(items, options);
	} catch (error) {
		console.warn("[textbook-utils] 获取 textbooks 集合异常:", error);
		return [];
	}
}

/**
 * 异步获取按学科分类聚合的教材列表
 */
export async function getSubjectCategories(
	itemsOrOptions?: TextbookItem[] | TextbookFilterOptions,
): Promise<SubjectCategory[]> {
	if (Array.isArray(itemsOrOptions)) {
		return coreGetSubjectCategories(itemsOrOptions);
	}
	const items = await getTextbooks(itemsOrOptions || {});
	return coreGetSubjectCategories(items);
}

/**
 * 根据 Slug 或 ID 精确查询单个教材条目
 */
export async function getTextbookBySlug(
	slugOrId: string,
): Promise<TextbookItem | null> {
	if (!slugOrId) return null;
	const target = stripTextbookSlug(slugOrId).toLowerCase();
	const allItems = await getTextbooks({ includeDrafts: true });
	return (
		allItems.find(
			(item) =>
				(item.slug && item.slug.toLowerCase() === target) ||
				stripTextbookSlug(item.id).toLowerCase() === target,
		) || null
	);
}

/**
 * 获取全站已发布教材的所有标签统计
 */
export async function getAllTextbookTags(): Promise<
	Array<{ tag: string; count: number }>
> {
	const allItems = await getTextbooks({ includeDrafts: false });
	return extractAllTextbookTags(allItems);
}

/**
 * 获取教材库全景统计数据
 */
export async function getTextbookStats(): Promise<TextbookStats> {
	const allItems = await getTextbooks({ includeDrafts: false });
	return calculateTextbookStats(allItems);
}
