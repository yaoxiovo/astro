#!/usr/bin/env node
/**
 * ensure-full-history.mjs — 跨平台的浅克隆补全守卫
 *
 * 背景：wiki 修订历史（generate-wiki-history.mjs）依赖完整的 git 提交历史。
 *       此前该守卫以 POSIX shell 内联写在 package.json 的 prebuild 里：
 *         (git rev-parse --is-shallow-repository 2>/dev/null | grep -q true && (...) || true)
 *       在 Windows 的 cmd.exe（npm/pnpm 的默认脚本 shell）下，`2>/dev/null` 与 `grep`
 *       均不可用，整条命令以 255 退出，`&&` 链断裂，导致本地 `pnpm build` 时
 *       4 个生成脚本全部被静默跳过。本脚本用 Node 重写同一语义，全平台一致。
 *
 * 行为：
 *   - 非浅克隆 / 非 git 仓库 → 立即成功退出（不阻塞构建）
 *   - 浅克隆 → 依次尝试 `git fetch --unshallow`，失败则回退 `git fetch --depth=2000 origin HEAD`
 *   - 任何 git 失败都不阻断构建（与旧行为的 `|| true` 等价）
 */

import { execFileSync } from "node:child_process";

const GIT_TIMEOUT_MS = 120_000;

/** 执行 git 命令，返回 { ok, stdout }；任何失败都不抛出 */
function git(args) {
	try {
		const stdout = execFileSync("git", args, {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: GIT_TIMEOUT_MS,
		});
		return { ok: true, stdout: stdout.trim() };
	} catch {
		return { ok: false, stdout: "" };
	}
}

const probe = git(["rev-parse", "--is-shallow-repository"]);
if (!probe.ok) {
	// 非 git 仓库（例如从 tarball 构建）：无需补全历史，静默放行
	process.exit(0);
}

if (probe.stdout !== "true") {
	// 已是完整克隆
	process.exit(0);
}

console.log("[git] 检测到浅克隆，正在补全提交历史以生成 wiki 修订记录…");

if (git(["fetch", "--unshallow"]).ok) {
	console.log("[git] 已补全为完整克隆。");
	process.exit(0);
}

if (git(["fetch", "--depth=2000", "origin", "HEAD"]).ok) {
	console.log("[git] 已加深历史至 2000 次提交。");
	process.exit(0);
}

// 与旧实现的 `|| true` 一致：补全失败不阻断构建，仅告警
console.warn(
	"[git] 警告：浅克隆补全失败，wiki 修订历史可能不完整（构建继续）。",
);
process.exit(0);
