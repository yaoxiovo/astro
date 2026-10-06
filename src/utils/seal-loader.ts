import fs from "node:fs";
import path from "node:path";

export interface SealEntry {
	slug: string;
	title: string;
	published: string;
	encrypted: boolean;
	tags: string[];
	hash: string;
	signature: string;
}

export interface SealManifest {
	version: string;
	algorithm: string;
	hashAlgorithm: string;
	keyFingerprint: string;
	publicKeyPem: string;
	publicKeyJwk: { kty: string; crv: string; x: string } | null;
	seals: SealEntry[];
}

const EMPTY_MANIFEST: SealManifest = {
	version: "yaoxi-official-seal/v1",
	algorithm: "Ed25519",
	hashAlgorithm: "SHA-256",
	keyFingerprint: "",
	publicKeyPem: "",
	publicKeyJwk: null,
	seals: [],
};

let cache: SealManifest | null = null;

export function getSealManifest(): SealManifest {
	if (cache) return cache;
	try {
		const manifestPath = path.join(process.cwd(), "src/data/seal/manifest.json");
		cache = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as SealManifest;
	} catch {
		cache = EMPTY_MANIFEST;
	}
	return cache;
}

export function getSealForPost(slug: string): SealEntry | null {
	const normalized = slug.replace(/\.[^/.]+$/, "");
	return getSealManifest().seals.find((s) => s.slug === normalized) ?? null;
}
