import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const astroRequire = createRequire(require.resolve("astro/package.json"));
const compiler = astroRequire("@astrojs/compiler");
const esbuild = astroRequire("esbuild");

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
