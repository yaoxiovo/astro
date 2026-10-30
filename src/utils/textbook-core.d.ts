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

export declare const DEFAULT_FALLBACK_IMAGE: string;
export declare const SUBJECT_METADATA_MAP: Record<string, SubjectMeta>;
export declare const SUBJECT_METAS: Record<string, SubjectMeta>;

export declare function getSubjectMeta(subject: string): SubjectMeta;
export declare function stripTextbookSlug(id?: string): string;
export declare function formatTextbookDate(
	dateInput: Date | string | number,
): string;
export declare function countTextbookWords(body?: string): number;
export declare function estimateTextbookReadingTime(wordCount: number): number;
export declare function validateImageUrl(url?: string): {
	valid: boolean;
	normalized: string;
	reason?: string;
};
export declare function validateTextbookSchema(item: unknown): {
	valid: boolean;
	errors: string[];
};
export declare function sortTextbooks(
	items: TextbookItem[],
	sortBy?: "order" | "date-desc" | "date-asc" | "title",
): TextbookItem[];
export declare function filterTextbooks(
	items: TextbookItem[],
	options?: TextbookFilterOptions,
): TextbookItem[];
export declare function filterTextbooksBySubject(
	items: TextbookItem[],
	subject: string,
): TextbookItem[];
export declare function filterTextbooksByType(
	items: TextbookItem[],
	type: TextbookType,
): TextbookItem[];
export declare function groupTextbooksBySubject(
	items: TextbookItem[],
): SubjectCategory[];
export declare function getSubjectCategories(
	items: TextbookItem[],
): SubjectCategory[];
export declare function extractAllTextbookTags(
	items: TextbookItem[],
): Array<{ tag: string; count: number }>;
export declare function calculateTextbookStats(
	items: TextbookItem[],
): TextbookStats;
