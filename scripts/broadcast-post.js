/**
 * 博客新文章自动化邮件广播脚本
 * 触发方式：GitHub Actions 或本地 `node scripts/broadcast-post.js [--file=xxx] [--preview]`
 */

import fs from "node:fs";
import path from "node:path";

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

async function main() {
	const postsDir = path.resolve("./src/content/posts");
	let targetFile = fileArg;

	if (!targetFile) {
		// 未指定文件时，按修改时间降序找到最新的一篇非草稿 markdown
		const files = fs
			.readdirSync(postsDir)
			.filter((f) => f.endsWith(".md"))
			.map((f) => {
				const full = path.join(postsDir, f);
				const stat = fs.statSync(full);
				return { file: f, full, mtime: stat.mtimeMs };
			})
			.sort((a, b) => b.mtime - a.mtime);

		for (const item of files) {
			const text = fs.readFileSync(item.full, "utf-8");
			const fm = parseFrontmatter(text);
			if (fm.draft !== true) {
				targetFile = item.file;
				break;
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
