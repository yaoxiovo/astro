/**
 * RFC 6902 JSON Patch & Incremental Delta Hot-Patching Contracts
 *
 * Provides industrial-grade type definitions for:
 * 1. RFC 6902 JSON Patch operations (add, remove, replace, move, copy, test)
 * 2. Compact line-level text delta hunks for markdown body OTA hot-patching
 * 3. Bidirectional incremental patch manifests (WikiDeltaManifest) & version transition graphs
 *
 * @module types/wiki-delta
 */

/**
 * RFC 6902 JSON Pointer string format (e.g. "/title", "/frontmatter/tags/0").
 * Represents a hierarchical path into a JSON/JavaScript object.
 */
export type JsonPointer = string;

/**
 * RFC 6902 'add' operation.
 * Adds a value into an object or inserts it into an array index.
 */
export interface JsonPatchAddOperation<T = unknown> {
	readonly op: "add";
	readonly path: JsonPointer;
	readonly value: T;
}

/**
 * RFC 6902 'remove' operation.
 * Removes a value from a target object or removes an element from an array index.
 */
export interface JsonPatchRemoveOperation {
	readonly op: "remove";
	readonly path: JsonPointer;
}

/**
 * RFC 6902 'replace' operation.
 * Replaces an existing value with a new value at the specified path.
 */
export interface JsonPatchReplaceOperation<T = unknown> {
	readonly op: "replace";
	readonly path: JsonPointer;
	readonly value: T;
}

/**
 * RFC 6902 'move' operation.
 * Removes value from 'from' path and adds it to the target 'path'.
 */
export interface JsonPatchMoveOperation {
	readonly op: "move";
	readonly from: JsonPointer;
	readonly path: JsonPointer;
}

/**
 * RFC 6902 'copy' operation.
 * Copies value from 'from' path and sets/appends it at the target 'path'.
 */
export interface JsonPatchCopyOperation {
	readonly op: "copy";
	readonly from: JsonPointer;
	readonly path: JsonPointer;
}

/**
 * RFC 6902 'test' operation.
 * Asserts that the value at 'path' matches 'value'.
 * If the assertion fails, the entire patch sequence must abort atomically.
 */
export interface JsonPatchTestOperation<T = unknown> {
	readonly op: "test";
	readonly path: JsonPointer;
	readonly value: T;
}

/**
 * Discriminated union of all 6 standard RFC 6902 JSON Patch operations.
 */
export type JsonPatchOperation<T = unknown> =
	| JsonPatchAddOperation<T>
	| JsonPatchRemoveOperation
	| JsonPatchReplaceOperation<T>
	| JsonPatchMoveOperation
	| JsonPatchCopyOperation
	| JsonPatchTestOperation<T>;

/**
 * RFC 6902 JSON Patch document: an ordered array of patch operations.
 */
export type JsonPatchDocument<T = unknown> = readonly JsonPatchOperation<T>[];

/**
 * Delta patch representation format:
 * - "rfc6902": Pure JSON Patch for structured AST/metadata.
 * - "line-delta": High-density line-level text diffs for prose/markdown bodies.
 * - "hybrid": Bundles both RFC 6902 frontmatter operations and line-level body delta.
 */
export type WikiDeltaFormat = "rfc6902" | "line-delta" | "hybrid";

/**
 * Supported hash algorithms for cryptographic patch integrity checks.
 */
export type PatchChecksumAlgorithm = "sha256" | "sha1" | "xxhash64" | "crc32";

/**
 * Checksum integrity record for atomic pre-apply and post-apply validation.
 */
export interface IntegrityChecksum {
	readonly algorithm: PatchChecksumAlgorithm;
	readonly sourceHash: string;
	readonly targetHash: string;
}

/**
 * Compact Line Delta operation types:
 * - "retain": Keep `count` lines unchanged from base document.
 * - "insert": Insert new `lines` into target document.
 * - "delete": Skip/drop `count` lines from base document.
 */
export type LineDeltaOp =
	| { readonly type: "retain"; readonly count: number }
	| { readonly type: "insert"; readonly lines: readonly string[] }
	| { readonly type: "delete"; readonly count: number };

/**
 * Compact line-level diff hunk for text bodies.
 */
export interface TextDeltaHunk {
	readonly oldStart: number;
	readonly oldLines: number;
	readonly newStart: number;
	readonly newLines: number;
	readonly ops: readonly LineDeltaOp[];
}

/**
 * Text delta payload for markdown body hot-patching.
 */
export interface TextDeltaPayload {
	readonly hunks: readonly TextDeltaHunk[];
}

/**
 * Compression algorithm used for patch payload transmission.
 */
export type DeltaCompression = "none" | "gzip" | "brotli" | "deflate";

/**
 * Standalone incremental diff patch artifact between two document revisions.
 */
export interface WikiDeltaPatch {
	readonly schemaVersion: "1.0.0";
	/** Unique patch identifier, standard format: `${slug}@${sourceSha}->${targetSha}` */
	readonly id: string;
	/** Document slug identifier */
	readonly slug: string;
	/** Base Git commit SHA or revision SHA */
	readonly sourceSha: string;
	/** Target Git commit SHA or revision SHA */
	readonly targetSha: string;
	/** Patch encoding strategy */
	readonly format: WikiDeltaFormat;
	/** Integrity validation hashes for zero-corruption OTA guarantees */
	readonly integrity: IntegrityChecksum;
	/** Payload size and compression stats */
	readonly byteSize: {
		readonly source: number;
		readonly target: number;
		readonly patch: number;
		readonly savingsRatio: number;
	};
	/** Line-level modification metrics */
	readonly stats: {
		readonly linesAdded: number;
		readonly linesDeleted: number;
		readonly linesRetained: number;
	};
	/** RFC 6902 operations for frontmatter and structured data mutations */
	readonly jsonPatch?: JsonPatchDocument;
	/** Compact line-level delta operations for markdown body */
	readonly textDelta?: TextDeltaPayload;
	/** ISO 8601 generation timestamp */
	readonly generatedAt: string;
	/** Over-the-wire compression type */
	readonly compression?: DeltaCompression;
}

/**
 * Lightweight reference entry to a downloadable delta patch file.
 */
export interface WikiDeltaPatchRef {
	readonly patchId: string;
	readonly sourceSha: string;
	readonly targetSha: string;
	readonly url: string;
	readonly byteSize: number;
	readonly checksum: string;
	readonly checksumAlgorithm: PatchChecksumAlgorithm;
	readonly format: WikiDeltaFormat;
	readonly compression: DeltaCompression;
	readonly linesAdded: number;
	readonly linesDeleted: number;
}

/**
 * Single hop in a multi-revision patch transition chain.
 */
export interface WikiDeltaChainHop {
	readonly fromSha: string;
	readonly toSha: string;
	readonly patchRef: WikiDeltaPatchRef;
}

/**
 * Pre-computed delta chain resolving transitions across multiple historical versions.
 */
export interface WikiDeltaChain {
	readonly sourceSha: string;
	readonly targetSha: string;
	readonly hops: readonly WikiDeltaChainHop[];
	readonly totalByteSize: number;
	readonly totalHops: number;
}

/**
 * Delta index & version mapping for an individual wiki post.
 */
export interface WikiPostDeltaManifest {
	readonly slug: string;
	readonly title: string;
	readonly latestSha: string;
	readonly latestShortSha: string;
	readonly latestUpdatedAt: string;
	readonly latestByteSize: number;
	/** Ordered revision SHAs from newest to oldest */
	readonly revisions: readonly string[];
	/**
	 * Direct patch map indexed by compound transition key `${sourceSha}->${targetSha}`
	 */
	readonly patches: Readonly<Record<string, WikiDeltaPatchRef>>;
	/**
	 * Pre-computed shortest paths jumping from historical sourceSha directly to latestSha.
	 * Keyed by historical sourceSha.
	 */
	readonly fastChainsToLatest: Readonly<Record<string, WikiDeltaChain>>;
}

/**
 * Global OTA Hot-Patching Manifest for all wiki & blog posts.
 */
export interface WikiDeltaManifest {
	readonly schemaVersion: "1.0.0";
	readonly generatedAt: string;
	readonly generator: string;
	readonly gitHeadSha: string;
	readonly baseUrl: string;
	readonly totalPosts: number;
	readonly totalPatches: number;
	readonly totalPatchBytes: number;
	/** Post manifests indexed by post slug */
	readonly posts: Readonly<Record<string, WikiPostDeltaManifest>>;
}

/**
 * Status outcomes when applying an OTA patch in the client engine.
 */
export type WikiPatchApplyStatus =
	| "success"
	| "checksum_mismatch"
	| "conflict"
	| "invalid_source_version"
	| "malformed_patch";

/**
 * Result report emitted after client applies an OTA delta patch.
 */
export interface WikiPatchApplyResult {
	readonly status: WikiPatchApplyStatus;
	readonly success: boolean;
	readonly sourceSha: string;
	readonly targetSha: string;
	readonly resultingContent?: string;
	readonly appliedHunks?: number;
	readonly errorMessage?: string;
	readonly executionTimeMs: number;
}

// ---------------------------------------------------------------------------
// Strict Type Guards
// ---------------------------------------------------------------------------

/**
 * Type guard for RFC 6902 JSON Patch operations.
 */
export function isJsonPatchOperation(
	value: unknown,
): value is JsonPatchOperation {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	const op = candidate.op;
	if (typeof candidate.path !== "string") {
		return false;
	}
	switch (op) {
		case "add":
		case "replace":
		case "test":
			return "value" in candidate;
		case "remove":
			return true;
		case "move":
		case "copy":
			return typeof candidate.from === "string";
		default:
			return false;
	}
}

/**
 * Type guard for WikiDeltaPatch structure.
 */
export function isWikiDeltaPatch(value: unknown): value is WikiDeltaPatch {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		candidate.schemaVersion === "1.0.0" &&
		typeof candidate.id === "string" &&
		typeof candidate.slug === "string" &&
		typeof candidate.sourceSha === "string" &&
		typeof candidate.targetSha === "string" &&
		typeof candidate.format === "string" &&
		typeof candidate.integrity === "object" &&
		candidate.integrity !== null &&
		typeof candidate.byteSize === "object" &&
		candidate.byteSize !== null &&
		typeof candidate.stats === "object" &&
		candidate.stats !== null
	);
}

/**
 * Type guard for WikiDeltaManifest structure.
 */
export function isWikiDeltaManifest(
	value: unknown,
): value is WikiDeltaManifest {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		candidate.schemaVersion === "1.0.0" &&
		typeof candidate.generatedAt === "string" &&
		typeof candidate.gitHeadSha === "string" &&
		typeof candidate.totalPosts === "number" &&
		typeof candidate.posts === "object" &&
		candidate.posts !== null
	);
}
