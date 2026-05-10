const SITE_URL = process.env.SITE_URL ?? "https://blog.yaoxi.wiki";
const INDEXNOW_KEY = process.env.INDEXNOW_KEY ?? "9c772a4f0f1e4b9082d4bb642f4fd1e7";
const INDEXNOW_KEY_LOCATION = `${SITE_URL.replace(/\/$/, "")}/${INDEXNOW_KEY}.txt`;
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS_PER_REQUEST = 10000;

function normalizeSiteUrl(value) {
	return value.replace(/\/$/, "");
}

async function fetchText(url) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
	}
	return response.text();
}

function extractUrlsFromSitemap(xml) {
	const matches = xml.matchAll(/<loc>(.*?)<\/loc>/g);
	return [...matches].map((match) => match[1].trim()).filter(Boolean);
}

async function collectUrlsFromSitemap(sitemapUrl, visited = new Set()) {
	if (visited.has(sitemapUrl)) return [];
	visited.add(sitemapUrl);

	const xml = await fetchText(sitemapUrl);
	const urls = extractUrlsFromSitemap(xml);

	const nestedSitemaps = urls.filter((url) => url.endsWith(".xml"));
	if (nestedSitemaps.length === 0) return urls;

	const nestedUrls = await Promise.all(
		nestedSitemaps.map((url) => collectUrlsFromSitemap(url, visited)),
	);
	return nestedUrls.flat();
}

function chunk(items, size) {
	const chunks = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}

async function submitUrls(urls) {
	const siteUrl = normalizeSiteUrl(SITE_URL);
	const host = new URL(siteUrl).host;
	const uniqueUrls = [...new Set(urls)].filter((url) => new URL(url).host === host);

	if (uniqueUrls.length === 0) {
		console.log("No URLs found to submit.");
		return;
	}

	for (const urlList of chunk(uniqueUrls, MAX_URLS_PER_REQUEST)) {
		const response = await fetch(INDEXNOW_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json; charset=utf-8",
			},
			body: JSON.stringify({
				host,
				key: INDEXNOW_KEY,
				keyLocation: INDEXNOW_KEY_LOCATION,
				urlList,
			}),
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(`IndexNow submit failed: ${response.status} ${response.statusText}\n${body}`);
		}

		console.log(`Submitted ${urlList.length} URL(s) to IndexNow.`);
	}
}

const sitemapUrl = `${normalizeSiteUrl(SITE_URL)}/sitemap-index.xml`;
const urls = await collectUrlsFromSitemap(sitemapUrl);
await submitUrls(urls);
