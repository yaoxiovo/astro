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
    content: `
        <div style="border-left: 4px solid #1a73e8; padding-left: 10px; margin-bottom: 12px;">
            <strong style="color: #1a73e8;">🛡️ 立场声明：</strong>本站坚定拥护党中央领导，严格遵守国家法律法规。文中所有推演语义场严格限定于 AGI 逻辑范畴，严禁脱离技术语境政治化解读。
        </div>
        <div style="border-left: 4px solid #ff4d4f; padding-left: 10px;">
            <strong style="color: #ff4d4f;">⚠️ 风险预警：</strong>限制类文章包含高强度反事实逻辑，可能诱发严重的现实感解体（Derealization）及心理不适。访问即代表同意置顶《合规协议》。
        </div>
    `,
    level: "critical", // 这里的 level 保持原样，我们通过内联 style 强行改色
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
