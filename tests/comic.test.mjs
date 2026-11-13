import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	buildLocalComicImagePath,
	classifyComicChapter,
	filterAndSortChapters,
	formatBytes,
	groupChaptersByRange,
	padChapterSlug,
	padPageFilename,
	parseCsvRecords,
	resolveComicImageUrl,
	sanitizeComicUrl,
} from "../src/utils/comic-core.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

describe("漫画板块核心逻辑与数据导入完整性测试 (Comic Core & Manifest Suite)", () => {
	describe("1. CSV 解析与路径规范化", () => {
		it("应正确剥离 UTF-8 BOM 并解析包含逗号与引号的 CSV 行", () => {
			const csv = `﻿chapter_index,chapter_title,chapter_url\n2,"002·糖果啊，是命运的邂逅",https://kkwebtoon.com/chapter/651/1494508\n3,"标题""含双引号""",https://example.com/3`;
			const rows = parseCsvRecords(csv);
			assert.strictEqual(rows.length, 2);
			assert.strictEqual(rows[0].chapter_index, "2");
			assert.strictEqual(rows[0].chapter_title, "002·糖果啊，是命运的邂逅");
			assert.strictEqual(rows[1].chapter_title, '标题"含双引号"');
		});

		it("应将章节序号与页码格式化为统一 ASCII 路径", () => {
			assert.strictEqual(padChapterSlug(1), "0001");
			assert.strictEqual(padChapterSlug("785"), "0785");
			assert.strictEqual(padPageFilename(1, "WEBP"), "page-0001.webp");
			assert.strictEqual(
				buildLocalComicImagePath(
					"huyao-xiaohongniang",
					"0002",
					"page-0001.webp",
				),
				"/comics/huyao-xiaohongniang/chapters/0002/page-0001.webp",
			);
		});

		it("formatBytes 应合理格式化 B / MB / GB", () => {
			assert.strictEqual(formatBytes(0), "0 B");
			assert.strictEqual(formatBytes(512), "512 B");
			assert.strictEqual(formatBytes(1024 * 1024 * 2.5), "2.50 MB");
		});
	});

	describe("2. URL 安全校验 (sanitizeComicUrl)", () => {
		it("自有资源域名应保留 Astro 路径并匹配 R2 对象键", () => {
			const pathname =
				"/comics/huyao-xiaohongniang/chapters/0001/page-0001.webp";
			const url = resolveComicImageUrl(
				pathname,
				"https://blog-s3-cf.yaoxi.wiki",
			);
			assert.strictEqual(url, `https://blog-s3-cf.yaoxi.wiki${pathname}`);
			assert.strictEqual(new URL(url).pathname.slice(1), pathname.slice(1));
			assert.throws(() =>
				resolveComicImageUrl(
					"https://other.example/image.webp",
					"https://blog-s3-cf.yaoxi.wiki",
				),
			);
			assert.throws(() =>
				resolveComicImageUrl(pathname, "http://other.example"),
			);
		});
		it("应放行合法 http(s) 与站内根相对路径", () => {
			assert.strictEqual(
				sanitizeComicUrl("https://s3-tbu-og.kkwebtoon.com/page.webp"),
				"https://s3-tbu-og.kkwebtoon.com/page.webp",
			);
			assert.strictEqual(
				sanitizeComicUrl("/comics/huyao-xiaohongniang/cover.webp"),
				"/comics/huyao-xiaohongniang/cover.webp",
			);
		});

		it("应拦截协议相对 URL 与危险协议", () => {
			assert.strictEqual(sanitizeComicUrl("//evil.example/x.webp"), "");
			assert.strictEqual(sanitizeComicUrl("javascript:alert(1)"), "");
			assert.strictEqual(sanitizeComicUrl("data:text/html,<script>"), "");
		});
	});

	describe("3. 章节分类、过滤排序与分卷分组", () => {
		it("应精准区分正篇、番外与公告休刊", () => {
			assert.strictEqual(
				classifyComicChapter("002·糖果啊，是命运的邂逅", 24),
				"main",
			);
			assert.strictEqual(classifyComicChapter("单行本番外一", 24), "extra");
			assert.strictEqual(classifyComicChapter("休刊番外", 17), "extra");
			assert.strictEqual(classifyComicChapter("可耻地休刊一期", 1), "notice");
			assert.strictEqual(
				classifyComicChapter("第735话 本周休刊，下周双更", 2),
				"notice",
			);
			assert.strictEqual(
				classifyComicChapter("总077·完全在意料之外（中）", 5),
				"main",
			);
		});

		it("应支持关键词检索、类型过滤与正倒序切换", () => {
			const sample = [
				{ index: 1, slug: "0001", title: "001", kind: "main" },
				{ index: 2, slug: "0002", title: "王权富贵", kind: "main" },
				{ index: 56, slug: "0056", title: "狐妖小番外", kind: "extra" },
				{ index: 403, slug: "0403", title: "可耻地休刊一期", kind: "notice" },
			];
			const descMain = filterAndSortChapters(sample, {
				kind: "main",
				sort: "desc",
			});
			assert.deepStrictEqual(
				descMain.map((c) => c.index),
				[2, 1],
			);

			const searchHit = filterAndSortChapters(sample, { keyword: "王权" });
			assert.strictEqual(searchHit.length, 1);
			assert.strictEqual(searchHit[0].slug, "0002");
		});

		it("应按每 100 话分卷分组", () => {
			const items = Array.from({ length: 205 }, (_, i) => ({ index: i + 1 }));
			const groups = groupChaptersByRange(items, 100);
			assert.strictEqual(groups.length, 3);
			assert.strictEqual(groups[0].label, "1 - 100 话");
			assert.strictEqual(groups[1].label, "101 - 200 话");
			assert.strictEqual(groups[2].label, "201 - 205 话");
		});
	});

	describe("4. 《狐妖小红娘》已导入数据清单校验", () => {
		it("catalog、index、manifest、api 与封面横幅资源应完整存在", () => {
			const catalogPath = path.join(ROOT_DIR, "src/data/comics/catalog.json");
			const indexPath = path.join(
				ROOT_DIR,
				"src/data/comics/huyao-xiaohongniang/index.json",
			);
			const manifestPath = path.join(
				ROOT_DIR,
				"src/data/comics/huyao-xiaohongniang/manifest.json",
			);
			const apiPath = path.join(
				ROOT_DIR,
				"public/api/comics/huyao-xiaohongniang/chapters.json",
			);
			const coverPath = path.join(
				ROOT_DIR,
				"public/comics/huyao-xiaohongniang/cover.webp",
			);
			const bannerPath = path.join(
				ROOT_DIR,
				"public/comics/huyao-xiaohongniang/banner.webp",
			);

			assert.ok(fs.existsSync(catalogPath), "缺少 catalog.json");
			assert.ok(fs.existsSync(indexPath), "缺少 index.json");
			assert.ok(fs.existsSync(manifestPath), "缺少 manifest.json");
			assert.ok(fs.existsSync(apiPath), "缺少 public/api chapters.json");
			assert.ok(fs.existsSync(coverPath), "缺少 cover.webp");
			assert.ok(fs.existsSync(bannerPath), "缺少 banner.webp");

			const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
			const huyao = catalog.find((c) => c.slug === "huyao-xiaohongniang");
			assert.ok(huyao, "catalog.json 未包含 huyao-xiaohongniang");
			assert.strictEqual(huyao.totalChapters, 785);
			assert.strictEqual(huyao.totalPages, 10405);
			assert.ok(!("coverFallback" in huyao));
			assert.ok(!("bannerFallback" in huyao));
			assert.deepEqual(
				huyao.imageSources.map((s) => s.baseUrl),
				[
					"https://blog-s3-cf.yaoxi.wiki",
					"https://blog-s3-eo.yaoxi.wiki",
					"https://blog-s3-esa.yaoxi.wiki",
				],
			);

			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
			assert.strictEqual(manifest.chapters.length, 785);
			assert.strictEqual(huyao.imageBaseUrl, huyao.imageSources[0].baseUrl);
			assert.deepEqual(manifest.meta.imageSources, huyao.imageSources);
			assert.strictEqual(manifest.meta.imageBaseUrl, huyao.imageBaseUrl);
			const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
			assert.deepEqual(index.meta.imageSources, huyao.imageSources);
			assert.strictEqual(index.meta.imageBaseUrl, huyao.imageBaseUrl);

			let countedPages = 0;
			for (const ch of manifest.chapters) {
				assert.ok(ch.pages.length > 0, `章节 ${ch.slug} 不应为空`);
				for (const page of ch.pages) {
					countedPages++;
					assert.ok(page.width > 0 && page.height > 0);
					assert.ok(
						page.src.startsWith("/comics/huyao-xiaohongniang/chapters/"),
					);
					assert.ok(!("fallbackUrl" in page));
					assert.ok(!("sourceUrl" in ch));
				}
			}
			assert.strictEqual(countedPages, 10405);

			// 抽样校验首尾话物理图片文件是否落盘（chapters/ 在 .gitignore 中忽略，仅在本地存在章节图片目录时校验）
			const chaptersDir = path.join(
				ROOT_DIR,
				"public/comics/huyao-xiaohongniang/chapters",
			);
			if (fs.existsSync(chaptersDir)) {
				const firstImg = path.join(
					ROOT_DIR,
					"public",
					manifest.chapters[0].pages[0].src,
				);
				const lastCh = manifest.chapters[manifest.chapters.length - 1];
				const lastImg = path.join(
					ROOT_DIR,
					"public",
					lastCh.pages[lastCh.pages.length - 1].src,
				);
				assert.ok(fs.existsSync(firstImg), `首图不存在: ${firstImg}`);
				assert.ok(fs.existsSync(lastImg), `末图不存在: ${lastImg}`);
			}
		});
	});
});
