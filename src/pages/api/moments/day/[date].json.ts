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
	const dates = [
		...new Set(
			moments.map((m) => new Date(m.data.published).toISOString().slice(0, 10)),
		),
	].sort((a, b) => (a < b ? 1 : -1));
	return dates.map((date) => ({ params: { date } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
	const moments = await getSortedMoments();
	const date = params.date;
	const filtered = moments
		.filter((m) => new Date(m.data.published).toISOString().slice(0, 10) === date)
		.map(serialize);
	return new Response(JSON.stringify({ date, moments: filtered }), {
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
};