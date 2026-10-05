import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const POSTS_DIR = path.resolve("src/content/posts");
const DATA_DIR = path.resolve("src/data/wiki");
const PUBLIC_API_DIR = path.resolve("public/api/wiki");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "snapshots"), { recursive: true });
fs.mkdirSync(PUBLIC_API_DIR, { recursive: true });
fs.mkdirSync(path.join(PUBLIC_API_DIR, "history"), { recursive: true });
fs.mkdirSync(path.join(PUBLIC_API_DIR, "snapshots"), { recursive: true });

function formatDisplayDate(isoString) {
	try {
		const d = new Date(isoString);
		if (Number.isNaN(d.getTime())) return isoString;
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, "0");
		const day = String(d.getDate()).padStart(2, "0");
		const hours = String(d.getHours()).padStart(2, "0");
		const minutes = String(d.getMinutes()).padStart(2, "0");
		const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
		const weekday = weekdays[d.getDay()];
		return `${year}年${month}月${day}日 (${weekday}) ${hours}:${minutes}`;
	} catch {
		return isoString;
	}
}

function parseSection(message) {
	// 匹配 MediaWiki 经典 /* 章节 */ 格式
	const wikiMatch = message.match(/\/\*\s*(.*?)\s*\*\//);
	if (wikiMatch) {
		return {
			section: wikiMatch[1].trim(),
			cleanMessage: message.replace(wikiMatch[0], "").trim() || message,
		};
	}
	// 匹配 Conventional Commit scope: feat(scope): message
	const convMatch = message.match(/^[a-zA-Z0-9_-]+\((.*?)\):\s*(.*)$/);
	if (convMatch) {
		return {
			section: convMatch[1].trim(),
			cleanMessage: convMatch[2].trim(),
		};
	}
	return {
		section: null,
		cleanMessage: message,
	};
}

function isMinorEdit(message) {
	return (
		message.startsWith("style:") ||
		message.startsWith("chore:") ||
		message.startsWith("fix(typo):") ||
		/minor|typo|错别字|样式调整|格式化|排版/i.test(message)
	);
}

console.log("🐾 [Wiki Generator] 开始提取文章 Git 修订历史与快照...");
const startTime = Date.now();

const postFiles = fs
	.readdirSync(POSTS_DIR)
	.filter((file) => file.endsWith(".md") && !file.startsWith("."));

const historyMap = {};
let totalCommitsExtracted = 0;

for (const file of postFiles) {
	const slug = file.replace(/\.md$/, "");
	const filePath = path.join(POSTS_DIR, file);
	const gitRelativePath = `src/content/posts/${file}`;

	let title = slug;
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const titleMatch = content.match(/^title:\s*(?:['"]?)(.*?)(?:['"]?)\s*$/m);
		if (titleMatch && titleMatch[1]) {
			title = titleMatch[1].trim();
		}
	} catch (e) {
		// ignore
	}

	let gitLogOutput = "";
	try {
		gitLogOutput = execSync(
			`git log --follow --format="%H|%h|%cI|%an|%ae|%s" -- "${gitRelativePath}"`,
			{ encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
		).trim();
	} catch (e) {
		console.warn(`[Wiki Generator] 无法读取 ${file} 的 git 历史:`, e.message);
	}

	const rawLines = gitLogOutput ? gitLogOutput.split("\n") : [];
	const revisions = [];

	for (let i = 0; i < rawLines.length; i++) {
		const line = rawLines[i].trim();
		if (!line) continue;

		const [sha, shortSha, date, author, authorEmail, ...msgParts] = line.split("|");
		const message = msgParts.join("|") || "";

		let byteSize = 0;
		try {
			const sizeStr = execSync(`git cat-file -s ${sha}:"${gitRelativePath}"`, {
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			byteSize = parseInt(sizeStr, 10) || 0;
		} catch {
			// fallback
		}

		let linesAdded = 0;
		let linesDeleted = 0;
		try {
			const numstat = execSync(
				`git show --numstat --format="" ${sha} -- "${gitRelativePath}"`,
				{ encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
			).trim();
			if (numstat) {
				const parts = numstat.split(/\s+/);
				linesAdded = parseInt(parts[0], 10) || 0;
				linesDeleted = parseInt(parts[1], 10) || 0;
			}
		} catch {
			// ignore
		}

		// 提取快照内容
		let snapshotContent = "";
		try {
			snapshotContent = execSync(`git show ${sha}:"${gitRelativePath}"`, {
				encoding: "utf-8",
				maxBuffer: 10 * 1024 * 1024,
				stdio: ["ignore", "pipe", "ignore"],
			});
		} catch {
			// fallback to current if failed
		}

		const { section, cleanMessage } = parseSection(message);
		const minor = isMinorEdit(message);
		const tags = [];
		if (minor) tags.push("小修改");
		if (i === rawLines.length - 1) tags.push("初始版本");

		revisions.push({
			sha,
			shortSha,
			date,
			displayDate: formatDisplayDate(date),
			author,
			authorEmail,
			message,
			section,
			cleanMessage,
			byteSize,
			byteDelta: 0, // 稍后与下一项计算
			linesAdded,
			linesDeleted,
			isMinor: minor,
			tags,
			diffUrl: `https://github.com/yaoxiovo/astro/commit/${sha}`,
		});

		// 存储快照文件
		if (snapshotContent) {
			const snapshotPayload = JSON.stringify(
				{
					sha,
					shortSha,
					date,
					author,
					message,
					slug,
					content: snapshotContent,
				},
				null,
				2
			);

			const dataSnapDir = path.join(DATA_DIR, "snapshots", slug);
			const publicSnapDir = path.join(PUBLIC_API_DIR, "snapshots", slug);
			fs.mkdirSync(dataSnapDir, { recursive: true });
			fs.mkdirSync(publicSnapDir, { recursive: true });

			fs.writeFileSync(path.join(dataSnapDir, `${shortSha}.json`), snapshotPayload);
			fs.writeFileSync(path.join(publicSnapDir, `${shortSha}.json`), snapshotPayload);
		}
	}

	// 计算相邻版本的字节差额 byteDelta
	// revisions 数组顺序是时间倒序：[0] 为最新版本，[revisions.length - 1] 为初始提交
	for (let j = 0; j < revisions.length; j++) {
		if (j === revisions.length - 1) {
			// 初始提交：delta 即为当次提交的全部字节数
			revisions[j].byteDelta = revisions[j].byteSize;
		} else {
			const currentSize = revisions[j].byteSize;
			const previousSize = revisions[j + 1].byteSize;
			revisions[j].byteDelta = currentSize - previousSize;
		}
	}

	// 如果没有 git 提交记录（新草稿），填充当前状态
	if (revisions.length === 0) {
		try {
			const stats = fs.statSync(filePath);
			const currentContent = fs.readFileSync(filePath, "utf-8");
			const nowISO = new Date(stats.mtime).toISOString();
			revisions.push({
				sha: "HEAD",
				shortSha: "HEAD",
				date: nowISO,
				displayDate: formatDisplayDate(nowISO),
				author: "Working Copy",
				authorEmail: "",
				message: "当前本地工作区草稿",
				section: null,
				cleanMessage: "当前本地工作区草稿",
				byteSize: stats.size,
				byteDelta: stats.size,
				linesAdded: 0,
				linesDeleted: 0,
				isMinor: false,
				tags: ["草稿"],
				diffUrl: "",
			});

			const dataSnapDir = path.join(DATA_DIR, "snapshots", slug);
			const publicSnapDir = path.join(PUBLIC_API_DIR, "snapshots", slug);
			fs.mkdirSync(dataSnapDir, { recursive: true });
			fs.mkdirSync(publicSnapDir, { recursive: true });

			const snapshotPayload = JSON.stringify({
				sha: "HEAD",
				shortSha: "HEAD",
				date: nowISO,
				author: "Working Copy",
				message: "当前本地工作区草稿",
				slug,
				content: currentContent,
			});
			fs.writeFileSync(path.join(dataSnapDir, "HEAD.json"), snapshotPayload);
			fs.writeFileSync(path.join(publicSnapDir, "HEAD.json"), snapshotPayload);
		} catch (e) {
			// ignore
		}
	}

	const postHistory = {
		slug,
		title,
		filePath: gitRelativePath,
		totalRevisions: revisions.length,
		lastUpdated: revisions[0]?.date || new Date().toISOString(),
		revisions,
	};

	historyMap[slug] = postHistory;
	totalCommitsExtracted += revisions.length;

	// 单独写入 public/api/wiki/history/${slug}.json 方便客户端独立轻量按需请求
	fs.writeFileSync(
		path.join(PUBLIC_API_DIR, "history", `${slug}.json`),
		JSON.stringify(postHistory, null, 2)
	);
}

// 汇总写入 master json
fs.writeFileSync(
	path.join(DATA_DIR, "history.json"),
	JSON.stringify(historyMap, null, 2)
);
fs.writeFileSync(
	path.join(PUBLIC_API_DIR, "history.json"),
	JSON.stringify(historyMap, null, 2)
);

console.log(
	`✨ [Wiki Generator] 成功生成 ${postFiles.length} 篇文章的历史数据与快照，共提取 ${totalCommitsExtracted} 次修订（耗时 ${Date.now() - startTime}ms）喵！`
);
