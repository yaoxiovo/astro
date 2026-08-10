import {
	getSortedMoments,
	momentToText,
	extractMomentTags,
	stripMomentId,
} from "@/utils/content-utils";
import type { APIRoute, GetStaticPaths } from "astro";

const serialize = (m: any) => ({
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

export const getStaticPaths = (async () => {
	const moments = await getSortedMoments();
	const tags = [...new Set(moments.flatMap((m) => extractMomentTags(m.body)))];
	return tags.map((tag) => ({ params: { tag } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
	const moments = await getSortedMoments();
	const tag = params.tag;
	const filtered = moments
		.filter((m) => extractMomentTags(m.body).includes(tag))
		.map(serialize);
	return new Response(JSON.stringify({ tag, moments: filtered }), {
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
};