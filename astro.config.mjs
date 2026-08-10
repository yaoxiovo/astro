import fs from "node:fs";
import path from "node:path";
import sitemap from "@astrojs/sitemap";
import svelte from "@astrojs/svelte";
import tailwind from "@astrojs/tailwind";
import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections";
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers";
import swup from "@swup/astro";
import expressiveCode from "astro-expressive-code";
import icon from "astro-icon";
import { defineConfig, passthroughImageService } from "astro/config";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeComponents from "rehype-components"; /* Render the custom directive content */
import rehypeExternalLinks from "rehype-external-links";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import remarkDirective from "remark-directive"; /* Handle directives */
import { remarkGithubAdmonitions } from "./src/plugins/remark-github-admonitions.js";
import remarkMath from "remark-math";
import remarkSectionize from "remark-sectionize";
import { imageFallbackConfig, siteConfig } from "./src/config.ts";
import { expressiveCodeConfig } from "./src/config.ts";
// import { pluginLanguageBadge } from "./src/plugins/expressive-code/language-badge.ts";
import { pluginCustomCopyButton } from "./src/plugins/expressive-code/custom-copy-button.js";
import { AdmonitionComponent } from "./src/plugins/rehype-component-admonition.mjs";
import { GithubCardComponent } from "./src/plugins/rehype-component-github-card.mjs";
import { UrlCardComponent } from "./src/plugins/rehype-component-url-card.mjs";
import rehypeImageFallback from "./src/plugins/rehype-image-fallback.mjs";
import { parseDirectiveNode } from "./src/plugins/remark-directive-rehype.js";
import { remarkExcerpt } from "./src/plugins/remark-excerpt.js";
import { remarkReadingTime } from "./src/plugins/remark-reading-time.mjs";

// Build backlink whitelist only for official yaoxi.wiki and subdomains
const backlinkWhitelist = new Set([
	"yaoxi.wiki",
	"blog.yaoxi.wiki",
	"png.yaoxi.wiki",
	"api.blog.yaoxi.cloud",
	"umami.yaoxi.cloud",
	"yaoxi.xyz"
]);

// ---- SEO: sitemap 白名单与 lastmod ----
// 只让高价值页面进 sitemap：首页、归档页、文章页
// 排除：分页页(/2/ /3/)、gallery/graph/music/moments/moment/sponsors 等低价值或 JS 功能页
function isIndexablePage(pageUrl) {
	const { pathname } = new URL(pageUrl);
	if (pathname === "/") return true;
	if (pathname === "/archive/") return true;
	return pathname.startsWith("/posts/");
}

// 从文章 frontmatter 读取 published/updated 作为 sitemap lastmod
const postDates = new Map();
try {
	const postsDir = path.join(process.cwd(), "src/content/posts");
	for (const file of fs.readdirSync(postsDir)) {
		if (!file.endsWith(".md")) continue;
		const content = fs.readFileSync(path.join(postsDir, file), "utf-8");
		const published = content.match(/^published:\s*(.+)$/m)?.[1]?.trim();
		const updated = content.match(/^updated:\s*(.+)$/m)?.[1]?.trim();
		if (published) {
			postDates.set(`/posts/${file.replace(/\.md$/, "")}/`, (updated || published).slice(0, 10));
		}
	}
} catch (e) {
	console.warn("[sitemap] 读取文章日期失败:", e);
}

// https://astro.build/config
export default defineConfig({
	image: {
		service: (process.env.NODE_ENV === "development" || process.env.LOCAL_AARCH64 === "true")
			? passthroughImageService()
			: undefined,
	},
	site: "https://blog.yaoxi.wiki",
	base: "/",
	trailingSlash: "always",
	output: "static",
	integrations: [
		tailwind({
			nesting: true,
		}),
		swup({
			theme: false,
			animationClass: "transition-swup-", // see https://swup.js.org/options/#animationselector
			// the default value `transition-` cause transition delay
			// when the Tailwind class `transition-all` is used
			containers: ["main", "#toc"],
			smoothScrolling: true,
			cache: true,
			preload: true,
			accessibility: true,
			updateHead: true,
			updateBodyClass: false,
			globalInstance: true,
		}),
		icon({
			include: {
				"fa6-brands": ["*"],
				"fa6-regular": ["*"],
				"fa6-solid": ["*"],
				"simple-icons": ["*"],
				"material-symbols-light": ["*"],
				"material-symbols": ["*"],
			},
		}),
		svelte(),
		sitemap({
			filter: isIndexablePage,
			serialize: (item) => {
				const { pathname } = new URL(item.url);
				const lastmod = postDates.get(pathname);
				return lastmod ? { ...item, lastmod } : item;
			},
		}),
		expressiveCode({
			themes: [expressiveCodeConfig.theme, expressiveCodeConfig.theme],
			plugins: [
				pluginCollapsibleSections(),
				pluginLineNumbers(),
				// pluginLanguageBadge(),
				pluginCustomCopyButton(),
			],
			defaultProps: {
				wrap: true,
				overridesByLang: {
					shellsession: {
						showLineNumbers: false,
					},
				},
			},
			styleOverrides: {
				codeBackground: "var(--codeblock-bg)",
				borderRadius: "0.25rem",
				borderColor: "none",
				codeFontSize: "0.875rem",
				codeFontFamily:
					"'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
				codeLineHeight: "1.5rem",
				frames: {
					editorBackground: "var(--codeblock-bg)",
					terminalBackground: "var(--codeblock-bg)",
					terminalTitlebarBackground: "var(--codeblock-topbar-bg)",
					editorTabBarBackground: "var(--codeblock-topbar-bg)",
					editorActiveTabBackground: "none",
					editorActiveTabIndicatorBottomColor: "var(--primary)",
					editorActiveTabIndicatorTopColor: "none",
					editorTabBarBorderBottomColor: "var(--codeblock-topbar-bg)",
					terminalTitlebarBorderBottomColor: "none",
				},
				textMarkers: {
					delHue: 0,
					insHue: 180,
					markHue: 250,
				},
			},
			frames: {
				showCopyToClipboardButton: false,
			},
		}),
	],
	markdown: {
		remarkPlugins: [
			remarkMath,
			remarkReadingTime,
			remarkExcerpt,
			remarkGithubAdmonitions,
			remarkDirective,
			remarkSectionize,
			parseDirectiveNode,
		],
		rehypePlugins: [
			rehypeKatex,
			rehypeSlug,
			[rehypeImageFallback, imageFallbackConfig],
			[
				rehypeComponents,
				{
					components: {
						github: GithubCardComponent,
						url: UrlCardComponent,
						note: (x, y) => AdmonitionComponent(x, y, "note"),
						tip: (x, y) => AdmonitionComponent(x, y, "tip"),
						important: (x, y) => AdmonitionComponent(x, y, "important"),
						caution: (x, y) => AdmonitionComponent(x, y, "caution"),
						warning: (x, y) => AdmonitionComponent(x, y, "warning"),
					},
				},
			],
			[
				rehypeExternalLinks,
				{
					target: "_blank",
					rel: (el) => {
						const href = el.properties?.href;
						if (typeof href !== "string") return ["noopener", "noreferrer", "nofollow"];
						try {
							const urlObj = new URL(href);
							const hostname = urlObj.hostname;
							if (backlinkWhitelist.has(hostname) || backlinkWhitelist.has(hostname.replace(/^www\./, ""))) {
								// Do NOT inject nofollow to trusted partners/friends & official sites
								return ["noopener", "noreferrer"];
							}
						} catch (e) {
							return ["noopener", "noreferrer"];
						}
						// Anti SEO juice leak for raw external links
						return ["noopener", "noreferrer", "nofollow"];
					}
				},
			],
			[
				rehypeAutolinkHeadings,
				{
					behavior: "append",
					properties: {
						className: ["anchor"],
					},
					content: {
						type: "element",
						tagName: "span",
						properties: {
							className: ["anchor-icon"],
							"data-pagefind-ignore": true,
						},
						children: [
							{
								type: "text",
								value: "#",
							},
						],
					},
				},
			],
		],
	},
	vite: {
		build: {
			rollupOptions: {
				onwarn(warning, warn) {
					// temporarily suppress this warning
					if (
						warning.message.includes("is dynamically imported by") &&
						warning.message.includes("but also statically imported by")
					) {
						return;
					}
					warn(warning);
				},
			},
		},
	},
});