const quotes = [
  "欲买桂花同载酒，终不似，少年游。",
  "热爱可抵岁月漫长。",
  "世界并不温柔，但你可以。",
  "代码写不动的时候，先活着。",
  "保持浪漫，持续理性。",
];
import type {
	ExpressiveCodeConfig,
	GitHubEditConfig,
	ImageFallbackConfig,
	LicenseConfig,
	NavBarConfig,
	ProfileConfig,
	SiteConfig,
	UmamiConfig,
} from "./types/config";
import { LinkPreset } from "./types/config";

export const siteConfig: SiteConfig = {
	title: "Yaoxi Blog",
	subtitle: "生活分享与实践",
	description:
		"分享生活经验技术",

	keywords: [],
	lang: "zh_CN", // 'en', 'zh_CN', 'zh_TW', 'ja', 'ko', 'es', 'th'
	themeColor: {
		hue: 361, // Default hue for the theme color, from 0 to 360. e.g. red: 0, teal: 200, cyan: 250, pink: 345
		fixed: false, // Hide the theme color picker for visitors
		forceDarkMode: false, // Force dark mode and hide theme switcher
	},
	banner: {
		enable: false,
		src: "/xinghui.avif", // Relative to the /src directory. Relative to the /public directory if it starts with '/'

		position: "center", // Equivalent to object-position, only supports 'top', 'center', 'bottom'. 'center' by default
		credit: {
			enable: true, // Display the credit text of the banner image
			text: "Pixiv @chokei", // Credit text to be displayed

			url: "https://www.pixiv.net/artworks/122782209", // (Optional) URL link to the original artwork or artist's page
		},
	},
	background: {
		enable: true, // Enable background image
		src: "https://t.alcy.cc/ycy", // Background image URL (supports HTTPS)
		position: "center", // Background position: 'top', 'center', 'bottom'
		size: "cover", // Background size: 'cover', 'contain', 'auto'
		repeat: "no-repeat", // Background repeat: 'no-repeat', 'repeat', 'repeat-x', 'repeat-y'
		attachment: "fixed", // Background attachment: 'fixed', 'scroll', 'local'
		opacity: 1, // Background opacity (0-1)
	},
	toc: {
		enable: true, // Display the table of contents on the right side of the post
		depth: 2, // Maximum heading depth to show in the table, from 1 to 3
	},
	notice: {
		enable: true,
		content: "声明：在浏览本站限制类文章前请确保你已阅读并同意置顶文章声明，如不同意请自觉阅读其他文章，否则将可能造成严重影响，包括但不限于：抑郁，轻生念头。
		严禁在休息时段阅读限制类文章，容易引发严重影响，包括但不限于：更严重的生理疾病，主义
        本文包含高强度的反事实逻辑推演，可能对既有认知体系造成剧烈冲击。由于思辨内容涉及极端存在主义与数字伦理边界，阅览过程中可能诱发包括但不限于：严重的抑郁倾向、轻生念念头、现实感解体（Derealization）及深度心理不适。
        最后忠告：如有任何身体不适，立即离开本站，严重时请就医，并尽可能描述问题，否则一样得不到解决。",
		level: "critical",
	},
	favicon: [
		// Leave this array empty to use the default favicon
		{
			src: "https://jpg.yaoxi.wiki/blog.yaoxi.xyz/home.png", // Path of the favicon, relative to the /public directory
			//   theme: 'light',              // (Optional) Either 'light' or 'dark', set only if you have different favicons for light and dark mode
			//   sizes: '32x32',              // (Optional) Size of the favicon, set only if you have favicons of different sizes
		},
	],
	officialSites: [
		{ url: "https://blog.yaoxi.xyz", alias: "CN" },
		{ url: "https://xingye.cyou", alias: "Global" },
	],
	server: [
		{ url: "", text: "博客本体节点" },
		{ url: "https://umami.yaoxi.wiki", text: "Umami节点" }
	],
};

export const navBarConfig: NavBarConfig = {
	links: [
		LinkPreset.Home,
		LinkPreset.Archive,
		{
			name: "友链",
			url: "/friends/", // Internal links should not include the base path, as it is automatically added
			external: false, // Show an external link icon and will open in a new tab
		},
		{
			name: "赞助",
			url: "/sponsors/", // Internal links should not include the base path, as it is automatically added
			external: false, // Show an external link icon and will open in a new tab
		},
		{
			name: "其他网站",
			url: "/posts/other-sites/", // Internal links should not include the base path, as it is automatically added
			external: false, // Show an external link icon and will open in a new tab
		},
		{
			name: "统计",
			url: "https://umami.yaoxi.wiki/share/CLGxRecPqPn9IidK", // Internal links should not include the base path, as it is automatically added
			external: true, // Show an external link icon and will open in a new tab
		},
			
	],
};

export const profileConfig: ProfileConfig = {
	avatar: "https://jpg.yaoxi.wiki/blog.yaoxi.xyz/home.png", // Relative to the /src directory. Relative to the /public directory if it starts with '/'
	name: "瑶曦",
	bio: quotes[Math.floor(Math.random() * quotes.length)],
	links: [
		{
			name: "Bilibli",
			icon: "fa6-brands:bilibili",
			url: "https://space.bilibili.com/",
		},
		{
			name: "GitHub",
			icon: "fa6-brands:github",
			url: "https://github.com/yaoxiovo",
		},
	],
};

export const licenseConfig: LicenseConfig = {
	enable: true,
	name: "CC BY-NC-SA 4.0",
	url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};

export const imageFallbackConfig: ImageFallbackConfig = {
	enable: false,
	originalDomain: "https://eopfapi.acofork.com/pic?img=ua",
	fallbackDomain: "https://eopfapi.acofork.com/pic?img=ua",
};

export const umamiConfig: UmamiConfig = {
	enable: true,
	baseUrl: "https://umami.yaoxi.wiki",
	shareId: "CLGxRecPqPn9IidK",
	timezone: "Asia/Shanghai",
};

export const expressiveCodeConfig: ExpressiveCodeConfig = {
	theme: "github-dark",
};

export const gitHubEditConfig: GitHubEditConfig = {
	enable: true,
	baseUrl: "https://github.com/yaoxiovo/astro/blob/main/src/content/posts",
};

// todoConfig removed from here
