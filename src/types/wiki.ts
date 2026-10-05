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
