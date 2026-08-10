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

/**
 * 朋友圈统计（统计页与 /api/moments/stats.json 共用，保证数据口径一致）
 * 输入：getSortedMoments() 的结果（已过滤时间胶囊、已排序）
 */
export function computeMomentStats(moments: any[]) {
	const top = moments.filter((m) => !m.data.replyTo);
	const replies = moments.length - top.length;

	const texts = top.map((m) => momentToText(m.body));
	const totalWords = texts.reduce((sum, t) => sum + t.length, 0);
	const totalImages = top.reduce((sum, m) => sum + (m.data.images || []).length, 0);
	const totalVideos = top.reduce((sum, m) => sum + (m.data.videos || []).length, 0);

	// 年月分布
	const monthMap = new Map<string, number>();
	// 星期分布（0=周日）
	const weekdayCount = [0, 0, 0, 0, 0, 0, 0];
	// 年份分布
	const yearMap = new Map<number, number>();
	// 标签频率
	const tagMap = new Map<string, number>();
	// 最长动态
	let longest: { slug: string; words: number } | null = null;

	let firstDate: string | null = null;
	let lastDate: string | null = null;

	for (const m of top) {
		const d = new Date(m.data.published);
		if (Number.isNaN(d.getTime())) continue;

		const iso = d.toISOString();
		if (!firstDate || iso < firstDate) firstDate = iso;
		if (!lastDate || iso > lastDate) lastDate = iso;

		const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
		monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + 1);
		weekdayCount[d.getDay()] += 1;
		yearMap.set(d.getFullYear(), (yearMap.get(d.getFullYear()) || 0) + 1);

		extractMomentTags(m.body).forEach((t) => tagMap.set(t, (tagMap.get(t) || 0) + 1));

		const words = momentToText(m.body).length;
		if (!longest || words > longest.words) {
			longest = { slug: stripMomentId(m.id), words };
		}
	}

	const months = [...monthMap.entries()]
		.map(([month, count]) => ({ month, count }))
		.sort((a, b) => (a.month < b.month ? 1 : -1));

	const years = [...yearMap.entries()]
		.map(([year, count]) => ({ year, count }))
		.sort((a, b) => b.year - a.year);

	const tags = [...tagMap.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 20);

	return {
		total: top.length,
		replies,
		totalWords,
		avgWords: top.length ? Math.round(totalWords / top.length) : 0,
		totalImages,
		totalVideos,
		firstDate,
		lastDate,
		years,
		months,
		weekdays: [
			{ day: 0, label: "周日", count: weekdayCount[0] },
			{ day: 1, label: "周一", count: weekdayCount[1] },
			{ day: 2, label: "周二", count: weekdayCount[2] },
			{ day: 3, label: "周三", count: weekdayCount[3] },
			{ day: 4, label: "周四", count: weekdayCount[4] },
			{ day: 5, label: "周五", count: weekdayCount[5] },
			{ day: 6, label: "周六", count: weekdayCount[6] },
		],
		tags,
		longest,
	};
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