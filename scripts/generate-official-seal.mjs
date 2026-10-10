/**
 * 官印生成器 — 对所有已发布文章做 Ed25519 防篡改签名
 *
 * 产出:
 *   src/data/seal/manifest.json   → 构建时被文章页徽章/验证页引用的总清单
 *   public/api/seal/manifest.json → 公开可下载的签名清单
 *   public/api/seal/pubkey.pem    → 公开公钥（供第三方离线验证）
 *
 * 密钥来源(按优先级):
 *   1. 环境变量 SEAL_PRIVATE_KEY（PEM 文本或 base64(PEM)，GitHub Secrets 用）
 *   2. .seal/private.pem（本地开发，gitignore）
 *   3. 本地首次运行自动生成密钥对并提示配置 CI Secret
 *   CI 环境（GITHUB_ACTIONS=true）缺密钥时：跳过签发并保留既有 manifest，构建不中断
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SEAL_VERSION, buildPayloadFromRaw } from "../src/utils/seal-core.mjs";

const POSTS_DIR = path.resolve("src/content/posts");
const DATA_DIR = path.resolve("src/data/seal");
const PUBLIC_API_DIR = path.resolve("public/api/seal");
const KEY_DIR = path.resolve(".seal");
const PRIVATE_KEY_PATH = path.join(KEY_DIR, "private.pem");
const MANIFEST_PATH = path.join(DATA_DIR, "manifest.json");

function log(msg) {
	console.log(`[官印] ${msg}`);
}

function loadPrivateKey() {
	const envKey = process.env.SEAL_PRIVATE_KEY?.trim();
	if (envKey) {
		try {
			const pem = envKey.includes("BEGIN")
				? envKey
				: Buffer.from(envKey, "base64").toString("utf-8");
			return crypto.createPrivateKey(pem);
		} catch (e) {
			console.warn(
				`⚠️ [官印] SEAL_PRIVATE_KEY 解析失败，将尝试本地密钥: ${e.message}`,
			);
		}
	}
	if (fs.existsSync(PRIVATE_KEY_PATH)) {
		return crypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY_PATH, "utf-8"));
	}
	return null;
}

/** 读取既有 manifest 的公钥指纹（无 manifest / 无指纹时返回 null） */
function readExistingFingerprint() {
	if (!fs.existsSync(MANIFEST_PATH)) return null;
	try {
		const existing = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
		return existing?.keyFingerprint || null;
	} catch {
		return null;
	}
}

function ensurePrivateKey() {
	const existing = loadPrivateKey();
	if (existing) return existing;

	if (process.env.GITHUB_ACTIONS === "true") {
		console.warn(
			"⚠️ [官印] CI 环境未配置 SEAL_PRIVATE_KEY，本次构建跳过签发（保留既有 manifest）",
		);
		return null;
	}

	// 安全护栏：仓库中已提交了由某把密钥签发的 manifest。若本地缺少对应私钥
	// 却擅自生成新密钥对，会把全部已提交签名一次性作废（且静默发生）。
	// 因此此处默认拒绝自动生成，仅提示如何恢复；显式设置
	// SEAL_ALLOW_KEY_ROTATION=true 才允许轮换（用于确实要换密钥的场景）。
	const committedFingerprint = readExistingFingerprint();
	if (committedFingerprint && process.env.SEAL_ALLOW_KEY_ROTATION !== "true") {
		console.error("❌ [官印] 缺少签名私钥，但仓库中已存在已签发的 manifest。");
		console.error(`   现有公钥指纹: ${committedFingerprint.slice(0, 16)}…`);
		console.error("   自动生成新密钥会使全部已提交签名失效，故已中止签发。");
		console.error("   请任选其一：");
		console.error(
			"     1) 配置环境变量 SEAL_PRIVATE_KEY 为对应私钥（PEM 或 base64(PEM)）；",
		);
		console.error("     2) 将私钥放到 .seal/private.pem；");
		console.error(
			"     3) 确需轮换密钥时，显式设置 SEAL_ALLOW_KEY_ROTATION=true。",
		);
		console.error("   本次构建将保留既有 manifest（页面显示为未启用签名）。");
		return null;
	}

	fs.mkdirSync(KEY_DIR, { recursive: true });
	const { privateKey } = crypto.generateKeyPairSync("ed25519");
	fs.writeFileSync(
		PRIVATE_KEY_PATH,
		privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		{ mode: 0o600 },
	);
	log(
		"🔑 首次运行：已生成全新 Ed25519 密钥对 → .seal/private.pem（已 gitignore）",
	);
	log(
		"   ⚠️ 请立即将私钥内容配置到 GitHub 仓库 Secrets 的 SEAL_PRIVATE_KEY，否则 CI 无法继续签发！",
	);
	return privateKey;
}

function walkMarkdown(dir, base = "") {
	const out = [];
	for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
		const rel = path.join(base, item.name);
		if (item.isDirectory()) {
			out.push(...walkMarkdown(path.join(dir, item.name), rel));
		} else if (item.name.endsWith(".md")) {
			out.push(rel);
		}
	}
	return out;
}

function writeManifest(manifest) {
	const json = `${JSON.stringify(manifest, null, 2)}\n`;
	fs.mkdirSync(DATA_DIR, { recursive: true });
	fs.mkdirSync(PUBLIC_API_DIR, { recursive: true });
	fs.writeFileSync(MANIFEST_PATH, json);
	fs.writeFileSync(path.join(PUBLIC_API_DIR, "manifest.json"), json);
	if (manifest.publicKeyPem) {
		fs.writeFileSync(
			path.join(PUBLIC_API_DIR, "pubkey.pem"),
			manifest.publicKeyPem,
		);
	}
}

function preserveExisting() {
	if (fs.existsSync(MANIFEST_PATH)) {
		const existing = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
		writeManifest(existing);
		return true;
	}
	writeManifest({
		version: SEAL_VERSION,
		algorithm: "Ed25519",
		hashAlgorithm: "SHA-256",
		keyFingerprint: "",
		publicKeyPem: "",
		publicKeyJwk: null,
		seals: [],
	});
	return false;
}

function main() {
	const privateKey = ensurePrivateKey();
	if (!privateKey) {
		preserveExisting();
		return;
	}

	const publicKey = crypto.createPublicKey(privateKey);
	const publicKeyPem = publicKey
		.export({ type: "spki", format: "pem" })
		.toString();
	const publicKeyJwk = publicKey.export({ format: "jwk" });
	const keyFingerprint = crypto
		.createHash("sha256")
		.update(publicKey.export({ type: "spki", format: "der" }))
		.digest("hex");

	const files = walkMarkdown(POSTS_DIR).sort();
	const seals = [];
	let skippedDraft = 0;

	for (const file of files) {
		const slug = file.replace(/\.md$/, "").split(path.sep).join("/");
		const raw = fs.readFileSync(path.join(POSTS_DIR, file), "utf-8");
		const payload = buildPayloadFromRaw(slug, raw);
		if (payload.draft) {
			skippedDraft++;
			continue;
		}

		const signature = crypto
			.sign(null, Buffer.from(payload.canonical, "utf-8"), privateKey)
			.toString("base64");
		const hash = crypto
			.createHash("sha256")
			.update(payload.canonical, "utf-8")
			.digest("hex");

		seals.push({
			slug,
			title: payload.title,
			published: payload.published,
			encrypted: payload.encrypted,
			tags: payload.tags,
			hash,
			signature,
		});
	}

	seals.sort((a, b) => (a.slug < b.slug ? -1 : 1));

	writeManifest({
		version: SEAL_VERSION,
		algorithm: "Ed25519",
		hashAlgorithm: "SHA-256",
		keyFingerprint,
		publicKeyPem,
		publicKeyJwk,
		seals,
	});

	log(`✅ 已签发 ${seals.length} 篇文章（跳过草稿 ${skippedDraft} 篇）`);
	log(`   公钥指纹: ${keyFingerprint.slice(0, 16)}…`);
}

main();
