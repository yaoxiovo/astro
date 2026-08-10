import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
	const siteUrl = site ?? new URL("https://blog.yaoxi.wiki");
	const sitemapUrl = new URL("sitemap-index.xml", siteUrl).href;

	const robotsTxt = `
User-agent: *
Allow: /
Disallow: /cdn/
Disallow: /draft/

Sitemap: ${sitemapUrl}
`.trim();

	return new Response(robotsTxt, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
};