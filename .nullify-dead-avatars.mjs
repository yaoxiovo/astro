// 把源站已失效的头像改为 null（组件有占位图标分支），彻底移除外部依赖
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "src/data/sponsors");

const DEAD = {
	"CPer(下北泽の我).json": "https://blog.510904.xyz/_astro/1.BpX3ReIY_2fdyFy.webp",
	"rownix.json": "https://xapi.rownix.dev/8bec399a8d697bf4db49df6073b263795760a2a9.jpg",
	"zz4zz.json": "https://zhongzhong.space/wp-content/uploads/2025/11/avatar.webp",
	"夜轻.json": "https://blog.yeqing.net/favicon.ico",
	"风萧li.json": "https://r2.1t.nz/images/avatars/Ferxal.webp",
};

for (const [file, url] of Object.entries(DEAD)) {
	const full = path.join(DIR, file);
	const raw = fs.readFileSync(full, "utf8");
	const before = raw;
	const after = raw.replace(
		new RegExp(`"avatar"\\s*:\\s*"${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
		'"avatar": null',
	);
	if (before === after) {
		console.log(`SKIP ${file}（未匹配到目标 URL）`);
		continue;
	}
	fs.writeFileSync(full, after, "utf8");
	console.log(`OK   ${file} -> avatar: null`);
}
