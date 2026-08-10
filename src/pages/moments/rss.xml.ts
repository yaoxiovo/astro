import { siteConfig } from "@/config";
import {
	getSortedMoments,
	momentToText,
	extractMomentTags,
	stripMomentId,
} from "@/utils/content-utils";
import rss from "@astrojs/rss";
import type { RSSFeedItem } from "@astrojs/rss";
import type { APIContext } from "astro";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

const markdownParser = new MarkdownIt();

export async function GET(context: APIContext) {
	if (!context.site) {
		throw Error("site not set");
	}

	const moments = (await getSortedMoments()).filter((m) => !m.data.replyTo);
	const feed: RSSFeedItem[] = moments.map((m) => {
		const d = new Date(m.data.published);
		const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		const text = momentToText(m.body, 60) || "查看动态";
		const html = markdownParser.render(m.body || "");

		return {
			title: `${dateStr} · ${text.slice(0, 30)}`,
			description: momentToText(m.body, 200),
			pubDate: m.data.published,
			link: `/moment/${stripMomentId(m.id)}/`,
			categories: extractMomentTags(m.body),
			content: sanitizeHtml(html, {
				allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
			}),
		};
	});

	return rss({
		title: `${siteConfig.title} · 朋友圈`,
		description: "瑶曦的朋友圈动态订阅",
		site: context.site,
		items: feed,
		customData: `<language>${siteConfig.lang}</language>`,
	});
}