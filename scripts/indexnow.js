const SITE = process.env.SITE_URL || "https://blog.yaoxi.wiki";
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || "8f0b7e1e4b7447819acb7bf9d8a6d324";
const INDEXNOW_ENDPOINT = process.env.INDEXNOW_ENDPOINT || "https://api.indexnow.org/indexnow";

const rawUrls = process.env.INDEXNOW_URLS || process.argv.slice(2).join(",");

function normalizeSite(value) {
	return value.replace(/\/+$/, "");
}

function toAbsoluteUrl(value) {
	const trimmed = value.trim();
	if (!trimmed) return null;

	try {
		return new URL(trimmed).href;
	} catch {
		return new URL(trimmed.startsWith("/") ? trimmed : `/${trimmed}`, normalizeSite(SITE)).href;
	}
}

const urls = Array.from(
	new Set(
		rawUrls
			.split(/[\n,]/)
			.map(toAbsoluteUrl)
			.filter(Boolean),
	),
);

if (!urls.length) {
	console.log("没有需要推送到 IndexNow 的 URL，跳过。");
	process.exit(0);
}

const siteUrl = new URL(normalizeSite(SITE));
const body = {
	host: siteUrl.host,
	key: INDEXNOW_KEY,
	keyLocation: `${normalizeSite(SITE)}/${INDEXNOW_KEY}.txt`,
	urlList: urls,
};

console.log(`准备推送 ${urls.length} 个 URL 到 IndexNow:`);
for (const url of urls) console.log(`- ${url}`);

const response = await fetch(INDEXNOW_ENDPOINT, {
	method: "POST",
	headers: {
		"Content-Type": "application/json; charset=utf-8",
	},
	body: JSON.stringify(body),
});

if (!response.ok && response.status !== 202) {
	const text = await response.text().catch(() => "");
	throw new Error(`IndexNow 推送失败：HTTP ${response.status} ${response.statusText}\n${text}`);
}

console.log(`IndexNow 推送完成：HTTP ${response.status}`);
