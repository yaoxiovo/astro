<script lang="ts">
import Icon from "@iconify/svelte";
import {
	type KnowledgeTypeFilter,
	SUBJECT_METAS,
	type SubjectFilter,
	type TextbookItem,
	type TextbookSubjectId,
} from "../../types/textbook";
import TextbookArticleDrawer from "./TextbookArticleDrawer.svelte";
import TextbookCard from "./TextbookCard.svelte";
import TextbookLightbox from "./TextbookLightbox.svelte";

export let textbooks: TextbookItem[] = [];

let selectedSubject: SubjectFilter = "all";
let selectedType: KnowledgeTypeFilter = "all";
let searchKeyword = "";
let selectedTag: string | null = null;

let activeLightboxItem: TextbookItem | null = null;
let activeDrawerItem: TextbookItem | null = null;
let toastMessage: string | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const subjectsList: TextbookSubjectId[] = [
	"math",
	"physics",
	"chemistry",
	"cs",
	"english",
	"biology",
];

const showToast = (msg: string) => {
	toastMessage = msg;
	if (toastTimer) clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		toastMessage = null;
	}, 2200);
};

// 反应式过滤列表
$: filteredItems = textbooks.filter((item) => {
	// 学科过滤
	if (selectedSubject !== "all" && item.subject !== selectedSubject) {
		return false;
	}
	// 类型过滤
	if (selectedType !== "all" && item.type !== selectedType) {
		return false;
	}
	// 标签过滤
	if (selectedTag && !item.tags.includes(selectedTag)) {
		return false;
	}
	// 关键词即时搜索
	if (searchKeyword.trim()) {
		const kw = searchKeyword.trim().toLowerCase();
		const matchTitle = item.title.toLowerCase().includes(kw);
		const matchSummary = item.summary.toLowerCase().includes(kw);
		const matchChapter = item.chapter.toLowerCase().includes(kw);
		const matchGrade = item.grade.toLowerCase().includes(kw);
		const matchSubject = item.subjectLabel.toLowerCase().includes(kw);
		const matchTags = item.tags.some((t) => t.toLowerCase().includes(kw));
		const matchKeyPoints =
			item.keyPoints?.some((kp) => kp.toLowerCase().includes(kw)) ?? false;

		if (
			!matchTitle &&
			!matchSummary &&
			!matchChapter &&
			!matchGrade &&
			!matchSubject &&
			!matchTags &&
			!matchKeyPoints
		) {
			return false;
		}
	}
	return true;
});

// 计算统计数据
$: totalCount = textbooks.length;
$: imageCount = textbooks.filter((it) => it.type === "image").length;
$: articleCount = textbooks.filter((it) => it.type === "article").length;

// 计算各学科对应数量
$: subjectCounts = subjectsList.reduce(
	(acc, sub) => {
		acc[sub] = textbooks.filter((it) => it.subject === sub).length;
		return acc;
	},
	{} as Record<TextbookSubjectId, number>,
);

// 获取所有图片条目用于 Lightbox 左右导航
$: allImageItems = textbooks.filter((it) => it.type === "image");

const resetFilters = () => {
	selectedSubject = "all";
	selectedType = "all";
	selectedTag = null;
	searchKeyword = "";
};
</script>

<div class="space-y-6">
  <!-- 顶部控制面板卡片 -->
  <div class="card-base p-5 md:p-6 bg-[var(--card-bg)] border border-black/5 dark:border-white/10 rounded-2xl shadow-sm space-y-5">
    
    <!-- 第一行：搜索框与统计摘要 -->
    <div class="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
      <!-- 搜索输入框 -->
      <div class="relative flex-1 max-w-xl">
        <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-black/40 dark:text-white/40">
          <Icon icon="material-symbols:search-rounded" class="text-xl" />
        </div>
        <input
          type="text"
          bind:value={searchKeyword}
          placeholder="即时检索学科、公式、定理、思维导图或关键词..."
          class="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl bg-black/[0.04] hover:bg-black/[0.06] focus:bg-black/[0.06] dark:bg-white/5 dark:hover:bg-white/10 dark:focus:bg-white/10 border border-black/10 dark:border-white/10 focus:border-[var(--primary)] dark:focus:border-[var(--primary)] outline-none text-black/90 dark:text-white/90 placeholder-black/40 dark:placeholder-white/40 transition-all"
        />
        {#if searchKeyword}
          <button
            type="button"
            class="absolute inset-y-0 right-0 pr-3 flex items-center text-black/40 dark:text-white/40 hover:text-black/80 dark:hover:text-white/80"
            on:click={() => (searchKeyword = "")}
          >
            <Icon icon="material-symbols:cancel-rounded" class="text-lg" />
          </button>
        {/if}
      </div>

      <!-- 类型快捷切换器 -->
      <div class="flex items-center gap-1 bg-black/[0.04] dark:bg-white/5 p-1 rounded-xl border border-black/5 dark:border-white/5 self-start md:self-auto">
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all {selectedType === 'all' ? 'bg-[var(--primary)] text-white dark:text-black shadow-xs font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black/90 dark:hover:text-white/90'}"
          on:click={() => (selectedType = 'all')}
        >
          全部 ({totalCount})
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 {selectedType === 'article' ? 'bg-[var(--primary)] text-white dark:text-black shadow-xs font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black/90 dark:hover:text-white/90'}"
          on:click={() => (selectedType = 'article')}
        >
          <Icon icon="material-symbols:article-outline-rounded" class="text-xs" />
          <span>文章 ({articleCount})</span>
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 {selectedType === 'image' ? 'bg-[var(--primary)] text-white dark:text-black shadow-xs font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black/90 dark:hover:text-white/90'}"
          on:click={() => (selectedType = 'image')}
        >
          <Icon icon="material-symbols:schema-rounded" class="text-xs" />
          <span>思维导图 ({imageCount})</span>
        </button>
      </div>
    </div>

    <!-- 第二行：学科多维标签组（水平滚动或换行） -->
    <div>
      <div class="text-[11px] font-semibold text-black/40 dark:text-white/40 mb-2 uppercase tracking-wider flex items-center gap-1">
        <Icon icon="material-symbols:filter-alt-outline-rounded" class="text-xs" />
        按学科筛选
      </div>
      <div class="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar flex-wrap">
        <button
          type="button"
          class="px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 border {selectedSubject === 'all' ? 'bg-[var(--primary)]/15 border-[var(--primary)] text-[var(--primary)] font-bold shadow-2xs' : 'border-black/5 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 text-black/70 dark:text-white/70'}"
          on:click={() => (selectedSubject = 'all')}
        >
          全部学科
        </button>

        {#each subjectsList as subId}
          {@const meta = SUBJECT_METAS[subId]}
          {@const isSelected = selectedSubject === subId}
          <button
            type="button"
            class="px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 border flex items-center gap-1.5 {isSelected ? 'bg-[var(--primary)]/15 border-[var(--primary)] text-[var(--primary)] font-bold shadow-2xs' : 'border-black/5 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 text-black/70 dark:text-white/70'}"
            on:click={() => (selectedSubject = subId)}
          >
            <Icon icon={meta.icon} class="text-sm {meta.color}" />
            <span>{meta.label}</span>
            <span class="text-[10px] px-1 py-0.2 rounded-full bg-black/5 dark:bg-white/10 opacity-75 font-mono">
              {subjectCounts[subId] || 0}
            </span>
          </button>
        {/each}
      </div>
    </div>

    <!-- 激活的筛选条件状态栏（如果有选标签或搜索词） -->
    {#if selectedTag || searchKeyword || selectedSubject !== 'all' || selectedType !== 'all'}
      <div class="flex flex-wrap items-center gap-2 pt-2 border-t border-black/5 dark:border-white/5 text-xs text-black/60 dark:text-white/60">
        <span class="text-[11px] text-black/40 dark:text-white/40">当前筛选：</span>

        {#if selectedSubject !== 'all'}
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10 text-xs">
            学科: {SUBJECT_METAS[selectedSubject]?.label}
            <button type="button" on:click={() => (selectedSubject = 'all')}>
              <Icon icon="material-symbols:close-rounded" class="text-xs hover:text-red-500" />
            </button>
          </span>
        {/if}

        {#if selectedType !== 'all'}
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10 text-xs">
            类型: {selectedType === 'article' ? '文章知识点' : '思维导图'}
            <button type="button" on:click={() => (selectedType = 'all')}>
              <Icon icon="material-symbols:close-rounded" class="text-xs hover:text-red-500" />
            </button>
          </span>
        {/if}

        {#if selectedTag}
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--primary)]/15 text-[var(--primary)] font-medium text-xs">
            #{selectedTag}
            <button type="button" on:click={() => (selectedTag = null)}>
              <Icon icon="material-symbols:close-rounded" class="text-xs hover:text-red-500" />
            </button>
          </span>
        {/if}

        {#if searchKeyword}
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10 text-xs">
            关键词: "{searchKeyword}"
            <button type="button" on:click={() => (searchKeyword = '')}>
              <Icon icon="material-symbols:close-rounded" class="text-xs hover:text-red-500" />
            </button>
          </span>
        {/if}

        <button
          type="button"
          class="text-xs text-[var(--primary)] hover:underline ml-auto flex items-center gap-1"
          on:click={resetFilters}
        >
          <Icon icon="material-symbols:restart-alt-rounded" class="text-xs" />
          重置所有筛选
        </button>
      </div>
    {/if}
  </div>

  <!-- 结果数量提示与轻量统计条 -->
  <div class="flex items-center justify-between text-xs text-black/50 dark:text-white/50 px-1">
    <div>
      共匹配到 <strong class="text-black/80 dark:text-white/80 font-bold">{filteredItems.length}</strong> 条教材知识点
    </div>
    <div class="hidden sm:block text-[11px]">
      💡 提示：点击图片卡片直接放大预览，点击文章卡片唤起侧边精讲抽屉
    </div>
  </div>

  <!-- 教材卡片网格 -->
  {#if filteredItems.length > 0}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {#each filteredItems as item (item.id)}
        <TextbookCard
          {item}
          on:openLightbox={(e) => (activeLightboxItem = e.detail)}
          on:openDrawer={(e) => (activeDrawerItem = e.detail)}
          on:selectTag={(e) => (selectedTag = e.detail)}
          on:showToast={(e) => showToast(e.detail)}
        />
      {/each}
    </div>
  {:else}
    <!-- 空状态展示 -->
    <div class="card-base p-12 text-center bg-[var(--card-bg)] border border-black/5 dark:border-white/10 rounded-2xl flex flex-col items-center justify-center">
      <div class="w-16 h-16 rounded-2xl bg-black/5 dark:bg-white/5 flex items-center justify-center text-black/30 dark:text-white/30 mb-4">
        <Icon icon="material-symbols:search-off-rounded" class="text-3xl" />
      </div>
      <h3 class="text-base font-bold text-black/80 dark:text-white/80 mb-1">
        未找到匹配的教材或知识点
      </h3>
      <p class="text-xs text-black/50 dark:text-white/50 max-w-sm mb-5 leading-relaxed">
        尝试调整您的学科筛选标签、切换知识点类型或清除搜索关键词喵~
      </p>
      <button
        type="button"
        class="px-4 py-2 rounded-xl bg-[var(--primary)] text-white dark:text-black font-semibold text-xs shadow-sm hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5"
        on:click={resetFilters}
      >
        <Icon icon="material-symbols:refresh-rounded" class="text-sm" />
        重置筛选并查看全部
      </button>
    </div>
  {/if}
</div>

<!-- 图片高清 Lightbox 浮层 -->
{#if activeLightboxItem}
  <TextbookLightbox
    item={activeLightboxItem}
    {allImageItems}
    on:close={() => (activeLightboxItem = null)}
    on:showToast={(e) => showToast(e.detail)}
    on:navigate={(e) => (activeLightboxItem = e.detail)}
  />
{/if}

<!-- 文章知识点抽屉 -->
{#if activeDrawerItem}
  <TextbookArticleDrawer
    item={activeDrawerItem}
    on:close={() => (activeDrawerItem = null)}
    on:showToast={(e) => showToast(e.detail)}
    on:selectTag={(e) => (selectedTag = e.detail)}
  />
{/if}

<!-- 浮动操作反馈 Toast -->
{#if toastMessage}
  <div class="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-black/85 text-white text-xs font-medium shadow-2xl backdrop-blur-md flex items-center gap-2 border border-white/10 animate-fadeUp">
    <Icon icon="material-symbols:info-rounded" class="text-sm text-[var(--primary)]" />
    <span>{toastMessage}</span>
  </div>
{/if}

<style>
  @keyframes fadeUp {
    from {
      opacity: 0;
      transform: translate(-50%, 12px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
  .animate-fadeUp {
    animation: fadeUp 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
</style>
