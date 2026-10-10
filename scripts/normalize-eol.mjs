/**
 * normalize-eol.mjs — 把工作区文本文件的行尾统一为 LF
 *
 * 背景：仓库已新增 .gitattributes（* text=auto eol=lf），但该文件只影响
 * 此后的检出行为。当前工作区里由 core.autocrlf=true 转换出的 CRLF 文件
 * 需要显式规范化，否则 Biome（formatter.lineEnding 默认 lf，且 1.9.4 无 auto）
 * 会一直把 CRLF 判为格式错误。
 *
 * 只处理文本类扩展名，跳过二进制；只把 CRLF 改成 LF，不做其它改动。
 */
import fs from "node:fs";
import path from "node:path";

const TEXT_EXT = new Set([
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".astro",
	".svelte",
	".vue",
	".json",
	".jsonc",
	".css",
	".styl",
	".md",
	".mdx",
	".yml",
	".yaml",
	".html",
	".txt",
	".sql",
	".sh",
	".bat",
]);
const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	".astro",
	".wrangler",
]);

let converted = 0;
let scanned = 0;

function walk(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			walk(path.join(dir, entry.name));
			continue;
		}
		if (!entry.isFile()) continue;
		if (!TEXT_EXT.has(path.extname(entry.name).toLowerCase())) continue;

		const full = path.join(dir, entry.name);
		scanned++;
		const buf = fs.readFileSync(full);
		if (!buf.includes(0x0d)) continue; // 无 CR，已是 LF
		const text = buf.toString("utf8");
		if (!text.includes("\r\n")) continue;
		fs.writeFileSync(full, text.replace(/\r\n/g, "\n"));
		converted++;
	}
}

walk(process.cwd());
console.log(`[eol] 扫描 ${scanned} 个文本文件，规范化 ${converted} 个为 LF`);
