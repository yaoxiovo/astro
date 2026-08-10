import { getCollection } from "astro:content";
import { momentToText, extractMomentTags, stripMomentId } from "@/utils/content-utils";
import type { APIRoute } from "astro";

/**
 * 时间胶囊清单 API（供 Telegram Bot 检查「今天有胶囊到期吗」）
 * 注意：这里故意不过滤 capsule 日期——未来胶囊也要暴露给 Bot
 */
export const GET: APIRoute = async () => {
	const all = await getCollection("moments");
	const capsules = all
		.filter((m) => m.data.capsule)
		.map((m) => ({
			slug: stripMomentId(m.id),
			capsule: m.data.capsule,
			published: m.data.published,
			tags: extractMomentTags(m.body),
			text: momentToText(m.body).slice(0, 120),
		}))
		.sort((a, b) => String(a.capsule).localeCompare(String(b.capsule)));

	return new Response(JSON.stringify({ updated: new Date().toISOString(), capsules }), {
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
};