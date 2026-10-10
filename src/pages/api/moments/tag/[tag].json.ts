import type { CollectionEntry } from "astro:content";
import {
	extractMomentTags,
	getSortedMoments,
	momentToText,
	stripMomentId,
} from "@/utils/content-utils";
import type { APIRoute, GetStaticPaths } from "astro";

const serialize = (m: CollectionEntry<"moments">) => ({
	slug: stripMomentId(m.id),
	published: m.data.published,
	author: m.data.author || null,
	source: m.data.source || null,
	pinned: m.data.pinned || false,
	replyTo: m.data.replyTo || null,
	location: m.data.location || null,
	images: m.data.images || [],
	videos: m.data.videos || [],
	tags: extractMomentTags(m.body),
	text: momentToText(m.body),
});

export const getStaticPaths: GetStaticPaths = async () => {
	const moments = await getSortedMoments();
	const tags = [...new Set(moments.flatMap((m) => extractMomentTags(m.body)))];
	return tags.map((tag) => ({ params: { tag } }));
};

export const GET: APIRoute = async ({ params }) => {
	const moments = await getSortedMoments();
	const tag = params.tag;
	// getStaticPaths 静态生成时 params.tag 必定存在；此处显式判空只为类型收窄，
	// 缺失时返回空集合，与原先 includes(undefined) 恒为 false 的行为一致
	const filtered = moments
		.filter((m) => tag !== undefined && extractMomentTags(m.body).includes(tag))
		.map(serialize);
	return new Response(JSON.stringify({ tag, moments: filtered }), {
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
};
