import type {
	DifficultyLevel,
	SubjectCategory,
	SubjectMeta,
	TextbookFilterOptions,
	TextbookItem,
	TextbookStats,
	TextbookType,
} from "../types/textbook";

export declare const SUBJECT_METADATA_MAP: Record<string, SubjectMeta>;
export declare const SUBJECT_METAS: Record<string, SubjectMeta>;
export declare const DEFAULT_FALLBACK_IMAGE: string;

export interface ImageValidationResult {
	valid: boolean;
	url: string;
	isExternal: boolean;
	isHttps: boolean;
	isDataUri: boolean;
	warning?: string;
	reason?: string;
}

export declare function validateImageUrl(
	rawUrl: unknown,
	fallbackUrl?: string,
): ImageValidationResult;

export declare function getSubjectMeta(subject: string): SubjectMeta;
export declare function stripTextbookSlug(id?: string): string;
export declare function formatTextbookDate(dateInput: unknown): string;
export declare function countTextbookWords(body?: string): number;
export declare function estimateTextbookReadingTime(wordCount: number): number;

export declare function filterTextbooksBySubject(
	items?: TextbookItem[],
	subject?: string,
): TextbookItem[];

export declare function filterTextbooksByType(
	items?: TextbookItem[],
	type?: string,
): TextbookItem[];

export declare function filterTextbooks(
	items?: TextbookItem[],
	options?: TextbookFilterOptions,
): TextbookItem[];

export declare function sortTextbooks(
	items?: TextbookItem[],
	sortBy?: string,
): TextbookItem[];

export declare function groupTextbooksBySubject(
	items?: TextbookItem[],
): SubjectCategory[];

export declare function getSubjectCategories(
	items?: TextbookItem[],
): SubjectCategory[];

export declare function extractAllTextbookTags(
	items?: TextbookItem[],
): Array<{ tag: string; count: number }>;

export declare function calculateTextbookStats(
	items?: TextbookItem[],
): TextbookStats;

export interface SchemaValidationResult {
	valid: boolean;
	errors: string[];
	data?: unknown;
}

export declare function validateTextbookSchema(
	data: unknown,
): SchemaValidationResult;
