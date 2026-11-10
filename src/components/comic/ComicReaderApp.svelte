<script lang="ts">
import Icon from "@iconify/svelte";
import { onDestroy, onMount } from "svelte";
import type {
	ComicChapterDetail,
	ComicChapterSummary,
	ComicPage,
	ComicReadingMode,
	ComicSeriesMeta,
	ComicWidthPreset,
} from "../../types/comic";
import {
	getComicReaderPrefs,
	markChapterAsRead,
	saveComicProgress,
	saveComicReaderPrefs,
} from "../../utils/comic-storage";

export let meta: ComicSeriesMeta;
export let chapter: ComicChapterDetail;
export let prevChapter: ComicChapterSummary | null = null;
export let nextChapter: ComicChapterSummary | null = null;

let mode: ComicReadingMode = "scroll";
let widthPreset: ComicWidthPreset = "standard";
let gapless = true;
let showPageNums = true;
let preferRemoteSource = false;
let autoFallbackMode = false;
let consecutiveLocalFailures = 0;

let currentPage = 1;
let immersive = false;
let settingsOpen = false;
let drawerOpen = false;
let drawerLoading = false;
let drawerError = "";
let drawerKeyword = "";
let allChapters: ComicChapterSummary[] = [];
let hasFetchedChapters = false;

/** 每页当前生效的图片源状态（local / fallback / error） */
let pageSourceState: Record<number, "local" | "fallback" | "error"> = {};
let observer: IntersectionObserver | null = null;

$: pages = chapter.pages;
$: totalPages = pages.length;
$: currentPageObj = pages[currentPage - 1] ?? pages[0];
$: progressPercent =
	totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;

$: filteredDrawerChapters = drawerKeyword.trim()
	? allChapters.filter((ch) => {
			const kw = drawerKeyword.trim().toLowerCase();
			return (
				ch.title.toLowerCase().includes(kw) ||
				String(ch.index).includes(kw) ||
				ch.slug.toLowerCase().includes(kw)
			);
		})
	: allChapters;

const WIDTH_CLASS_MAP: Record<ComicWidthPreset, string> = {
	compact: "max-w-[640px]",
	standard: "max-w-[820px]",
	wide: "max-w-[1040px]",
	full: "max-w-full",
};

const WIDTH_PRESET_OPTIONS: Array<{ id: ComicWidthPreset; label: string }> = [
	{ id: "compact", label: "紧凑" },
	{ id: "standard", label: "标准" },
	{ id: "wide", label: "宽屏" },
	{ id: "full", label: "铺满" },
];

function handleRangeInput(event: Event) {
	const input = event.currentTarget as HTMLInputElement | null;
	if (!input) return;
	const parsed = Number.parseInt(input.value, 10);
	if (Number.isFinite(parsed)) {
		goToPage(parsed);
	}
}

function resolveImageSrc(page: ComicPage): string {
	const forcedState = pageSourceState[page.page];
	if (forcedState === "fallback" && page.fallbackUrl) {
		return page.fallbackUrl;
	}
	if ((preferRemoteSource || autoFallbackMode) && page.fallbackUrl) {
		return page.fallbackUrl;
	}
	return page.src;
}

function handleImageLoad(page: ComicPage, usedSrc: string) {
	if (usedSrc === page.src) {
		consecutiveLocalFailures = 0;
	}
}

function handleImageError(page: ComicPage) {
	const currentUsed = resolveImageSrc(page);
	// 若当前用的是本地图片且存在远程兜底链接，则切换至远程图源
	if (currentUsed === page.src && page.fallbackUrl) {
		consecutiveLocalFailures += 1;
		pageSourceState = { ...pageSourceState, [page.page]: "fallback" };
		// 若连续两张本地图 404，自动为本话其余页启用远程兜底，避免无意义 404 探测
		if (consecutiveLocalFailures >= 2) {
			autoFallbackMode = true;
		}
		return;
	}
	pageSourceState = { ...pageSourceState, [page.page]: "error" };
}

function retryPageImage(page: ComicPage) {
	const next = { ...pageSourceState };
	delete next[page.page];
	pageSourceState = next;
}

function persistPrefs() {
	saveComicReaderPrefs({
		mode,
		widthPreset,
		gapless,
		showPageNums,
		preferRemoteSource,
	});
}

function setMode(nextMode: ComicReadingMode) {
	mode = nextMode;
	persistPrefs();
	if (nextMode === "page") {
		window.scrollTo({ top: 0, behavior: "smooth" });
		preloadAdjacentPages(currentPage);
	} else {
		setupPageObserver();
	}
}

function setWidthPreset(preset: ComicWidthPreset) {
	widthPreset = preset;
	persistPrefs();
}

function toggleGapless() {
	gapless = !gapless;
	persistPrefs();
}

function togglePageNums() {
	showPageNums = !showPageNums;
	persistPrefs();
}

function toggleRemoteSource() {
	preferRemoteSource = !preferRemoteSource;
	autoFallbackMode = false;
	consecutiveLocalFailures = 0;
	pageSourceState = {};
	persistPrefs();
}

function syncProgress(pageNum: number) {
	const clamped = Math.max(1, Math.min(totalPages, pageNum));
	currentPage = clamped;
	saveComicProgress({
		comicSlug: meta.slug,
		comicTitle: meta.title,
		chapterIndex: chapter.index,
		chapterSlug: chapter.slug,
		chapterTitle: chapter.title,
		page: clamped,
		totalPages,
		updatedAt: new Date().toISOString(),
	});
}

function preloadAdjacentPages(basePage: number) {
	if (typeof window === "undefined") return;
	for (const offset of [1, 2]) {
		const target = pages[basePage - 1 + offset];
		if (!target) continue;
		const src = resolveImageSrc(target);
		if (!src) continue;
		const img = new Image();
		img.src = src;
	}
}

function navigateToChapter(targetUrl: string) {
	const swupInstance = (
		window as unknown as { swup?: { navigate?: (url: string) => void } }
	).swup;
	if (swupInstance && typeof swupInstance.navigate === "function") {
		swupInstance.navigate(targetUrl);
		return;
	}
	window.location.href = targetUrl;
}

function goToPage(targetPage: number) {
	if (targetPage < 1) {
		if (prevChapter) {
			navigateToChapter(`/comics/${meta.slug}/${prevChapter.slug}/`);
		}
		return;
	}
	if (targetPage > totalPages) {
		if (nextChapter) {
			navigateToChapter(`/comics/${meta.slug}/${nextChapter.slug}/`);
		}
		return;
	}
	syncProgress(targetPage);
	preloadAdjacentPages(targetPage);
	if (mode === "scroll") {
		const el = document.getElementById(`comic-page-${targetPage}`);
		el?.scrollIntoView({ behavior: "smooth", block: "start" });
	} else {
		window.scrollTo({ top: 0, behavior: "smooth" });
	}
}

function handleSinglePageClick(event: MouseEvent) {
	const target = event.currentTarget as HTMLElement | null;
	if (!target) return;
	const rect = target.getBoundingClientRect();
	const clickX = event.clientX - rect.left;
	if (clickX < rect.width * 0.35) {
		goToPage(currentPage - 1);
	} else {
		goToPage(currentPage + 1);
	}
}

function applyImmersiveClass(active: boolean) {
	if (typeof document === "undefined") return;
	document.documentElement.classList.toggle("comic-immersive-mode", active);
}

function toggleImmersive() {
	immersive = !immersive;
	applyImmersiveClass(immersive);
}

async function openChapterDrawer() {
	drawerOpen = true;
	settingsOpen = false;
	if (hasFetchedChapters) return;

	drawerLoading = true;
	drawerError = "";
	try {
		const res = await fetch(`/api/comics/${meta.slug}/chapters.json`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const payload = (await res.json()) as {
			chapters?: ComicChapterSummary[];
		};
		allChapters = Array.isArray(payload.chapters) ? payload.chapters : [];
		hasFetchedChapters = true;
	} catch (err) {
		drawerError =
			err instanceof Error ? err.message : "目录加载失败，请稍后重试";
	} finally {
		drawerLoading = false;
	}
}

function setupPageObserver() {
	if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
		return;
	}
	observer?.disconnect();
	observer = new IntersectionObserver(
		(entries) => {
			let bestPage = currentPage;
			let bestRatio = 0;
			for (const entry of entries) {
				if (entry.isIntersecting && entry.intersectionRatio >= bestRatio) {
					const pageAttr = (entry.target as HTMLElement).dataset.page;
					const parsed = Number.parseInt(pageAttr || "", 10);
					if (Number.isFinite(parsed)) {
						bestPage = parsed;
						bestRatio = entry.intersectionRatio;
					}
				}
			}
			if (bestPage !== currentPage && bestRatio > 0) {
				syncProgress(bestPage);
			}
		},
		{ threshold: [0.25, 0.55] },
	);

	requestAnimationFrame(() => {
		const nodes = document.querySelectorAll<HTMLElement>("[data-comic-page]");
		for (const node of nodes) {
			observer?.observe(node);
		}
	});
}

function handleKeydown(event: KeyboardEvent) {
	const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
	if (
		activeTag === "INPUT" ||
		activeTag === "TEXTAREA" ||
		activeTag === "SELECT"
	) {
		if (event.key === "Escape") {
			drawerOpen = false;
		}
		return;
	}

	if (event.key === "Escape") {
		if (drawerOpen) {
			drawerOpen = false;
			return;
		}
		if (settingsOpen) {
			settingsOpen = false;
			return;
		}
		if (immersive) {
			immersive = false;
			applyImmersiveClass(false);
		}
		return;
	}

	if (event.key === "c" || event.key === "C") {
		if (drawerOpen) drawerOpen = false;
		else void openChapterDrawer();
		return;
	}

	if (event.key === "f" || event.key === "F") {
		toggleImmersive();
		return;
	}

	if (event.key === "m" || event.key === "M") {
		setMode(mode === "scroll" ? "page" : "scroll");
		return;
	}

	if (event.key === "[") {
		if (prevChapter) {
			navigateToChapter(`/comics/${meta.slug}/${prevChapter.slug}/`);
		}
		return;
	}

	if (event.key === "]") {
		if (nextChapter) {
			navigateToChapter(`/comics/${meta.slug}/${nextChapter.slug}/`);
		}
		return;
	}

	if (mode === "page") {
		if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
			event.preventDefault();
			goToPage(currentPage - 1);
		} else if (
			event.key === "ArrowRight" ||
			event.key === "d" ||
			event.key === "D"
		) {
			event.preventDefault();
			goToPage(currentPage + 1);
		}
	}
}

onMount(() => {
	const prefs = getComicReaderPrefs();
	mode = prefs.mode;
	widthPreset = prefs.widthPreset;
	gapless = prefs.gapless;
	showPageNums = prefs.showPageNums;
	preferRemoteSource = prefs.preferRemoteSource;

	markChapterAsRead(meta.slug, chapter.slug);
	syncProgress(1);

	if (mode === "scroll") {
		setupPageObserver();
	} else {
		preloadAdjacentPages(1);
	}

	window.addEventListener("keydown", handleKeydown);
});

onDestroy(() => {
	observer?.disconnect();
	if (typeof window !== "undefined") {
		window.removeEventListener("keydown", handleKeydown);
	}
	applyImmersiveClass(false);
});
</script>

<div class="comic-reader-shell space-y-4">
	<!-- 顶部控制条（吸顶） -->
	<div class="sticky top-2 z-30 card-base px-3.5 md:px-5 py-3 bg-[var(--card-bg)]/95 backdrop-blur-md border border-black/10 dark:border-white/10 rounded-2xl shadow-md">
		<div class="flex flex-wrap items-center justify-between gap-2.5">
			<!-- 左：面包屑与话名 -->
			<div class="flex items-center gap-2 min-w-0 flex-1">
				<a
					href={`/comics/${meta.slug}/`}
					class="w-8 h-8 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-[var(--primary)]/15 text-black/70 dark:text-white/70 hover:text-[var(--primary)] flex items-center justify-center flex-shrink-0 transition-colors"
					title="返回章节目录"
					aria-label="返回章节目录"
				>
					<Icon icon="material-symbols:arrow-back-rounded" class="text-lg" />
				</a>
				<div class="min-w-0">
					<div class="flex items-center gap-1.5 text-[11px] text-black/45 dark:text-white/45">
						<a href="/comics/" class="hover:text-[var(--primary)]">漫画</a>
						<span>/</span>
						<a href={`/comics/${meta.slug}/`} class="hover:text-[var(--primary)] truncate">
							{meta.title}
						</a>
					</div>
					<h1 class="text-sm md:text-base font-bold text-black/90 dark:text-white/90 truncate">
						#{String(chapter.index).padStart(3, "0")} · {chapter.title}
					</h1>
				</div>
			</div>

			<!-- 右：进度指示 + 模式切换 + 目录 + 设置 + 沉浸模式 -->
			<div class="flex items-center gap-1.5 flex-shrink-0">
				<div class="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-black/5 dark:bg-white/5 text-xs font-mono text-black/70 dark:text-white/70">
					<span>{currentPage}/{totalPages}</span>
					<span class="text-black/30 dark:text-white/30">·</span>
					<span class="text-[var(--primary)] font-bold">{progressPercent}%</span>
				</div>

				<!-- 条漫 / 单页切换 -->
				<div class="flex items-center p-0.5 rounded-xl bg-black/5 dark:bg-white/5 text-xs">
					<button
						type="button"
						on:click={() => setMode("scroll")}
						class={`px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1 ${
							mode === "scroll"
								? "bg-[var(--primary)] text-white dark:text-black/90 shadow-sm"
								: "text-black/65 dark:text-white/65 hover:text-[var(--primary)]"
						}`}
						title="条漫连阅 (M)"
					>
						<Icon icon="material-symbols:view-day-outline-rounded" class="text-sm" />
						<span class="hidden md:inline">条漫</span>
					</button>
					<button
						type="button"
						on:click={() => setMode("page")}
						class={`px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1 ${
							mode === "page"
								? "bg-[var(--primary)] text-white dark:text-black/90 shadow-sm"
								: "text-black/65 dark:text-white/65 hover:text-[var(--primary)]"
						}`}
						title="单页翻阅 (M)"
					>
						<Icon icon="material-symbols:auto-stories-outline-rounded" class="text-sm" />
						<span class="hidden md:inline">单页</span>
					</button>
				</div>

				<!-- 目录抽屉开关 -->
				<button
					type="button"
					on:click={openChapterDrawer}
					class="px-2.5 py-1.5 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-[var(--primary)]/15 text-xs font-medium text-black/75 dark:text-white/75 hover:text-[var(--primary)] flex items-center gap-1 transition-colors"
					title="章节目录 (C)"
				>
					<Icon icon="material-symbols:format-list-bulleted-rounded" class="text-base" />
					<span class="hidden sm:inline">目录</span>
				</button>

				<!-- 沉浸宽屏切换 -->
				<button
					type="button"
					on:click={toggleImmersive}
					class={`px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1 transition-colors ${
						immersive
							? "bg-[var(--primary)] text-white dark:text-black/90"
							: "bg-black/5 dark:bg-white/5 hover:bg-[var(--primary)]/15 text-black/75 dark:text-white/75 hover:text-[var(--primary)]"
					}`}
					title={immersive ? "退出沉浸模式 (F / Esc)" : "沉浸宽屏模式 (F)"}
				>
					<Icon
						icon={immersive
							? "material-symbols:fullscreen-exit-rounded"
							: "material-symbols:fullscreen-rounded"}
						class="text-base"
					/>
					<span class="hidden lg:inline">{immersive ? "退出沉浸" : "沉浸"}</span>
				</button>

				<!-- 设置面板开关 -->
				<button
					type="button"
					on:click={() => (settingsOpen = !settingsOpen)}
					class={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
						settingsOpen
							? "bg-[var(--primary)] text-white dark:text-black/90"
							: "bg-black/5 dark:bg-white/5 hover:bg-[var(--primary)]/15 text-black/75 dark:text-white/75 hover:text-[var(--primary)]"
					}`}
					aria-label="阅读设置"
					title="阅读设置"
				>
					<Icon icon="material-symbols:tune-rounded" class="text-base" />
				</button>
			</div>
		</div>

		<!-- 展开的阅读设置面板 -->
		{#if settingsOpen}
			<div class="mt-3 pt-3 border-t border-black/10 dark:border-white/10 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
				<!-- 画幅宽度 -->
				<div class="space-y-1.5">
					<div class="text-black/50 dark:text-white/50 font-semibold">画幅宽度</div>
					<div class="flex flex-wrap gap-1.5">
						{#each WIDTH_PRESET_OPTIONS as item (item.id)}
							<button
								type="button"
								on:click={() => setWidthPreset(item.id)}
								class={`px-2.5 py-1 rounded-lg transition-all ${
									widthPreset === item.id
										? "bg-[var(--primary)] text-white dark:text-black/90 font-semibold"
										: "bg-black/5 dark:bg-white/5 text-black/70 dark:text-white/70 hover:bg-black/10 dark:hover:bg-white/10"
								}`}
							>
								{item.label}
							</button>
						{/each}
					</div>
				</div>

				<!-- 条漫排版开关 -->
				<div class="space-y-1.5">
					<div class="text-black/50 dark:text-white/50 font-semibold">排版与标注</div>
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							on:click={toggleGapless}
							class={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
								gapless
									? "bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30 font-semibold"
									: "bg-black/5 dark:bg-white/5 text-black/65 dark:text-white/65"
							}`}
						>
							<Icon icon="material-symbols:vertical-align-center-rounded" class="text-sm" />
							<span>无缝拼接: {gapless ? "开" : "关"}</span>
						</button>
						<button
							type="button"
							on:click={togglePageNums}
							class={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
								showPageNums
									? "bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30 font-semibold"
									: "bg-black/5 dark:bg-white/5 text-black/65 dark:text-white/65"
							}`}
						>
							<Icon icon="material-symbols:tag-rounded" class="text-sm" />
							<span>页码角标: {showPageNums ? "显" : "隐"}</span>
						</button>
					</div>
				</div>

				<!-- 图源策略与快捷键提示 -->
				<div class="space-y-1.5">
					<div class="text-black/50 dark:text-white/50 font-semibold">图源路线</div>
					<div class="flex flex-wrap items-center gap-2">
						<button
							type="button"
							on:click={toggleRemoteSource}
							class={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
								preferRemoteSource || autoFallbackMode
									? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold"
									: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-semibold"
							}`}
						>
							<Icon
								icon={preferRemoteSource || autoFallbackMode
									? "material-symbols:cloud-outline"
									: "material-symbols:hard-drive-outline"}
								class="text-sm"
							/>
							<span>
								{preferRemoteSource
									? "强制云端图床"
									: autoFallbackMode
										? "已自动切云端兜底"
										: "优先本地镜像"}
							</span>
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<!-- 阅读主体画布 -->
	<div class={`mx-auto w-full ${WIDTH_CLASS_MAP[widthPreset]} transition-all duration-200`}>
		{#if mode === "scroll"}
			<!-- 条漫连阅模式 -->
			<div
				class={`card-base bg-neutral-950/95 border border-black/10 dark:border-white/10 rounded-2xl overflow-hidden shadow-lg flex flex-col items-center ${
					gapless ? "gap-0 p-0" : "gap-3 p-2 md:p-4"
				}`}
			>
				{#each pages as page, idx (page.page)}
					{@const imgSrc = resolveImageSrc(page)}
					{@const isFailed = pageSourceState[page.page] === "error"}
					<div
						id={`comic-page-${page.page}`}
						data-comic-page
						data-page={page.page}
						class={`relative w-full bg-neutral-900 overflow-hidden ${
							gapless ? "" : "rounded-xl"
						}`}
						style={`aspect-ratio: ${page.width} / ${page.height};`}
					>
						{#if isFailed}
							<div class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-white/70 bg-neutral-900">
								<Icon icon="material-symbols:broken-image-outline-rounded" class="text-4xl text-white/35" />
								<p class="text-xs">第 {page.page} 页图片暂时加载失败</p>
								<button
									type="button"
									on:click={() => retryPageImage(page)}
									class="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-semibold"
								>
									重新加载
								</button>
							</div>
						{:else}
							<img
								src={imgSrc}
								alt={`${meta.title} ${chapter.title} 第 ${page.page} 页`}
								width={page.width}
								height={page.height}
								loading={idx < 3 ? "eager" : "lazy"}
								decoding="async"
								class="w-full h-full block object-contain select-none"
								on:load={() => handleImageLoad(page, imgSrc)}
								on:error={() => handleImageError(page)}
							/>
						{/if}

						{#if showPageNums}
							<span class="pointer-events-none absolute right-2.5 bottom-2 px-2 py-0.5 rounded-md bg-black/55 backdrop-blur-sm text-white/80 font-mono text-[10px]">
								{page.page} / {totalPages}
							</span>
						{/if}
					</div>
				{/each}
			</div>
		{:else if currentPageObj}
			<!-- 单页翻阅模式 -->
			{@const imgSrc = resolveImageSrc(currentPageObj)}
			{@const isFailed = pageSourceState[currentPageObj.page] === "error"}
			<div class="space-y-3">
				<div
					class="card-base bg-neutral-950/95 border border-black/10 dark:border-white/10 rounded-2xl overflow-hidden shadow-lg relative"
				>
					<button
						type="button"
						on:click={handleSinglePageClick}
						class="w-full block relative cursor-pointer focus:outline-none"
						aria-label="点击画面左侧上一页、右侧下一页"
						style={`aspect-ratio: ${currentPageObj.width} / ${currentPageObj.height};`}
					>
						{#if isFailed}
							<div class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-white/70">
								<Icon icon="material-symbols:broken-image-outline-rounded" class="text-4xl text-white/35" />
								<p class="text-xs">第 {currentPageObj.page} 页加载失败</p>
							</div>
						{:else}
							<img
								src={imgSrc}
								alt={`${meta.title} ${chapter.title} 第 ${currentPageObj.page} 页`}
								width={currentPageObj.width}
								height={currentPageObj.height}
								decoding="async"
								class="w-full h-full block object-contain select-none"
								on:load={() => handleImageLoad(currentPageObj, imgSrc)}
								on:error={() => handleImageError(currentPageObj)}
							/>
						{/if}
					</button>
				</div>

				<!-- 单页翻页控制条 -->
				<div class="card-base px-4 py-3 bg-[var(--card-bg)] border border-black/10 dark:border-white/10 rounded-2xl flex items-center justify-between gap-3 text-xs">
					<button
						type="button"
						on:click={() => goToPage(currentPage - 1)}
						disabled={currentPage <= 1 && !prevChapter}
						class="px-3.5 py-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-[var(--primary)]/15 hover:text-[var(--primary)] disabled:opacity-35 disabled:pointer-events-none font-semibold flex items-center gap-1 transition-colors"
					>
						<Icon icon="material-symbols:chevron-left-rounded" class="text-base" />
						<span>{currentPage <= 1 && prevChapter ? "上一话" : "上一页"}</span>
					</button>

					<div class="flex items-center gap-2 flex-1 max-w-xs">
						<input
							type="range"
							min="1"
							max={totalPages}
							value={currentPage}
							on:input={handleRangeInput}
							aria-label="页码进度滑块"
							class="w-full accent-[var(--primary)] cursor-pointer"
						/>
						<span class="font-mono text-black/65 dark:text-white/65 flex-shrink-0">
							{currentPage}/{totalPages}
						</span>
					</div>

					<button
						type="button"
						on:click={() => goToPage(currentPage + 1)}
						disabled={currentPage >= totalPages && !nextChapter}
						class="px-3.5 py-2 rounded-xl bg-[var(--primary)] text-white dark:text-black/90 hover:opacity-90 disabled:opacity-35 disabled:pointer-events-none font-semibold flex items-center gap-1 transition-all"
					>
						<span>{currentPage >= totalPages && nextChapter ? "下一话" : "下一页"}</span>
						<Icon icon="material-symbols:chevron-right-rounded" class="text-base" />
					</button>
				</div>
			</div>
		{/if}
	</div>

	<!-- 话末导航条 -->
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
		{#if prevChapter}
			<a
				href={`/comics/${meta.slug}/${prevChapter.slug}/`}
				class="card-base px-4 py-3.5 bg-[var(--card-bg)] border border-black/5 dark:border-white/10 rounded-2xl hover:border-[var(--primary)]/35 transition-all group flex items-center gap-3"
			>
				<Icon icon="material-symbols:arrow-back-rounded" class="text-lg text-black/40 group-hover:text-[var(--primary)] flex-shrink-0 transition-colors" />
				<div class="min-w-0">
					<div class="text-[11px] text-black/45 dark:text-white/45">上一话</div>
					<div class="text-xs md:text-sm font-semibold text-black/80 dark:text-white/80 truncate group-hover:text-[var(--primary)] transition-colors">
						#{String(prevChapter.index).padStart(3, "0")} · {prevChapter.title}
					</div>
				</div>
			</a>
		{:else}
			<div class="card-base px-4 py-3.5 bg-[var(--card-bg)]/50 border border-black/5 dark:border-white/5 rounded-2xl text-xs text-black/35 dark:text-white/35 flex items-center">
				已经是第 1 话了
			</div>
		{/if}

		<div class="flex items-center justify-center gap-2">
			<button
				type="button"
				on:click={openChapterDrawer}
				class="card-base w-full h-full px-4 py-3.5 bg-[var(--card-bg)] border border-black/5 dark:border-white/10 rounded-2xl hover:border-[var(--primary)]/35 hover:text-[var(--primary)] transition-all flex items-center justify-center gap-2 text-xs md:text-sm font-semibold text-black/75 dark:text-white/75"
			>
				<Icon icon="material-symbols:format-list-bulleted-rounded" class="text-base text-[var(--primary)]" />
				<span>全话目录 ({meta.totalChapters})</span>
			</button>
		</div>

		{#if nextChapter}
			<a
				href={`/comics/${meta.slug}/${nextChapter.slug}/`}
				class="card-base px-4 py-3.5 bg-[var(--card-bg)] border border-black/5 dark:border-white/10 rounded-2xl hover:border-[var(--primary)]/35 transition-all group flex items-center justify-end gap-3 text-right"
			>
				<div class="min-w-0">
					<div class="text-[11px] text-black/45 dark:text-white/45">下一话</div>
					<div class="text-xs md:text-sm font-semibold text-black/80 dark:text-white/80 truncate group-hover:text-[var(--primary)] transition-colors">
						#{String(nextChapter.index).padStart(3, "0")} · {nextChapter.title}
					</div>
				</div>
				<Icon icon="material-symbols:arrow-forward-rounded" class="text-lg text-black/40 group-hover:text-[var(--primary)] flex-shrink-0 transition-colors" />
			</a>
		{:else}
			<div class="card-base px-4 py-3.5 bg-[var(--card-bg)]/50 border border-black/5 dark:border-white/5 rounded-2xl text-xs text-black/35 dark:text-white/35 flex items-center justify-end">
				已到达最新话
			</div>
		{/if}
	</div>

	<!-- 底部快捷键说明 -->
	<div class="text-center text-[11px] text-black/40 dark:text-white/40 pt-1 pb-2 hidden md:block">
		快捷键提示：<kbd class="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono">C</kbd> 目录 ·
		<kbd class="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono">M</kbd> 切条漫/单页 ·
		<kbd class="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono">F</kbd> 沉浸全屏 ·
		<kbd class="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono">[</kbd> /
		<kbd class="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono">]</kbd> 上下话
	</div>
</div>

<!-- 右侧章节抽屉（按需懒加载 chapters.json） -->
{#if drawerOpen}
	<div class="fixed inset-0 z-50 flex justify-end">
		<button
			type="button"
			aria-label="关闭目录抽屉"
			on:click={() => (drawerOpen = false)}
			class="fixed inset-0 bg-black/55 backdrop-blur-sm cursor-default"
		></button>
		<aside
			class="relative z-10 w-full max-w-sm h-full bg-[var(--card-bg)] border-l border-black/10 dark:border-white/10 shadow-2xl flex flex-col"
			aria-label="章节快速跳转目录"
		>
			<div class="p-4 border-b border-black/10 dark:border-white/10 space-y-3">
				<div class="flex items-center justify-between">
					<div class="font-bold text-sm text-black/90 dark:text-white/90 flex items-center gap-2">
						<Icon icon="material-symbols:menu-book-rounded" class="text-[var(--primary)]" />
						<span>{meta.title} · 目录</span>
					</div>
					<button
						type="button"
						on:click={() => (drawerOpen = false)}
						class="w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center"
						aria-label="关闭目录"
					>
						<Icon icon="material-symbols:close-rounded" class="text-lg" />
					</button>
				</div>
				<input
					type="search"
					bind:value={drawerKeyword}
					placeholder="过滤话数或标题..."
					class="w-full px-3 py-2 text-xs rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 text-black/85 dark:text-white/85 focus:outline-none focus:border-[var(--primary)]/50"
				/>
			</div>

			<div class="flex-1 overflow-y-auto p-3 space-y-1.5">
				{#if drawerLoading}
					<div class="py-16 text-center text-xs text-black/50 dark:text-white/50">
						正在加载全部 {meta.totalChapters} 话目录...
					</div>
				{:else if drawerError}
					<div class="py-12 text-center space-y-2 text-xs text-red-500">
						<p>{drawerError}</p>
						<button
							type="button"
							on:click={() => {
								hasFetchedChapters = false;
								void openChapterDrawer();
							}}
							class="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white"
						>
							重试
						</button>
					</div>
				{:else if filteredDrawerChapters.length === 0}
					<div class="py-12 text-center text-xs text-black/45 dark:text-white/45">
						无匹配章节
					</div>
				{:else}
					{#each filteredDrawerChapters as ch (ch.slug)}
						{@const isActive = ch.slug === chapter.slug}
						<a
							href={`/comics/${meta.slug}/${ch.slug}/`}
							on:click={() => (drawerOpen = false)}
							class={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs transition-colors ${
								isActive
									? "bg-[var(--primary)] text-white dark:text-black/90 font-bold"
									: "hover:bg-[var(--primary)]/10 text-black/80 dark:text-white/80"
							}`}
						>
							<span class="truncate">
								#{String(ch.index).padStart(3, "0")} · {ch.title}
							</span>
							<span class={`font-mono text-[10px] flex-shrink-0 ${
								isActive ? "opacity-90" : "text-black/40 dark:text-white/40"
							}`}>
								{ch.pageCount}P
							</span>
						</a>
					{/each}
				{/if}
			</div>
		</aside>
	</div>
{/if}

<style>
	:global(html.comic-immersive-mode #sidebar),
	:global(html.comic-immersive-mode #top-row),
	:global(html.comic-immersive-mode .footer) {
		display: none !important;
	}
	:global(html.comic-immersive-mode #main-grid) {
		grid-template-columns: minmax(0, 1fr) !important;
	}
	:global(html.comic-immersive-mode #swup-container) {
		grid-column: 1 / -1 !important;
	}
</style>
