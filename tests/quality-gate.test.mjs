import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
	slugifyHeading,
	extractLinterLines,
	inspectCjkTypography,
	inspectLinksAndAnchors,
	analyzeCognitiveComplexity,
	computeScorecard,
	runQualityGate,
} from "../scripts/content-quality-gate.mjs";

describe("静态内容 CI/CD 质量工程门禁测试套件 (Content Static Analysis & Quality Gate)", () => {
	describe("1. CJK 盘古之白与标点符号漂移规则精准拦截", () => {
		it("应当拦截西文与中文紧密连接缺少空格（如 'Hello世界' -> 'Hello 世'）", () => {
			const raw = "这是一个测试，我们在 Hello世界 中编写代码。";
			const lines = extractLinterLines(raw);
			const issues = inspectCjkTypography(lines);

			const panguIssue = issues.find((i) => i.type === "pangu_missing_space");
			assert.ok(panguIssue, "应当捕获盘古空格缺失警告");
			assert.equal(panguIssue.severity, "warning");
			assert.equal(panguIssue.suggestion, "Hello 世");
		});

		it("应当拦截中文与西文紧密连接缺少空格（如 '世界Hello' -> '界 Hello'）", () => {
			const raw = "我们生活在 世界Hello 的交汇处。";
			const lines = extractLinterLines(raw);
			const issues = inspectCjkTypography(lines);

			const panguIssue = issues.find((i) => i.type === "pangu_missing_space");
			assert.ok(panguIssue, "应当捕获中文后接西文空格缺失警告");
			assert.equal(panguIssue.suggestion, "界 Hello");
		});

		it("规范的盘古空格中英文混排应完全通过（零警告）", () => {
			const raw = "这是一个规范的句子，我们在 Hello 世界 中快乐编程。";
			const lines = extractLinterLines(raw);
			const issues = inspectCjkTypography(lines);
			const panguIssues = issues.filter((i) => i.type === "pangu_missing_space");
			assert.equal(panguIssues.length, 0, "规范文本不应有任何盘古空格告警");
		});

		it("代码块、行内代码与数学公式内部的中英混排应被白名单豁免", () => {
			const markdown = [
				"正文描述中保持规范。",
				"行内代码测试：`const message = 'Hello世界';` 不受影响。",
				"```typescript",
				"function greet() {",
				"    console.log('代码块内Hello世界不受影响');",
				"}",
				"```",
				"数学公式：$E = mc^2$ 以及公式内部 $Hello世界$ 均被豁免。",
			].join("\n");

			const lines = extractLinterLines(markdown);
			const issues = inspectCjkTypography(lines);
			const panguIssues = issues.filter((i) => i.type === "pangu_missing_space");
			assert.equal(panguIssues.length, 0, "代码块与公式内部不得触发误报");
		});

		it("应当精确捕获中文语境下的半角标点漂移 (Punctuation Drift)", () => {
			const raw = [
				"第一行测试汉字接半角逗号,应当被拦截。",
				"第二行测试汉字接半角句号. 应当被拦截。",
				"第三行测试汉字接半角分号; 应当被拦截。",
			].join("\n");

			const lines = extractLinterLines(raw);
			const issues = inspectCjkTypography(lines);

			const commaIssue = issues.find(
				(i) => i.type === "punctuation_drift" && i.message.includes('半角逗号 ","'),
			);
			assert.ok(commaIssue, "必须捕获半角逗号漂移");
			assert.equal(commaIssue.suggestion, "号，");

			const periodIssue = issues.find(
				(i) => i.type === "punctuation_drift" && i.message.includes('半角句号 "."'),
			);
			assert.ok(periodIssue, "必须捕获半角句号漂移");
			assert.equal(periodIssue.suggestion, "号。");

			const semicolonIssue = issues.find(
				(i) => i.type === "punctuation_drift" && i.message.includes('半角分号 ";"'),
			);
			assert.ok(semicolonIssue, "必须捕获半角分号漂移");
			assert.equal(semicolonIssue.suggestion, "号；");
		});

		it("规范的全角中文标点应 100% 豁免", () => {
			const raw = "猫娘架构师写道：“优雅的代码，不仅跑得快，读起来也赏心悦目；这就是艺术。”";
			const lines = extractLinterLines(raw);
			const issues = inspectCjkTypography(lines);
			const driftIssues = issues.filter((i) => i.type === "punctuation_drift");
			assert.equal(driftIssues.length, 0);
		});
	});

	describe("2. 标题层级跳跃探测 (Heading Hierarchy Jumps)", () => {
		it("合法标题层级应当完全放行", () => {
			const headings = [
				{ level: 1, title: "主标题", slug: "主标题" },
				{ level: 2, title: "第一章", slug: "第一章" },
				{ level: 3, title: "第一节", slug: "第一节" },
				{ level: 2, title: "第二章", slug: "第二章" },
			];
			const analysis = analyzeCognitiveComplexity("", [], headings);
			const jumps = analysis.issues.filter((i) => i.type === "heading_hierarchy_jump");
			assert.equal(jumps.length, 0);
		});

		it("应当拦截非法层级跳跃（如 H2 直接跳跃至 H4）", () => {
			const headings = [
				{ level: 2, title: "高并发架构设计", slug: "高并发架构设计" },
				{ level: 4, title: "细粒度锁实现", slug: "细粒度锁实现" }, // 跳过了 H3
			];
			const analysis = analyzeCognitiveComplexity("", [], headings);
			const jumps = analysis.issues.filter((i) => i.type === "heading_hierarchy_jump");
			assert.equal(jumps.length, 1);
			assert.equal(jumps[0].severity, "warning");
			assert.ok(jumps[0].message.includes("从 H2 直接跳跃至 H4"));
			assert.equal(jumps[0].suggestion, '建议将 "细粒度锁实现" 调整为 H3');
		});

		it("应当拦截 H1 直接跳至 H3 的层级断层", () => {
			const headings = [
				{ level: 1, title: "全站根大纲", slug: "全站根大纲" },
				{ level: 3, title: "底层子模块", slug: "底层子模块" },
			];
			const analysis = analyzeCognitiveComplexity("", [], headings);
			const jumps = analysis.issues.filter((i) => i.type === "heading_hierarchy_jump");
			assert.equal(jumps.length, 1);
			assert.ok(jumps[0].message.includes("从 H1 直接跳跃至 H3"));
		});
	});

	describe("3. 站内死链与失效锚点检测 (Link Rot & Anchor Probing)", () => {
		it("应当正确识别文档内存在的合法锚点", () => {
			const markdown = [
				"# 快速开始",
				"",
				"请查看 [安装指南](#安装指南) 了解详情。",
				"",
				"## 安装指南",
				"执行 `pnpm install` 即可。",
			].join("\n");

			const { issues } = inspectLinksAndAnchors(markdown, "test-post", new Set(["test-post"]));
			const brokenAnchors = issues.filter((i) => i.type === "broken_anchor");
			assert.equal(brokenAnchors.length, 0, "合法锚点不应报错");
		});

		it("应当精确捕获未定义的失效页内锚点 (#broken-anchor)", () => {
			const markdown = [
				"# 架构概述",
				"",
				"参考 [不存在的模块说明](#ghost-module) 喵~",
				"",
				"## 现有模块 A",
				"这里是现有模块内容。",
			].join("\n");

			const { issues } = inspectLinksAndAnchors(markdown, "test-post", new Set(["test-post"]));
			const broken = issues.find((i) => i.type === "broken_anchor");
			assert.ok(broken, "必须捕获失效锚点");
			assert.equal(broken.severity, "error");
			assert.equal(broken.excerpt, "#ghost-module");
			assert.ok(broken.message.includes('目标锚点 "#ghost-module" 在当前文章标题大纲中未找到'));
		});

		it("应当拦截不存在的站内文章链接 (/posts/non-existent)", () => {
			const markdown = "推荐阅读 [不存在的旧博文](/posts/old-deleted-article/) 喵。";
			const { issues } = inspectLinksAndAnchors(
				markdown,
				"current-post",
				new Set(["current-post", "valid-post"]),
			);
			const brokenLink = issues.find((i) => i.type === "broken_internal_link");
			assert.ok(brokenLink, "必须捕获站内死链");
			assert.equal(brokenLink.severity, "error");
			assert.ok(brokenLink.message.includes("/posts/old-deleted-article"));
		});

		it("应当对已存在的站内文章链接正常放行", () => {
			const markdown = "推荐阅读 [现有优质博文](/posts/valid-post/) 喵。";
			const { issues } = inspectLinksAndAnchors(
				markdown,
				"current-post",
				new Set(["current-post", "valid-post"]),
			);
			const brokenLink = issues.filter((i) => i.type === "broken_internal_link");
			assert.equal(brokenLink.length, 0);
		});
	});

	describe("4. 质量评分矩阵 (Quality Scorecard Engine) 算法测试", () => {
		it("高质量文章应斩获 S 级工业级卓越评价 (Score >= 95)", () => {
			const scorecard = computeScorecard(
				[], // 无排版缺陷
				[], // 无死链
				{
					metrics: {
						totalLines: 150,
						codeLines: 30,
						codePercentage: "20.0%",
						cjkChars: 1200,
						englishWords: 300,
						totalEquivalentWords: 1500,
						lexicalDiversity: "65.0%",
						readingMinutes: 5,
						headingsCount: 6,
					},
					issues: [],
				},
			);

			assert.equal(scorecard.score, 100);
			assert.equal(scorecard.grade, "S");
			assert.equal(scorecard.badgeColor, "emerald");
			assert.equal(scorecard.issuesCount.errors, 0);
		});

		it("存在严重死链和多处警告的文章应被严厉降级扣分", () => {
			const typographyIssues = [
				{ type: "pangu_missing_space", severity: "warning" },
				{ type: "pangu_missing_space", severity: "warning" },
				{ type: "punctuation_drift", severity: "warning" },
			];
			const linkIssues = [
				{ type: "broken_internal_link", severity: "error" }, // 扣 10 分
				{ type: "broken_anchor", severity: "error" }, // 扣 5 分
			];
			const complexityAnalysis = {
				metrics: {
					totalLines: 30,
					codeLines: 0,
					codePercentage: "0%",
					cjkChars: 50,
					englishWords: 10,
					totalEquivalentWords: 60,
					lexicalDiversity: "50%",
					readingMinutes: 1,
					headingsCount: 1,
				},
				issues: [
					{ type: "heading_hierarchy_jump", severity: "warning" }, // 扣 5 分
					{ type: "thin_content", severity: "warning" }, // 扣 5 分
				],
			};

			const scorecard = computeScorecard(typographyIssues, linkIssues, complexityAnalysis);
			assert.ok(scorecard.score < 80, `综合评分应显著降级，实际: ${scorecard.score}`);
			assert.ok(["B", "C", "D"].includes(scorecard.grade));
			assert.equal(scorecard.issuesCount.errors, 2);
		});
	});

	describe("5. 全站 49 篇真实博文全量静态巡检与质量排行榜 (Full Site Benchmark)", () => {
		it("必须完整扫描全站 49 篇真实博文并生成质量大盘排行榜", () => {
			const result = runQualityGate({ verbose: false });

			assert.equal(result.totalFiles, 49, "全站文章总数必须为 49 篇");
			assert.ok(result.totalPassedS >= 40, `S 级卓越文章应达到 40 篇以上 (实际: ${result.totalPassedS})`);
			assert.equal(result.totalFatalErrors, 0, "全站不应有任何未解决的致命死链");

			// 验证产物文件已生成
			const matrixDataPath = path.resolve("src/data/wiki/quality/matrix.json");
			const matrixPublicPath = path.resolve("public/api/wiki/quality/matrix.json");
			assert.ok(fs.existsSync(matrixDataPath), "src/data/wiki/quality/matrix.json 必须生成");
			assert.ok(fs.existsSync(matrixPublicPath), "public/api/wiki/quality/matrix.json 必须生成");

			const matrix = JSON.parse(fs.readFileSync(matrixDataPath, "utf-8"));
			const slugs = Object.keys(matrix);
			assert.equal(slugs.length, 49);

			// 按评分从高到低排序，输出全站 Top 10 质量排行榜
			const leaderboard = slugs
				.map((slug) => matrix[slug])
				.sort((a, b) => b.score - a.score || a.issuesCount.total - b.issuesCount.total);

			console.log("\n=======================================================");
			console.log("🏆 [FuWari Blog] 全站博文质量工程排行榜 Top 10 喵！");
			console.log("=======================================================");
			leaderboard.slice(0, 10).forEach((item, idx) => {
				const rank = String(idx + 1).padStart(2, " ");
				const score = String(item.score).padStart(3, " ");
				console.log(
					` ${rank}. [${item.grade}] ${score}分 | 《${item.title}》 (${item.slug})` +
					` [警告: ${item.issuesCount.warnings}, 字数: ${item.metrics?.totalEquivalentWords || 0}]`,
				);
			});
			console.log("=======================================================");

			// 验证每篇博文独立报告的 Schema 完整性
			for (const slug of slugs.slice(0, 5)) {
				const singlePath = path.resolve(`src/data/wiki/quality/${slug}.json`);
				assert.ok(fs.existsSync(singlePath), `单篇博文质量报告 ${slug}.json 必须存在`);
				const singleData = JSON.parse(fs.readFileSync(singlePath, "utf-8"));
				assert.equal(singleData.slug, slug);
				assert.ok(typeof singleData.score === "number");
				assert.ok(["S", "A", "B", "C", "D"].includes(singleData.grade));
				assert.ok(singleData.breakdown.typography);
				assert.ok(singleData.breakdown.links);
				assert.ok(singleData.breakdown.structure);
				assert.ok(singleData.breakdown.readability);
			}
		});
	});
});
