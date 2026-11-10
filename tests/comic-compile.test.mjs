import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const astroRequire = createRequire(require.resolve("astro/package.json"));
const compiler = astroRequire("@astrojs/compiler");
const esbuild = astroRequire("esbuild");

test("reader source preference persists and ignores legacy remote-source switches", async () => {
	const source = await readFile(
		new URL("../src/utils/comic-storage.ts", import.meta.url),
		"utf8",
	);
	const result = await esbuild.transform(source, {
		loader: "ts",
		format: "esm",
	});
	const storage = await import(
		`data:text/javascript;base64,${Buffer.from(result.code).toString("base64")}`
	);
	const saved = new Map();
	const previous = globalThis.window;
	globalThis.window = {
		localStorage: {
			getItem: (key) => saved.get(key) ?? null,
			setItem: (key, value) => saved.set(key, value),
		},
	};
	try {
		assert.equal(storage.getComicReaderPrefs().imageSource, "cdn");
		storage.saveComicReaderPrefs({ imageSource: "r2" });
		assert.equal(storage.getComicReaderPrefs().imageSource, "r2");
		saved.set(
			"yaoxi-comic-prefs-v1",
			JSON.stringify({
				imageSource: "https://other.example",
				preferRemoteSource: true,
			}),
		);
		assert.equal(storage.getComicReaderPrefs().imageSource, "cdn");
		assert.equal("preferRemoteSource" in storage.getComicReaderPrefs(), false);
	} finally {
		globalThis.window = previous;
	}
});

for (const route of [
	"src/pages/comics/[comic].astro",
	"src/pages/comics/[comic]/[chapter].astro",
]) {
	test(`${route} compiles to valid TypeScript`, async () => {
		const source = await readFile(
			new URL(`../${route}`, import.meta.url),
			"utf8",
		);
		const compiled = await compiler.transform(source, { filename: route });
		await esbuild.transform(compiled.code, { loader: "ts", format: "esm" });
	});
}
