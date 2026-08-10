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
	tags: extractMomentTags(m.body),
	text: momentToText(m.body, 80),
});

export const GET: APIRoute = async () => {
	const moments = await getSortedMoments();
	const top = moments.filter((m) => !m.data.replyTo);

	// 按 年 -> 月 分组（getSortedMoments 已按时间倒序，天然满足组内倒序）
	const yearMap = new Map<number, Map<number, any[]>>();
	for (const m of top) {
		const d = new Date(m.data.published);
		if (Number.isNaN(d.getTime())) continue;
		const year = d.getFullYear();
		const month = d.getMonth() + 1;
		if (!yearMap.has(year)) yearMap.set(year, new Map());
		const monthMap = yearMap.get(year)!;
		if (!monthMap.has(month)) monthMap.set(month, []);
		monthMap.get(month)!.push(serialize(m));
	}

	const archive = [...yearMap.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([year, monthMap]) => ({
			year,
			total: [...monthMap.values()].reduce((s, arr) => s + arr.length, 0),
			months: [...monthMap.entries()]
				.sort((a, b) => b[0] - a[0])
				.map(([month, items]) => ({ month, count: items.length, items })),
		}));

	return new Response(
		JSON.stringify({ updated: new Date().toISOString(), archive }),
		{ headers: { "Content-Type": "application/json; charset=utf-8" } },
	);
};