/** Run by remote CI on the existing Linux host. No build is performed. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const [release, sha] = process.argv.slice(2);
if (!release || !/^[0-9a-f]{40}$/.test(sha || ""))
	throw new Error("Invalid release arguments");
const root = "/opt/yaoxi-workers";
const envFile = "/etc/yaoxi-workers/blog-api.env";
const service = "local-workers@blog-api.service";
const patch = path.join(release, "changes.patch");
const files = fs
	.readFileSync(path.join(release, "changed-paths"), "utf8")
	.split("\0")
	.filter(Boolean);
if (
	files.some(
		(file) =>
			!/^blog-api\/src\/[\w./-]+\.js$/.test(file) ||
			file.split("/").includes(".."),
	)
)
	throw new Error("Unexpected deployment path");
const oldEnv = fs.readFileSync(envFile, "utf8");
const values = parseEnv(oldEnv);
if (values.SERVICE !== "blog-api") throw new Error("Unexpected target service");
const credentialFile = "/root/.config/lumitape/tencent-edgeone.json";
const saved = fs.existsSync(credentialFile)
	? JSON.parse(fs.readFileSync(credentialFile, "utf8"))
	: {};
const id = saved.SecretId || values.TENCENTCLOUD_SECRET_ID;
const key = saved.SecretKey || values.TENCENTCLOUD_SECRET_KEY;
if (!id || !key)
	throw new Error(
		"Existing Tencent credentials are unavailable on the production host",
	);
const updates = {
	TENCENT_TMS_ENABLED: "true",
	TENCENTCLOUD_SECRET_ID: id,
	TENCENTCLOUD_SECRET_KEY: key,
	TENCENT_TMS_REGION: values.TENCENT_TMS_REGION || "ap-guangzhou",
};
const retainedEnv = oldEnv
	.split(/\r?\n/)
	.filter((line) => {
		const name = line.match(/^\s*(?:export\s+)?([\w]+)\s*=/)?.[1];
		return (
			!Object.hasOwn(updates, name || "") &&
			!(saved.SecretId && name === "TENCENTCLOUD_TOKEN")
		);
	})
	.join("\n");
const tmsEnv = Object.entries(updates)
	.map(([name, value]) => `${name}=${JSON.stringify(value)}`)
	.join("\n");
const newEnv = `${retainedEnv}\n${tmsEnv}\n`;

const changed = fs.statSync(patch).size > 0;
if (changed)
	execFileSync("git", ["apply", "--check", patch], {
		cwd: root,
		stdio: "pipe",
	});
const backup = `/var/backups/yaoxi-blog-api/${new Date().toISOString().replace(/[:.]/g, "-")}-${sha.slice(0, 8)}`;
fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(backup, "blog-api.env"), oldEnv, { mode: 0o600 });
const previous = files.map((file) => ({
	file,
	exists: fs.existsSync(path.join(root, file)),
}));
for (const { file, exists } of previous) {
	if (!exists) continue;
	fs.mkdirSync(path.dirname(path.join(backup, file)), { recursive: true });
	fs.copyFileSync(path.join(root, file), path.join(backup, file));
}
let modified = false;
try {
	modified = true;
	if (changed)
		execFileSync("git", ["apply", patch], { cwd: root, stdio: "pipe" });
	for (const file of files)
		if (fs.existsSync(path.join(root, file)))
			execFileSync(process.execPath, ["--check", path.join(root, file)], {
				stdio: "pipe",
			});
	fs.writeFileSync(envFile, newEnv, { mode: 0o600 });
	fs.chmodSync(envFile, 0o600);
	const { moderateTencentText } = await import(
		pathToFileURL(path.join(root, "blog-api/src/tencent-tms.js"))
	);
	const result = await moderateTencentText(
		parseEnv(newEnv),
		"这是一条博客评论内容安全接入测试。",
	);
	if (result.suggestion !== "Pass")
		throw new Error(
			`Tencent verification failed: ${result.suggestion}/${result.error || "review"}`,
		);
	execFileSync("systemctl", ["restart", service], { stdio: "pipe" });
	let healthy = false;
	for (let attempt = 0; attempt < 15; attempt++) {
		try {
			const response = await fetch(
				`http://127.0.0.1:${values.PORT || "3101"}/healthz`,
				{ signal: AbortSignal.timeout(2000) },
			);
			const body = await response.json();
			if (response.ok && body.ok && body.service === "blog-api") {
				healthy = true;
				break;
			}
		} catch {
			/* Allow the service to bind after restart. */
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	if (!healthy) throw new Error("Blog API health check failed");
	fs.writeFileSync(path.join(root, ".blog-api-deploy-sha"), `${sha}\n`);
	console.log(
		JSON.stringify({
			deployed: sha,
			service,
			tms: result.suggestion,
			requestId: result.requestId,
			backup,
		}),
	);
} catch (error) {
	if (modified) {
		for (const { file, exists } of previous) {
			if (exists)
				fs.copyFileSync(path.join(backup, file), path.join(root, file));
			else fs.rmSync(path.join(root, file), { force: true });
		}
		fs.writeFileSync(envFile, oldEnv, { mode: 0o600 });
		execFileSync("systemctl", ["restart", service], { stdio: "pipe" });
	}
	// Suppress subprocess stderr and secret-bearing arguments from CI output.
	console.error(
		JSON.stringify({
			failed: true,
			reason: error?.code || error?.message?.split("\n")[0],
			restored: modified,
			backup,
		}),
	);
	process.exitCode = 1;
}
