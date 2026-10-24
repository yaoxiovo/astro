// 下载赞助商外部头像到本地，并把 JSON 的 avatar 改写为本地路径
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "src/data/sponsors");
const OUT = path.join(ROOT, "public/sponsors/avatars");
fs.mkdirSync(OUT, { recursive: true });

// 文件名 -> 本地 slug
const SLUG = {
	"AlexMa233.json": "alexma233",
	"chuzouX.json": "chuzoux",
	"CPer(下北泽の我).json": "cper",
	"HEISEN黑森.json": "heisen",
	"Maple.json": "maple",
	"MingTone.json": "mingtone",
	"rownix.json": "rownix",
	"zz4zz.json": "zz4zz",
	"コットンキャンディ.json": "cotton",
	"夜轻.json": "yeqing",
	"请输入内容404.json": "neirong404",
	"酷丁同学.json": "kuding",
	"风萧li.json": "fengxiao",
};

const EXT_BY_TYPE = {
	"image/jpeg": ".jpg",
	"image/jpg": ".jpg",
	"image/png": ".png",
	"image/webp": ".webp",
	"image/gif": ".gif",
	"image/x-icon": ".ico",
	"image/vnd.microsoft.icon": ".ico",
	"image/svg+xml": ".svg",
};

const results = [];

for (const [file, slug] of Object.entries(SLUG)) {
	const full = path.join(DIR, file);
	if (!fs.existsSync(full)) {
		results.push({ file, status: "missing-json" });
		continue;
	}
	const raw = fs.readFileSync(full, "utf8");
	const m = raw.match(/"avatar"\s*:\s*"([^"]+)"/);
	if (!m) {
		results.push({ file, status: "no-avatar-field" });
		continue;
	}
	const url = m[1];
	if (!/^https?:\/\//i.test(url)) {
		results.push({ file, status: "already-local", url });
		continue;
	}

	let ext = "";
	try {
		ext = path.extname(new URL(url).pathname).toLowerCase();
	} catch {}
	if (!/^\.(jpg|jpeg|png|webp|gif|ico|svg|avif)$/.test(ext)) ext = "";

	try {
		const res = await fetch(url, {
			headers: { "User-Agent": "Mozilla/5.0 (compatible; avatar-cache/1.0)" },
			redirect: "follow",
		});
		if (!res.ok) {
			results.push({ file, status: `http-${res.status}`, url });
			continue;
		}
		const ct = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
		if (!ext) ext = EXT_BY_TYPE[ct] || ".img";
		// 若声明的扩展名与 content-type 冲突，以 content-type 为准
		if (EXT_BY_TYPE[ct] && EXT_BY_TYPE[ct] !== ext) {
			if (ext === ".ico" && EXT_BY_TYPE[ct] === ".png") ext = ".png";
			else if (ct.startsWith("image/")) ext = EXT_BY_TYPE[ct];
		}

		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.length < 100) {
			results.push({ file, status: "too-small", url, bytes: buf.length });
			continue;
		}
		const outName = `${slug}${ext}`;
		fs.writeFileSync(path.join(OUT, outName), buf);
		const localPath = `/sponsors/avatars/${outName}`;
		fs.writeFileSync(full, raw.replace(m[0], `"avatar": "${localPath}"`), "utf8");
		results.push({ file, status: "ok", url, localPath, bytes: buf.length, ct });
	} catch (e) {
		results.push({ file, status: "error", url, error: String(e.message || e) });
	}
}

for (const r of results) {
	const tag = r.status === "ok" ? "OK  " : r.status === "already-local" ? "SKIP" : "FAIL";
	console.log(
		`${tag} ${r.file.padEnd(26)} ${r.status.padEnd(12)} ${r.localPath || ""} ${r.bytes || ""} ${r.error || ""}`,
	);
}
const ok = results.filter((r) => r.status === "ok").length;
const skip = results.filter((r) => r.status === "already-local").length;
const fail = results.filter((r) => !["ok", "already-local"].includes(r.status));
console.log(`\n成功 ${ok} / 已是本地 ${skip} / 失败 ${fail.length}`);
if (fail.length) console.log("失败明细:", JSON.stringify(fail, null, 2));
