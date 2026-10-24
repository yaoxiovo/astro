<script lang="ts">
import Icon from "@iconify/svelte";
import { createEventDispatcher } from "svelte";
import {
	SUBJECT_METAS,
	type TextbookItem,
	type TextbookSubjectId,
} from "../../types/textbook";

export let item: TextbookItem;

const dispatch = createEventDispatcher<{
	openLightbox: TextbookItem;
	openDrawer: TextbookItem;
	selectTag: string;
	showToast: string;
}>();

let imgError = false;
let copySuccess = false;

$: subjectMeta = SUBJECT_METAS[item.subject as TextbookSubjectId] || {
	label: item.subjectLabel,
	icon: "material-symbols:book-2-outline",
	color: "text-blue-500",
	borderClass: "border-blue-500/20",
	badgeClass: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
};

const handleImageError = () => {
	imgError = true;
};

const handleCardClick = () => {
	if (item.type === "image") {
		dispatch("openLightbox", item);
	} else {
		dispatch("openDrawer", item);
	}
};

const handleCopyLink = async (e: MouseEvent) => {
	e.stopPropagation();
	const targetUrl =
		item.type === "image" && item.imageUrl
			? item.imageUrl
			: item.articleUrl
				? `${window.location.origin}${item.articleUrl}`
				: window.location.href;

	try {
		await navigator.clipboard.writeText(targetUrl);
		copySuccess = true;
		dispatch(
			"showToast",
			item.type === "image" ? "已复制图片外链！" : "已复制知识点链接！",
		);
		setTimeout(() => {
			copySuccess = false;
		}, 2000);
	} catch (err) {
		dispatch("showToast", "复制失败，请手动选择复制");
	}
};
</script>

<div
  class="card-base card-hover flex flex-col justify-between overflow-hidden group cursor-pointer transition-all duration-300 border border-black/5 dark:border-white/10 hover:border-black/15 dark:hover:border-white/20 bg-[var(--card-bg)] shadow-sm hover:shadow-lg rounded-2xl"
  on:click={handleCardClick}
  role="button"
  tabindex="0"
  on:keydown={(e) => { if (e.key === 'Enter') handleCardClick(); }}
>
  <div>
    <!-- 卡片顶部预览区域（针对图片导图有封面/外链图，针对文章有知识专栏标识） -->
    {#if item.type === 'image'}
      <div class="relative w-full h-44 bg-black/5 dark:bg-white/5 overflow-hidden">
        {#if !imgError && (item.coverImage || item.imageUrl)}
          <img
            src={item.coverImage || item.imageUrl}
            alt={item.title}
            loading="lazy"
            decoding="async"
            class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            on:error={handleImageError}
          />
          <!-- 悬浮微渐变遮罩 -->
          <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-3 pointer-events-none">
            <span class="text-white text-xs font-medium flex items-center gap-1.5 drop-shadow">
              <Icon icon="material-symbols:zoom-in-rounded" class="text-sm" />
              点击放大预览高清导图
            </span>
          </div>
        {:else}
          <!-- 图片加载失败或缺失时的优雅降级占位图 -->
          <div class="w-full h-full flex flex-col items-center justify-center p-4 bg-gradient-to-br from-black/[0.03] to-black/[0.07] dark:from-white/[0.02] dark:to-white/[0.05] text-black/50 dark:text-white/50">
            <Icon icon={subjectMeta.icon} class="text-3xl {subjectMeta.color} opacity-80 mb-1" />
            <span class="text-xs font-medium text-black/60 dark:text-white/60">思维导图 · 外链图解</span>
            {#if imgError}
              <span class="text-[10px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                <Icon icon="material-symbols:warning-rounded" class="text-xs" />
                外链图片预览受阻，点击尝试直接查看
              </span>
            {/if}
          </div>
        {/if}

        <!-- 浮在图片右上角的类型徽章 -->
        <div class="absolute top-2.5 right-2.5 flex items-center gap-1 bg-black/60 backdrop-blur-md text-white text-[11px] font-medium px-2 py-0.5 rounded-full shadow-sm">
          <Icon icon="material-symbols:schema-rounded" class="text-xs text-amber-300" />
          <span>思维导图</span>
        </div>

        <!-- 浮在图片左上角的学科徽章 -->
        <div class="absolute top-2.5 left-2.5 flex items-center gap-1 bg-white/90 dark:bg-black/80 backdrop-blur-md text-[11px] font-semibold px-2 py-0.5 rounded-full shadow-sm {subjectMeta.color}">
          <Icon icon={subjectMeta.icon} class="text-xs" />
          <span>{subjectMeta.label}</span>
        </div>
      </div>
    {:else}
      <!-- 文章知识点专属卡片顶栏 -->
      <div class="relative w-full h-32 bg-gradient-to-br from-[var(--primary)]/10 via-[var(--primary)]/5 to-transparent p-4 flex flex-col justify-between border-b border-black/5 dark:border-white/5 overflow-hidden">
        <!-- 背景虚化大图标装饰 -->
        <Icon icon={subjectMeta.icon} class="absolute -right-3 -bottom-3 text-7xl opacity-10 {subjectMeta.color} pointer-events-none" />

        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full border shadow-2xs {subjectMeta.badgeClass}">
            <Icon icon={subjectMeta.icon} class="text-sm" />
            <span>{subjectMeta.label}</span>
          </div>

          <div class="flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-300 bg-blue-500/10 dark:bg-blue-400/15 px-2 py-0.5 rounded-full">
            <Icon icon="material-symbols:article-outline-rounded" class="text-xs" />
            <span>核心讲义</span>
          </div>
        </div>

        <div class="text-xs text-black/50 dark:text-white/50 flex items-center gap-1.5">
          <Icon icon="material-symbols:folder-open-outline-rounded" class="text-xs" />
          <span class="truncate">{item.grade} · {item.chapter}</span>
        </div>
      </div>
    {/if}

    <!-- 卡片主体内容 -->
    <div class="p-4 md:p-5">
      {#if item.type === 'image'}
        <!-- 如果是图片卡片，展示年级/章节信息 -->
        <div class="flex items-center gap-1.5 text-[11px] text-black/40 dark:text-white/40 mb-1.5">
          <Icon icon="material-symbols:bookmark-outline-rounded" class="text-xs" />
          <span class="truncate">{item.grade} · {item.chapter}</span>
        </div>
      {/if}

      <!-- 知识点标题 -->
      <h3 class="text-base md:text-lg font-bold text-black/90 dark:text-white/90 group-hover:text-[var(--primary)] transition-colors duration-200 line-clamp-2 leading-snug mb-2">
        {item.title}
      </h3>

      <!-- 知识点摘要 -->
      <p class="text-xs md:text-sm text-black/60 dark:text-white/60 line-clamp-2 leading-relaxed mb-3">
        {item.summary}
      </p>

      <!-- 核心要点小清单（若有） -->
      {#if item.keyPoints && item.keyPoints.length > 0}
        <div class="bg-black/[0.02] dark:bg-white/[0.03] border border-black/5 dark:border-white/5 rounded-xl p-2.5 mb-3 space-y-1">
          <div class="text-[11px] font-semibold text-black/70 dark:text-white/70 flex items-center gap-1">
            <Icon icon="material-symbols:check-circle-outline-rounded" class="text-xs text-emerald-500" />
            <span>核心提要 ({item.keyPoints.length})</span>
          </div>
          <div class="text-[11px] text-black/50 dark:text-white/50 line-clamp-2 pl-3.5 leading-relaxed">
            • {item.keyPoints[0]}
          </div>
        </div>
      {/if}

      <!-- 标签列表 -->
      <div class="flex flex-wrap gap-1.5">
        {#each item.tags as tag}
          <button
            type="button"
            class="text-[11px] px-2 py-0.5 rounded-md bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10 text-black/60 hover:text-black/90 dark:text-white/60 dark:hover:text-white/90 transition-colors"
            on:click={(e) => {
              e.stopPropagation();
              dispatch('selectTag', tag);
            }}
          >
            #{tag}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <!-- 卡片底部操作栏 -->
  <div class="px-4 py-3 md:px-5 md:py-3.5 bg-black/[0.015] dark:bg-white/[0.015] border-t border-black/5 dark:border-white/5 flex items-center justify-between text-xs">
    <div class="text-black/40 dark:text-white/40 text-[11px] flex items-center gap-1">
      <Icon icon="material-symbols:schedule-outline-rounded" class="text-xs" />
      <span>{item.updatedAt}</span>
    </div>

    <div class="flex items-center gap-1.5">
      <!-- 复制外链按钮 -->
      <button
        type="button"
        class="h-7 px-2 rounded-lg bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10 text-black/70 dark:text-white/70 flex items-center gap-1 transition-colors text-[11px]"
        title={item.type === 'image' ? '复制思维导图外链' : '复制知识点链接'}
        on:click={handleCopyLink}
      >
        <Icon icon={copySuccess ? "material-symbols:check-small-rounded" : "material-symbols:content-copy-outline-rounded"} class="text-xs" />
        <span class="hidden sm:inline">{copySuccess ? '已复制' : '复制外链'}</span>
      </button>

      <!-- 主要交互按钮 -->
      {#if item.type === 'image'}
        <button
          type="button"
          class="h-7 px-2.5 rounded-lg bg-[var(--primary)] text-white dark:text-black font-medium flex items-center gap-1 shadow-xs hover:opacity-90 active:scale-95 transition-all text-[11px]"
          on:click={(e) => {
            e.stopPropagation();
            dispatch('openLightbox', item);
          }}
        >
          <Icon icon="material-symbols:visibility-rounded" class="text-xs" />
          <span>查看大图</span>
        </button>
      {:else}
        <button
          type="button"
          class="h-7 px-2.5 rounded-lg bg-[var(--primary)] text-white dark:text-black font-medium flex items-center gap-1 shadow-xs hover:opacity-90 active:scale-95 transition-all text-[11px]"
          on:click={(e) => {
            e.stopPropagation();
            dispatch('openDrawer', item);
          }}
        >
          <Icon icon="material-symbols:chrome-reader-mode-outline-rounded" class="text-xs" />
          <span>阅读讲义</span>
        </button>
      {/if}
    </div>
  </div>
</div>
