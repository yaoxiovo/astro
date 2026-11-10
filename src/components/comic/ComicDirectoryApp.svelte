<script lang="ts">
import Icon from "@iconify/svelte";
import { onMount } from "svelte";
import type {
	ComicChapterKind,
	ComicChapterSummary,
	ComicReadingProgress,
	ComicSeriesMeta,
} from "../../types/comic";
import {
	filterAndSortChapters,
	groupChaptersByRange,
} from "../../utils/comic-core.mjs";
import { getComicProgress, getReadChapters } from "../../utils/comic-storage";

export let meta: ComicSeriesMeta;
export let chapters: ComicChapterSummary[] = [];

let selectedKind: ComicChapterKind | "all" = "all";
let sortOrder: "asc" | "desc" = "asc";
let searchKeyword = "";
let activeRangeId = "all";

let progress: ComicReadingProgress | null = null;
let readSet = new Set<string>();

onMount(() => {
	progress = getComicProgress(meta.slug);
	readSet = new Set(getReadChapters(meta.slug));
});

$: rangeGroups = groupChaptersByRange(chapters, 100);

$: filteredChapters = filterAndSortChapters(chapters, {
	keyword: searchKeyword,
	kind: selectedKind,
	sort: sortOrder,
});

// 当有关键词搜索或选择了细分类型(番外/公告)时，展示全部匹配结果，不限制分卷范围
$: isFilteringByRange =
	!searchKeyword.trim() && selectedKind === "all" && activeRangeId !== "all";

$: activeRange = rangeGroups.find((g) => g.id === activeRangeId) ?? null;

$: displayedChapters =
	isFilteringByRange && activeRange
		? filteredChapters.filter(
				(c) =>
					c.index >= activeRange.startIndex && c.index <= activeRange.endIndex,
			)
		: filteredChapters;

function getKindMeta(kind: ComicChapterKind): {
	label: string;
	badgeClass: string;
} {
	if (kind === "extra") {
		return {
			label: "番外",
			badgeClass:
				"bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",
		};
	}
	if (kind === "notice") {
		return {
			label: "公告",
			badgeClass:
				"bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/25",
		};
	}
	return {
		label: "正篇",
		badgeClass:
			"bg-[var(--primary)]/12 text-[var(--primary)] border-[var(--primary)]/20",
	};
}

function resetFilters() {
	selectedKind = "all";
	searchKeyword = "";
	activeRangeId = "all";
}

function jumpToReadRange() {
	if (!progress) return;
	const targetGroup = rangeGroups.find(
		(g) =>
			progress &&
			progress.chapterIndex >= g.startIndex &&
			progress.chapterIndex <= g.endIndex,
	);
	if (targetGroup) {
		selectedKind = "all";
		searchKeyword = "";
		activeRangeId = targetGroup.id;
	}
}
</script>

<div class="space-y-5">
	<!-- 个人阅读进度条 -->
	{#if progress}
		<div class="card-base px-5 py-4 bg-[var(--card-bg)] border border-[var(--primary)]/25 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
			<div class="flex items-center gap-3 min-w-0">
				<div class="w-10 h-10 rounded-xl bg-[var(--primary)]/15 text-[var(--primary)] flex items-center justify-center flex-shrink-0">
					<Icon icon="material-symbols:bookmark-added-rounded" class="text-xl" />
				</div>
				<div class="min-w-0">
					<div class="text-xs text-black/50 dark:text-white/50 flex items-center gap-2">
						<span>上次阅读记录</span>
						<span class="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono text-[10px]">
							第 {progress.page} / {progress.totalPages} 页
						</span>
					</div>
					<div class="text-sm font-bold text-black/85 dark:text-white/85 truncate">
						#{String(progress.chapterIndex).padStart(3, "0")} · {progress.chapterTitle}
					</div>
				</div>
			</div>
			<div class="flex items-center gap-2 flex-shrink-0">
				<button
					type="button"
					on:click={jumpToReadRange}
					class="px-3 py-2 rounded-xl text-xs font-medium bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-black/70 dark:text-white/70 transition-colors"
				>
					定位卷区
				</button>
				<a
					href={`/comics/${meta.slug}/${progress.chapterSlug}/`}
					class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[var(--primary)] text-white dark:text-black/90 hover:opacity-90 active:scale-95 transition-all shadow-sm"
				>
					<Icon icon="material-symbols:play-arrow-rounded" class="text-base" />
					<span>继续阅读</span>
				</a>
			</div>
		</div>
	{/if}

	<!-- 控制工具栏：搜索 + 分类 + 排序 + 分卷切换 -->
	<div class="card-base p-4 md:p-5 bg-[var(--card-bg)] border border-black/5 dark:border-white/10 rounded-2xl space-y-4">
		<div class="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
			<!-- 关键词 / 话数搜索 -->
			<div class="relative flex-1 max-w-md">
				<div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-black/40 dark:text-white/40">
					<Icon icon="material-symbols:search-rounded" class="text-lg" />
				</div>
				<input
					type="search"
					bind:value={searchKeyword}
					placeholder="搜索话数或标题（如：520、王权、番外）..."
					aria-label="搜索漫画章节"
					class="w-full pl-10 pr-4 py-2 text-xs md:text-sm rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 text-black/85 dark:text-white/85 placeholder:text-black/35 dark:placeholder:text-white/35 focus:outline-none focus:border-[var(--primary)]/50 transition-colors"
				/>
			</div>

			<!-- 分类筛选与排序 -->
			<div class="flex flex-wrap items-center gap-2 text-xs">
				<div class="flex flex-wrap items-center gap-1.5">
					<button
						type="button"
						on:click={() => (selectedKind = "all")}
						class={`px-3 py-1.5 rounded-lg font-medium transition-all ${
							selectedKind === "all"
								? "bg-[var(--primary)] text-white dark:text-black/90"
								: "bg-black/5 dark:bg-white/5 text-black/70 dark:text-white/70 hover:bg-black/10 dark:hover:bg-white/10"
						}`}
					>
						全部 ({meta.totalChapters})
					</button>
					<button
						type="button"
						on:click={() => (selectedKind = "main")}
						class={`px-3 py-1.5 rounded-lg font-medium transition-all ${
							selectedKind === "main"
								? "bg-[var(--primary)] text-white dark:text-black/90"
								: "bg-black/5 dark:bg-white/5 text-black/70 dark:text-white/70 hover:bg-black/10 dark:hover:bg-white/10"
						}`}
					>
						正篇 ({meta.mainChapters})
					</button>
					{#if meta.extraChapters > 0}
						<button
							type="button"
							on:click={() => (selectedKind = "extra")}
							class={`px-3 py-1.5 rounded-lg font-medium transition-all ${
								selectedKind === "extra"
									? "bg-[var(--primary)] text-white dark:text-black/90"
									: "bg-black/5 dark:bg-white/5 text-black/70 dark:text-white/70 hover:bg-black/10 dark:hover:bg-white/10"
							}`}
						>
							番外 ({meta.extraChapters})
						</button>
					{/if}
					{#if meta.noticeChapters > 0}
						<button
							type="button"
							on:click={() => (selectedKind = "notice")}
							class={`px-3 py-1.5 rounded-lg font-medium transition-all ${
								selectedKind === "notice"
									? "bg-[var(--primary)] text-white dark:text-black/90"
									: "bg-black/5 dark:bg-white/5 text-black/70 dark:text-white/70 hover:bg-black/10 dark:hover:bg-white/10"
							}`}
						>
							公告 ({meta.noticeChapters})
						</button>
					{/if}
				</div>

				<button
					type="button"
					on:click={() => (sortOrder = sortOrder === "asc" ? "desc" : "asc")}
					class="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-black/75 dark:text-white/75 font-medium transition-colors"
					title="切换章节排序方向"
				>
					<Icon
						icon={sortOrder === "asc"
							? "material-symbols:arrow-upward-rounded"
							: "material-symbols:arrow-downward-rounded"}
						class="text-sm text-[var(--primary)]"
					/>
					<span>{sortOrder === "asc" ? "正序" : "倒序"}</span>
				</button>
			</div>
		</div>

		<!-- 分卷快速索引（百话区间，仅全部+未搜索时激活） -->
		{#if rangeGroups.length > 1 && !searchKeyword.trim() && selectedKind === "all"}
			<div class="pt-3 border-t border-black/5 dark:border-white/5 flex flex-wrap items-center gap-1.5 text-xs">
				<span class="text-black/40 dark:text-white/40 font-semibold mr-1">区间跳转:</span>
				<button
					type="button"
					on:click={() => (activeRangeId = "all")}
					class={`px-2.5 py-1 rounded-lg transition-all ${
						activeRangeId === "all"
							? "bg-[var(--primary)]/15 text-[var(--primary)] font-bold border border-[var(--primary)]/25"
							: "bg-black/[0.03] dark:bg-white/[0.04] text-black/60 dark:text-white/60 hover:bg-black/10 dark:hover:bg-white/10"
					}`}
				>
					全部 ({chapters.length})
				</button>
				{#each rangeGroups as grp (grp.id)}
					<button
						type="button"
						on:click={() => (activeRangeId = grp.id)}
						class={`px-2.5 py-1 rounded-lg transition-all font-mono ${
							activeRangeId === grp.id
								? "bg-[var(--primary)]/15 text-[var(--primary)] font-bold border border-[var(--primary)]/25"
								: "bg-black/[0.03] dark:bg-white/[0.04] text-black/60 dark:text-white/60 hover:bg-black/10 dark:hover:bg-white/10"
						}`}
					>
						{grp.label}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- 章节网格清单 -->
	<div class="card-base p-4 md:p-6 bg-[var(--card-bg)] border border-black/5 dark:border-white/10 rounded-2xl">
		<div class="flex items-center justify-between mb-4 text-xs text-black/50 dark:text-white/50">
			<span class="font-semibold flex items-center gap-1.5 text-sm text-black/80 dark:text-white/80">
				<Icon icon="material-symbols:format-list-bulleted-rounded" class="text-[var(--primary)]" />
				章节列表
			</span>
			<span>
				当前显示 <strong class="text-[var(--primary)]">{displayedChapters.length}</strong> 话
				{#if readSet.size > 0}
					· 已读 {readSet.size} 话
				{/if}
			</span>
		</div>

		{#if displayedChapters.length === 0}
			<div class="py-14 text-center space-y-3">
				<Icon icon="material-symbols:search-off-rounded" class="text-4xl text-black/25 dark:text-white/25 mx-auto" />
				<p class="text-sm text-black/50 dark:text-white/50">没有找到匹配的章节~</p>
				<button
					type="button"
					on:click={resetFilters}
					class="px-4 py-1.5 rounded-xl text-xs font-semibold bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white transition-all"
				>
					重置筛选
				</button>
			</div>
		{:else}
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
				{#each displayedChapters as ch (ch.slug)}
					{@const isCurrent = progress?.chapterSlug === ch.slug}
					{@const isRead = readSet.has(ch.slug)}
					{@const kindMeta = getKindMeta(ch.kind)}
					<a
						href={`/comics/${meta.slug}/${ch.slug}/`}
						class={`group flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl border transition-all ${
							isCurrent
								? "bg-[var(--primary)]/10 border-[var(--primary)]/40 shadow-sm"
								: "bg-black/[0.02] dark:bg-white/[0.02] border-black/5 dark:border-white/5 hover:border-[var(--primary)]/35 hover:bg-[var(--primary)]/5"
						}`}
					>
						<div class="flex items-center gap-2.5 min-w-0 flex-1">
							<span class={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
								isCurrent
									? "bg-[var(--primary)] text-white dark:text-black/90"
									: isRead
										? "bg-black/5 dark:bg-white/10 text-black/40 dark:text-white/40"
										: "bg-[var(--primary)]/10 text-[var(--primary)]"
							}`}>
								{String(ch.index).padStart(3, "0")}
							</span>
							<span class={`text-xs md:text-sm font-medium truncate transition-colors ${
								isCurrent
									? "text-[var(--primary)] font-bold"
									: isRead
										? "text-black/55 dark:text-white/55 group-hover:text-[var(--primary)]"
										: "text-black/85 dark:text-white/85 group-hover:text-[var(--primary)]"
							}`}>
								{ch.title}
							</span>
						</div>

						<div class="flex items-center gap-1.5 flex-shrink-0">
							{#if ch.kind !== "main"}
								<span class={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${kindMeta.badgeClass}`}>
									{kindMeta.label}
								</span>
							{/if}
							{#if isCurrent}
								<span class="w-2 h-2 rounded-full bg-[var(--primary)] animate-pulse" title="上次阅读"></span>
							{:else if isRead}
								<Icon icon="material-symbols:check-circle-rounded" class="text-sm text-emerald-500/80" />
							{/if}
							<span class="text-[11px] font-mono text-black/40 dark:text-white/40 w-8 text-right">
								{ch.pageCount}P
							</span>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</div>
</div>
