/**
 * src/utils/delta-core.mjs 的类型声明（RFC 6902 增量差分热补丁核心引擎）
 *
 * 该模块是原生 ESM（.mjs），而本仓库 tsconfig 的 allowJs 为 false，
 * 因此需要一个同名声明文件让 TypeScript 理解其导出（此前报 TS7016）。
 *
 * 这里的接口刻意写成「可变属性的结构化类型」，而不是复用
 * src/types/wiki-delta.ts 中的 readonly 判别联合：
 * 后者要求 add/replace/test 操作必须携带 value，且数组为 readonly，
 * 与 delta-patcher.ts 中既有的显式函数注解不兼容（readonly T[] 不可赋给 T[]）。
 * 声明的字段与 delta-core.mjs 运行时实际读写的字段逐一对应，不使用 any。
 */

/** 单条 RFC 6902 JSON Patch 操作（delta-core.mjs 会读取 op/path/value/from 四个字段） */
export interface DeltaJsonPatchOperation {
	op: "add" | "remove" | "replace" | "move" | "copy" | "test";
	path: string;
	value?: unknown;
	from?: string;
}

/** 紧凑行级文本差分块（delta-core.mjs 生成与消费的最小单位） */
export interface DeltaLineHunk {
	/** 0-indexed 起始行号 */
	start: number;
	/** 删除的基础行数 */
	deleteCount: number;
	/** 插入的新文本行 */
	lines: string[];
}

/** createDeltaPatch 返回的补丁统计信息 */
export interface DeltaPatchStats {
	baseLength: number;
	targetLength: number;
	patchSize: number;
	compressionRatio: string;
	addedLines: number;
	deletedLines: number;
}

/** createDeltaPatch 的返回结构（含 stats） */
export interface DeltaPatchResult {
	version: "1.0";
	slug: string;
	fromSha: string;
	toSha: string;
	fromShortSha: string;
	toShortSha: string;
	timestamp: string;
	rfc6902: DeltaJsonPatchOperation[];
	lineDeltas: DeltaLineHunk[];
	stats: DeltaPatchStats;
}

/** createDeltaPatch 的可选元数据；缺省值在运行时补齐 */
export interface DeltaPatchOptions {
	slug?: string;
	fromSha?: string;
	toSha?: string;
	fromShortSha?: string;
	toShortSha?: string;
}

/**
 * 解析 RFC 6901 JSON Pointer 路径为 token 数组。
 * 空串与 "/" 返回空数组；不以 "/" 开头时抛错。
 */
export function parseJsonPointer(path: string): string[];

/** 编码 JSON Pointer 单个 token（转义 ~ 与 /） */
export function encodePointerToken(token: unknown): string;

/** 按 JSON Pointer 读取深层属性值，路径不存在时返回 undefined */
export function getPointerValue(doc: unknown, path: string): unknown;

/** 就地对 doc 应用单条 RFC 6902 操作（原地修改，无返回值） */
export function applyOperation(
	doc: Record<string, unknown> | unknown[],
	operation: DeltaJsonPatchOperation,
): void;

/** 应用一组 RFC 6902 操作；mutate 为 false（默认）时先深拷贝，返回应用结果 */
export function applyJsonPatch<T extends Record<string, unknown> | unknown[]>(
	doc: T,
	patch: DeltaJsonPatchOperation[],
	mutate?: boolean,
): T;

/** 基于 Myers/LCS 算法生成紧凑行级差分块 */
export function generateLineDeltas(
	fromText: string,
	toText: string,
): DeltaLineHunk[];

/** 按 start 倒序应用行级差分块，返回打补丁后的文本 */
export function applyLineDeltas(
	baseText: string,
	deltas: DeltaLineHunk[],
): string;

/** 生成两个对象之间的 RFC 6902 操作列表（ignoredKeys 中的键会被跳过） */
export function generateObjectJsonPatch(
	fromObj: Record<string, unknown>,
	toObj: Record<string, unknown>,
	ignoredKeys?: string[],
): DeltaJsonPatchOperation[];

/** 由新旧文档生成完整增量补丁（文本走 lineDeltas，对象额外产出 rfc6902） */
export function createDeltaPatch(
	fromDoc: string | Record<string, unknown>,
	toDoc: string | Record<string, unknown>,
	options?: DeltaPatchOptions,
): DeltaPatchResult;

/**
 * 应用增量补丁到字符串、DOM 元素或普通对象；
 * patch 为空（null/undefined）时原样返回 baseDoc。
 */
export function applyDeltaPatch<T>(
	baseDoc: T,
	patch:
		| DeltaPatchResult
		| DeltaJsonPatchOperation[]
		| DeltaLineHunk[]
		| null
		| undefined,
): T;
