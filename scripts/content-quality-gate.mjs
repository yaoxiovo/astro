#!/usr/bin/env node

/**
 * 静态内容 CI/CD 质量工程门禁 (Content Static Analysis & AST Linter Matrix)
 * 工业级 Markdown 静态分析巡检系统：
 * 1. CJK 中英混排规范 (盘古之白空格检查、全半角标点漂移拦截)
 * 2. 站内锚点与相对链接死链检测 (Link Rot Probing)
 * 3. 认知复杂度与可读性算法 (字数、词汇密度、代码行比重、标题层级跳跃探测)
 * 4. 工业级评分卡 (Quality Scorecard & Matrix) 生成
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const POSTS_DIR = path.join(ROOT_DIR, "src/content/posts");
const QUALITY_DIR = path.join(ROOT_DIR, "src/data/wiki/quality");
const PUBLIC_QUALITY_DIR = path.join(ROOT_DIR, "public/api/wiki/quality");

fs.mkdirSync(QUALITY_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_QUALITY_DIR, { recursive: true });

// GitHub / Astro 默认标题 Slugify 生成规则
export function slugifyHeading(text) {
	return text
		.toLowerCase()
		.trim()
		.replace(/<[^>]+>/g, "") // 移除 HTML 标签
		.replace(/[`*_~[\]()]/g, "") // 移除 Markdown 格式符号
		.replace(/[\s\t\n]+/g, "-") // 空格替换为横杠
		.replace(/[^\w\u4e00-\u9fa5\-_]/g, "") // 保留英数中文字符与破折号
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

/**
 * 剥离代码块、行内代码、数学公式、HTML、链接，生成用于排版检查的纯净文本行
 */
export function extractLinterLines(markdown) {
	const lines = markdown.split("\n");
	let inYaml = false;
	let inCodeBlock = false;
	let inMathBlock = false;
	let yamlFinished = false;

	const processedLines = [];

	for (let i = 0; i < lines.length; i++) {
		const rawLine = lines[i];
		const trimmed = rawLine.trim();

		// 处理 Frontmatter
		if (i === 0 && trimmed === "---") {
			inYaml = true;
			processedLines.push({
				lineNo: i + 1,
				raw: rawLine,
				checkText: "",
				isCode: false,
			});
			continue;
		}
		if (inYaml) {
			if (trimmed === "---") {
				inYaml = false;
				yamlFinished = true;
			}
			processedLines.push({
				lineNo: i + 1,
				raw: rawLine,
				checkText: "",
				isCode: false,
			});
			continue;
		}

		// 处理代码块 ```
		if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
			inCodeBlock = !inCodeBlock;
			processedLines.push({
				lineNo: i + 1,
				raw: rawLine,
				checkText: "",
				isCode: true,
			});
			continue;
		}
		if (inCodeBlock) {
			processedLines.push({
				lineNo: i + 1,
				raw: rawLine,
				checkText: "",
				isCode: true,
			});
			continue;
		}

		// 处理 Math $$
		if (trimmed.startsWith("$$")) {
			inMathBlock = !inMathBlock;
			processedLines.push({
				lineNo: i + 1,
				raw: rawLine,
				checkText: "",
				isCode: false,
			});
			continue;
		}
		if (inMathBlock) {
			processedLines.push({
				lineNo: i + 1,
				raw: rawLine,
				checkText: "",
				isCode: false,
			});
			continue;
		}

		// 处于正文行：剥离行内代码 `...`、图片 `![...]`、行内链接 `[...]`、HTML `<...>`、行内公式 `$...$`
		let checkText = rawLine;
		// 保护图片语法，单独提取
		checkText = checkText.replace(/!\[.*?\]\(.*?\)/g, " [IMAGE] ");
		// 保护行内代码
		checkText = checkText.replace(/`[^`]+`/g, " [CODE] ");
		// 保护行内公式
		checkText = checkText.replace(/\$[^$]+\$/g, " [MATH] ");
		// 保护 HTML 标签
		checkText = checkText.replace(/<[^>]+>/g, " ");

		processedLines.push({
			lineNo: i + 1,
			raw: rawLine,
			checkText,
			isCode: false,
		});
	}

	return processedLines;
}

/**
 * 1. CJK 中英混排规范巡检
 */
export function inspectCjkTypography(lines) {
	const issues = [];

	for (const { lineNo, raw, checkText, isCode } of lines) {
		if (isCode || !checkText.trim()) continue;

		// 检查标题行跳过前导 #
		const cleanText = checkText.replace(/^#+\s*/, "");

		// 盘古之白 1: 中文接英文/数字无空格，例如 "学习React"
		// 匹配: 中文字符直接跟随英文字母或数字（排除已标记为占位符的 [CODE] 等）
		const cjkFollowedByAlnum = /([\u4e00-\u9fa5])([a-zA-Z0-9]+)/g;
		let match;
		while ((match = cjkFollowedByAlnum.exec(cleanText)) !== null) {
			// 过滤形如 "第1章" 的数字情况可选允许，但这里记录优化建议
			const word = match[2];
			if (word === "CODE" || word === "IMAGE" || word === "MATH") continue;
			issues.push({
				type: "pangu_missing_space",
				severity: "warning",
				line: lineNo,
				excerpt: match[0],
				message: `中文与西文/数字间缺少盘古之白空格: "${match[1]}${word}" -> 建议为 "${match[1]} ${word}"`,
				suggestion: `${match[1]} ${word}`,
			});
		}

		// 盘古之白 2: 英文/数字接中文无空格，例如 "React很棒"
		const alnumFollowedByCjk = /([a-zA-Z0-9]+)([\u4e00-\u9fa5])/g;
		while ((match = alnumFollowedByCjk.exec(cleanText)) !== null) {
			const word = match[1];
			if (word === "CODE" || word === "IMAGE" || word === "MATH") continue;
			issues.push({
				type: "pangu_missing_space",
				severity: "warning",
				line: lineNo,
				excerpt: match[0],
				message: `西文/数字与中文间缺少盘古之白空格: "${word}${match[2]}" -> 建议为 "${word} ${match[2]}"`,
				suggestion: `${word} ${match[2]}`,
			});
		}

		// 全半角标点漂移拦截 (Punctuation Drift)
		// 中文后面的半角逗号: 汉字接英文逗号再接文字
		const halfCommaAfterCjk = /([\u4e00-\u9fa5]),/g;
		while ((match = halfCommaAfterCjk.exec(cleanText)) !== null) {
			issues.push({
				type: "punctuation_drift",
				severity: "warning",
				line: lineNo,
				excerpt: match[0],
				message: `中文语境下误用半角逗号 ",": "${match[1]}," -> 建议替换为全角 "，"`,
				suggestion: `${match[1]}，`,
			});
		}

		// 中文后面的半角句号: 汉字接英文句点且后面不是数字或字母 (如 "很好." 或 "很好. 然后")
		const halfPeriodAfterCjk = /([\u4e00-\u9fa5])\.(?:\s|$|[\u4e00-\u9fa5])/g;
		while ((match = halfPeriodAfterCjk.exec(cleanText)) !== null) {
			issues.push({
				type: "punctuation_drift",
				severity: "warning",
				line: lineNo,
				excerpt: match[0],
				message: `中文语境下误用半角句号 ".": "${match[1]}." -> 建议替换为全角 "。"`,
				suggestion: `${match[1]}。`,
			});
		}

		// 中文后面的半角分号
		const halfSemicolonAfterCjk = /([\u4e00-\u9fa5]);/g;
		while ((match = halfSemicolonAfterCjk.exec(cleanText)) !== null) {
			issues.push({
				type: "punctuation_drift",
				severity: "info",
				line: lineNo,
				excerpt: match[0],
				message: `中文语境下误用半角分号 ";": "${match[1]};" -> 建议替换为全角 "；"`,
				suggestion: `${match[1]}；`,
			});
		}
	}

	return issues;
}

/**
 * 2. 站内锚点与相对外链死链检测 (Link Rot Probing)
 */
export function inspectLinksAndAnchors(rawMarkdown, currentSlug, allPostSlugs) {
	const issues = [];

	// 1. 提取文档内部所有标题锚点
	const headings = [];
	const headingRegex = /^(#{1,6})\s+(.+)$/gm;
	let hMatch;
	while ((hMatch = headingRegex.exec(rawMarkdown)) !== null) {
		const level = hMatch[1].length;
		const rawTitle = hMatch[2].trim();
		const slug = slugifyHeading(rawTitle);
		headings.push({ level, title: rawTitle, slug });
	}

	const headingSlugs = new Set(headings.map((h) => h.slug));

	// 2. 提取所有链接和图片
	// Markdown 链接: [text](target)
	const linkRegex = /\[([^\]]*)\]\(([^)"]+)(?:(?:\s+["'][^"']*["'])?)\)/g;
	let lMatch;
	const links = [];

	while ((lMatch = linkRegex.exec(rawMarkdown)) !== null) {
		links.push({
			text: lMatch[1],
			url: lMatch[2].trim(),
			index: lMatch.index,
		});
	}

	// 计算行号辅助
	const lineStarts = [0];
	for (let i = 0; i < rawMarkdown.length; i++) {
		if (rawMarkdown[i] === "\n") lineStarts.push(i + 1);
	}
	function getLineNumber(charIndex) {
		let low = 0;
		let high = lineStarts.length - 1;
		while (low <= high) {
			const mid = (low + high) >> 1;
			if (lineStarts[mid] <= charIndex) {
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		return high + 1;
	}

	for (const link of links) {
		const url = link.url;
		const lineNo = getLineNumber(link.index);

		// A: 页内锚点检测 #anchor
		if (url.startsWith("#")) {
			const targetAnchor = url.slice(1);
			if (targetAnchor && !headingSlugs.has(targetAnchor)) {
				// 容忍常见顶层锚点或空锚点
				if (targetAnchor !== "top" && targetAnchor !== "header") {
					issues.push({
						type: "broken_anchor",
						severity: "error",
						line: lineNo,
						excerpt: link.url,
						message: `页内锚点死链: 目标锚点 "${url}" 在当前文章标题大纲中未找到！`,
						suggestion: `可用锚点候选: ${Array.from(headingSlugs).slice(0, 3).join(", ") || "无"}`,
					});
				}
			}
			continue;
		}

		// B: 站内文章链接检测 /posts/slug
		if (url.startsWith("/posts/")) {
			const cleanPath = url
				.replace(/^\/posts\//, "")
				.replace(/\/$/, "")
				.split("#")[0];
			if (cleanPath && !allPostSlugs.has(cleanPath)) {
				issues.push({
					type: "broken_internal_link",
					severity: "error",
					line: lineNo,
					excerpt: link.url,
					message: `站内死链: 目标文章 "/posts/${cleanPath}" 不存在喵！`,
					suggestion: "请核对站内博文 slug 名称",
				});
			}
			continue;
		}

		// C: 相对资源文件检测 ./assets/xxx 或 assets/xxx
		if (
			url.startsWith("./") ||
			url.startsWith("../") ||
			url.startsWith("assets/")
		) {
			const resolvedPath = path.resolve(
				POSTS_DIR,
				url.split("#")[0].split("?")[0],
			);
			if (!fs.existsSync(resolvedPath)) {
				issues.push({
					type: "broken_relative_asset",
					severity: "error",
					line: lineNo,
					excerpt: link.url,
					message: `本地资源文件缺失: "${url}" 无法在磁盘上找到！`,
					suggestion: "请检查图片或附件相对路径是否正确",
				});
			}
			continue;
		}

		// D: 外链格式与安全性检查
		if (url.startsWith("http://")) {
			issues.push({
				type: "insecure_http_link",
				severity: "info",
				line: lineNo,
				excerpt: link.url,
				message: `非安全 HTTP 外链: "${url}" -> 建议升级为 HTTPS 协议`,
				suggestion: url.replace(/^http:\/\//, "https://"),
			});
		}
	}

	return { issues, headings };
}

/**
 * 3. 认知复杂度、阅读指标与标题层级跳跃探测
 */
export function analyzeCognitiveComplexity(rawMarkdown, parsedLines, headings) {
	const issues = [];

	// 1. 标题层级跳跃探测 (Heading Hierarchy Jumps)
	// 例如：H1 直接跳到 H3，或者 H2 直接跳到 H4
	for (let i = 0; i < headings.length - 1; i++) {
		const cur = headings[i];
		const next = headings[i + 1];
		if (next.level > cur.level + 1) {
			issues.push({
				type: "heading_hierarchy_jump",
				severity: "warning",
				line: 1, // 简要标注
				excerpt: `${"#".repeat(cur.level)} ${cur.title} -> ${"#".repeat(next.level)} ${next.title}`,
				message: `标题层级突变: 从 H${cur.level} 直接跳跃至 H${next.level}（跳过了 H${cur.level + 1}），破坏大纲语义树！`,
				suggestion: `建议将 "${next.title}" 调整为 H${cur.level + 1}`,
			});
		}
	}

	// 2. 统计字数与代码行
	let totalLines = parsedLines.length;
	let codeLines = 0;
	let cjkChars = 0;
	let englishWords = 0;

	// 提取正文文本用于分词与密度统计
	let fullPlainText = "";

	for (const { raw, checkText, isCode } of parsedLines) {
		if (isCode) {
			codeLines++;
		} else {
			// 统计 CJK 汉字
			const cjkMatch = checkText.match(/[\u4e00-\u9fa5]/g);
			if (cjkMatch) cjkChars += cjkMatch.length;

			// 统计英文单词
			const engMatch = checkText.match(/[a-zA-Z0-9_-]+/g);
			if (engMatch) englishWords += engMatch.length;

			fullPlainText += ` ${checkText}`;
		}
	}

	// 等效总阅读字数（中文 1 字符 = 1 字，英文 1 词 = 1 字）
	const totalEquivalentWords = cjkChars + englishWords;

	// 代码行占比
	const codeRatio = totalLines > 0 ? codeLines / totalLines : 0;
	const codePercentage = (codeRatio * 100).toFixed(1);

	// 词汇密度 (Lexical Diversity / Unique Tokens Ratio)
	// 对中文采用双字切分 (Bigram) 与单字结合，对英文采用唯一词切分
	const wordsTokenized =
		fullPlainText.toLowerCase().match(/[\u4e00-\u9fa5]|[a-z0-9_-]{2,}/g) || [];
	const uniqueTokens = new Set(wordsTokenized);
	const lexicalDiversity =
		wordsTokenized.length > 0
			? Math.min(1, uniqueTokens.size / wordsTokenized.length)
			: 0;

	// 预计阅读时间：中文 350 字/分钟，代码每行约 1.5 秒
	const readingMinutes = Math.max(
		1,
		Math.round(totalEquivalentWords / 350 + (codeLines * 1.5) / 60),
	);

	// 复杂度提示
	if (codeRatio > 0.7 && totalLines > 50) {
		issues.push({
			type: "high_code_density",
			severity: "info",
			line: 1,
			excerpt: `代码行占比 ${codePercentage}%`,
			message: `代码行占比高达 ${codePercentage}%，建议补充更多上下文原理解析喵~`,
			suggestion: "增加对关键代码段的设计动机与技术要点阐述",
		});
	}

	if (totalEquivalentWords < 150 && !rawMarkdown.includes("draft: true")) {
		issues.push({
			type: "thin_content",
			severity: "warning",
			line: 1,
			excerpt: `总字数仅 ${totalEquivalentWords} 字`,
			message: "内容篇幅较为精简，可能属于短篇随笔或未展开草稿",
			suggestion: "可适当扩充背景知识或实战示例",
		});
	}

	return {
		metrics: {
			totalLines,
			codeLines,
			codePercentage: `${codePercentage}%`,
			cjkChars,
			englishWords,
			totalEquivalentWords,
			lexicalDiversity: `${(lexicalDiversity * 100).toFixed(1)}%`,
			readingMinutes,
			headingsCount: headings.length,
		},
		issues,
	};
}

/**
 * 4. 工业级评分矩阵算法 (Quality Scorecard Engine)
 */
export function computeScorecard(
	typographyIssues,
	linkIssues,
	complexityAnalysis,
) {
	let typographyScore = 25;
	let linkScore = 25;
	let structureScore = 25;
	let readabilityScore = 25;

	// A: Typography (扣分项: 盘古空格警告每个扣 1 分，标点漂移扣 2 分，最多扣 25 分)
	for (const iss of typographyIssues) {
		if (iss.type === "pangu_missing_space") {
			typographyScore = Math.max(0, typographyScore - 1);
		} else if (iss.type === "punctuation_drift") {
			typographyScore = Math.max(0, typographyScore - 2);
		}
	}

	// B: Links (扣分项: 死链致命扣 10 分，断裂锚点扣 5 分，HTTP 扣 1 分)
	for (const iss of linkIssues) {
		if (iss.type === "broken_anchor") {
			linkScore = Math.max(0, linkScore - 5);
		} else if (
			iss.type === "broken_internal_link" ||
			iss.type === "broken_relative_asset"
		) {
			linkScore = Math.max(0, linkScore - 10);
		} else if (iss.type === "insecure_http_link") {
			linkScore = Math.max(0, linkScore - 1);
		}
	}

	// C: Structure (扣分项: 标题层级跳跃每个扣 5 分，无任何标题且长文扣 5 分)
	for (const iss of complexityAnalysis.issues) {
		if (iss.type === "heading_hierarchy_jump") {
			structureScore = Math.max(0, structureScore - 5);
		}
	}
	if (
		complexityAnalysis.metrics.headingsCount === 0 &&
		complexityAnalysis.metrics.totalLines > 60
	) {
		structureScore = Math.max(0, structureScore - 5);
	}

	// D: Readability (篇幅过短扣 5 分，纯代码堆砌扣 3 分)
	for (const iss of complexityAnalysis.issues) {
		if (iss.type === "thin_content") {
			readabilityScore = Math.max(0, readabilityScore - 5);
		}
	}

	const totalScore =
		typographyScore + linkScore + structureScore + readabilityScore;

	// 等级评定
	let grade = "S";
	let gradeLabel = "工业级卓越 (Industrial S)";
	let badgeColor = "emerald";

	if (totalScore >= 95) {
		grade = "S";
		gradeLabel = "工业级卓越 (Industrial S)";
		badgeColor = "emerald";
	} else if (totalScore >= 85) {
		grade = "A";
		gradeLabel = "生产级就绪 (Production A)";
		badgeColor = "emerald";
	} else if (totalScore >= 70) {
		grade = "B";
		gradeLabel = "规范合格 (Standard B)";
		badgeColor = "amber";
	} else if (totalScore >= 60) {
		grade = "C";
		gradeLabel = "建议优化 (Needs Polish C)";
		badgeColor = "orange";
	} else {
		grade = "D";
		gradeLabel = "质量告警 (Degraded D)";
		badgeColor = "rose";
	}

	const allIssues = [
		...typographyIssues,
		...linkIssues,
		...complexityAnalysis.issues,
	];

	return {
		score: totalScore,
		grade,
		gradeLabel,
		badgeColor,
		breakdown: {
			typography: { score: typographyScore, max: 25, label: "排版与盘古之白" },
			links: { score: linkScore, max: 25, label: "链接与锚点健康度" },
			structure: { score: structureScore, max: 25, label: "大纲与层级语义" },
			readability: {
				score: readabilityScore,
				max: 25,
				label: "认知负荷与深度",
			},
		},
		metrics: complexityAnalysis.metrics,
		issuesCount: {
			total: allIssues.length,
			errors: allIssues.filter((i) => i.severity === "error").length,
			warnings: allIssues.filter((i) => i.severity === "warning").length,
			infos: allIssues.filter((i) => i.severity === "info").length,
		},
		issues: allIssues,
	};
}

// 主流程执行函数
export function runQualityGate(options = {}) {
	const verbose = options.verbose ?? true;
	if (verbose) {
		console.log(
			"🚀 [Content Quality Gate] 启动工业级 Markdown 静态分析巡检矩阵...",
		);
	}
	const startTime = Date.now();

	const allFiles = fs
		.readdirSync(POSTS_DIR)
		.filter((f) => f.endsWith(".md") && !f.startsWith("."));

	const allPostSlugs = new Set(allFiles.map((f) => f.replace(/\.md$/, "")));
	const summaryMatrix = {};

	let totalPassedS = 0;
	let totalPassedA = 0;
	let totalWarnings = 0;
	let totalFatalErrors = 0;

	for (const file of allFiles) {
		const slug = file.replace(/\.md$/, "");
		const filePath = path.join(POSTS_DIR, file);
		const rawContent = fs.readFileSync(filePath, "utf-8");

		// 提取标题
		let title = slug;
		const titleMatch = rawContent.match(
			/^title:\s*(?:['"]?)(.*?)(?:['"]?)\s*$/m,
		);
		if (titleMatch && titleMatch[1]) {
			title = titleMatch[1].trim();
		}

		// 1. 拆解分析纯净行
		const parsedLines = extractLinterLines(rawContent);

		// 2. 检查 CJK 排版
		const typographyIssues = inspectCjkTypography(parsedLines);

		// 3. 检查链接与锚点
		const { issues: linkIssues, headings } = inspectLinksAndAnchors(
			rawContent,
			slug,
			allPostSlugs,
		);

		// 4. 认知复杂度分析
		const complexity = analyzeCognitiveComplexity(
			rawContent,
			parsedLines,
			headings,
		);

		// 5. 综合评分卡
		const scorecard = computeScorecard(
			typographyIssues,
			linkIssues,
			complexity,
		);

		const report = {
			slug,
			title,
			checkedAt: new Date().toISOString(),
			...scorecard,
		};

		summaryMatrix[slug] = {
			slug,
			title,
			score: scorecard.score,
			grade: scorecard.grade,
			badgeColor: scorecard.badgeColor,
			issuesCount: scorecard.issuesCount,
			metrics: scorecard.metrics,
		};

		if (scorecard.grade === "S") totalPassedS++;
		else if (scorecard.grade === "A") totalPassedA++;
		totalWarnings += scorecard.issuesCount.warnings;
		totalFatalErrors += scorecard.issuesCount.errors;

		// 单独写入每篇博文的质量体检报告
		fs.writeFileSync(
			path.join(QUALITY_DIR, `${slug}.json`),
			JSON.stringify(report, null, 2),
		);
		fs.writeFileSync(
			path.join(PUBLIC_QUALITY_DIR, `${slug}.json`),
			JSON.stringify(report, null, 2),
		);
	}

	// 汇总写入矩阵报告
	fs.writeFileSync(
		path.join(QUALITY_DIR, "matrix.json"),
		JSON.stringify(summaryMatrix, null, 2),
	);
	fs.writeFileSync(
		path.join(PUBLIC_QUALITY_DIR, "matrix.json"),
		JSON.stringify(summaryMatrix, null, 2),
	);

	const duration = Date.now() - startTime;
	if (verbose) {
		console.log(
			`\n✨ [Content Quality Gate] 巡检完成！耗时 ${duration}ms 喵！` +
				`\n📊 巡检博文总数: ${allFiles.length} 篇` +
				`\n🏆 S 级卓越文章: ${totalPassedS} 篇 | A 级优质文章: ${totalPassedA} 篇` +
				`\n🛡️ 拦截致命死链/断裂资源: ${totalFatalErrors} 处` +
				`\n💡 发现排版优化建议: ${totalWarnings} 处` +
				`\n📦 报告已成功沉淀至 src/data/wiki/quality/ 与 public/api/wiki/quality/ 喵呜~\n`,
		);
	}

	return {
		duration,
		totalFiles: allFiles.length,
		totalPassedS,
		totalPassedA,
		totalWarnings,
		totalFatalErrors,
		summaryMatrix,
	};
}

// CLI 直接执行
if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	runQualityGate();
}
