export interface ComicCacheTarget {
	context: string;
	title: string;
	page: number;
	source: string;
	url: string;
}

export interface ComicCacheInfo {
	status: string;
	hit: boolean | null;
	httpStatus: number;
	checkedAt: string;
	durationMs: number;
	headers: Array<{ name: string; value: string }>;
}

const CACHE_HEADERS = [
	"CF-Cache-Status",
	"EO-Cache-Status",
	"X-Site-Cache-Status",
	"X-Cache",
];

const DETAIL_HEADERS = [
	...CACHE_HEADERS,
	"Age",
	"Cache-Control",
	"Expires",
	"Last-Modified",
	"ETag",
	"Content-Length",
	"Server",
	"CF-Ray",
	"EO-LOG-UUID",
	"EagleId",
	"Ali-Swift-Global-Savetime",
	"X-Swift-CacheTime",
	"X-Swift-SaveTime",
];

export function readComicCacheInfo(
	response: Response,
	durationMs: number,
): ComicCacheInfo {
	const raw = CACHE_HEADERS.map((name) => response.headers.get(name)).find(
		(value) => value,
	);
	const state = raw?.trim().toUpperCase();
	let status = "缓存状态未公开";
	let hit: boolean | null = null;
	if (!response.ok) {
		status = "图片请求失败";
	} else if (state && /^(HIT|TCP_HIT)(?:\b|_)/.test(state)) {
		status = "命中 CDN 缓存";
		hit = true;
	} else if (state === "STALE" || state === "UPDATING") {
		status = "使用旧缓存";
		hit = true;
	} else if (state === "REVALIDATED") {
		status = "缓存已重新验证";
		hit = true;
	} else if (state && /^(MISS|TCP_MISS|EXPIRED)(?:\b|_)/.test(state)) {
		status = state === "EXPIRED" ? "缓存过期，已回源" : "未命中 CDN 缓存";
		hit = false;
	} else if (state === "BYPASS" || state === "DYNAMIC" || state === "NOCACHE") {
		status = "未使用 CDN 缓存";
		hit = false;
	}
	return {
		status,
		hit,
		httpStatus: response.status,
		checkedAt: new Date().toISOString(),
		durationMs: Math.round(durationMs),
		headers: DETAIL_HEADERS.flatMap((name) => {
			const value = response.headers.get(name);
			return value === null ? [] : [{ name, value }];
		}),
	};
}
