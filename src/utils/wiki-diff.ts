import type { DiffChunk, DiffLine, DiffResult, DiffToken } from "../types/wiki";

export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/**
 * 将单行文本按 CJK 汉字、字母数字单词、标点、空白符号拆分成最小 Token
 */
export function tokenizeLine(text: string): string[] {
	if (!text) return [];
	return (
		text.match(
			/[\p{Unified_Ideograph}]|[a-zA-Z0-9_-]+|[^\s\p{Unified_Ideograph}a-zA-Z0-9_-]+|\s+/gu,
		) || []
	);
}

/**
 * 经典 Myers Diff 差异计算算法 (LCS)
 */
export function myersDiff<T>(
	a: T[],
	b: T[],
	equals: (x: T, y: T) => boolean = (x, y) => x === y,
): Array<{ type: "eq" | "add" | "del"; a?: T; b?: T }> {
	const n = a.length;
	const m = b.length;
	if (n === 0 && m === 0) return [];
	if (n === 0) return b.map((item) => ({ type: "add" as const, b: item }));
	if (m === 0) return a.map((item) => ({ type: "del" as const, a: item }));

	const max = n + m;
	const v: Record<number, number> = { 1: 0 };
	const trace: Array<Record<number, number>> = [];

	for (let d = 0; d <= max; d++) {
		const vCopy = { ...v };
		trace.push(vCopy);

		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (k === -d || (k !== d && (v[k - 1] ?? -1) < (v[k + 1] ?? -1))) {
				x = v[k + 1] ?? 0;
			} else {
				x = (v[k - 1] ?? 0) + 1;
			}
			let y = x - k;

			while (x < n && y < m && equals(a[x], b[y])) {
				x++;
				y++;
			}

			v[k] = x;

			if (x >= n && y >= m) {
				// 回溯构建编辑序列
				const script: Array<{ type: "eq" | "add" | "del"; a?: T; b?: T }> = [];
				let curX = n;
				let curY = m;

				for (let cd = d; cd > 0; cd--) {
					const vPrev = trace[cd];
					const ck = curX - curY;
					let prevK: number;
					if (
						ck === -cd ||
						(ck !== cd && (vPrev[ck - 1] ?? -1) < (vPrev[ck + 1] ?? -1))
					) {
						prevK = ck + 1;
					} else {
						prevK = ck - 1;
					}

					const prevX = vPrev[prevK] ?? 0;
					const prevY = prevX - prevK;

					while (curX > prevX && curY > prevY) {
						script.unshift({
							type: "eq",
							a: a[curX - 1],
							b: b[curY - 1],
						});
						curX--;
						curY--;
					}

					if (cd > 0) {
						if (curX === prevX) {
							script.unshift({ type: "add", b: b[prevY] });
							curY--;
						} else if (curY === prevY) {
							script.unshift({ type: "del", a: a[prevX] });
							curX--;
						}
					}
				}

				while (curX > 0 && curY > 0) {
					script.unshift({
						type: "eq",
						a: a[curX - 1],
						b: b[curY - 1],
					});
					curX--;
					curY--;
				}
				return script;
			}
		}
	}
	return [];
}

/**
 * 对单行进行词级/字符级二次差异切分（MediaWiki 经典 Word-level Diff）
 */
export function computeWordLevelDiff(
	oldLine: string,
	newLine: string,
): { oldTokens: DiffToken[]; newTokens: DiffToken[] } {
	const aTokens = tokenizeLine(oldLine);
	const bTokens = tokenizeLine(newLine);
	const tokenDiff = myersDiff(aTokens, bTokens);

	const oldTokens: DiffToken[] = [];
	const newTokens: DiffToken[] = [];

	for (const item of tokenDiff) {
		if (item.type === "eq") {
			oldTokens.push({ type: "same", text: item.a || "" });
			newTokens.push({ type: "same", text: item.b || "" });
		} else if (item.type === "del") {
			oldTokens.push({ type: "del", text: item.a || "" });
		} else if (item.type === "add") {
			newTokens.push({ type: "add", text: item.b || "" });
		}
	}

	return { oldTokens, newTokens };
}

/**
 * 生成维基百科经典差异报告（带上下文折叠与行内词级标记）
 */
export function generateWikiDiff(
	oldText: string,
	newText: string,
	options: { contextLines?: number; oldSha?: string; newSha?: string } = {},
): DiffResult {
	const contextLines = options.contextLines ?? 3;
	const oldLines = oldText ? oldText.split(/\r?\n/) : [];
	const newLines = newText ? newText.split(/\r?\n/) : [];

	const rawScript = myersDiff(oldLines, newLines);

	// 转换为带有真实行号的中间列表
	let oldLineCounter = 1;
	let newLineCounter = 1;
	let addedCount = 0;
	let deletedCount = 0;

	const allLines: DiffLine[] = [];

	let i = 0;
	while (i < rawScript.length) {
		const item = rawScript[i];

		if (item.type === "eq") {
			allLines.push({
				type: "same",
				oldLineNo: oldLineCounter++,
				newLineNo: newLineCounter++,
				oldContent: item.a,
				newContent: item.b,
			});
			i++;
		} else if (item.type === "del") {
			// 检测是否有成对的 add，作为 modified 行进行词级切分
			let nextAddIndex = -1;
			// 在连续的 del/add 块中匹配
			for (let j = i + 1; j < rawScript.length; j++) {
				if (rawScript[j].type === "eq") break;
				if (rawScript[j].type === "add") {
					nextAddIndex = j;
					break;
				}
			}

			if (nextAddIndex !== -1 && nextAddIndex === i + 1) {
				// 成对的修改行：计算词级 Diff
				deletedCount++;
				addedCount++;
				const oldContent = item.a || "";
				const newContent = rawScript[nextAddIndex].b || "";
				const { oldTokens, newTokens } = computeWordLevelDiff(
					oldContent,
					newContent,
				);

				allLines.push({
					type: "modified",
					oldLineNo: oldLineCounter++,
					newLineNo: newLineCounter++,
					oldContent,
					newContent,
					oldTokens,
					newTokens,
				});
				i += 2;
			} else {
				deletedCount++;
				allLines.push({
					type: "del",
					oldLineNo: oldLineCounter++,
					oldContent: item.a,
				});
				i++;
			}
		} else if (item.type === "add") {
			addedCount++;
			allLines.push({
				type: "add",
				newLineNo: newLineCounter++,
				newContent: item.b,
			});
			i++;
		}
	}

	// 按照 contextLines 折叠未修改部分为 Chunks
	const chunks: DiffChunk[] = [];
	const isDiffLine = (l: DiffLine) => l.type !== "same";

	let currentChunkLines: DiffLine[] = [];
	let chunkOldStart = 1;
	let chunkNewStart = 1;

	// 标记哪些行需要保留在上下文里
	const keepLine = new Array(allLines.length).fill(false);
	for (let idx = 0; idx < allLines.length; idx++) {
		if (isDiffLine(allLines[idx])) {
			const start = Math.max(0, idx - contextLines);
			const end = Math.min(allLines.length - 1, idx + contextLines);
			for (let k = start; k <= end; k++) {
				keepLine[k] = true;
			}
		}
	}

	for (let idx = 0; idx < allLines.length; idx++) {
		if (keepLine[idx]) {
			if (currentChunkLines.length === 0) {
				chunkOldStart = allLines[idx].oldLineNo ?? 1;
				chunkNewStart = allLines[idx].newLineNo ?? 1;
			}
			currentChunkLines.push(allLines[idx]);
		} else {
			if (currentChunkLines.length > 0) {
				chunks.push({
					oldStart: chunkOldStart,
					newStart: chunkNewStart,
					lines: currentChunkLines,
				});
				currentChunkLines = [];
			}
		}
	}

	if (currentChunkLines.length > 0) {
		chunks.push({
			oldStart: chunkOldStart,
			newStart: chunkNewStart,
			lines: currentChunkLines,
		});
	}

	return {
		oldSha: options.oldSha || "",
		newSha: options.newSha || "",
		chunks,
		stats: {
			added: addedCount,
			deleted: deletedCount,
		},
	};
}

/**
 * 格式化词级 Token 为带维基百科经典样式的 HTML
 */
export function renderTokensToHtml(
	tokens: DiffToken[] | undefined,
	fallbackContent = "",
): string {
	if (!tokens || tokens.length === 0) {
		return escapeHtml(fallbackContent);
	}

	return tokens
		.map((t) => {
			const escaped = escapeHtml(t.text);
			if (t.type === "del") {
				return `<del class="diffchange diffchange-inline bg-red-500/25 text-red-700 dark:text-red-300 font-semibold px-0.5 rounded-sm">${escaped}</del>`;
			}
			if (t.type === "add") {
				return `<ins class="diffchange diffchange-inline bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 font-semibold px-0.5 rounded-sm">${escaped}</ins>`;
			}
			return escaped;
		})
		.join("");
}
