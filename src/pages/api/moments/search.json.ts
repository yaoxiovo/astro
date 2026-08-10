import {
	getSortedMoments,
	momentToText,
	extractMomentTags,
	stripMomentId,
} from "@/utils/content-utils";
import type { APIRoute } from "astro";

export const GET: APIRoute = async () => {
	const moments = await getSortedMoments();
	const index = moments.map((m) => ({
		slug: stripMomentId(m.id),
		date: new Date(m.data.published).toISOString().slice(0, 10),
		author: m.data.author || "",
		text: momentToText(m.body),
		tags: extractMomentTags(m.body),
	}));
	return new Response(JSON.stringify(index), {
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
};