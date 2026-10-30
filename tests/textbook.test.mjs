import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	DEFAULT_FALLBACK_IMAGE,
	SUBJECT_METADATA_MAP,
	calculateTextbookStats,
	countTextbookWords,
	estimateTextbookReadingTime,
	extractAllTextbookTags,
	filterTextbooks,
	filterTextbooksBySubject,
	filterTextbooksByType,
	formatTextbookDate,
	getSubjectCategories,
	getSubjectMeta,
	groupTextbooksBySubject,
	sortTextbooks,
	stripTextbookSlug,
	validateImageUrl,
	validateTextbookSchema,
} from "../src/utils/textbook-core.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const TEXTBOOKS_DIR = path.join(ROOT_DIR, "src/content/textbooks");

describe("教材展示页知识库与外链图片核心测试套件 (Textbook Core Test Suite)", () => {
	describe("1. 外链图片 URL 安全校验与 Fallback 兜底机制 (validateImageUrl)", () => {
		it("合法 HTTPS 外链图片应直接通过校验", () => {
			const url =
				"https://images.unsplash.com/photo-1635070041078-e363dbe005cb";
			const res = validateImageUrl(url);
			assert.strictEqual(res.valid, true);
			assert.strictEqual(res.url, url);
			assert.strictEqual(res.isExternal, true);
			assert.strictEqual(res.isHttps, true);
		});

		it("合法 HTTP 外链图片应通过但附带升级提示", () => {
			const url = "http://example.com/diagram.png";
			const res = validateImageUrl(url);
			assert.strictEqual(res.valid, true);
			assert.strictEqual(res.url, url);
			assert.strictEqual(res.isExternal, true);
			assert.strictEqual(res.isHttps, false);
			assert.ok(res.warning?.includes("建议升级"));
		});

		it("合法的 Data URI 与站内绝对路径应放行且标记为非外链", () => {
			const dataUri = "data:image/svg+xml;base64,PHN2Zz4=";
			const resData = validateImageUrl(dataUri);
			assert.strictEqual(resData.valid, true);
			assert.strictEqual(resData.isDataUri, true);
			assert.strictEqual(resData.isExternal, false);

			const localPath = "/assets/diagram.png";
			const resLocal = validateImageUrl(localPath);
			assert.strictEqual(resLocal.valid, true);
			assert.strictEqual(resLocal.isExternal, false);
		});

		it("危险协议（javascript:, file:）应被安全拦截并降级为默认兜底图", () => {
			const dangerous = "javascript:alert(1)";
			const res = validateImageUrl(dangerous);
			assert.strictEqual(res.valid, false);
			assert.strictEqual(res.url, DEFAULT_FALLBACK_IMAGE);
			assert.ok(res.reason?.includes("不安全"));

			const fileProto = "file:///etc/passwd";
			const resFile = validateImageUrl(fileProto);
			assert.strictEqual(resFile.valid, false);
			assert.strictEqual(resFile.url, DEFAULT_FALLBACK_IMAGE);
		});

		it("空字符串或畸形 URL 应安全降级为兜底图", () => {
			const resNull = validateImageUrl(null);
			assert.strictEqual(resNull.valid, false);
			assert.strictEqual(resNull.url, DEFAULT_FALLBACK_IMAGE);

			const resEmpty = validateImageUrl("   ");
			assert.strictEqual(resEmpty.valid, false);
			assert.strictEqual(resEmpty.url, DEFAULT_FALLBACK_IMAGE);

			const resMalformed = validateImageUrl("http://");
			assert.strictEqual(resMalformed.valid, false);
			assert.strictEqual(resMalformed.url, DEFAULT_FALLBACK_IMAGE);
		});
	});

	describe("2. Schema 契约校验 (validateTextbookSchema)", () => {
		it("合法完整的知识点数据应通过校验", () => {
			const raw = {
				title: "微积分基础：梯度下降与多元偏导",
				subject: "math",
				grade: "大学本科 / 计算机数学基础",
				chapter: "第1章 多元微积分与优化",
				type: "hybrid",
				imageUrl:
					"https://images.unsplash.com/photo-1635070041078-e363dbe005cb",
				tags: ["微积分", "数学", "梯度下降", "AI数学基础"],
				order: 1,
			};

			const result = validateTextbookSchema(raw);
			assert.strictEqual(result.valid, true);
			assert.strictEqual(result.errors.length, 0);
			assert.strictEqual(result.data.title, raw.title);
			assert.strictEqual(result.data.subject, "math");
			assert.strictEqual(result.data.type, "hybrid");
		});

		it("缺少必填字段（title 或 subject）应报错拦截", () => {
			const missingTitle = { subject: "math" };
			const res1 = validateTextbookSchema(missingTitle);
			assert.strictEqual(res1.valid, false);
			assert.ok(res1.errors.some((e) => e.includes("title")));

			const missingSubj = { title: "标题" };
			const res2 = validateTextbookSchema(missingSubj);
			assert.strictEqual(res2.valid, false);
			assert.ok(res2.errors.some((e) => e.includes("subject")));
		});

		it("非法 type 字段应拦截", () => {
			const invalidType = {
				title: "有效标题",
				subject: "cs",
				type: "video_clip", // 非法类型
			};
			const res = validateTextbookSchema(invalidType);
			assert.strictEqual(res.valid, false);
			assert.ok(res.errors.some((e) => e.includes("type")));
		});
	});

	describe("3. 多维度过滤与检索算法 (Filtering & Search)", () => {
		const sampleItems = [
			{
				title: "微积分基础：偏导数与梯度下降",
				subject: "math",
				type: "hybrid",
				tags: ["微积分", "数学", "优化"],
				description: "多元微积分基础，梯度概念几何可视化",
				body: "从单变量导数过渡到多元偏导数，梯度方向即函数值上升最快的方向。",
				order: 1,
				grade: "大学",
				chapter: "第1章",
			},
			{
				title: "动态规划设计范式与状态转移方程",
				subject: "cs",
				type: "article",
				tags: ["算法", "动态规划", "算法导论"],
				description: "从记忆化搜索到表格递推",
				body: "最优子结构与重叠子问题。状态转移方程是动态规划的核心灵魂。",
				order: 2,
				grade: "通用",
				chapter: "第3章",
			},
			{
				title: "高中物理：牛顿运动定律与质点动力学",
				subject: "physics",
				type: "image",
				imageUrl:
					"https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa",
				tags: ["物理", "经典力学"],
				description: "牛顿三定律知识结构脑图思维导图",
				body: "力的合成与分解、牛顿第一、第二、第三定律图谱。",
				order: 3,
				grade: "高中",
				chapter: "第2章",
			},
			{
				title: "草稿条目：未完成的线性代数",
				subject: "math",
				type: "article",
				draft: true,
				order: 4,
			},
		];

		it("按学科过滤 (filterTextbooksBySubject)", () => {
			const all = filterTextbooksBySubject(sampleItems, "all");
			assert.strictEqual(all.length, 4);

			const mathOnly = filterTextbooksBySubject(sampleItems, "math");
			assert.strictEqual(mathOnly.length, 2);
			assert.ok(mathOnly.every((i) => i.subject === "math"));

			const csOnly = filterTextbooksBySubject(sampleItems, "cs");
			assert.strictEqual(csOnly.length, 1);
			assert.strictEqual(csOnly[0].title, sampleItems[1].title);
		});

		it("按展现类型过滤 (filterTextbooksByType)", () => {
			const images = filterTextbooksByType(sampleItems, "image");
			assert.strictEqual(images.length, 1);
			assert.strictEqual(images[0].subject, "physics");

			const articles = filterTextbooksByType(sampleItems, "article");
			assert.strictEqual(articles.length, 2);
		});

		it("关键词全文检索与草稿隔离 (filterTextbooks)", () => {
			// 检索 "梯度"（同时命中 title 和 body）
			const searchGradient = filterTextbooks(sampleItems, {
				keyword: "梯度",
				includeDrafts: false,
			});
			assert.strictEqual(searchGradient.length, 1);
			assert.strictEqual(searchGradient[0].title, sampleItems[0].title);

			// 默认不包含 draft
			const mathPublic = filterTextbooks(sampleItems, {
				subject: "math",
				includeDrafts: false,
			});
			assert.strictEqual(mathPublic.length, 1);

			// 显式包含 draft
			const mathAll = filterTextbooks(sampleItems, {
				subject: "math",
				includeDrafts: true,
			});
			assert.strictEqual(mathAll.length, 2);
		});
	});

	describe("4. 统计与聚合运算 (Stats & Grouping)", () => {
		const sampleData = [
			{
				title: "高数",
				subject: "math",
				type: "article",
				body: "这是一段包含中文和 English 的测试正文内容",
				tags: ["数学", "基础"],
			},
			{
				title: "物理脑图",
				subject: "physics",
				type: "image",
				imageUrl: "https://example.com/p.png",
				tags: ["物理", "基础"],
			},
		];

		it("准确统计字数与估算阅读耗时", () => {
			const words = countTextbookWords("这是五个字 with three words");
			assert.strictEqual(words, 8); // 5 中文字 + 3 英文单词 = 8

			const time = estimateTextbookReadingTime(600);
			assert.strictEqual(time, 2); // 600字 / 300字每分 = 2分
		});

		it("提取所有非重复标签与频度 (extractAllTextbookTags)", () => {
			const tags = extractAllTextbookTags(sampleData);
			const baseTag = tags.find((t) => t.tag === "基础");
			assert.ok(baseTag);
			assert.strictEqual(baseTag.count, 2);
		});

		it("按学科聚合分类 (groupTextbooksBySubject)", () => {
			const categories = groupTextbooksBySubject(sampleData);
			assert.strictEqual(categories.length, 2);
			assert.ok(categories.some((c) => c.subject === "math"));
			assert.ok(categories.some((c) => c.subject === "physics"));
		});

		it("全景统计指标生成 (calculateTextbookStats)", () => {
			const stats = calculateTextbookStats(sampleData);
			assert.strictEqual(stats.total, 2);
			assert.strictEqual(stats.typeCounts.article, 1);
			assert.strictEqual(stats.typeCounts.image, 1);
			assert.strictEqual(stats.subjectCounts.math, 1);
		});
	});

	describe("5. 真实落地 Markdown 教材内容巡检 (Real Content Verification)", () => {
		it("src/content/textbooks 目录下应至少包含 4 篇跨学科知识点文档", () => {
			assert.ok(fs.existsSync(TEXTBOOKS_DIR), "教材内容目录不存在");
			const files = fs
				.readdirSync(TEXTBOOKS_DIR)
				.filter((f) => f.endsWith(".md"));
			assert.ok(
				files.length >= 4,
				`实际只有 ${files.length} 篇文档，少于 4 篇基线`,
			);
		});

		it("每篇教材 Markdown 的 Frontmatter 与外链图片均须 100% 合规", () => {
			const files = fs
				.readdirSync(TEXTBOOKS_DIR)
				.filter((f) => f.endsWith(".md"));

			for (const file of files) {
				const fullPath = path.join(TEXTBOOKS_DIR, file);
				const content = fs.readFileSync(fullPath, "utf-8");

				// 简单提取 frontmatter
				const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
				assert.ok(match, `文件 ${file} 缺少合法 YAML Frontmatter`);

				const fmText = match[1];
				// 提取基础键值
				const titleMatch = fmText.match(/title:\s*["']?([^"'\n\r]+)["']?/);
				const subjectMatch = fmText.match(/subject:\s*["']?([^"'\n\r]+)["']?/);
				const typeMatch = fmText.match(/type:\s*["']?([^"'\n\r]+)["']?/);
				const imageMatch = fmText.match(/imageUrl:\s*["']?([^"'\n\r]+)["']?/);

				assert.ok(titleMatch, `${file} 缺少 title`);
				assert.ok(subjectMatch, `${file} 缺少 subject`);

				const title = titleMatch[1].trim();
				const subject = subjectMatch[1].trim();
				const type = typeMatch ? typeMatch[1].trim() : "hybrid";

				const schemaRes = validateTextbookSchema({
					title,
					subject,
					type,
					imageUrl: imageMatch ? imageMatch[1].trim() : undefined,
				});

				assert.strictEqual(
					schemaRes.valid,
					true,
					`${file} 未通过 Schema 验证: ${schemaRes.errors.join("; ")}`,
				);

				// 如果存在外链图片，必须是合法的 HTTP/HTTPS
				if (imageMatch) {
					const imgUrl = imageMatch[1].trim();
					const imgRes = validateImageUrl(imgUrl);
					assert.strictEqual(
						imgRes.valid,
						true,
						`${file} 外链图片非法: ${imgRes.reason}`,
					);
				}
			}
		});
	});
});
