/**
 * 博客新文章自动化邮件广播脚本
 * 触发方式：GitHub Actions 或本地 `node scripts/broadcast-post.js [--file=xxx] [--preview]`
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const API_BASE = process.env.BLOG_API_BASE || "https://blog-api.yaoxi.cloud";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const BLOG_ORIGIN = "https://blog.yaoxi.wiki";

const args = process.argv.slice(2);
const isPreview = args.includes("--preview");
const fileArg = args.find((a) => a.startsWith("--file="))?.split("=")[1];

function parseFrontmatter(content) {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	const yaml = match[1];
	const result = {};

	for (const line of yaml.split("\n")) {
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const key = line.slice(0, colon).trim();
		let val = line.slice(colon + 1).trim();

		if (val.startsWith('"') && val.endsWith('"')) {
			val = val.slice(1, -1);
		} else if (val.startsWith("'") && val.endsWith("'")) {
			val = val.slice(1, -1);
		} else if (val === "true") val = true;
		else if (val === "false") val = false;

		result[key] = val;
	}

	// 提取 tags 列表
	const tagsMatch = yaml.match(/tags:\s*\n((?:\s*-\s*[^\n]+\n?)+)/);
	if (tagsMatch) {
		result.tags = tagsMatch[1]
			.split("\n")
			.map((l) => l.replace(/^\s*-\s*/, "").trim())
			.filter(Boolean);
	}

	return result;
}

/**
 * 从 Git 变更历史中识别本次 Push 或最新 Commit 实际改动的文章
 */
function detectChangedPostFromGit(postsDir) {
	const candidates = new Set();
	try {
		// 1. 如果有 BEFORE_SHA（GitHub Push 事件），对比前后 commit 差异
		const beforeSha = process.env.BEFORE_SHA;
		if (beforeSha && beforeSha !== "0000000000000000000000000000000000000000") {
			try {
				const rangeDiff = execSync(`git diff --name-only ${beforeSha} HEAD -- src/content/posts`, {
					encoding: "utf-8",
					stdio: ["ignore", "pipe", "ignore"],
				}).trim();
				if (rangeDiff) {
					for (const line of rangeDiff.split("\n")) {
						const trimmed = line.trim();
						if (trimmed.endsWith(".md")) candidates.add(trimmed);
					}
				}
			} catch (e) {
				// beforeSha 可能在 shallow clone 中不可见，回退到 HEAD
			}
		}

		// 2. 检查当前 HEAD commit 的变动文件（git diff-tree）
		if (candidates.size === 0) {
			const diffTree = execSync("git diff-tree --no-commit-id --name-only -r HEAD -- src/content/posts", {
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			if (diffTree) {
				for (const line of diffTree.split("\n")) {
					const trimmed = line.trim();
					if (trimmed.endsWith(".md")) candidates.add(trimmed);
				}
			}
		}

		// 3. 检查 HEAD~1 到 HEAD 的差异
		if (candidates.size === 0) {
			try {
				const diffHead = execSync("git diff --name-only HEAD~1 HEAD -- src/content/posts", {
					encoding: "utf-8",
					stdio: ["ignore", "pipe", "ignore"],
				}).trim();
				if (diffHead) {
					for (const line of diffHead.split("\n")) {
						const trimmed = line.trim();
						if (trimmed.endsWith(".md")) candidates.add(trimmed);
					}
				}
			} catch {}
		}

		// 4. 回退：git log -1
		if (candidates.size === 0) {
			const logOut = execSync("git log -1 --name-only --pretty='' -- src/content/posts", {
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			if (logOut) {
				for (const line of logOut.split("\n")) {
					const trimmed = line.trim();
					if (trimmed.endsWith(".md")) candidates.add(trimmed);
				}
			}
		}
	} catch (e) {
		console.warn("⚠️ Git 变更探测异常：", e.message);
	}

	// 过滤出存在且非草稿、非加密的 markdown
	const validPosts = [];
	for (const relPath of candidates) {
		const fullPath = path.resolve(relPath);
		if (!fs.existsSync(fullPath)) continue;
		const content = fs.readFileSync(fullPath, "utf-8");
		const fm = parseFrontmatter(content);
		if (fm.draft !== true && fm.encrypted !== true) {
			validPosts.push({
				file: path.basename(relPath),
				full: fullPath,
				published: fm.published ? new Date(fm.published).getTime() : 0,
			});
		}
	}

	if (validPosts.length > 0) {
		// 如果本次提交修改了多篇，按发布时间降序取最新的一篇
		validPosts.sort((a, b) => b.published - a.published);
		return validPosts[0].file;
	}

	return null;
}

/**
 * 降级策略：按真实发布时间 (published) 倒序查找最新发布文章
 * 绝对不优先考虑 pinned 置顶标志！置顶是页面展示属性，绝不是发信时间依据！
 */
function findLatestPublishedPost(postsDir) {
	const allFiles = fs
		.readdirSync(postsDir)
		.filter((f) => f.endsWith(".md"))
		.map((f) => {
			const full = path.join(postsDir, f);
			const text = fs.readFileSync(full, "utf-8");
			const fm = parseFrontmatter(text);
			return {
				file: f,
				full,
				draft: fm.draft === true,
				encrypted: fm.encrypted === true,
				published: fm.published ? new Date(fm.published).getTime() : 0,
			};
		})
		.filter((p) => !p.draft && !p.encrypted)
		.sort((a, b) => b.published - a.published);

	return allFiles[0]?.file || null;
}

async function main() {
	const postsDir = path.resolve("./src/content/posts");
	let targetFile = fileArg;

	if (targetFile) {
		console.log(`📌 用户指定广播文章：${targetFile}`);
	} else {
		// 1. 优先从 Git 实际变更记录中提取本次被修改/新增的文章
		targetFile = detectChangedPostFromGit(postsDir);
		if (targetFile) {
			console.log(`🔍 从 Git 变动中自动定位目标文章：${targetFile}`);
		} else {
			// 2. 降级：按 published 真实发布时间倒序获取最新一篇文章（杜绝置顶干扰）
			targetFile = findLatestPublishedPost(postsDir);
			if (targetFile) {
				console.log(`⏰ 从文章发布时间降序中自动选取最新文章：${targetFile}`);
			}
		}
	}

	if (!targetFile) {
		console.log("未找到可供广播的文章，跳过发信。");
		return;
	}

	const filePath = path.join(postsDir, targetFile);
	const content = fs.readFileSync(filePath, "utf-8");
	const fm = parseFrontmatter(content);

	if (fm.draft === true) {
		console.log(`文章 ${targetFile} 为草稿(draft: true)，跳过广播。`);
		return;
	}
	if (fm.encrypted === true) {
		console.log(`文章 ${targetFile} 为端到端加密文章(encrypted: true)，跳过全员邮件广播。`);
		return;
	}

	const slug = targetFile.replace(/\.md$/, "");
	const postUrl = `${BLOG_ORIGIN}/posts/${slug}/`;
	const title = fm.title || slug;
	const summary = fm.description || "瑶曦 Blog 发布了最新文章，点击前往阅读全文。";
	const pubDate = fm.published || new Date().toISOString();
	const tags = Array.isArray(fm.tags) ? fm.tags : [];

	console.log(`📡 准备广播文章：${title}`);
	console.log(`🔗 链接：${postUrl}`);
	console.log(`🏷️ 标签：${tags.join(", ") || "无"}`);
	console.log(`模式：${isPreview ? "仅预览测试 (preview)" : "正式群发"}`);

	if (!ADMIN_TOKEN && !isPreview) {
		console.warn("⚠️ 未配置 ADMIN_TOKEN 环境变量，无法向 API 鉴权。跳过正式发信。");
		return;
	}

	const payload = {
		title,
		summary,
		url: postUrl,
		pubDate,
		tags,
		author: "瑶曦",
		type: "post",
		preview: isPreview,
	};

	try {
		const res = await fetch(`${API_BASE}/api/newsletter/broadcast`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {}),
			},
			body: JSON.stringify(payload),
		});

		const result = await res.json();
		console.log("API 响应：", res.status, result);

		if (!res.ok || !result.ok) {
			console.error("❌ 广播请求失败：", result.message || result.error);
			process.exitCode = 1;
		} else {
			console.log(`✅ 发信完成！总订阅者：${result.total ?? 0}，成功送达：${result.sent ?? 0}，失败：${result.failed ?? 0}`);
		}
	} catch (err) {
		console.error("❌ 发送异常：", err);
		process.exitCode = 1;
	}
}

main();
