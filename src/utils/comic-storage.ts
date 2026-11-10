import type {
	ComicReadingMode,
	ComicReadingProgress,
	ComicWidthPreset,
} from "../types/comic";

const PROGRESS_STORAGE_KEY = "yaoxi-comic-progress-v1";
const READ_CHAPTERS_STORAGE_KEY = "yaoxi-comic-read-chapters-v1";
const PREFS_STORAGE_KEY = "yaoxi-comic-prefs-v1";

export interface ComicReaderPrefs {
	mode: ComicReadingMode;
	widthPreset: ComicWidthPreset;
	gapless: boolean;
	showPageNums: boolean;
}

const DEFAULT_PREFS: ComicReaderPrefs = {
	mode: "scroll",
	widthPreset: "standard",
	gapless: true,
	showPageNums: true,
};

function readStorageJson<T>(key: string, fallback: T): T {
	if (typeof window === "undefined") return fallback;
	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return fallback;
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function writeStorageJson<T>(key: string, value: T): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// 隐私模式或存储配额已满时静默降级
	}
}

export function getAllComicProgress(): Record<string, ComicReadingProgress> {
	return readStorageJson<Record<string, ComicReadingProgress>>(
		PROGRESS_STORAGE_KEY,
		{},
	);
}

export function getComicProgress(
	comicSlug: string,
): ComicReadingProgress | null {
	if (!comicSlug) return null;
	const all = getAllComicProgress();
	return all[comicSlug] ?? null;
}

export function saveComicProgress(progress: ComicReadingProgress): void {
	if (!progress.comicSlug) return;
	const all = getAllComicProgress();
	all[progress.comicSlug] = progress;
	writeStorageJson(PROGRESS_STORAGE_KEY, all);
}

export function getReadChapters(comicSlug: string): string[] {
	if (!comicSlug) return [];
	const all = readStorageJson<Record<string, string[]>>(
		READ_CHAPTERS_STORAGE_KEY,
		{},
	);
	const list = all[comicSlug];
	return Array.isArray(list) ? list : [];
}

export function markChapterAsRead(
	comicSlug: string,
	chapterSlug: string,
): string[] {
	if (!comicSlug || !chapterSlug) return [];
	const all = readStorageJson<Record<string, string[]>>(
		READ_CHAPTERS_STORAGE_KEY,
		{},
	);
	const current = Array.isArray(all[comicSlug]) ? all[comicSlug] : [];
	if (!current.includes(chapterSlug)) {
		const next = [...current, chapterSlug].slice(-1500);
		all[comicSlug] = next;
		writeStorageJson(READ_CHAPTERS_STORAGE_KEY, all);
		return next;
	}
	return current;
}

export function getComicReaderPrefs(): ComicReaderPrefs {
	const saved = readStorageJson<Partial<ComicReaderPrefs>>(
		PREFS_STORAGE_KEY,
		{},
	);
	return {
		mode: saved.mode === "page" ? "page" : DEFAULT_PREFS.mode,
		widthPreset:
			saved.widthPreset === "compact" ||
			saved.widthPreset === "standard" ||
			saved.widthPreset === "wide" ||
			saved.widthPreset === "full"
				? saved.widthPreset
				: DEFAULT_PREFS.widthPreset,
		gapless:
			typeof saved.gapless === "boolean"
				? saved.gapless
				: DEFAULT_PREFS.gapless,
		showPageNums:
			typeof saved.showPageNums === "boolean"
				? saved.showPageNums
				: DEFAULT_PREFS.showPageNums,
	};
}

export function saveComicReaderPrefs(
	prefs: Partial<ComicReaderPrefs>,
): ComicReaderPrefs {
	const merged: ComicReaderPrefs = {
		...getComicReaderPrefs(),
		...prefs,
	};
	writeStorageJson(PREFS_STORAGE_KEY, merged);
	return merged;
}
