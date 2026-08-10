import { getCollection } from "astro:content";

/**
 * 获取已排序的朋友圈动态（所有朋友圈相关页面统一使用）
 * - 过滤：未到期的时间胶囊（capsule 日期 > 当前构建时间）
 * - 排序：置顶优先，再按发布时间倒序
 * 注意：本函数通过 import 引用，Astro 5.7 构建时 getStaticPaths 提取后依然可用
 */
export async function getSortedMoments() {
	const all = await getCollection("moments");
	const now = new Date();
	return all
		.filter((m) => !m.data.capsule || new Date(m.data.capsule) <= now)
		.sort((a, b) => {
			if (a.data.pinned !== b.data.pinned) {
				return a.data.pinned ? -1 : 1;
			}
			return (
				new Date(b.data.published).getTime() -
				new Date(a.data.published).getTime()
			);
		});
}

/** 统一 id 解析：只剥掉内容扩展名，文件名内其他点号原样保留 */
export function stripMomentId(id = "") {
	return id.replace(/\.(md|mdx)$/, "");
}

/** Markdown 正文 -> 纯文本（max > 0 时截断） */
export function momentToText(body = "", max = 0) {
	const text = (body || "")
		.replace(/```[\s\S]*?```/g, " ") // 代码块
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 图片
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接 -> 文字
		.replace(/[#>*_`~|-]/g, " ") // Markdown 符号 -> 空格
		.replace(/\s+/g, " ")
		.trim();
	return max > 0 ? text.slice(0, max) : text;
}

/** 从正文提取 hashtag 标签（跳过代码块、去重） */
export function extractMomentTags(body = "") {
	const text = (body || "").replace(/```[\s\S]*?```/g, " ");
	const matches = text.match(/#[\p{L}\p{N}_-]+/gu) || [];
	return [...new Set(matches.map((t) => t.slice(1)))];
}

export async function getSortedPosts() {
	const allBlogPosts = await getCollection("posts", ({ data }) => {
		return import.meta.env.PROD ? data.draft !== true : true;
	});
	const sorted = allBlogPosts.sort((a, b) => {
		// 如果一个是置顶一个不是置顶，置顶的排在前面
		if (a.data.pinned !== b.data.pinned) {
			return a.data.pinned ? -1 : 1;
		}
		// 都是置顶或都不是置顶，按发布日期时间排序（包含小时分钟秒）
		const dateA = new Date(a.data.published);
		const dateB = new Date(b.data.published);
		return dateA > dateB ? -1 : 1;
	});

	for (let i = 1; i < sorted.length; i++) {
		sorted[i].data.nextSlug = sorted[i - 1].id;
		sorted[i].data.nextTitle = sorted[i - 1].data.title;
	}
	for (let i = 0; i < sorted.length - 1; i++) {
		sorted[i].data.prevSlug = sorted[i + 1].id;
		sorted[i].data.prevTitle = sorted[i + 1].data.title;
	}

	return sorted;
}