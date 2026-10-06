/**
 * seal-core — 官印签名共享核心 (Official Seal shared core)
 * 被构建脚本 (scripts/generate-official-seal.mjs) 与验证页 (src/pages/verify/*) 共同引用，
 * 保证 canonical 文本格式在「签发端」和「验证端」完全一致。
 * 任何格式变更必须升级 SEAL_VERSION，旧签名按旧版本校验。
 */

export const SEAL_VERSION = "yaoxi-official-seal/v1";

/** 拆分 frontmatter 与正文 */
export function parseFrontmatter(raw) {
	const text = String(raw).replace(/\r\n/g, "\n");
	const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!m) return { meta: "", body: text };
	return { meta: m[1], body: m[2] };
}

function stripQuotes(v) {
	const s = v.trim();
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		return s.slice(1, -1);
	}
	return s;
}

/** 解析 tags 字段：兼容行内 `[a, b]` 与多行 `- a` 两种 YAML 写法 */
function extractTags(meta) {
	const lines = meta.split("\n");
	const idx = lines.findIndex((l) => /^tags:/.test(l));
	if (idx === -1) return [];
	const inline = lines[idx].replace(/^tags:\s*/, "").trim();
	if (inline) {
		return inline
			.replace(/^\[|\]$/g, "")
			.split(",")
			.map((t) => stripQuotes(t))
			.filter(Boolean);
	}
	const tags = [];
	for (let i = idx + 1; i < lines.length; i++) {
		const m = lines[i].match(/^\s+-\s+(.+)$/);
		if (!m) break;
		tags.push(stripQuotes(m[1]));
	}
	return tags;
}

/** 提取参与签名的关键元数据 */
export function extractSealFields(meta) {
	const field = (name) => {
		const m = meta.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
		return m ? stripQuotes(m[1]) : "";
	};
	const tags = extractTags(meta);
	return {
		title: field("title"),
		published: field("published"),
		draft: field("draft") === "true",
		encrypted: field("encrypted") === "true",
		tags,
	};
}

/**
 * 生成 canonical 文本（签名对象）。
 * 格式一经发布不可变更；如需变更必须升级 SEAL_VERSION。
 */
export function buildCanonical({ slug, title, published, tags, body }) {
	return [
		SEAL_VERSION,
		`slug: ${slug}`,
		`title: ${title}`,
		`published: ${published}`,
		`tags: ${tags.join("|")}`,
		"---",
		String(body).trim(),
	].join("\n");
}

/** 从 posts 目录的一条 md 原始内容构建完整 canonical 载荷 */
export function buildPayloadFromRaw(slug, raw) {
	const { meta, body } = parseFrontmatter(raw);
	const fields = extractSealFields(meta);
	const canonical = buildCanonical({
		slug,
		title: fields.title,
		published: fields.published,
		tags: fields.tags,
		body,
	});
	return { ...fields, body, canonical };
}
