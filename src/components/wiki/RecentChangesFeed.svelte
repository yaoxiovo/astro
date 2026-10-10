<script lang="ts">
import { onMount } from "svelte";
import type { DiffResult, WikiRevision } from "../../types/wiki";
import { applyDeltaPatch, fetchDeltaPatch } from "../../utils/delta-patcher";
import { generateWikiDiff } from "../../utils/wiki-diff";
import type {
	RecentChangeEntry,
	RecentChangesData,
} from "../../utils/wiki-special-loader";
import WikiDiffViewer from "./WikiDiffViewer.svelte";

let data: RecentChangesData | null = null;
let loading = true;
let loadError = "";

const RANGES: { key: "all" | "30d" | "7d" | "24h"; label: string }[] = [
	{ key: "all", label: "全部" },
	{ key: "30d", label: "近 30 天" },
	{ key: "7d", label: "近 7 天" },
	{ key: "24h", label: "近 24 小时" },
];
const DAY_MS = 86_400_000;

let rangeKey: "all" | "30d" | "7d" | "24h" = "all";
let authorFilter = "";
let slugFilter = "";
let minorOnly = false;
let query = "";
let visibleCount = 60;

// diff 展开状态
let expandedKey: string | null = null;
let diffLoading = false;
let diffResult: DiffResult | null = null;
let diffEntry: RecentChangeEntry | null = null;
let diffOldEntry: RecentChangeEntry | null = null;
let deltaInfo:
	| {
			isDeltaHit?: boolean;
			patchSize?: number;
			compressionRatio?: string;
			loadDurationMs?: number;
	  }
	| undefined = undefined;

interface WikiSnapshot extends Partial<WikiRevision> {
	slug?: string;
	content: string;
	[key: string]: unknown;
}

const snapshotCache = new Map<string, WikiSnapshot>();

onMount(async () => {
	try {
		const res = await fetch("/api/wiki/recent-changes.json");
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		data = (await res.json()) as RecentChangesData;
	} catch (e) {
		console.error("[RecentChanges] 加载失败:", e);
		loadError = "最近更改索引加载失败，请刷新重试 喵~";
	} finally {
		loading = false;
	}
});

$: entries = data?.entries || [];
$: authors = Array.from(new Set(entries.map((e) => e.author))).sort();
$: articleSlugs = Array.from(new Set(entries.map((e) => e.slug))).sort();

function titleOf(slug: string): string {
	return data?.articles?.[slug] || slug;
}

function cutoffTime(): number {
	if (rangeKey === "all") return 0;
	const span = rangeKey === "30d" ? 30 : rangeKey === "7d" ? 7 : 1;
	return Date.now() - span * DAY_MS;
}

$: filtered = entries.filter((e) => {
	if (minorOnly && !e.isMinor) return false;
	if (authorFilter && e.author !== authorFilter) return false;
	if (slugFilter && e.slug !== slugFilter) return false;
	if (rangeKey !== "all" && new Date(e.date).getTime() < cutoffTime())
		return false;
	if (query) {
		const q = query.toLowerCase();
		const haystack = `${titleOf(e.slug)} ${e.cleanMessage} ${e.section || ""} ${e.author}`;
		if (!haystack.toLowerCase().includes(q)) return false;
	}
	return true;
});

$: visible = filtered.slice(0, visibleCount);

function dayKey(iso: string): string {
	const d = new Date(iso);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function dayLabel(iso: string): string {
	const d = new Date(iso);
	return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日（周${WEEKDAYS[d.getDay()]}）`;
}

$: groups = (() => {
	const map = new Map<string, RecentChangeEntry[]>();
	for (const entry of visible) {
		const key = dayKey(entry.date);
		if (!map.has(key)) map.set(key, []);
		map.get(key)?.push(entry);
	}
	return Array.from(map, ([key, items]) => ({
		key,
		label: items[0] ? dayLabel(items[0].date) : key,
		items,
	}));
})();

// 过滤器变化时重置分页
$: {
	rangeKey;
	authorFilter;
	slugFilter;
	minorOnly;
	query;
	visibleCount = 60;
}

function entryKey(e: RecentChangeEntry): string {
	return `${e.slug}:${e.shortSha}`;
}

function goRandom() {
	if (articleSlugs.length === 0) return;
	const slug = articleSlugs[Math.floor(Math.random() * articleSlugs.length)];
	window.location.href = `/posts/${slug}/`;
}

async function loadSnapshot(
	slug: string,
	shortSha: string,
): Promise<WikiSnapshot> {
	const key = `${slug}:${shortSha}`;
	const cached = snapshotCache.get(key);
	if (cached) return cached;
	const res = await fetch(`/api/wiki/snapshots/${slug}/${shortSha}.json`);
	if (!res.ok) throw new Error(`快照 ${shortSha} 拉取失败`);
	const json = (await res.json()) as WikiSnapshot;
	snapshotCache.set(key, json);
	return json;
}

async function loadRevisionPair(
	slug: string,
	oldShort: string,
	newShort: string,
) {
	const oldKey = `${slug}:${oldShort}`;
	const newKey = `${slug}:${newShort}`;
	// 增量热补丁路径：旧版已在内存缓存时仅需拉取数百字节的正向补丁
	if (snapshotCache.has(oldKey)) {
		const patch = await fetchDeltaPatch(slug, oldShort, newShort);
		if (patch) {
			const oldData = snapshotCache.get(oldKey);
			if (oldData) {
				const newData = applyDeltaPatch(oldData, patch);
				snapshotCache.set(newKey, newData);
				return { oldData, newData, hitDelta: true, patch };
			}
		}
	}
	const [oldData, newData] = await Promise.all([
		loadSnapshot(slug, oldShort),
		loadSnapshot(slug, newShort),
	]);
	return { oldData, newData, hitDelta: false, patch: null };
}

async function toggleDiff(entry: RecentChangeEntry) {
	const key = entryKey(entry);
	if (expandedKey === key) {
		closeDiff();
		return;
	}

	expandedKey = key;
	diffLoading = true;
	diffResult = null;
	deltaInfo = undefined;
	diffEntry = entry;
	diffOldEntry = entry.prevShortSha
		? entries.find(
				(e) => e.slug === entry.slug && e.shortSha === entry.prevShortSha,
			) || null
		: null;

	const t0 = performance.now();
	try {
		let oldContent = "";
		let newContent = "";
		let hitDelta = false;

		if (entry.prevShortSha) {
			const pair = await loadRevisionPair(
				entry.slug,
				entry.prevShortSha,
				entry.shortSha,
			);
			oldContent = pair.oldData.content || "";
			newContent = pair.newData.content || "";
			if (pair.hitDelta && pair.patch) {
				hitDelta = true;
				deltaInfo = {
					isDeltaHit: true,
					patchSize: pair.patch.stats.patchSize,
					compressionRatio: pair.patch.stats.compressionRatio,
					loadDurationMs: Math.max(1, Math.round(performance.now() - t0)),
				};
			}
		} else {
			// 初始版本：以空文本为基准展示全量新增
			const newData = await loadSnapshot(entry.slug, entry.shortSha);
			newContent = newData.content || "";
		}

		diffResult = generateWikiDiff(oldContent, newContent, {
			oldSha: entry.prevShortSha || "",
			newSha: entry.sha,
			contextLines: 3,
		});
	} catch (err) {
		console.error("[RecentChanges Diff Error]", err);
		expandedKey = null;
		alert("获取版本内容失败，请检查网络或构建产物 喵~");
	} finally {
		diffLoading = false;
	}
}

function closeDiff() {
	expandedKey = null;
	diffResult = null;
	diffEntry = null;
	diffOldEntry = null;
	deltaInfo = undefined;
}
</script>

<div class="wiki-recent-changes w-full">
	{#if loading}
		<div class="p-10 rounded-2xl border border-[var(--line-divider)] bg-[var(--card-bg)] text-center">
			<div class="inline-block w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mb-3"></div>
			<div class="text-xs text-black/50 dark:text-white/50">正在加载全站最近更改索引 (RecentChanges Index)... 喵~</div>
		</div>
	{:else if loadError}
		<div class="p-8 rounded-2xl border border-red-500/30 bg-red-500/[0.06] text-center text-xs text-red-600 dark:text-red-400">
			{loadError}
		</div>
	{:else if !data}
		<div class="p-8 rounded-2xl border border-[var(--line-divider)] text-center text-xs text-black/50 dark:text-white/50">
			暂无最近更改数据，请先运行 <code class="font-mono">pnpm wiki:special</code> 生成索引 喵~
		</div>
	{:else}
		<!-- 筛选控制栏 -->
		<div class="flex flex-col gap-3 mb-4 p-4 rounded-2xl border border-[var(--line-divider)] bg-black/[0.02] dark:bg-white/[0.02]">
			<div class="flex flex-wrap items-center gap-2.5">
				<!-- 时间范围 -->
				<div class="inline-flex rounded-lg p-0.5 bg-black/5 dark:bg-white/10 font-medium">
					{#each RANGES as range}
						<button
							type="button"
							class="px-2.5 py-1 rounded-md text-[11px] transition-all {rangeKey === range.key ? 'bg-white dark:bg-black/40 text-[var(--primary)] shadow-sm font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'}"
							on:click={() => (rangeKey = range.key)}
						>
							{range.label}
						</button>
					{/each}
				</div>

				<!-- 搜索框 -->
				<input
					type="search"
					placeholder="搜索条目 / 作者 / 摘要..."
					bind:value={query}
					class="flex-1 min-w-[140px] px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 border border-transparent focus:border-[var(--primary)] text-xs outline-none"
				/>

				<button
					type="button"
					class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors {minorOnly ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--line-divider)] text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10'}"
					title="仅显示小修改 (Minor Edit)"
					on:click={() => (minorOnly = !minorOnly)}
				>
					仅小修改
				</button>

				<button
					type="button"
					class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-[var(--line-divider)] text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
					title="随机跳转到一篇条目 (Special:Random)"
					on:click={goRandom}
				>
					随机条目
				</button>
			</div>

			<div class="flex flex-wrap items-center gap-2.5">
				<!-- 作者筛选 -->
				<select
					bind:value={authorFilter}
					class="px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 border border-transparent focus:border-[var(--primary)] text-xs outline-none cursor-pointer"
				>
					<option value="">全部贡献者</option>
					{#each authors as author}
						<option value={author}>{author}</option>
					{/each}
				</select>

				<!-- 条目筛选 -->
				<select
					bind:value={slugFilter}
					class="px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 border border-transparent focus:border-[var(--primary)] text-xs outline-none cursor-pointer max-w-[280px]"
				>
					<option value="">全部条目</option>
					{#each articleSlugs as slug}
						<option value={slug}>{titleOf(slug)}</option>
					{/each}
				</select>

				<span class="text-[11px] text-black/45 dark:text-white/45 ml-auto font-mono">
					筛选出 <strong class="text-[var(--primary)]">{filtered.length}</strong> / {entries.length} 条修订 · 索引生成于 {new Date(data.generatedAt).toLocaleString("zh-CN")}
				</span>
			</div>
		</div>

		<!-- 按天分组的时间线 -->
		{#if visible.length === 0}
			<div class="p-8 rounded-2xl border border-[var(--line-divider)] text-center text-xs text-black/50 dark:text-white/50">
				没有符合筛选条件的修订记录 喵~
			</div>
		{:else}
			{#each groups as group}
				<div class="mb-4">
					<div class="flex items-center gap-2 mb-2 select-none">
						<div class="w-1.5 h-4 rounded-full bg-[var(--primary)]"></div>
						<h3 class="text-xs font-bold text-black/80 dark:text-white/80">{group.label}</h3>
						<span class="text-[10px] font-mono text-black/40 dark:text-white/40">{group.items.length} 条修订</span>
						<div class="flex-1 border-t border-dashed border-[var(--line-divider)]"></div>
					</div>

					<div class="border border-[var(--line-divider)] rounded-xl overflow-hidden divide-y divide-[var(--line-divider)]/50 bg-black/[0.01] dark:bg-white/[0.01]">
						{#each group.items as entry (entryKey(entry))}
							<div class="transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
								<div class="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 px-3 py-2.5 text-xs">
									<!-- 时间 -->
									<span class="font-mono text-[11px] text-black/45 dark:text-white/45 whitespace-nowrap md:w-[88px] shrink-0">
										{new Date(entry.date).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}
									</span>

									<!-- 主内容 -->
									<div class="flex-1 min-w-0">
										<div class="flex flex-wrap items-center gap-1.5">
											<a
												href={`/posts/${entry.slug}/`}
												class="font-semibold text-[var(--primary)] hover:underline truncate max-w-[420px]"
												title={titleOf(entry.slug)}
											>
												{titleOf(entry.slug)}
											</a>
											{#each entry.tags as tag}
												<span class="px-1.5 py-0.2 rounded text-[10px] font-mono {tag === '小修改' ? 'bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50' : 'bg-[var(--primary)]/10 text-[var(--primary)] font-semibold'}">
													{tag}
												</span>
											{/each}
											{#if entry.section}
												<span class="font-mono text-black/45 dark:text-white/45 bg-black/5 dark:bg-white/5 px-1 rounded text-[11px]">
													/* {entry.section} */
												</span>
											{/if}
										</div>
										<div class="text-black/75 dark:text-white/75 mt-0.5 line-clamp-1">
											{entry.cleanMessage}
											<span class="text-black/40 dark:text-white/40 ml-1.5">— {entry.author}</span>
										</div>
									</div>

									<!-- 体量统计 -->
									<span class="font-mono text-[11px] whitespace-nowrap shrink-0">
										{#if entry.byteDelta > 0}
											<span class="text-emerald-600 dark:text-emerald-400">+{entry.byteDelta}B</span>
										{:else if entry.byteDelta < 0}
											<span class="text-red-600 dark:text-red-400">{entry.byteDelta}B</span>
										{:else}
											<span class="text-black/30 dark:text-white/30">±0B</span>
										{/if}
										<span class="text-black/40 dark:text-white/40 ml-1.5">Δ{entry.linesAdded + entry.linesDeleted} 行</span>
									</span>

									<!-- 操作区 -->
									<span class="flex items-center gap-1.5 shrink-0">
										<button
											type="button"
											class="px-2 py-1 rounded-md text-[11px] font-semibold transition-all {expandedKey === entryKey(entry) ? 'bg-[var(--primary)] text-white dark:text-black/80' : 'bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20'} disabled:opacity-50"
											disabled={diffLoading && expandedKey === entryKey(entry)}
											title={entry.prevShortSha ? "展开与上一版本的行内差异" : "展开初始版本全量新增差异"}
											on:click={() => toggleDiff(entry)}
										>
											{expandedKey === entryKey(entry) ? "收起" : "差异"}
										</button>
										<a
											href={`/posts/${entry.slug}/revision/${entry.shortSha}/`}
											class="px-2 py-1 rounded-md text-[11px] font-medium bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60 hover:text-[var(--primary)] transition-colors"
											title="查看该修订的快照永久链接"
										>
											快照
										</a>
										<a
											href={`/posts/${entry.slug}/history/`}
											class="px-2 py-1 rounded-md text-[11px] font-medium bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60 hover:text-[var(--primary)] transition-colors"
											title="查看该条目的完整修订历史"
										>
											历史
										</a>
									</span>
								</div>

								<!-- 行内差异展开区 -->
								{#if expandedKey === entryKey(entry)}
									<div class="px-3 pb-3">
										{#if diffLoading}
											<div class="p-6 rounded-xl border border-[var(--line-divider)] bg-[var(--card-bg)] text-center">
												<div class="inline-block w-5 h-5 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mb-2"></div>
												<div class="text-[11px] text-black/50 dark:text-white/50">正在提取快照并计算词级差异 (Intraline Diff)... 喵~</div>
											</div>
										{:else if diffResult && diffEntry}
											<WikiDiffViewer
												{diffResult}
												{deltaInfo}
												oldTitle={diffOldEntry?.cleanMessage || "初始版本"}
												newTitle={diffEntry.cleanMessage}
												oldDate={diffOldEntry?.displayDate || "—"}
												newDate={diffEntry.displayDate}
												oldAuthor={diffOldEntry?.author || "—"}
												newAuthor={diffEntry.author}
												oldMessage={diffOldEntry?.cleanMessage || "（此修订为条目的初始创建）"}
												newMessage={diffEntry.cleanMessage}
												oldSha={diffEntry.prevShortSha || ""}
												newSha={diffEntry.sha}
												slug={diffEntry.slug}
												rollbackPatchUrl={diffEntry.prevShortSha
													? `/api/wiki/deltas/${diffEntry.slug}/${diffEntry.shortSha}--${diffEntry.prevShortSha}.json`
													: ""}
												onClose={closeDiff}
											/>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}

			{#if filtered.length > visible.length}
				<div class="mt-4 text-center">
					<button
						type="button"
						class="px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 transition-all"
						on:click={() => (visibleCount += 60)}
					>
						加载更多修订（剩余 {filtered.length - visible.length} 条）
					</button>
				</div>
			{/if}
		{/if}
	{/if}
</div>
