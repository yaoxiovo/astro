import { getCollection } from "astro:content";
import {
	extractMomentTags,
	momentToText,
	stripMomentId,
} from "@/utils/content-utils";
import type { APIRoute } from "astro";

/**
 * 时间胶囊清单 API（供 Telegram Bot 检查「今天有胶囊到期吗」）
 * 注意：这里故意不过滤 capsule 日期——未来胶囊也要暴露给 Bot
 */
export const GET: APIRoute = async () => {
	const all = await getCollection("moments");
	const now = new Date();
	const capsules = all
		.filter((m) => m.data.capsule)
		.map((m) => {
			const capsule = m.data.capsule;
			// 上一行 filter 已保证 capsule 存在；此处显式判空只为类型收窄，
			// 兜底分支返回 false，与原先 new Date(undefined) 得到 Invalid Date 的比较结果一致
			const isExpired = capsule ? new Date(capsule) <= now : false;
			return {
				slug: stripMomentId(m.id),
				capsule,
				published: m.data.published,
				tags: extractMomentTags(m.body),
				text: isExpired
					? momentToText(m.body).slice(0, 120)
					: "[未到期时间胶囊：正文已封存未解锁]",
				isUnlocked: isExpired,
			};
		})
		.sort((a, b) => String(a.capsule).localeCompare(String(b.capsule)));

	return new Response(
		JSON.stringify({ updated: new Date().toISOString(), capsules }),
		{
			headers: { "Content-Type": "application/json; charset=utf-8" },
		},
	);
};
