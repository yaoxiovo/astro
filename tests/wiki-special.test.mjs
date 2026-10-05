import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	SITE_HOST,
	STALE_THRESHOLD_DAYS,
	extractInternalLinks,
	invertBacklinks,
	flattenRecentChanges,
	buildMaintenanceReport,
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
});
