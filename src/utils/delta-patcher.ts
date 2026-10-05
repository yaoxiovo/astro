/**
 * RFC 6902 客户端增量差分热补丁引擎 (Delta-Encoding & OTA Hot-Patching)
 * 支持标准 RFC 6902 JSON Patch 与紧凑行级文本差分 (Compact Line Deltas)
 * 提供客户端内存对象、纯文本及 DOM AST 树的毫秒级原地热补丁应用
 */

import {
	applyDeltaPatch as coreApplyDeltaPatch,
	applyJsonPatch as coreApplyJsonPatch,
	applyLineDeltas as coreApplyLineDeltas,
	applyOperation as coreApplyOperation,
	createDeltaPatch as coreCreateDeltaPatch,
	encodePointerToken as coreEncodePointerToken,
	generateLineDeltas as coreGenerateLineDeltas,
	generateObjectJsonPatch as coreGenerateObjectJsonPatch,
	getPointerValue as coreGetPointerValue,
	parseJsonPointer as coreParseJsonPointer,
} from "./delta-core.mjs";

export interface JsonPatchOperation {
	op: "add" | "remove" | "replace" | "move" | "copy" | "test";
	path: string;
	value?: unknown;
	from?: string;
}

export interface LineDelta {
	start: number; // 0-indexed 起始行号
	deleteCount: number; // 删除的基础行数
	lines: string[]; // 插入的新文本行
}

export interface DeltaPatchStats {
	baseLength: number;
	targetLength: number;
	patchSize: number;
	compressionRatio: string;
	addedLines: number;
	deletedLines: number;
}

export interface DeltaPatch {
	version: "1.0";
	slug: string;
	fromSha: string;
	toSha: string;
	fromShortSha: string;
	toShortSha: string;
	timestamp: string;
	rfc6902: JsonPatchOperation[];
	lineDeltas: LineDelta[];
	stats: DeltaPatchStats;
}

export const parseJsonPointer: (path: string) => string[] =
	coreParseJsonPointer;
export const encodePointerToken: (token: string) => string =
	coreEncodePointerToken;
export const getPointerValue: (doc: unknown, path: string) => unknown =
	coreGetPointerValue;
export const applyOperation: (
	doc: Record<string, unknown> | unknown[],
	operation: JsonPatchOperation,
) => void = coreApplyOperation;
export const applyJsonPatch: <T extends Record<string, unknown> | unknown[]>(
	doc: T,
	patch: JsonPatchOperation[],
	mutate?: boolean,
) => T = coreApplyJsonPatch;
export const generateLineDeltas: (
	fromText: string,
	toText: string,
) => LineDelta[] = coreGenerateLineDeltas;
export const applyLineDeltas: (
	baseText: string,
	deltas: LineDelta[],
) => string = coreApplyLineDeltas;
export const generateObjectJsonPatch: (
	fromObj: Record<string, unknown>,
	toObj: Record<string, unknown>,
	ignoredKeys?: string[],
) => JsonPatchOperation[] = coreGenerateObjectJsonPatch;

export const createDeltaPatch: (
	fromDoc: string | Record<string, unknown>,
	toDoc: string | Record<string, unknown>,
	options?: {
		slug?: string;
		fromSha?: string;
		toSha?: string;
		fromShortSha?: string;
		toShortSha?: string;
	},
) => DeltaPatch = coreCreateDeltaPatch;

export const applyDeltaPatch: <T = unknown>(
	baseDoc: T,
	patch: DeltaPatch | JsonPatchOperation[] | LineDelta[],
) => T = coreApplyDeltaPatch;

/**
 * 客户端异步拉取增量热补丁 (OTA Fetcher)
 */
export async function fetchDeltaPatch(
	slug: string,
	fromShortSha: string,
	toShortSha: string,
): Promise<DeltaPatch | null> {
	try {
		const res = await fetch(
			`/api/wiki/deltas/${slug}/${fromShortSha}--${toShortSha}.json`,
		);
		if (!res.ok) return null;
		return (await res.json()) as DeltaPatch;
	} catch (e) {
		console.warn(
			`[DeltaPatcher] 无法获取增量补丁 ${fromShortSha} -> ${toShortSha}:`,
			e,
		);
		return null;
	}
}
