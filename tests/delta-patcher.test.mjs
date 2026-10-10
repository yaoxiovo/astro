import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyDeltaPatch,
	applyJsonPatch,
	applyLineDeltas,
	applyOperation,
	createDeltaPatch,
	encodePointerToken,
	generateLineDeltas,
	generateObjectJsonPatch,
	getPointerValue,
	parseJsonPointer,
} from "../src/utils/delta-patcher.mjs";

describe("RFC 6902 客户端增量差分热补丁测试套件 (Delta-Encoding & Hot-Patching)", () => {
	describe("1. RFC 6901 / RFC 6902 核心基石测试", () => {
		it("应当正确解析 JSON Pointer 并处理 ~0 与 ~1 转义字符", () => {
			assert.deepEqual(parseJsonPointer(""), []);
			assert.deepEqual(parseJsonPointer("/"), []);
			assert.deepEqual(parseJsonPointer("/title"), ["title"]);
			assert.deepEqual(parseJsonPointer("/a/b/c"), ["a", "b", "c"]);
			assert.deepEqual(parseJsonPointer("/users/0/name"), [
				"users",
				"0",
				"name",
			]);
			assert.deepEqual(parseJsonPointer("/special~1slash"), ["special/slash"]);
			assert.deepEqual(parseJsonPointer("/special~0tilde"), ["special~tilde"]);
			assert.deepEqual(parseJsonPointer("/mix~0tilde~1slash/item"), [
				"mix~tilde/slash",
				"item",
			]);

			assert.throws(
				() => parseJsonPointer("invalid_no_slash"),
				/非法 JSON Pointer 路径/,
			);
		});

		it("应当正确编码 JSON Pointer token", () => {
			assert.equal(encodePointerToken("simple"), "simple");
			assert.equal(encodePointerToken("foo/bar"), "foo~1bar");
			assert.equal(encodePointerToken("foo~bar"), "foo~0bar");
			assert.equal(encodePointerToken("foo/bar~baz"), "foo~1bar~0baz");
		});

		it("应当正确通过 JSON Pointer 获取深层属性值", () => {
			const doc = {
				title: "测试博文喵~",
				meta: { tags: ["astro", "neko"], views: 1024 },
				authors: [{ name: "yaoxi" }, { name: "neko" }],
			};
			assert.equal(getPointerValue(doc, "/title"), "测试博文喵~");
			assert.equal(getPointerValue(doc, "/meta/views"), 1024);
			assert.equal(getPointerValue(doc, "/meta/tags/1"), "neko");
			assert.equal(getPointerValue(doc, "/authors/0/name"), "yaoxi");
			assert.equal(getPointerValue(doc, "/non/existent"), undefined);
		});

		it("应当正确执行 RFC 6902 全部标准操作：add, remove, replace, move, copy, test", () => {
			const doc = {
				title: "初始标题",
				views: 10,
				tags: ["dev"],
				author: { name: "Alice" },
			};

			// add 属性与数组项
			applyOperation(doc, {
				op: "add",
				path: "/description",
				value: "博文描述",
			});
			assert.equal(doc.description, "博文描述");
			applyOperation(doc, { op: "add", path: "/tags/1", value: "ops" });
			assert.deepEqual(doc.tags, ["dev", "ops"]);

			// replace 属性与数组项
			applyOperation(doc, { op: "replace", path: "/title", value: "更新标题" });
			assert.equal(doc.title, "更新标题");
			applyOperation(doc, {
				op: "replace",
				path: "/tags/0",
				value: "development",
			});
			assert.deepEqual(doc.tags, ["development", "ops"]);

			// copy 操作
			applyOperation(doc, { op: "copy", from: "/title", path: "/backupTitle" });
			assert.equal(doc.backupTitle, "更新标题");

			// move 操作
			applyOperation(doc, {
				op: "move",
				from: "/backupTitle",
				path: "/archivedTitle",
			});
			assert.equal(doc.archivedTitle, "更新标题");
			assert.equal("backupTitle" in doc, false);

			// test 操作 (成功与失败断言)
			assert.doesNotThrow(() => {
				applyOperation(doc, { op: "test", path: "/title", value: "更新标题" });
			});
			assert.throws(() => {
				applyOperation(doc, { op: "test", path: "/title", value: "错误标题" });
			}, /test 操作断言失败/);

			// remove 操作
			applyOperation(doc, { op: "remove", path: "/archivedTitle" });
			assert.equal("archivedTitle" in doc, false);
			applyOperation(doc, { op: "remove", path: "/tags/1" });
			assert.deepEqual(doc.tags, ["development"]);
		});

		it("应当支持生成对象间的 RFC 6902 差分补丁集", () => {
			const fromObj = { a: 1, b: "hello", c: [1, 2], d: "to_delete" };
			const toObj = { a: 2, b: "hello", c: [1, 2, 3], e: "new_field" };

			const patch = generateObjectJsonPatch(fromObj, toObj, ["c"]);
			const patched = applyJsonPatch(fromObj, patch, false);

			assert.equal(patched.a, 2);
			assert.equal(patched.b, "hello");
			assert.equal(patched.e, "new_field");
			assert.equal("d" in patched, false);
			// 忽略的键 c 未变更
			assert.deepEqual(patched.c, [1, 2]);
		});
	});

	describe("2. 紧凑行级文本差分引擎 (LineDelta) 边界场景测试", () => {
		it("边界用例：完全相同的文本应输出空差分", () => {
			const text = "第一行喵~\n第二行\n第三行";
			const deltas = generateLineDeltas(text, text);
			assert.deepEqual(deltas, []);
			const restored = applyLineDeltas(text, deltas);
			assert.equal(restored, text);
		});

		it("边界用例：空文本转换场景 (Empty <-> Non-Empty)", () => {
			// 空 -> 有内容
			const emptyToText = generateLineDeltas("", "新增行A\n新增行B");
			assert.equal(applyLineDeltas("", emptyToText), "新增行A\n新增行B");

			// 有内容 -> 空
			const textToEmpty = generateLineDeltas("删除行A\n删除行B", "");
			assert.equal(applyLineDeltas("删除行A\n删除行B", textToEmpty), "");

			// 空 -> 空
			assert.deepEqual(generateLineDeltas("", ""), []);
			assert.equal(applyLineDeltas("", []), "");
		});

		it("边界用例：纯行新增场景（开头、中间、末尾插入）", () => {
			const base = ["line 1", "line 2", "line 3"].join("\n");

			// 开头插入
			const atHead = ["line 0", "line 1", "line 2", "line 3"].join("\n");
			const deltaHead = generateLineDeltas(base, atHead);
			assert.equal(applyLineDeltas(base, deltaHead), atHead);

			// 中间插入
			const atMid = ["line 1", "line 1.5", "line 2", "line 3"].join("\n");
			const deltaMid = generateLineDeltas(base, atMid);
			assert.equal(applyLineDeltas(base, deltaMid), atMid);

			// 末尾插入
			const atTail = ["line 1", "line 2", "line 3", "line 4", "line 5"].join(
				"\n",
			);
			const deltaTail = generateLineDeltas(base, atTail);
			assert.equal(applyLineDeltas(base, deltaTail), atTail);
		});

		it("边界用例：纯行删除场景（首部裁剪、中间挖空、尾部截断）", () => {
			const base = ["A", "B", "C", "D", "E"].join("\n");

			// 删首
			const delHead = ["B", "C", "D", "E"].join("\n");
			assert.equal(
				applyLineDeltas(base, generateLineDeltas(base, delHead)),
				delHead,
			);

			// 删中间
			const delMid = ["A", "C", "E"].join("\n");
			assert.equal(
				applyLineDeltas(base, generateLineDeltas(base, delMid)),
				delMid,
			);

			// 删尾部
			const delTail = ["A", "B"].join("\n");
			assert.equal(
				applyLineDeltas(base, generateLineDeltas(base, delTail)),
				delTail,
			);
		});

		it("边界用例：中英文混排与复杂标点符号改写", () => {
			const v1 = [
				"# 深入理解 Node.js 异步模型喵！",
				"",
				"Node.js uses an event-driven architecture.",
				"在这里，libuv 负责底层的 I/O 多路复用 (epoll/kqueue)。",
				"当网络请求到达时，唤醒 Event Loop 并派发 Callback。",
				"猫娘架构师提醒：千万别阻塞主线程喵~",
			].join("\n");

			const v2 = [
				"# 深入理解 Node.js 与 Bun 异步并发模型喵！",
				"",
				"Node.js and Bun utilize event-driven reactive architectures.",
				"在这里，libuv 与 mimalloc 深度协作处理极致 I/O (epoll/io_uring)。",
				"当网络请求达到 100k QPS 时，高效唤醒 Event Loop 并派发 Callback 回调。",
				"猫娘架构师特别提醒：千万别阻塞主线程，必须保持非阻塞轻量（Lean & Idle）喵呜~！✨",
			].join("\n");

			const deltas = generateLineDeltas(v1, v2);
			const restored = applyLineDeltas(v1, deltas);
			assert.equal(restored, v2);
		});

		it("边界用例：特殊符号、多行代码块、KaTeX 数学公式与 Markdown 标记", () => {
			const v1 = [
				"```typescript",
				"const neko = { age: 3, voice: 'nya~' };",
				"console.log(neko.voice);",
				"```",
				"",
				"数学公式验证：",
				"$$ f(x) = \\int_{-\\infty}^\\infty \\hat f(\\xi)\\,e^{2 \\pi i \\xi x} \\,d\\xi $$",
				"",
				"Emoji 与特殊控制符测试: 🐱✨🐾 <script>alert('xss')</script> \\r\\n\\t `code`",
			].join("\n");

			const v2 = [
				"```typescript",
				"interface Neko { age: number; voice: 'nya~' | 'mew~'; }",
				"const neko: Neko = { age: 3, voice: 'mew~' };",
				"console.log(`猫娘叫声: ${neko.voice} 喵！`);",
				"```",
				"",
				"数学公式演进：",
				"$$ f(x) = \\frac{1}{\\sqrt{2\\pi}} \\int_{-\\infty}^\\infty \\hat f(\\xi)\\,e^{i \\xi x} \\,d\\xi $$",
				"",
				'Emoji 与特殊控制符强化: 🐱🐾⚡🚀 <div>Safe & Sound</div> `"escaped"`',
			].join("\n");

			const deltas = generateLineDeltas(v1, v2);
			const restored = applyLineDeltas(v1, deltas);
			assert.equal(restored, v2);
		});

		it("边界用例：超大文本块 (2000+ 行) 差分算法健壮性", () => {
			const originalLines = [];
			for (let i = 1; i <= 2000; i++) {
				originalLines.push(
					`Line ${i}: 这是全站静态内容工程的第 ${i} 行测试数据喵~`,
				);
			}
			const v1 = originalLines.join("\n");

			const modifiedLines = [...originalLines];
			// 散布几处修改
			modifiedLines[42] = "Line 43: [MODIFIED] 特异性修改点 Alpha 喵！";
			modifiedLines[500] = "Line 501: [MODIFIED] 特异性修改点 Beta 喵！";
			modifiedLines.splice(
				1000,
				5,
				"Line 1001-1005: 批量替换为一行核心日志喵！",
			);
			modifiedLines.push("Line 2001: 尾部追加新行喵~");
			const v2 = modifiedLines.join("\n");

			const deltas = generateLineDeltas(v1, v2);
			assert.ok(deltas.length > 0, "应生成有效的 delta 块");
			const restored = applyLineDeltas(v1, deltas);
			assert.equal(restored, v2, "2000 行超大文本块必须精确还原");
		});
	});

	describe("3. createDeltaPatch & applyDeltaPatch 双向一致性与可逆性 (Roundtrip Integrity)", () => {
		it("正向还原与逆向还原 (A -> B -> A) 必须保证 100% 数据一致性", () => {
			const docA = [
				"---",
				"title: 维基版本演进史",
				"published: 2026-10-01",
				"---",
				"# 第一版内容",
				"这是最初的草稿文字喵。",
				"包含基础语法和简单的段落说明。",
			].join("\n");

			const docB = [
				"---",
				"title: 维基版本演进史 (RFC 6902 增强版)",
				"published: 2026-10-01",
				"updated: 2026-10-05",
				"tags: ['wiki', 'delta']",
				"---",
				"# 第一版内容 (已修订)",
				"这是经过多代理高并发重构后的专业技术长文喵！",
				"包含基础语法、RFC 6902 补丁引擎和极致的边缘计算优化说明。",
				"特别感谢猫娘团队的严谨测试喵~",
			].join("\n");

			// 1. 生成正向补丁 A -> B
			const patchAtoB = createDeltaPatch(docA, docB, {
				slug: "wiki-history",
				fromSha: "aaaa111122223333444455556666777788889999",
				toSha: "bbbb111122223333444455556666777788889999",
			});
			const restoredB = applyDeltaPatch(docA, patchAtoB);
			assert.equal(restoredB, docB, "正向应用补丁必须精确重现 docB");

			// 2. 生成逆向补丁 B -> A
			const patchBtoA = createDeltaPatch(docB, docA, {
				slug: "wiki-history",
				fromSha: "bbbb111122223333444455556666777788889999",
				toSha: "aaaa111122223333444455556666777788889999",
			});
			const restoredA = applyDeltaPatch(restoredB, patchBtoA);
			assert.equal(restoredA, docA, "逆向应用补丁必须精确无损还原 docA");
		});

		it("复杂多版本链式跃迁 (v1 -> v2 -> v3 -> v1) 完整性", () => {
			const v1 = "Version 1\nAlpha\nBeta";
			const v2 = "Version 2\nAlpha\nBeta Modified\nGamma";
			const v3 = "Version 3\nAlpha Super\nBeta Modified\nGamma\nDelta";

			const patch1to2 = createDeltaPatch(v1, v2);
			const patch2to3 = createDeltaPatch(v2, v3);
			const patch3to1 = createDeltaPatch(v3, v1);

			const step2 = applyDeltaPatch(v1, patch1to2);
			assert.equal(step2, v2);

			const step3 = applyDeltaPatch(step2, patch2to3);
			assert.equal(step3, v3);

			const backTo1 = applyDeltaPatch(step3, patch3to1);
			assert.equal(backTo1, v1);
		});

		it("结构化快照对象 (含 content 文本与其它 RFC 6902 键值) 复合热补丁", () => {
			const snapshotV1 = {
				sha: "1111111111111111111111111111111111111111",
				shortSha: "1111111",
				author: "yaoxi",
				date: "2026-10-01T00:00:00Z",
				message: "docs: initial commit",
				content: "# Title\nInitial content line 1\nInitial content line 2",
			};

			const snapshotV2 = {
				sha: "2222222222222222222222222222222222222222",
				shortSha: "2222222",
				author: "yaoxi",
				date: "2026-10-05T12:00:00Z",
				message: "feat: add hot patch support",
				content:
					"# Title (Updated)\nInitial content line 1\nPatched content line 2",
				badgeStatus: "verified",
			};

			const patch = createDeltaPatch(snapshotV1, snapshotV2, {
				slug: "post-test",
				fromSha: snapshotV1.sha,
				toSha: snapshotV2.sha,
			});

			const restoredObj = applyDeltaPatch(snapshotV1, patch);
			assert.equal(restoredObj.sha, snapshotV2.sha);
			assert.equal(restoredObj.shortSha, snapshotV2.shortSha);
			assert.equal(restoredObj.message, snapshotV2.message);
			assert.equal(restoredObj.badgeStatus, "verified");
			assert.equal(restoredObj.content, snapshotV2.content);
		});
	});

	describe("4. 极限体积瘦身与压缩比率指标验证 (80% ~ 95% Slimming Threshold)", () => {
		it("在真实万字博文小幅度修订场景下，增量补丁相比全量快照必须实现 80%~95% 以上的极限瘦身", () => {
			// 构造一个模拟真实长文的段落集合 (~20KB)
			const paragraphs = [];
			for (let i = 1; i <= 80; i++) {
				paragraphs.push(
					`### 第 ${i} 章节：高并发架构演进论\n在现代云原生架构体系中，微服务与边缘计算的结合极大地降低了端到端延迟（Latency）。\n通过充分利用 Redis 缓存层、Cloudflare Workers 边缘分发网络与本地 SQLite/D1 数据库，\n我们可以将吞吐量（Throughput）提升至数万 QPS 以上，同时保持系统 CPU 占用率在 15% 以下。\n\`\`\`typescript\nexport async function handleRequest(req: Request): Promise<Response> {\n    const cacheKey = req.url;\n    const cached = await caches.default.match(cacheKey);\n    if (cached) return cached;\n    return new Response("OK - Stage ${i}", { headers: { "X-Cache": "MISS" } });\n}\n\`\`\`\n`,
				);
			}

			const fullDocA = paragraphs.join("\n");
			const fullDocSize = Buffer.byteLength(fullDocA, "utf-8");
			assert.ok(
				fullDocSize >= 15000,
				`全量快照体积需达到真实技术长文规模 (当前: ${fullDocSize} 字节)`,
			);

			// 模拟真实修订：修改 2 个段落中的错别字与代码优化
			const modifiedParagraphs = [...paragraphs];
			modifiedParagraphs[10] = modifiedParagraphs[10].replace(
				"数万 QPS",
				"数十万 QPS (优化升级)",
			);
			modifiedParagraphs[50] = modifiedParagraphs[50].replace(
				"X-Cache",
				"X-Edge-Cache",
			);
			const fullDocB = modifiedParagraphs.join("\n");

			// 生成增量补丁
			const patch = createDeltaPatch(fullDocA, fullDocB, {
				slug: "benchmark-post",
				fromSha: "1111111111111111111111111111111111111111",
				toSha: "2222222222222222222222222222222222222222",
			});

			const patchJson = JSON.stringify(patch);
			const patchSize = Buffer.byteLength(patchJson, "utf-8");
			const fullSnapshotSize = Buffer.byteLength(
				JSON.stringify({
					slug: "benchmark-post",
					sha: "2222222222222222222222222222222222222222",
					content: fullDocB,
				}),
				"utf-8",
			);

			const slimmingPercentage = (1 - patchSize / fullSnapshotSize) * 100;

			console.log(
				`\n📊 [OTA Delta Benchmark] 瘦身指标汇报：\n   - 全量快照体积: ${fullSnapshotSize} 字节 (${(fullSnapshotSize / 1024).toFixed(2)} KB)\n   - 增量补丁体积: ${patchSize} 字节 (${(patchSize / 1024).toFixed(2)} KB)\n   - 带宽节约瘦身率: ${slimmingPercentage.toFixed(2)}%\n   - 变更行数: +${patch.stats.addedLines} / -${patch.stats.deletedLines} 行喵~`,
			);

			// 严苛断言：必须达到 80%~95% 以上的高压缩瘦身比率
			assert.ok(
				slimmingPercentage >= 80.0,
				`增量补丁瘦身率必须达到 80% 以上！当前仅为 ${slimmingPercentage.toFixed(2)}%`,
			);

			// 验证还原数据无误
			const restored = applyDeltaPatch(fullDocA, patch);
			assert.equal(restored, fullDocB, "高压缩补丁应用后文本必须 100% 吻合");
		});
	});
});
