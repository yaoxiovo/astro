import {
	getSortedMoments,
	momentToText,
	extractMomentTags,
	stripMomentId,
} from "@/utils/content-utils";
import type { APIRoute } from "astro";

const serialize = (m: any) => ({
	slug: stripMomentId(m.id),
	published: m.data.published,
	author: m.data.author || null,
	source: m.data.source || null,
	pinned: m.data.pinned || false,
	replyTo: m.data.replyTo || null,
	capsule: m.data.capsule || null,
	location: m.data.location || null,
	images: m.data.images || [],
	videos: m.data.videos || [],
	tags: extractMomentTags(m.body),
	text: momentToText(m.body),
});

export const GET: APIRoute = async () => {
	const moments = await getSortedMoments();
	return new Response(
		JSON.stringify({ updated: new Date().toISOString(), moments: moments.map(serialize) }),
		{ headers: { "Content-Type": "application/json; charset=utf-8" } },
	);
};