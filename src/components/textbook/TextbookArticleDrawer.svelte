<script lang="ts">
import Icon from "@iconify/svelte";
import { createEventDispatcher, onDestroy, onMount } from "svelte";
import {
	SUBJECT_METAS,
	type TextbookItem,
	type TextbookSubjectId,
} from "../../types/textbook";

export let item: TextbookItem;

const dispatch = createEventDispatcher<{
	close: void;
	showToast: string;
	selectTag: string;
}>();

let copySuccess = false;

$: subjectMeta = SUBJECT_METAS[item.subject as TextbookSubjectId] || {
	label: item.subjectLabel,
	icon: "material-symbols:book-2-outline",
	color: "text-blue-500",
	borderClass: "border-blue-500/20",
	badgeClass: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
};

const handleCopyLink = async () => {
	const targetUrl = item.articleUrl
		? `${window.location.origin}${item.articleUrl}`
		: window.location.href;

	try {
		await navigator.clipboard.writeText(targetUrl);
		copySuccess = true;
		dispatch("showToast", "已复制知识点文章链接！");
		setTimeout(() => {
			copySuccess = false;
		}, 2000);
	} catch (e) {
		dispatch("showToast", "复制失败，请手动复制");
	}
};

const handleKeyDown = (e: KeyboardEvent) => {
	if (e.key === "Escape") {
		dispatch("close");
	}
};

onMount(() => {
	window.addEventListener("keydown", handleKeyDown);
	document.body.style.overflow = "hidden";
});

onDestroy(() => {
	window.removeEventListener("keydown", handleKeyDown);
	document.body.style.overflow = "";
});
</script>

<!-- 抽屉容器与半透明遮罩 -->
<div class="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true">
  <!-- 背景模糊遮罩 -->
  <div
    class="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity duration-300 animate-fadeIn"
    on:click={() => dispatch('close')}
  ></div>

  <!-- 抽屉主体：移动端全屏/底栏，桌面端右侧滑出 -->
  <div class="fixed inset-y-0 right-0 max-w-2xl w-full flex pl-6 sm:pl-10 pointer-events-none">
    <div class="pointer-events-auto w-screen max-w-2xl bg-[var(--card-bg)] text-black/90 dark:text-white/90 shadow-2xl border-l border-black/10 dark:border-white/10 flex flex-col justify-between overflow-hidden animate-slideLeft">

      <!-- 抽屉顶栏 -->
      <div class="px-6 py-4 border-b border-black/5 dark:border-white/10 flex items-center justify-between bg-black/[0.02] dark:bg-white/[0.02]">
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full border shadow-2xs {subjectMeta.badgeClass}">
            <Icon icon={subjectMeta.icon} class="text-sm" />
            <span>{subjectMeta.label}</span>
          </div>
          <span class="text-xs text-black/40 dark:text-white/40">
            {item.grade} · {item.chapter}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <!-- 复制链接按钮 -->
          <button
            type="button"
            class="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-black/60 dark:text-white/60 transition-colors"
            title="复制本页链接"
            on:click={handleCopyLink}
          >
            <Icon icon={copySuccess ? "material-symbols:check-small-rounded" : "material-symbols:share-outline-rounded"} class="text-lg" />
          </button>

          <!-- 关闭抽屉按钮 -->
          <button
            type="button"
            class="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-black/60 dark:text-white/60 transition-colors"
            title="关闭 (ESC)"
            on:click={() => dispatch('close')}
          >
            <Icon icon="material-symbols:close-rounded" class="text-xl" />
          </button>
        </div>
      </div>

      <!-- 抽屉滚动内容区 -->
      <div class="flex-1 overflow-y-auto px-6 py-6 md:px-8 space-y-6">
        <!-- 标题与元数据 -->
        <div>
          <h1 class="text-xl md:text-2xl font-black text-black/95 dark:text-white/95 leading-tight mb-3">
            {item.title}
          </h1>

          <div class="flex flex-wrap items-center gap-3 text-xs text-black/40 dark:text-white/40">
            <span class="flex items-center gap-1">
              <Icon icon="material-symbols:person-outline-rounded" class="text-sm" />
              整理：{item.author || '瑶曦'}
            </span>
            <span class="flex items-center gap-1">
              <Icon icon="material-symbols:update-rounded" class="text-sm" />
              更新于：{item.updatedAt}
            </span>
            {#if item.difficulty}
              <span class="px-2 py-0.5 rounded-full text-[11px] font-medium {item.difficulty === 'hard' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : item.difficulty === 'medium' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}">
                难度：{item.difficulty === 'hard' ? '硬核' : item.difficulty === 'medium' ? '进阶' : '基础'}
              </span>
            {/if}
          </div>
        </div>

        <!-- 知识点摘要卡 -->
        <div class="p-4 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border-l-4 border-[var(--primary)] text-sm text-black/80 dark:text-white/80 leading-relaxed">
          <p class="font-medium text-black/90 dark:text-white/90 mb-1 flex items-center gap-1.5">
            <Icon icon="material-symbols:info-outline-rounded" class="text-base text-[var(--primary)]" />
            内容概述
          </p>
          <p>{item.summary}</p>
        </div>

        <!-- 核心考点速记清单 -->
        {#if item.keyPoints && item.keyPoints.length > 0}
          <div class="space-y-3">
            <h2 class="text-sm font-bold uppercase tracking-wider text-black/70 dark:text-white/70 flex items-center gap-1.5">
              <Icon icon="material-symbols:fact-check-outline-rounded" class="text-base text-emerald-500" />
              核心知识点 & 考点提炼
            </h2>
            <div class="grid gap-2.5">
              {#each item.keyPoints as point, idx}
                <div class="flex items-start gap-2.5 p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/5 dark:border-white/5 text-xs md:text-sm text-black/80 dark:text-white/80">
                  <div class="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                    {idx + 1}
                  </div>
                  <div class="leading-relaxed">{point}</div>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- 讲义核心正文 -->
        {#if item.content}
          <div class="space-y-3 border-t border-black/5 dark:border-white/5 pt-5">
            <h2 class="text-sm font-bold uppercase tracking-wider text-black/70 dark:text-white/70 flex items-center gap-1.5">
              <Icon icon="material-symbols:menu-book-rounded" class="text-base text-blue-500" />
              讲义详解
            </h2>
            <div class="prose dark:prose-invert max-w-none text-xs md:text-sm leading-relaxed whitespace-pre-line text-black/80 dark:text-white/80 bg-black/[0.015] dark:bg-white/[0.02] p-4 rounded-xl border border-black/5 dark:border-white/5 font-sans">
              {item.content}
            </div>
          </div>
        {/if}

        <!-- 标签集合 -->
        <div class="border-t border-black/5 dark:border-white/5 pt-4">
          <div class="text-xs text-black/40 dark:text-white/40 mb-2">相关主题标签：</div>
          <div class="flex flex-wrap gap-1.5">
            {#each item.tags as tag}
              <button
                type="button"
                class="text-xs px-2.5 py-1 rounded-md bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10 text-black/70 dark:text-white/70 transition-colors"
                on:click={() => {
                  dispatch('selectTag', tag);
                  dispatch('close');
                }}
              >
                #{tag}
              </button>
            {/each}
          </div>
        </div>
      </div>

      <!-- 抽屉底栏：行动按钮 -->
      <div class="p-4 md:px-8 border-t border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between gap-3">
        <div class="text-xs text-black/40 dark:text-white/40">
          教材与知识库 · 随身速记
        </div>

        <div class="flex items-center gap-2">
          {#if item.articleUrl}
            <a
              href={item.articleUrl}
              class="h-9 px-4 rounded-xl bg-[var(--primary)] text-white dark:text-black font-semibold text-xs flex items-center gap-1.5 shadow-sm hover:opacity-90 active:scale-95 transition-all"
            >
              <Icon icon="material-symbols:open-in-new-rounded" class="text-sm" />
              <span>阅读博客完整专栏</span>
            </a>
          {/if}

          <button
            type="button"
            class="h-9 px-4 rounded-xl bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 text-black/80 dark:text-white/80 font-medium text-xs transition-colors"
            on:click={() => dispatch('close')}
          >
            关闭预览
          </button>
        </div>
      </div>

    </div>
  </div>
</div>

<style>
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes slideLeft {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  .animate-fadeIn {
    animation: fadeIn 0.25s ease-out forwards;
  }
  .animate-slideLeft {
    animation: slideLeft 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
</style>
