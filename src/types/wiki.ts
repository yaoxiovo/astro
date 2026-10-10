export interface WikiRevision {
	sha: string;
	shortSha: string;
	date: string;
	displayDate: string;
	author: string;
	authorEmail?: string;
	message: string;
	section: string | null;
	cleanMessage: string;
	byteSize: number;
	byteDelta: number;
	linesAdded: number;
	linesDeleted: number;
	isMinor: boolean;
	tags: string[];
	diffUrl?: string;
}

export interface WikiPostHistory {
	slug: string;
	title: string;
	filePath: string;
	totalRevisions: number;
	lastUpdated: string;
	revisions: WikiRevision[];
}

/**
 * src/data/wiki/history.json 的顶层结构：slug → 该文章的完整修订历史。
 *
 * 该文件由 scripts/generate-wiki-history.mjs 生成，全部条目均为
 * `{ slug, title, filePath, totalRevisions, lastUpdated, revisions }`，
 * 因此顶层是 slug 到 WikiPostHistory 的映射（而非单篇文章的历史）。
 */
export type WikiHistoryData = Record<string, WikiPostHistory>;

export interface DiffToken {
	type: "same" | "add" | "del";
	text: string;
}

export interface DiffLine {
	type: "same" | "add" | "del" | "modified";
	oldLineNo?: number;
	newLineNo?: number;
	oldContent?: string;
	newContent?: string;
	oldTokens?: DiffToken[];
	newTokens?: DiffToken[];
}

export interface DiffChunk {
	oldStart: number;
	newStart: number;
	lines: DiffLine[];
}

export interface DiffResult {
	oldSha: string;
	newSha: string;
	chunks: DiffChunk[];
	stats: {
		added: number;
		deleted: number;
	};
}
