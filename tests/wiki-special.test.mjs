import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	SITE_HOST,
	STALE_THRESHOLD_DAYS,
	extractInternalLinks,
	invertBacklinks,
	flattenRecentChanges,
	buildMaintenanceReport,
	buildScanMask,
	computeLinkSuggestions,
	computeRelatedArticles,
} from "../scripts/generate-wiki-special.mjs";

describe("维基百科式特殊页面索引生成套件 (Special Pages Indexer)", () => {
	describe("1. 站内链接提取 (extractInternalLinks)", () => {
		it("应当提取 /posts/ 相对链接并统计出现次数", () => {
			const md = [
				"参考 [第一篇](/posts/hello-world) 与 [第二篇](/posts/second)。",
				"再次提到 [第一篇](/posts/hello-world)。",
			].join("\n");
			const links = extractInternalLinks(md, "self-slug");
			assert.deepEqual(links, [
				{ slug: "hello-world", count: 2 },
				{ slug: "second", count: 1 },
			]);
		});

		it("应当剥离锚点 (#anchor) 与查询串 (?query) 后归一化 slug", () => {
			const md = "[A](/posts/foo#section-2) 和 [B](/posts/bar?tab=1&x=2)";
			const links = extractInternalLinks(md, "self-slug");
			assert.deepEqual(
				links.map((l) => l.slug).sort(),
				["bar", "foo"],
			);
		});

		it("应当识别绝对站内 URL 并拒绝外站 /posts/ 路径", () => {
			const md = [
				`[内链](${`https://${SITE_HOST}`}/posts/baz/)`,
				"[外站](https://example.com/posts/nope)",
			].join("\n");
			const links = extractInternalLinks(md, "self-slug");
			assert.deepEqual(links, [{ slug: "baz", count: 1 }]);
		});

		it("应当跳过图片语法 ![alt](src) 不产生误报", () => {
			const md = "![封面](/posts/not-a-link) 正文 [真链接](/posts/real)";
			const links = extractInternalLinks(md, "self-slug");
			assert.deepEqual(links, [{ slug: "real", count: 1 }]);
		});

		it("应当剔除自链接并支持 URI 解码与标题语法", () => {
			const md = [
				"[自指](/posts/self-slug)",
				"[编码](/posts/hello%20world)",
				'[带标题](/posts/titled "鼠标悬停标题")',
			].join("\n");
			const links = extractInternalLinks(md, "self-slug");
			assert.deepEqual(
				links.map((l) => l.slug).sort(),
				["hello world", "titled"],
			);
		});

		it("应当忽略普通相对路径与外部 http 链接", () => {
			const md =
				"[相对](./other.md) [外部](https://google.com) [锚点](#top)";
			const links = extractInternalLinks(md, "self-slug");
			assert.deepEqual(links, []);
		});
	});

	describe("2. 反链索引反转 (invertBacklinks)", () => {
		it("应当将出链映射反转为按目标聚合的反链索引", () => {
			const outbound = {
				alpha: [{ slug: "x", count: 2 }],
				beta: [
					{ slug: "x", count: 5 },
					{ slug: "y", count: 1 },
				],
			};
			const backlinks = invertBacklinks(outbound);
			assert.deepEqual(backlinks.x, [
				{ slug: "beta", count: 5 },
				{ slug: "alpha", count: 2 },
			]);
			assert.deepEqual(backlinks.y, [{ slug: "beta", count: 1 }]);
		});

		it("相同引用次数时应按来源 slug 字典序稳定排序", () => {
			const outbound = {
				zzz: [{ slug: "t", count: 1 }],
				aaa: [{ slug: "t", count: 1 }],
			};
			const backlinks = invertBacklinks(outbound);
			assert.deepEqual(
				backlinks.t.map((b) => b.slug),
				["aaa", "zzz"],
			);
		});
	});

	describe("3. 全站最近更改流展平 (flattenRecentChanges)", () => {
		const historyMap = {
			"post-a": {
				title: "A",
				revisions: [
					{
						sha: "sha-a3",
						shortSha: "a3",
						date: "2026-09-10T10:00:00Z",
						displayDate: "2026-09-10 18:00",
						author: "u",
						message: "m3",
						isMinor: false,
					},
					{
						sha: "sha-a2",
						shortSha: "a2",
						date: "2026-08-01T10:00:00Z",
						displayDate: "2026-08-01 18:00",
						author: "u",
						message: "m2",
						isMinor: true,
					},
				],
			},
			"post-b": {
				title: "B",
				revisions: [
					{
						sha: "sha-b1",
						shortSha: "b1",
						date: "2026-09-20T10:00:00Z",
						displayDate: "2026-09-20 18:00",
						author: "u",
						message: "m1",
						isMinor: false,
					},
				],
			},
		};

		it("应当跨文章展平全部修订并按时间倒序排列", () => {
			const entries = flattenRecentChanges(historyMap);
			assert.equal(entries.length, 3);
			assert.deepEqual(
				entries.map((e) => e.shortSha),
				["b1", "a3", "a2"],
			);
		});

		it("相邻旧版本指针 prevShortSha 应指向同文章更早的修订（最旧为 null）", () => {
			const entries = flattenRecentChanges(historyMap);
			const a3 = entries.find((e) => e.shortSha === "a3");
			const a2 = entries.find((e) => e.shortSha === "a2");
			assert.equal(a3.prevShortSha, "a2");
			assert.equal(a2.prevShortSha, null);
		});

		it("limit 参数应截断为最新的 N 条", () => {
			const entries = flattenRecentChanges(historyMap, 1);
			assert.deepEqual(
				entries.map((e) => e.shortSha),
				["b1"],
			);
		});

		it("空历史或缺失 revisions 字段应当安全降级为空数组", () => {
			assert.deepEqual(flattenRecentChanges({}), []);
			assert.deepEqual(
				flattenRecentChanges({ "post-x": { title: "X" } }),
				[],
			);
		});
	});

	describe("4. 维护巡检报告 (buildMaintenanceReport)", () => {
		const posts = [
			{ slug: "hub", title: "枢纽" },
			{ slug: "leaf", title: "孤叶" },
			{ slug: "desert", title: "荒漠" },
		];
		// hub 被 leaf 引用（有链入）；leaf 引用 hub（有出链）；desert 双向皆无
		const backlinkIndex = { hub: [{ slug: "leaf", count: 1 }] };
		const outboundMap = { leaf: [{ slug: "hub", count: 2 }] };
		const historyMap = {
			hub: { lastUpdated: "2026-01-01T00:00:00Z", totalRevisions: 5 },
			leaf: { lastUpdated: "2026-09-30T00:00:00Z", totalRevisions: 2 },
		};
		const now = new Date("2026-10-05T00:00:00Z");
		const qualityMatrix = {
			hub: { title: "枢纽", grade: "A", score: 95, issuesCount: { total: 0 } },
			leaf: {
				title: "孤叶",
				grade: "D",
				score: 42,
				issuesCount: { total: 9 },
			},
			desert: { title: "荒漠", grade: "B", score: 80, issuesCount: { total: 3 } },
		};
		const qualityReports = {
			hub: {
				title: "枢纽",
				issues: [
					{
						severity: "error",
						type: "broken_link",
						line: 12,
						excerpt: "[死链]",
						message: "链接目标不存在",
					},
					{
						severity: "warning",
						type: "pangu_missing_space",
						line: 20,
						excerpt: "Hello世界",
						message: "缺少盘古空格",
					},
				],
			},
			leaf: { title: "孤叶", issues: [] },
		};

		function report(overrides = {}) {
			return buildMaintenanceReport({
				posts,
				backlinkIndex,
				outboundMap,
				historyMap,
				qualityMatrix,
				qualityReports,
				now,
				...overrides,
			});
		}

		it("应当识别孤立条目（零链入）与断头路（零出链）", () => {
			const r = report();
			assert.deepEqual(
				r.orphans.map((o) => o.slug).sort(),
				["desert", "leaf"],
			);
			assert.deepEqual(
				r.deadEnds.map((d) => d.slug).sort(),
				["desert", "hub"],
			);
		});

		it("自链接引用不应计入链入/出链度", () => {
			const r = report({
				backlinkIndex: { hub: [{ slug: "hub", count: 3 }] },
				outboundMap: { leaf: [{ slug: "leaf", count: 1 }] },
			});
			assert.ok(
				r.orphans.some((o) => o.slug === "hub"),
				"仅含自链接的条目仍应视为孤立条目",
			);
			assert.ok(
				r.deadEnds.some((d) => d.slug === "leaf"),
				"仅含自链接的条目仍应视为断头路",
			);
		});

		it(`应当标记超过 ${STALE_THRESHOLD_DAYS} 天未更新的过时条目并支持阈值覆盖`, () => {
			const r = report();
			assert.deepEqual(
				r.stale.map((s) => s.slug),
				["hub"],
			);
			assert.equal(r.stale[0].daysSinceUpdate, 277);

			const relaxed = report({ staleThresholdDays: 300 });
			assert.deepEqual(relaxed.stale, [], "阈值放宽至 300 天后不应有过时条目");
		});

		it("应当仅收集 C/D 评级条目为低质条目并按分值升序排列", () => {
			const r = report();
			assert.deepEqual(
				r.lowQuality.map((l) => l.slug),
				["leaf"],
			);
			assert.equal(r.lowQuality[0].grade, "D");
			assert.equal(r.lowQuality[0].issuesCount, 9);
		});

		it("应当仅将 severity=error 的质量问题收集为死链告警", () => {
			const r = report();
			assert.equal(r.brokenLinks.length, 1);
			assert.equal(r.brokenLinks[0].slug, "hub");
			assert.equal(r.brokenLinks[0].type, "broken_link");
			assert.equal(r.brokenLinks[0].line, 12);
		});

		it("统计面板应输出各维度总数与站内链接总次数", () => {
			const r = report();
			assert.equal(r.stats.totalPosts, 3);
			assert.equal(r.stats.totalRevisions, 7);
			assert.equal(r.stats.totalInternalLinks, 2);
			assert.equal(r.stats.totalOrphans, 2);
			assert.equal(r.stats.totalDeadEnds, 2);
			assert.equal(r.stats.totalStale, 1);
			assert.equal(r.stats.totalLowQuality, 1);
			assert.equal(r.stats.totalBrokenLinks, 1);
			assert.equal(r.generatedAt, now.toISOString());
		});
	});

	describe("5. 相关文章推荐 (computeRelatedArticles)", () => {
		it("应当基于共同链接邻居与标签计算余弦相似度并互推", () => {
			const posts = [
				{ slug: "alpha", title: "Alpha", tags: ["主题"] },
				{ slug: "beta", title: "Beta", tags: [] },
				{ slug: "gamma", title: "Gamma", tags: ["主题"] },
				{ slug: "lonely", title: "Lonely", tags: [] },
			];
			const outboundMap = {
				alpha: [{ slug: "beta", count: 1 }],
				beta: [],
				gamma: [{ slug: "beta", count: 2 }],
				lonely: [],
			};
			const backlinkIndex = invertBacklinks(outboundMap);
			const { related } = computeRelatedArticles({ posts, outboundMap, backlinkIndex });

			assert.equal(related.alpha.length, 1);
			assert.equal(related.alpha[0].slug, "gamma");
			assert.equal(related.alpha[0].sharedPosts, 1);
			assert.equal(related.alpha[0].sharedTags, 1);
			assert.equal(related.gamma[0].slug, "alpha");
			// 仅被链接（无共同邻居）与完全孤立的条目不应产生推荐
			assert.equal(related.beta, undefined);
			assert.equal(related.lonely, undefined);
		});

		it("无任何内链时应当由共同标签降权兜底（×0.3）", () => {
			const posts = [
				{ slug: "alpha", title: "Alpha", tags: ["Astro", "教程"] },
				{ slug: "beta", title: "Beta", tags: ["Astro"] },
				{ slug: "gamma", title: "Gamma", tags: ["无关"] },
			];
			const { related } = computeRelatedArticles({
				posts,
				outboundMap: {},
				backlinkIndex: {},
			});

			assert.equal(related.alpha.length, 1);
			assert.equal(related.alpha[0].slug, "beta");
			assert.equal(related.alpha[0].sharedPosts, 0);
			assert.equal(related.alpha[0].sharedTags, 1);
			// tagScore = 1 / sqrt(2 * 1)，再乘 0.3 降权系数后取三位小数
			const expected = Math.round((1 / Math.sqrt(2)) * 0.3 * 1000) / 1000;
			assert.equal(related.alpha[0].score, expected);
			assert.equal(related.beta[0].slug, "alpha");
			// 零共同信号的条目不应产生推荐
			assert.equal(related.gamma, undefined);
		});

		it("应当排除 draft 条目（生产环境不生成页面）", () => {
			const posts = [
				{ slug: "alpha", title: "Alpha", tags: [] },
				{ slug: "beta", title: "Beta", tags: [] },
				{ slug: "hidden", title: "Hidden", tags: [], draft: true },
			];
			const outboundMap = {
				alpha: [{ slug: "beta", count: 1 }],
				beta: [],
				hidden: [{ slug: "beta", count: 1 }],
			};
			const backlinkIndex = invertBacklinks(outboundMap);
			const { related } = computeRelatedArticles({ posts, outboundMap, backlinkIndex });

			assert.equal("hidden" in related, false);
			assert.equal(related.alpha, undefined);
		});

		it("结果应按相似度排序并受 topN 限制", () => {
			const posts = [
				{ slug: "main", title: "Main", tags: [] },
				{ slug: "hub", title: "Hub", tags: [] },
			];
			const outboundMap = {
				main: [{ slug: "hub", count: 1 }],
				hub: [],
			};
			const backlinkIndex = invertBacklinks(outboundMap);
			for (let i = 1; i <= 6; i++) {
				const slug = `t${i}`;
				posts.push({ slug, title: `T${i}`, tags: [] });
				outboundMap[slug] = [{ slug: "hub", count: 1 }];
				backlinkIndex.hub.push({ slug, count: 1 });
			}
			const { related } = computeRelatedArticles({ posts, outboundMap, backlinkIndex });

			assert.equal(related.main.length, 5);
			assert.deepEqual(
				related.main.map((item) => item.slug),
				["t1", "t2", "t3", "t4", "t5"],
			);
		});
	});

	describe("6. 补链雷达 (computeLinkSuggestions)", () => {
		function makeSuggestionsFixture() {
			const raw = [
				"---",
				"title: 来源文章",
				"tags:",
				"  - 测试",
				"---",
				"",
				"## 开头",
				"",
				"正文提到 目标文章甲，再次提到 目标文章甲 喵。",
				"",
				"```js",
				"// 目标文章乙 出现在代码里",
				"```",
				"",
				"行内代码 `目标文章乙` 也不算。",
				"",
				"[目标文章丁](/posts/dummy) 已有链接；另有 目标文章丙 已被链接过。",
				"",
			].join("\n");
			return {
				posts: [
					{ slug: "source", title: "来源文章", raw },
					{ slug: "target-a", title: "目标文章甲", raw: "" },
					{ slug: "target-b", title: "目标文章乙", raw: "" },
					{ slug: "target-c", title: "目标文章丙", raw: "" },
					{ slug: "target-d", title: "目标文章丁", raw: "" },
					{ slug: "dummy", title: "占位页", raw: "" },
				],
				outboundMap: {
					source: [
						{ slug: "dummy", count: 1 },
						{ slug: "target-c", count: 1 },
					],
				},
			};
		}

		it("应当统计未链接的标题提及并生成样本上下文", () => {
			const { posts, outboundMap } = makeSuggestionsFixture();
			const { suggestions, stats } = computeLinkSuggestions({ posts, outboundMap });

			const list = suggestions.source;
			assert.equal(list.length, 1);
			assert.equal(list[0].slug, "target-a");
			assert.equal(list[0].title, "目标文章甲");
			assert.equal(list[0].count, 2);
			assert.equal(list[0].samples.length, 2);
			assert.ok(list[0].samples[0].includes("目标文章甲"));
			assert.equal(stats.totalArticles, 1);
			assert.equal(stats.totalSuggestions, 1);
			assert.equal(stats.totalMentions, 2);
		});

		it("代码块、行内代码与链接语法内的提及不应误报", () => {
			const { posts, outboundMap } = makeSuggestionsFixture();
			const { suggestions } = computeLinkSuggestions({ posts, outboundMap });
			const slugs = (suggestions.source || []).map((item) => item.slug);
			assert.ok(!slugs.includes("target-b"));
			assert.ok(!slugs.includes("target-d"));
		});

		it("已建立站内链接的目标不应出现在建议中", () => {
			const { posts, outboundMap } = makeSuggestionsFixture();
			const { suggestions } = computeLinkSuggestions({ posts, outboundMap });
			const slugs = (suggestions.source || []).map((item) => item.slug);
			assert.ok(!slugs.includes("target-c"));
		});

		it("扫描掩码应保持长度与换行结构，仅遮蔽语法区域", () => {
			const md = "前言 [链接](/posts/x) `code`\n```\n块\n```\n尾声";
			const mask = buildScanMask(md);
			assert.equal(mask.length, md.length);
			assert.equal(mask.split("\n").length, md.split("\n").length);
			assert.ok(mask.includes("前言"));
			assert.ok(mask.includes("尾声"));
			assert.ok(!mask.includes("链接"));
			assert.ok(!mask.includes("code"));
		});

		it("加密正文与 draft 条目不应作为扫描来源（样本防泄漏）", () => {
			const posts = [
				{ slug: "secret", title: "加密文章", encrypted: true, raw: "这里提到 目标文章甲 的内容" },
				{ slug: "draft-x", title: "草稿", draft: true, raw: "这里提到 目标文章甲 的内容" },
				{ slug: "target-a", title: "目标文章甲", raw: "" },
			];
			const { suggestions } = computeLinkSuggestions({ posts, outboundMap: {} });
			assert.deepEqual(suggestions, {});
		});

		it("同名冲突标题与单字短标题不应作为补链目标", () => {
			const posts = [
				{ slug: "s1", title: "来源一", raw: "提到 重名条目 和 短 字标题。" },
				{ slug: "dup-a", title: "重名条目", raw: "" },
				{ slug: "dup-b", title: "重名条目", raw: "" },
				{ slug: "short", title: "短", raw: "" },
			];
			const { suggestions } = computeLinkSuggestions({ posts, outboundMap: {} });
			assert.equal(suggestions.s1, undefined);
		});

		it("副标题变体（冒号后的核心短语）应能匹配未链接提及并回填完整标题", () => {
			const posts = [
				{
					slug: "source",
					title: "来源文章",
					raw: "正文提到 构建提速 的核心技巧，还有 构建提速 的细节。",
				},
				{ slug: "target", title: "开发日志：构建提速", raw: "" },
			];
			const { suggestions } = computeLinkSuggestions({ posts, outboundMap: {} });
			const list = suggestions.source;
			assert.equal(list.length, 1);
			assert.equal(list[0].slug, "target");
			// 展示名应回填完整标题，而非匹配到的副标题变体
			assert.equal(list[0].title, "开发日志：构建提速");
			assert.equal(list[0].count, 2);
		});

		it("通用副标题前缀跨条目冲突时应整体弃用该变体", () => {
			const posts = [
				{ slug: "source", title: "来源文章", raw: "提到 开发日志 与 构建提速 两处。" },
				{ slug: "target-a", title: "开发日志：构建提速", raw: "" },
				{ slug: "target-b", title: "开发日志：部署复盘", raw: "" },
			];
			const { suggestions } = computeLinkSuggestions({ posts, outboundMap: {} });
			const list = suggestions.source;
			// 「开发日志」歧义弃用；「构建提速」仍唯一指向 target-a
			assert.ok(list.some((item) => item.slug === "target-a"));
			assert.ok(!list.some((item) => item.slug === "target-b"));
		});
	});
});
