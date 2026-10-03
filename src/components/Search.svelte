<script lang="ts">
import Icon from "@iconify/svelte";
import { url } from "@utils/url-utils.ts";
import { onMount } from "svelte";

interface SearchItem {
	type: "post" | "moment" | "capsule";
	title: string;
	description: string;
	content: string;
	link: string;
	badge: string;
	tags?: string[];
	pubDate?: string;
}

interface SearchResult {
	url: string;
	meta: {
		title: string;
		type: "post" | "moment" | "capsule";
		badge: string;
		tags?: string[];
	};
	excerpt: string;
	urlPath?: string;
}

let keywordDesktop = "";
let keywordMobile = "";
let result: SearchResult[] = [];
let selectedIndex = 0;
let isSearching = false;
let isLoadingData = false;
let isDataLoaded = false;
let loadPromise: Promise<void> | null = null;
let allItems: SearchItem[] = [];

let desktopInputEl: HTMLInputElement;
let mobileInputEl: HTMLInputElement;

const ensureDataLoaded = async (): Promise<void> => {
	if (isDataLoaded) return;
	if (loadPromise) return loadPromise;

	isLoadingData = true;
	loadPromise = (async () => {
		try {
			const items: SearchItem[] = [];

			// 1. 并发获取文章 RSS 与朋友圈动态
			const [rssRes, momentsRes] = await Promise.allSettled([
				fetch("/rss.xml").then((r) => r.text()),
				fetch("/api/moments.json").then((r) => r.json()),
			]);

			// 解析文章
			if (rssRes.status === "fulfilled") {
				try {
					const parser = new DOMParser();
					const xml = parser.parseFromString(rssRes.value, "text/xml");
					const xmlItems = xml.querySelectorAll("item");

					xmlItems.forEach((item) => {
						let content = "";
						const contentEncoded =
							item.getElementsByTagNameNS("*", "encoded")[0]?.textContent ||
							item.querySelector("*|encoded")?.textContent ||
							"";

						if (contentEncoded) {
							content = contentEncoded.replace(/<[^>]*>/g, "");
						}

						const linkRaw = item.querySelector("link")?.textContent || "";
						const slugMatch = linkRaw.match(/.*\/posts\/(.*?)\/?$/);
						const cleanSlug = slugMatch ? slugMatch[1] : linkRaw;

						items.push({
							type: "post",
							title: item.querySelector("title")?.textContent || "",
							description: item.querySelector("description")?.textContent || "",
							content: content,
							link: `/posts/${cleanSlug}/`,
							badge: "文章",
							pubDate: item.querySelector("pubDate")?.textContent || "",
						});
					});
				} catch (e) {
					console.warn("Failed to parse RSS XML:", e);
				}
			}

			// 解析朋友圈动态
			if (momentsRes.status === "fulfilled" && momentsRes.value?.moments) {
				momentsRes.value.moments.forEach((m: any) => {
					const isCapsule = Boolean(m.capsule);
					const rawText = m.text || "";
					const firstLine = rawText.split("\n")[0].trim() || "朋友圈随笔";
					const displayTitle = firstLine.length > 32 ? `${firstLine.slice(0, 32)}...` : firstLine;

					items.push({
						type: isCapsule ? "capsule" : "moment",
						title: displayTitle,
						description: rawText,
						content: rawText,
						link: `/moments/#${m.slug}`,
						tags: m.tags || [],
						badge: isCapsule ? "时间胶囊" : "朋友圈",
						pubDate: m.published || "",
					});
				});
			}

			allItems = items;
			isDataLoaded = true;
		} catch (error) {
			console.error("Error fetching search indexes:", error);
		} finally {
			isLoadingData = false;
		}
	})();
	return loadPromise;
};

const togglePanel = () => {
	const panel = document.getElementById("search-panel");
	panel?.classList.toggle("float-panel-closed");
};

const setPanelVisibility = (show: boolean, isDesktop: boolean): void => {
	const panel = document.getElementById("search-panel");
	if (!panel) return;

	if (show) {
		panel.classList.remove("float-panel-closed");
	} else {
		panel.classList.add("float-panel-closed");
	}
};

const highlightText = (text: string, keyword: string): string => {
	if (!keyword) return text;
	const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const regex = new RegExp(`(${escaped})`, "gi");
	return text.replace(
		regex,
		"<mark class='bg-[var(--primary)]/20 text-[var(--primary)] font-bold px-0.5 rounded'>$1</mark>",
	);
};

const search = async (keyword: string, isDesktop: boolean): Promise<void> => {
	if (!keyword || !keyword.trim()) {
		setPanelVisibility(false, isDesktop);
		result = [];
		selectedIndex = 0;
		return;
	}

	isSearching = true;

	try {
		if (!isDataLoaded) {
			await ensureDataLoaded();
		}

		const kw = keyword.trim().toLowerCase();

		const searchResults: SearchResult[] = allItems
			.filter((item) => {
				const tagsStr = (item.tags || []).join(" ").toLowerCase();
				const searchText = `${item.title} ${item.description} ${item.content} ${tagsStr}`.toLowerCase();
				return searchText.includes(kw) || item.link.toLowerCase().includes(kw);
			})
			.map((item) => {
				const contentLower = item.content.toLowerCase();
				const contentIndex = contentLower.indexOf(kw);

				let excerpt = "";
				if (contentIndex !== -1) {
					const start = Math.max(0, contentIndex - 40);
					const end = Math.min(item.content.length, contentIndex + 80);
					excerpt = item.content.substring(start, end);
					if (start > 0) excerpt = `...${excerpt}`;
					if (end < item.content.length) excerpt = `${excerpt}...`;
				} else {
					excerpt = item.description.slice(0, 120) || item.content.slice(0, 120);
					if (item.description.length > 120 || item.content.length > 120) excerpt += "...";
				}

				return {
					url: url(item.link),
					meta: {
						title: item.title,
						type: item.type,
						badge: item.badge,
						tags: item.tags,
					},
					excerpt: highlightText(excerpt, keyword.trim()),
					urlPath: item.link,
				};
			});

		result = searchResults;
		selectedIndex = 0;
		setPanelVisibility(result.length > 0, isDesktop);
	} catch (error) {
		console.error("Search error:", error);
		result = [];
		setPanelVisibility(false, isDesktop);
	} finally {
		isSearching = false;
	}
};

const handleKeyNavigation = (e: KeyboardEvent) => {
	if (result.length === 0) return;

	if (e.key === "ArrowDown") {
		e.preventDefault();
		selectedIndex = (selectedIndex + 1) % result.length;
	} else if (e.key === "ArrowUp") {
		e.preventDefault();
		selectedIndex = (selectedIndex - 1 + result.length) % result.length;
	} else if (e.key === "Enter") {
		if (result[selectedIndex]) {
			e.preventDefault();
			window.location.href = result[selectedIndex].url;
		}
	}
};

onMount(() => {
	const handleGlobalKeyDown = (e: KeyboardEvent) => {
		// Cmd+K 或 Ctrl+K 全局快捷键呼出
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
			e.preventDefault();
			const panel = document.getElementById("search-panel");
			const isClosed = !panel || panel.classList.contains("float-panel-closed");

			ensureDataLoaded();

			if (isClosed) {
				setPanelVisibility(true, true);
				panel?.classList.remove("float-panel-closed");
				if (window.innerWidth >= 1024) {
					desktopInputEl?.focus();
					desktopInputEl?.select();
				} else {
					mobileInputEl?.focus();
					mobileInputEl?.select();
				}
			} else {
				setPanelVisibility(false, true);
				panel?.classList.add("float-panel-closed");
				desktopInputEl?.blur();
				mobileInputEl?.blur();
			}
		} else if (e.key === "Escape") {
			setPanelVisibility(false, true);
			const panel = document.getElementById("search-panel");
			panel?.classList.add("float-panel-closed");
			desktopInputEl?.blur();
			mobileInputEl?.blur();
		}
	};

	const handleCustomSearch = (e: Event) => {
		const customEvent = e as CustomEvent<{ query: string }>;
		const query = customEvent.detail?.query?.trim();
		if (!query) return;
		ensureDataLoaded();
		const panel = document.getElementById("search-panel");
		panel?.classList.remove("float-panel-closed");
		setPanelVisibility(true, true);
		if (window.innerWidth >= 1024) {
			keywordDesktop = query;
			desktopInputEl?.focus();
		} else {
			keywordMobile = query;
			mobileInputEl?.focus();
		}
	};

	window.addEventListener("keydown", handleGlobalKeyDown);
	window.addEventListener("yaoxi:search", handleCustomSearch);
	return () => {
		window.removeEventListener("keydown", handleGlobalKeyDown);
		window.removeEventListener("yaoxi:search", handleCustomSearch);
	};
});

$: search(keywordDesktop, true);
$: search(keywordMobile, false);
</script>

<!-- 桌面端搜索栏与快捷键指示徽章 -->
<div id="search-bar" class="hidden lg:flex transition-all items-center h-11 mr-2 rounded-xl
      bg-black/[0.04] hover:bg-black/[0.06] focus-within:bg-black/[0.06]
      dark:bg-white/5 dark:hover:bg-white/10 dark:focus-within:bg-white/10 relative px-2.5
">
    <Icon icon="material-symbols:search" class="text-[1.25rem] pointer-events-none transition text-black/30 dark:text-white/30 shrink-0"></Icon>
    <input bind:this={desktopInputEl} placeholder="搜索文章/朋友圈..." bind:value={keywordDesktop}
           on:focus={() => { ensureDataLoaded(); search(keywordDesktop, true); }}
           on:mouseenter={ensureDataLoaded}
           on:keydown={handleKeyNavigation}
           class="transition-all pl-2 text-sm bg-transparent outline-0
         h-full w-36 active:w-56 focus:w-56 text-black/70 dark:text-white/70"
    >
    <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-black/40 dark:text-white/40 border border-black/10 dark:border-white/10 select-none ml-1 pointer-events-none">
      ⌘K
    </span>
</div>

<!-- 移动端触发按钮 -->
<button on:click={() => { togglePanel(); ensureDataLoaded(); }} aria-label="Search Panel" id="search-switch"
        class="btn-plain scale-animation lg:!hidden rounded-xl w-11 h-11 active:scale-90 flex items-center justify-center">
    <Icon icon="material-symbols:search" class="text-[1.25rem]"></Icon>
</button>

<!-- 搜索浮动面板 -->
<div id="search-panel" class="float-panel float-panel-closed search-panel absolute md:w-[32rem]
top-20 left-4 md:left-[unset] right-4 shadow-2xl rounded-2xl p-3 border border-[var(--line-divider)] backdrop-blur-md">

    <!-- 移动端输入框 -->
    <div id="search-bar-inside" class="flex relative lg:hidden transition-all items-center h-11 rounded-xl px-3 mb-2
      bg-black/[0.04] hover:bg-black/[0.06] focus-within:bg-black/[0.06]
      dark:bg-white/5 dark:hover:bg-white/10 dark:focus-within:bg-white/10 border border-[var(--line-divider)]
  ">
        <Icon icon="material-symbols:search" class="text-[1.25rem] pointer-events-none transition text-black/30 dark:text-white/30 shrink-0"></Icon>
        <input bind:this={mobileInputEl} placeholder="搜索文章或朋友圈..." bind:value={keywordMobile}
               on:focus={ensureDataLoaded}
               on:keydown={handleKeyNavigation}
               class="pl-2 w-full text-sm bg-transparent outline-0 text-black/80 dark:text-white/80"
        >
    </div>

    <!-- 数据载入状态 -->
    {#if isLoadingData}
        <div class="text-xs text-neutral-400 dark:text-neutral-500 py-3 text-center flex items-center justify-center gap-2">
            <span class="inline-block h-3 w-3 rounded-full border-2 border-[var(--primary)] border-t-transparent animate-spin"></span>
            <span>正在建立文章与朋友圈全站索引...</span>
        </div>
    {/if}

    <!-- 快捷按键提示 -->
    {#if result.length > 0}
      <div class="flex items-center justify-between text-[11px] text-black/40 dark:text-white/40 px-2 py-1 mb-1 border-b border-[var(--line-divider)] font-mono">
        <span>共找到 {result.length} 条相关结果</span>
        <span class="hidden md:inline">↑↓ 切换 · Enter 直达 · Esc 关闭</span>
      </div>
    {/if}

    <!-- 搜索结果列表 -->
    {#each result as item, idx}
        <a href={item.url}
           class="transition first-of-type:mt-1 group block rounded-xl p-2.5 mb-1
           {idx === selectedIndex ? 'bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30' : 'hover:bg-[var(--btn-plain-bg-hover)]'}
        ">
            <div class="flex items-center gap-2 mb-1">
                <!-- 模块类型标签 -->
                {#if item.meta.type === 'post'}
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20 shrink-0">文章</span>
                {:else if item.meta.type === 'capsule'}
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-500/10 text-purple-500 border border-purple-500/20 shrink-0">胶囊</span>
                {:else}
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shrink-0">朋友圈</span>
                {/if}

                <div class="transition text-sm font-bold text-black/90 dark:text-white/90 group-hover:text-[var(--primary)] truncate flex-1">
                    {item.meta.title}
                </div>
                <Icon icon="fa6-solid:chevron-right" class="transition text-[0.7rem] my-auto text-black/30 dark:text-white/30 group-hover:text-[var(--primary)] shrink-0"></Icon>
            </div>

            <div class="transition text-xs text-black/60 dark:text-white/60 line-clamp-2 leading-relaxed">
                {@html item.excerpt}
            </div>

            <div class="transition text-[10px] text-black/30 dark:text-white/30 mt-1 font-mono flex items-center justify-between">
                <span>{item.urlPath}</span>
                {#if item.meta.tags && item.meta.tags.length > 0}
                  <span class="text-[var(--primary)] font-sans">#{item.meta.tags.slice(0, 2).join(' #')}</span>
                {/if}
            </div>
        </a>
    {/each}

    {#if !isLoadingData && (keywordDesktop || keywordMobile) && result.length === 0}
      <div class="text-xs text-neutral-400 dark:text-neutral-500 py-6 text-center">
        未找到与该关键词相关的文章或朋友圈动态 喵~
      </div>
    {/if}
</div>

<style>
  input:focus {
    outline: 0;
  }
  .search-panel {
    background-color: var(--float-panel-bg-opaque);
    max-height: calc(100vh - 110px);
    overflow-y: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .search-panel::-webkit-scrollbar {
    display: none;
  }
</style>
