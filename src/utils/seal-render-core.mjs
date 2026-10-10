/**
 * seal-render-core — 渲染护栏 (Render Guard) 共享核心
 * 构建端 (src/integrations/seal-render-guard.mjs) 与浏览器端 (OfficialSealBadge 内联脚本) 共同引用,
 * 保证「渲染文本抽取范围 / 排除规则 / 签名消息格式」在两端严格一致。
 * 任何变更必须升级 RENDER_GUARD_VERSION,旧载荷按旧版本不再校验(浏览器端显示未启用)。
 */

export const RENDER_GUARD_VERSION = "yaoxi-render-guard/v1";

/** 抽取容器(文章卡片),其下按文档顺序拼接各目标区域的文本 */
export const GUARD_ROOT = "#post-container";

/** 参与渲染文本哈希的展示区域(按数组顺序拼接,中间不加分隔符) */
export const GUARD_TARGETS = ["h1", ".markdown-content"];

/** 运行时会被注入动态内容、必须从文本抽取中排除的子树 */
export const GUARD_EXCLUDE_TAGS = ["script", "style", "noscript", "template"];
export const GUARD_EXCLUDE_CLASSES = ["yaoxi-dm-layer"];
export const GUARD_EXCLUDE_SELECTOR = [
	...GUARD_EXCLUDE_TAGS,
	...GUARD_EXCLUDE_CLASSES.map((c) => `.${c}`),
].join(",");

/** 构建端遍历时判断某元素是否应跳过整棵子树(classList 为空格分隔后的数组) */
export function isGuardExcluded(tagName, classList) {
	if (GUARD_EXCLUDE_TAGS.includes(String(tagName || "").toLowerCase()))
		return true;
	if (!classList || classList.length === 0) return false;
	return GUARD_EXCLUDE_CLASSES.some((c) => classList.includes(c));
}

/** 被签名对象:版本号 + 渲染文本哈希(格式不可变更,变更须升级版本号) */
export function buildGuardMessage(textHash) {
	return `${RENDER_GUARD_VERSION}\nsha256: ${textHash}`;
}

/**
 * 换行归一化,补齐浏览器 HTML 解析器的输入流规范化(CRLF/CR → LF)。
 * node-html-parser 不做此规范化,若不统一,产物中含 CRLF 的文本会导致两端哈希不一致。
 * 两端均调用(浏览器端为幂等无操作),保证逐字节对齐。
 */
export function normalizeGuardText(text) {
	return String(text).replace(/\r\n?/g, "\n");
}
