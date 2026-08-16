import { getSortedPosts } from "@/utils/content-utils";
import type { APIRoute, GetStaticPaths } from "astro";

/** Markdown 正文 -> 纯文本（与朋友圈 momentToText 同一套清洗逻辑） */
const mdToText = (body = "", max = 0) => {
	const text = (body || "")
		.replace(/```[\s\S]*?```/g, " ") // 代码块
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 图片
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接 -> 文字
		.replace(/[#>*_`~|-]/g, " ") // Markdown 符号 -> 空格
		.replace(/\s+/g, " ")
		.trim();
	return max > 0 ? text.slice(0, max) : text;
};

/** 统一 id 解析：只剥掉内容扩展名（posts 的 id 通常已不带扩展名，兼容处理） */
const stripId = (id = "") => id.replace(/\.(md|mdx)$/, "");

export const getStaticPaths = (async () => {
	const posts = await getSortedPosts();
	return posts.map((post) => ({ params: { slug: stripId(post.id) } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
	const posts = await getSortedPosts();
	const post = posts.find((p) => stripId(p.id) === params.slug);

	if (!post) {
		return new Response(JSON.stringify({ error: "not found", slug: params.slug }), {
			status: 404,
			headers: { "Content-Type": "application/json; charset=utf-8" },
		});
	}

	const text = mdToText(post.body);
	const wordCount = text.length;
	const { data } = post;

	return new Response(
		JSON.stringify({
			slug: stripId(post.id),
			title: data.title,
			published: data.published,
			updated: data.updated || null,
			draft: data.draft || false,
			description: data.description || "",
			image: data.image || "",
			tags: data.tags || [],
			category: data.category || "",
			series: data.series || "",
			lang: data.lang || "",
			pinned: data.pinned || false,
			// 前后篇导航（getSortedPosts 已填充）
			prev: data.prevSlug ? { slug: data.prevSlug, title: data.prevTitle } : null,
			next: data.nextSlug ? { slug: data.nextSlug, title: data.nextTitle } : null,
			// 统计
			wordCount,
			readingTime: Math.max(1, Math.round(wordCount / 400)), // 中文约 400 字/分钟
			// 摘要：frontmatter description 优先，否则取正文前 200 字
			excerpt: data.description || mdToText(post.body, 200),
			// 纯文本正文（供第三方/AI/小程序直接消费）
			text,
		}),
		{
			headers: { "Content-Type": "application/json; charset=utf-8" },
		},
	);
};
