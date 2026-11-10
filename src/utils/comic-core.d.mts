import type {
	ComicChapterFilterOptions,
	ComicChapterGroup,
	ComicChapterKind,
} from "../types/comic";

export declare function parseCsvRecords(
	text: string,
): Array<Record<string, string>>;

export declare function padChapterSlug(chapterIndex: number | string): string;

export declare function padPageFilename(
	pageNumber: number | string,
	ext?: string,
): string;

export declare function buildLocalComicImagePath(
	comicSlug: string,
	chapterSlug: string,
	filename: string,
): string;

export declare function sanitizeComicUrl(rawUrl: unknown): string;

export declare function classifyComicChapter(
	title: string,
	pageCount?: number,
): ComicChapterKind;

export declare function formatBytes(bytes: number): string;

export declare function filterAndSortChapters<
	T extends { index: number; slug: string; title: string; kind: string },
>(chapters: T[], options?: ComicChapterFilterOptions): T[];

export declare function groupChaptersByRange<T extends { index: number }>(
	chapters: T[],
	chunkSize?: number,
): Array<Omit<ComicChapterGroup, "chapters"> & { chapters: T[] }>;

export declare function formatChapterLabel(chapter: {
	index: number;
	title: string;
}): string;
