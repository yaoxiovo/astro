import { getSortedMoments, computeMomentStats } from "@/utils/content-utils";
import type { APIRoute } from "astro";

export const GET: APIRoute = async () => {
	const moments = await getSortedMoments();
	const stats = computeMomentStats(moments);
	return new Response(
		JSON.stringify({ updated: new Date().toISOString(), ...stats }),
		{ headers: { "Content-Type": "application/json; charset=utf-8" } },
	);
};