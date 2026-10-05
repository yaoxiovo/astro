import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { siteConfig } from "@/config";
import { getRecentChangesSync } from "../../utils/wiki-special-loader";

const FEED_SIZE = 100;

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export async function GET(context: APIContext) {
	if (!context.site) {
		throw Error("site not set");
	}

	const data = getRecentChangesSync();
	const entries = (data?.entries || []).slice(0, FEED_SIZE);

	const items = entries.map((entry) => {
		const title = data?.articles?.[entry.slug] || entry.slug;
		const deltaParts: string[] = [];
		if (entry.byteDelta > 0) deltaParts.push(`+${entry.byteDelta} 字节`);
		else if (entry.byteDelta < 0) deltaParts.push(`${entry.byteDelta} 字节`);
		else deltaParts.push("±0 字节");
		deltaParts.push(`+${entry.linesAdded} / -${entry.linesDeleted} 行`);

		const descriptionParts = [
			`贡献者 ${entry.author} 于 ${entry.displayDate} 修订`,
			entry.section ? `章节「${entry.section}」` : "",
			`(${deltaParts.join("，")})`,
			entry.prevShortSha
				? `对比上一版本 ${entry.prevShortSha}`
				: "条目初始创建",
		].filter(Boolean);

		return {
			title: `${title} · ${entry.cleanMessage || "修订"}`,
			link: `/posts/${entry.slug}/revision/${entry.shortSha}/`,
			description: escapeXml(descriptionParts.join(" ")),
			pubDate: new Date(entry.date),
		};
	});

	return rss({
		title: `${siteConfig.title} - 全站最近更改`,
		description: "维基百科式全站修订流：所有条目的最新 Git 修订记录",
		site: context.site,
		items,
		customData: `<language>${siteConfig.lang}</language>`,
	});
}
