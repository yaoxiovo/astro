import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const astroRequire = createRequire(require.resolve("astro/package.json"));
const esbuild = astroRequire("esbuild");
const source = await readFile(
	new URL("../src/utils/comic-cache.ts", import.meta.url),
	"utf8",
);
const { code } = await esbuild.transform(source, {
	loader: "ts",
	format: "esm",
});
const { readComicCacheInfo } = await import(
	`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);

for (const name of [
	"CF-Cache-Status",
	"EO-Cache-Status",
	"X-Site-Cache-Status",
]) {
	for (const [value, hit] of [
		["HIT", true],
		["MISS", false],
	]) {
		test(`${name}: ${value} reports the provider's cache result`, () => {
			const info = readComicCacheInfo(
				new Response(null, { headers: { [name]: value, Age: "0" } }),
				12.4,
			);
			assert.equal(info.hit, hit);
			assert.ok(
				info.headers.some(
					(header) => header.name === name && header.value === value,
				),
			);
			assert.ok(
				info.headers.some(
					(header) => header.name === "Age" && header.value === "0",
				),
			);
			assert.equal(info.durationMs, 12);
		});
	}
}

test("hidden or unrecognized cache headers remain unknown even when Age is present", () => {
	for (const headers of [
		{ Age: "123" },
		{ "CF-Cache-Status": "NEW_STATE" },
		{},
	]) {
		const info = readComicCacheInfo(new Response(null, { headers }), 0);
		assert.equal(info.hit, null);
		assert.equal(info.status, "缓存状态未公开");
	}
});

test("stale, revalidated, expired and bypass responses retain their distinct meaning", () => {
	for (const [value, hit, status] of [
		["STALE", true, "使用旧缓存"],
		["REVALIDATED", true, "缓存已重新验证"],
		["EXPIRED", false, "缓存过期，已回源"],
		["BYPASS", false, "未使用 CDN 缓存"],
	]) {
		const info = readComicCacheInfo(
			new Response(null, { headers: { "CF-Cache-Status": value } }),
			1,
		);
		assert.equal(info.hit, hit);
		assert.equal(info.status, status);
	}
});

test("a cached error is shown as a failed image request", () => {
	const info = readComicCacheInfo(
		new Response(null, { status: 404, headers: { "CF-Cache-Status": "HIT" } }),
		1,
	);
	assert.equal(info.httpStatus, 404);
	assert.equal(info.status, "图片请求失败");
	assert.equal(info.hit, null);
});
