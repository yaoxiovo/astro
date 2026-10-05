/**
 * RFC 6902 客户端增量差分热补丁核心算法引擎 (Delta-Encoding Core)
 * 原生 ES Module 实现，兼容 Node.js 20 构建环境与客户端现代浏览器
 */

/**
 * 解析 RFC 6901 JSON Pointer 路径
 */
export function parseJsonPointer(path) {
	if (!path || path === "/") return [];
	if (!path.startsWith("/")) {
		throw new Error(
			`[DeltaPatcher] 非法 JSON Pointer 路径: ${path} (必须以 '/' 开头)喵！`,
		);
	}
	return path
		.slice(1)
		.split("/")
		.map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * 编码 JSON Pointer 单个 token
 */
export function encodePointerToken(token) {
	return String(token).replace(/~/g, "~0").replace(/\//g, "~1");
}

function cloneValue(val) {
	if (val === undefined || val === null) return val;
	if (typeof val !== "object") return val;
	return JSON.parse(JSON.stringify(val));
}

function resolvePointerParent(doc, tokens, createParents = false) {
	if (tokens.length === 0) {
		throw new Error("[DeltaPatcher] 根路径不能作为属性操作喵！");
	}

	let current = doc;
	for (let i = 0; i < tokens.length - 1; i++) {
		const token = tokens[i];
		if (typeof current !== "object" || current === null) {
			throw new Error(
				`[DeltaPatcher] 路径节点无法解析: /${tokens.slice(0, i + 1).join("/")} 喵！`,
			);
		}

		if (Array.isArray(current)) {
			const idx = Number.parseInt(token, 10);
			if (Number.isNaN(idx) || idx < 0 || idx >= current.length) {
				throw new Error(`[DeltaPatcher] 数组索引越界: ${token} 喵！`);
			}
			current = current[idx];
		} else {
			if (!(token in current)) {
				if (createParents) {
					current[token] = {};
				} else {
					throw new Error(`[DeltaPatcher] 目标属性不存在: ${token} 喵！`);
				}
			}
			current = current[token];
		}
	}

	const lastToken = tokens[tokens.length - 1];
	if (Array.isArray(current)) {
		if (lastToken === "-") {
			return { parent: current, key: current.length };
		}
		const idx = Number.parseInt(lastToken, 10);
		if (Number.isNaN(idx)) {
			throw new Error(`[DeltaPatcher] 非法数组索引: ${lastToken} 喵！`);
		}
		return { parent: current, key: idx };
	}

	return { parent: current, key: lastToken };
}

export function getPointerValue(doc, path) {
	const tokens = parseJsonPointer(path);
	if (tokens.length === 0) return doc;

	let current = doc;
	for (const token of tokens) {
		if (typeof current !== "object" || current === null) return undefined;
		if (Array.isArray(current)) {
			const idx = Number.parseInt(token, 10);
			if (Number.isNaN(idx) || idx < 0 || idx >= current.length)
				return undefined;
			current = current[idx];
		} else {
			current = current[token];
		}
	}
	return current;
}

export function applyOperation(doc, operation) {
	const { op, path } = operation;
	const tokens = parseJsonPointer(path);

	switch (op) {
		case "add": {
			const { parent, key } = resolvePointerParent(doc, tokens, true);
			if (Array.isArray(parent)) {
				const idx = typeof key === "number" ? key : Number.parseInt(key, 10);
				parent.splice(idx, 0, cloneValue(operation.value));
			} else {
				parent[key] = cloneValue(operation.value);
			}
			break;
		}
		case "remove": {
			const { parent, key } = resolvePointerParent(doc, tokens, false);
			if (Array.isArray(parent)) {
				const idx = typeof key === "number" ? key : Number.parseInt(key, 10);
				if (idx < 0 || idx >= parent.length) {
					throw new Error(`[DeltaPatcher] 移除数组元素索引越界: ${idx} 喵！`);
				}
				parent.splice(idx, 1);
			} else {
				delete parent[key];
			}
			break;
		}
		case "replace": {
			const { parent, key } = resolvePointerParent(doc, tokens, false);
			if (Array.isArray(parent)) {
				const idx = typeof key === "number" ? key : Number.parseInt(key, 10);
				if (idx < 0 || idx >= parent.length) {
					throw new Error(`[DeltaPatcher] 替换数组元素索引越界: ${idx} 喵！`);
				}
				parent[idx] = cloneValue(operation.value);
			} else {
				parent[key] = cloneValue(operation.value);
			}
			break;
		}
		case "move": {
			if (!operation.from) {
				throw new Error("[DeltaPatcher] move 操作缺少 'from' 参数喵！");
			}
			const val = getPointerValue(doc, operation.from);
			applyOperation(doc, { op: "remove", path: operation.from });
			applyOperation(doc, { op: "add", path, value: val });
			break;
		}
		case "copy": {
			if (!operation.from) {
				throw new Error("[DeltaPatcher] copy 操作缺少 'from' 参数喵！");
			}
			const val = getPointerValue(doc, operation.from);
			applyOperation(doc, { op: "add", path, value: val });
			break;
		}
		case "test": {
			const currentVal = getPointerValue(doc, path);
			if (JSON.stringify(currentVal) !== JSON.stringify(operation.value)) {
				throw new Error(
					`[DeltaPatcher] test 操作断言失败: ${path} 不匹配预期值 喵！`,
				);
			}
			break;
		}
		default:
			throw new Error(`[DeltaPatcher] 未知的 RFC 6902 操作符: ${op} 喵！`);
	}
}

export function applyJsonPatch(doc, patch, mutate = false) {
	const target = mutate ? doc : cloneValue(doc);
	for (const op of patch) {
		applyOperation(target, op);
	}
	return target;
}

/**
 * 基于 Myers/LCS 算法生成紧凑的 LineDelta
 */
export function generateLineDeltas(fromText, toText) {
	if (fromText === toText) return [];

	const a = fromText === "" ? [] : fromText.split("\n");
	const b = toText === "" ? [] : toText.split("\n");

	const n = a.length;
	const m = b.length;

	if (n === 0) {
		return [{ start: 0, deleteCount: 0, lines: b }];
	}
	if (m === 0) {
		return [{ start: 0, deleteCount: n, lines: [] }];
	}

	let prefix = 0;
	while (prefix < n && prefix < m && a[prefix] === b[prefix]) {
		prefix++;
	}

	let suffix = 0;
	while (
		suffix < n - prefix &&
		suffix < m - prefix &&
		a[n - 1 - suffix] === b[m - 1 - suffix]
	) {
		suffix++;
	}

	const subA = a.slice(prefix, n - suffix);
	const subB = b.slice(prefix, m - suffix);

	const deltas = [];
	if (subA.length === 0 && subB.length === 0) {
		return [];
	}

	if (subA.length <= 1500 && subB.length <= 1500) {
		const dp = Array.from({ length: subA.length + 1 }, () =>
			new Array(subB.length + 1).fill(0),
		);

		for (let i = 0; i < subA.length; i++) {
			for (let j = 0; j < subB.length; j++) {
				if (subA[i] === subB[j]) {
					dp[i + 1][j + 1] = dp[i][j] + 1;
				} else {
					dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
				}
			}
		}

		let i = subA.length;
		let j = subB.length;
		const edits = [];

		while (i > 0 || j > 0) {
			if (i > 0 && j > 0 && subA[i - 1] === subB[j - 1]) {
				edits.unshift({ type: "eq", aIdx: i - 1, bIdx: j - 1 });
				i--;
				j--;
			} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
				edits.unshift({ type: "add", bIdx: j - 1 });
				j--;
			} else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
				edits.unshift({ type: "del", aIdx: i - 1 });
				i--;
			}
		}

		let curA = prefix;
		let delCount = 0;
		let insLines = [];
		let blockStart = curA;

		for (const edit of edits) {
			if (edit.type === "eq") {
				if (delCount > 0 || insLines.length > 0) {
					deltas.push({
						start: blockStart,
						deleteCount: delCount,
						lines: insLines,
					});
					delCount = 0;
					insLines = [];
				}
				curA++;
				blockStart = curA;
			} else if (edit.type === "del") {
				if (delCount === 0 && insLines.length === 0) {
					blockStart = curA;
				}
				delCount++;
				curA++;
			} else if (edit.type === "add") {
				if (delCount === 0 && insLines.length === 0) {
					blockStart = curA;
				}
				insLines.push(subB[edit.bIdx ?? 0]);
			}
		}

		if (delCount > 0 || insLines.length > 0) {
			deltas.push({
				start: blockStart,
				deleteCount: delCount,
				lines: insLines,
			});
		}
	} else {
		deltas.push({
			start: prefix,
			deleteCount: subA.length,
			lines: subB,
		});
	}

	return deltas;
}

export function applyLineDeltas(baseText, deltas) {
	if (!deltas || deltas.length === 0) return baseText;

	const lines = baseText === "" ? [] : baseText.split("\n");
	const sortedDeltas = [...deltas].sort((a, b) => b.start - a.start);

	for (const delta of sortedDeltas) {
		lines.splice(delta.start, delta.deleteCount, ...delta.lines);
	}

	return lines.join("\n");
}

export function generateObjectJsonPatch(fromObj, toObj, ignoredKeys = []) {
	const ops = [];
	const allKeys = new Set([...Object.keys(fromObj), ...Object.keys(toObj)]);

	for (const key of allKeys) {
		if (ignoredKeys.includes(key)) continue;

		const fromVal = fromObj[key];
		const toVal = toObj[key];
		const path = `/${encodePointerToken(key)}`;

		if (fromVal === undefined && toVal !== undefined) {
			ops.push({ op: "add", path, value: toVal });
		} else if (fromVal !== undefined && toVal === undefined) {
			ops.push({ op: "remove", path });
		} else if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
			ops.push({ op: "replace", path, value: toVal });
		}
	}

	return ops;
}

export function createDeltaPatch(fromDoc, toDoc, options = {}) {
	const slug = options.slug || "document";
	const fromSha = options.fromSha || "0000000000000000000000000000000000000000";
	const toSha = options.toSha || "0000000000000000000000000000000000000000";
	const fromShortSha = options.fromShortSha || fromSha.slice(0, 7);
	const toShortSha = options.toShortSha || toSha.slice(0, 7);

	let fromText = "";
	let toText = "";
	let rfcOps = [];

	if (typeof fromDoc === "string" && typeof toDoc === "string") {
		fromText = fromDoc;
		toText = toDoc;
	} else if (
		typeof fromDoc === "object" &&
		typeof toDoc === "object" &&
		fromDoc &&
		toDoc
	) {
		fromText = typeof fromDoc.content === "string" ? fromDoc.content : "";
		toText = typeof toDoc.content === "string" ? toDoc.content : "";

		rfcOps = generateObjectJsonPatch(fromDoc, toDoc, ["content"]);
	}

	const lineDeltas = generateLineDeltas(fromText, toText);

	let addedLines = 0;
	let deletedLines = 0;
	for (const d of lineDeltas) {
		deletedLines += d.deleteCount;
		addedLines += d.lines.length;
	}

	const baseLength = Buffer.byteLength(fromText, "utf-8");
	const targetLength = Buffer.byteLength(toText, "utf-8");

	const patchPayload = {
		version: "1.0",
		slug,
		fromSha,
		toSha,
		fromShortSha,
		toShortSha,
		timestamp: new Date().toISOString(),
		rfc6902: rfcOps,
		lineDeltas,
	};

	const patchJson = JSON.stringify(patchPayload);
	const patchSize = Buffer.byteLength(patchJson, "utf-8");
	const ratio =
		targetLength > 0
			? `${Math.max(0, Math.min(99.9, (1 - patchSize / targetLength) * 100)).toFixed(1)}%`
			: "0%";

	return {
		...patchPayload,
		stats: {
			baseLength,
			targetLength,
			patchSize,
			compressionRatio: ratio,
			addedLines,
			deletedLines,
		},
	};
}

export function applyDeltaPatch(baseDoc, patch) {
	if (!patch) return baseDoc;

	if (Array.isArray(patch)) {
		if (patch.length === 0) return baseDoc;
		const first = patch[0];
		if ("op" in first && "path" in first) {
			return applyJsonPatch(baseDoc, patch);
		}
		if ("start" in first && "deleteCount" in first) {
			return applyLineDeltas(baseDoc, patch);
		}
	}

	const deltaPatch = patch;

	if (typeof baseDoc === "string") {
		return applyLineDeltas(baseDoc, deltaPatch.lineDeltas || []);
	}

	if (
		typeof window !== "undefined" &&
		typeof Element !== "undefined" &&
		baseDoc instanceof Element
	) {
		const el = baseDoc;
		if (deltaPatch.rfc6902 && deltaPatch.rfc6902.length > 0) {
			for (const op of deltaPatch.rfc6902) {
				const tokens = parseJsonPointer(op.path);
				const attr = tokens[0];
				if (!attr) continue;

				if (op.op === "replace" || op.op === "add") {
					if (attr.startsWith("data-")) {
						el.setAttribute(attr, String(op.value));
					} else if (attr === "textContent" || attr === "innerText") {
						el.textContent = String(op.value);
					} else if (attr === "className") {
						el.className = String(op.value);
					}
				} else if (op.op === "remove") {
					el.removeAttribute(attr);
				}
			}
		}

		const contentTarget = el.querySelector("[data-wiki-content]") || el;
		if (contentTarget && deltaPatch.lineDeltas) {
			const currentText =
				contentTarget.innerText || contentTarget.textContent || "";
			const newText = applyLineDeltas(currentText, deltaPatch.lineDeltas);
			contentTarget.textContent = newText;
		}

		return el;
	}

	if (typeof baseDoc === "object" && baseDoc !== null) {
		const doc = cloneValue(baseDoc);

		if (deltaPatch.rfc6902 && deltaPatch.rfc6902.length > 0) {
			applyJsonPatch(doc, deltaPatch.rfc6902, true);
		}

		if (typeof doc.content === "string" && deltaPatch.lineDeltas) {
			doc.content = applyLineDeltas(doc.content, deltaPatch.lineDeltas);
		}

		if (deltaPatch.toSha) doc.sha = deltaPatch.toSha;
		if (deltaPatch.toShortSha) doc.shortSha = deltaPatch.toShortSha;

		return doc;
	}

	return baseDoc;
}
