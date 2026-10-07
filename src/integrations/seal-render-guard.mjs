/**
 * seal-render-guard — 渲染护栏构建端集成 (Render Guard, build side)
 *
 * astro:build:done 时,对 dist 中每篇文章页:
 *   1. 抽取 h1 + 正文(.markdown-content,排除动态子树)的渲染文本 → SHA-256
 *   2. 用官印私钥对该哈希签名(Ed25519,消息格式见 seal-render-core)
 *   3. 将载荷注入页面内 <script id="seal-render-guard"> 占位槽
 * 浏览器端(OfficialSealBadge 脚本)用公开载荷复算并比对:
 *   渲染内容被改一个字符(哪怕是标点)→ 哈希不一致 → 红色告警;签名无法伪造,私钥不在攻击者手中。
 * 密钥来源与签发脚本一致(SEAL_PRIVATE_KEY → .seal/private.pem),缺失时跳过注入(页面保留占位,前端显示未启用)。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";
import {
	RENDER_GUARD_VERSION,
	GUARD_ROOT,
	GUARD_TARGETS,
	buildGuardMessage,
	isGuardExcluded,
	normalizeGuardText,
} from "../utils/seal-render-core.mjs";

const SLOT_MARKER = 'id="seal-render-guard"';

function loadSealPrivateKey() {
	const envKey = process.env.SEAL_PRIVATE_KEY?.trim();
	if (envKey) {
		try {
			const pem = envKey.includes("BEGIN") ? envKey : Buffer.from(envKey, "base64").toString("utf-8");
			return crypto.createPrivateKey(pem);
		} catch {
			// 继续尝试本地密钥
		}
	}
	const localPath = path.resolve(".seal/private.pem");
	if (fs.existsSync(localPath)) {
		return crypto.createPrivateKey(fs.readFileSync(localPath, "utf-8"));
	}
	return null;
}

/** 收集文本节点(已实体解码),跳过排除清单子树 —— 与浏览器端 clone+remove 语义逐字节等价 */
function collectText(node, out) {
	for (const child of node.childNodes) {
		if (child.nodeType === 1) {
			const classAttr = (child.getAttribute && child.getAttribute("class")) || "";
			if (isGuardExcluded(child.rawTagName, classAttr.split(/\s+/))) continue;
			collectText(child, out);
		} else if (child.nodeType === 3 && child.text != null) {
			out.push(child.text);
		}
	}
}

function elementText(el) {
	const out = [];
	collectText(el, out);
	return out.join("");
}

function walkHtmlFiles(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walkHtmlFiles(full, out);
		else if (entry.name.endsWith(".html")) out.push(full);
	}
	return out;
}

export default function sealRenderGuard() {
	return {
		name: "seal-render-guard",
		hooks: {
			"astro:build:done": ({ dir, logger }) => {
				const privateKey = loadSealPrivateKey();
				if (!privateKey) {
					logger.warn("[渲染护栏] 未找到签名私钥(SEAL_PRIVATE_KEY / .seal/private.pem),跳过注入");
					return;
				}

				const publicKey = crypto.createPublicKey(privateKey);
				const keyFingerprint = crypto
					.createHash("sha256")
					.update(publicKey.export({ type: "spki", format: "der" }))
					.digest("hex");
				const publicKeyJwk = publicKey.export({ format: "jwk" });

				const outDir = fileURLToPath(dir);
				const postsDir = path.join(outDir, "posts");
				if (!fs.existsSync(postsDir)) {
					logger.warn("[渲染护栏] dist 中未找到 posts 目录,跳过注入");
					return;
				}

				let injected = 0;
				let skipped = 0;

				for (const file of walkHtmlFiles(postsDir)) {
					const html = fs.readFileSync(file, "utf-8");
					if (!html.includes(SLOT_MARKER)) continue;

					const root = parse(html);
					const slot = root.querySelector("#seal-render-guard");
					const guardRoot = root.querySelector(GUARD_ROOT);
					if (!slot || !slot.range || !guardRoot) {
						skipped++;
						continue;
					}

					const parts = [];
					let missing = false;
					for (const selector of GUARD_TARGETS) {
						const el = guardRoot.querySelector(selector);
						if (!el) {
							missing = true;
							break;
						}
						parts.push(elementText(el));
					}
					// 如加密文章(无正文容器),不适用渲染护栏
					if (missing) {
						skipped++;
						continue;
					}

					const textHash = crypto
						.createHash("sha256")
						.update(normalizeGuardText(parts.join("")), "utf-8")
						.digest("hex");
					const signature = crypto
						.sign(null, Buffer.from(buildGuardMessage(textHash), "utf-8"), privateKey)
						.toString("base64");

					const payload = JSON.stringify({
						v: RENDER_GUARD_VERSION,
						textHash,
						signature,
						publicKeyJwk,
						keyFingerprint,
					}).replace(/</g, "\\u003c");

					const [start, end] = slot.range;
					if (!html.slice(start, end).includes(SLOT_MARKER)) {
						skipped++;
						continue;
					}

					const replacement = `<script type="application/json" id="seal-render-guard">${payload}</script>`;
					fs.writeFileSync(file, html.slice(0, start) + replacement + html.slice(end));
					injected++;
				}

				logger.info(
					`[渲染护栏] 已签署并注入 ${injected} 篇(跳过 ${skipped} 篇);公钥指纹 ${keyFingerprint.slice(0, 16)}…`,
				);
			},
		},
	};
}
