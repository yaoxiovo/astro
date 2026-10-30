<script lang="ts">
import Icon from "@iconify/svelte";
import { createEventDispatcher, onDestroy, onMount } from "svelte";
import {
	SUBJECT_METAS,
	type TextbookItem,
	type TextbookSubjectId,
} from "../../types/textbook";

export let item: TextbookItem;
export let allImageItems: TextbookItem[] = [];

const dispatch = createEventDispatcher<{
	close: undefined;
	showToast: string;
	navigate: TextbookItem;
}>();

let zoomScale = 1;
let isDragging = false;
let startX = 0;
let startY = 0;
let translateX = 0;
let translateY = 0;
let imgLoading = true;
let imgError = false;
let copySuccess = false;

$: targetUrl = item.imageUrl || item.coverImage || "";
$: subjectMeta = SUBJECT_METAS[item.subject as TextbookSubjectId] || {
	label: item.subjectLabel,
	icon: "material-symbols:book-2-outline",
	color: "text-blue-500",
	borderClass: "border-blue-500/20",
	badgeClass: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
};

$: currentIndex = allImageItems.findIndex((it) => it.id === item.id);
$: hasPrev = currentIndex > 0;
$: hasNext = currentIndex >= 0 && currentIndex < allImageItems.length - 1;

const resetTransform = () => {
	zoomScale = 1;
	translateX = 0;
	translateY = 0;
	imgLoading = true;
	imgError = false;
};

$: if (item) {
	resetTransform();
}

const handleZoomIn = () => {
	zoomScale = Math.min(zoomScale + 0.25, 3.5);
};

const handleZoomOut = () => {
	zoomScale = Math.max(zoomScale - 0.25, 0.5);
};

const handleResetZoom = () => {
	zoomScale = 1;
	translateX = 0;
	translateY = 0;
};

const handleImageLoad = () => {
	imgLoading = false;
	imgError = false;
};

const handleImageError = () => {
	imgLoading = false;
	imgError = true;
};

const retryLoad = () => {
	imgLoading = true;
	imgError = false;
	// 增加防缓存时间戳参数重试
	const separator = targetUrl.includes("?") ? "&" : "?";
	targetUrl = `${targetUrl}${separator}_retry=${Date.now()}`;
};

const copyImageUrl = async () => {
	if (!targetUrl) return;
	try {
		await navigator.clipboard.writeText(targetUrl);
		copySuccess = true;
		dispatch("showToast", "已复制高清图片外链！");
		setTimeout(() => {
			copySuccess = false;
		}, 2000);
	} catch (e) {
		dispatch("showToast", "复制失败，请手动在浏览器地址栏复制");
	}
};

const openInNewTab = () => {
	if (targetUrl) {
		window.open(targetUrl, "_blank", "noopener,noreferrer");
	}
};

const handlePrev = () => {
	if (hasPrev) {
		dispatch("navigate", allImageItems[currentIndex - 1]);
	}
};

const handleNext = () => {
	if (hasNext) {
		dispatch("navigate", allImageItems[currentIndex + 1]);
	}
};

const handleKeyDown = (e: KeyboardEvent) => {
	if (e.key === "Escape") {
		dispatch("close");
	} else if (e.key === "ArrowLeft") {
		handlePrev();
	} else if (e.key === "ArrowRight") {
		handleNext();
	} else if (e.key === "+" || e.key === "=") {
		handleZoomIn();
	} else if (e.key === "-") {
		handleZoomOut();
	} else if (e.key === "0") {
		handleResetZoom();
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

<!-- 全屏浮层容器 -->
<div
  class="fixed inset-0 z-50 flex flex-col justify-between bg-black/85 backdrop-blur-md text-white select-none animate-fadeIn"
  role="dialog"
  aria-modal="true"
>
  <!-- 顶栏：信息与工具控制 -->
  <div class="relative z-10 flex items-center justify-between px-4 py-3 bg-black/40 backdrop-blur-lg border-b border-white/10 gap-2">
    <div class="flex items-center gap-2.5 min-w-0">
      <div class="flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full border border-white/20 bg-white/10 shrink-0">
        <Icon icon={subjectMeta.icon} class="text-sm {subjectMeta.color}" />
        <span>{subjectMeta.label}</span>
      </div>

      <div class="truncate">
        <h2 class="text-sm md:text-base font-bold truncate text-white/95">
          {item.title}
        </h2>
        <p class="text-[11px] text-white/50 truncate">
          {item.grade} · {item.chapter}
        </p>
      </div>
    </div>

    <!-- 右侧工具按钮组 -->
    <div class="flex items-center gap-1 sm:gap-2 shrink-0">
      <!-- 缩放控制组 -->
      <div class="hidden sm:flex items-center bg-white/10 rounded-lg p-0.5 border border-white/15 text-xs">
        <button
          type="button"
          class="p-1.5 hover:bg-white/15 rounded-md transition-colors"
          title="缩小 (-)"
          on:click={handleZoomOut}
        >
          <Icon icon="material-symbols:zoom-out-rounded" class="text-base" />
        </button>
        <span class="px-2 font-mono text-[11px] text-white/75 min-w-[3rem] text-center">
          {Math.round(zoomScale * 100)}%
        </span>
        <button
          type="button"
          class="p-1.5 hover:bg-white/15 rounded-md transition-colors"
          title="放大 (+)"
          on:click={handleZoomIn}
        >
          <Icon icon="material-symbols:zoom-in-rounded" class="text-base" />
        </button>
        <button
          type="button"
          class="px-2 py-1 hover:bg-white/15 rounded-md text-[11px] text-white/80 transition-colors"
          title="还原比例 (0)"
          on:click={handleResetZoom}
        >
          1:1
        </button>
      </div>

      <!-- 复制外链按钮 -->
      <button
        type="button"
        class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium border border-white/15 transition-colors"
        title="复制高清图片外链"
        on:click={copyImageUrl}
      >
        <Icon icon={copySuccess ? "material-symbols:check-small-rounded" : "material-symbols:content-copy-outline-rounded"} class="text-sm" />
        <span class="hidden md:inline">{copySuccess ? '已复制外链' : '复制外链'}</span>
      </button>

      <!-- 新窗口打开原图 -->
      <button
        type="button"
        class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium border border-white/15 transition-colors"
        title="在新窗口打开原图 (防盗链时有效)"
        on:click={openInNewTab}
      >
        <Icon icon="material-symbols:open-in-new-rounded" class="text-sm" />
        <span class="hidden md:inline">原图直链</span>
      </button>

      <!-- 关闭按钮 -->
      <button
        type="button"
        class="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 active:scale-95 transition-all text-white/90"
        title="关闭浮层 (ESC)"
        on:click={() => dispatch('close')}
      >
        <Icon icon="material-symbols:close-rounded" class="text-xl" />
      </button>
    </div>
  </div>

  <!-- 主体视图区域 -->
  <div
    class="relative flex-1 flex items-center justify-center overflow-hidden p-4 md:p-8"
    on:click={(e) => {
      // 点击背景遮罩关闭
      if (e.target === e.currentTarget) dispatch('close');
    }}
  >
    <!-- 左切换按钮 -->
    {#if hasPrev}
      <button
        type="button"
        class="absolute left-3 md:left-6 z-20 w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/50 hover:bg-black/75 border border-white/20 text-white flex items-center justify-center backdrop-blur-md transition-all active:scale-95"
        title="上一张 (←)"
        on:click={handlePrev}
      >
        <Icon icon="material-symbols:chevron-left-rounded" class="text-2xl" />
      </button>
    {/if}

    <!-- 右切换按钮 -->
    {#if hasNext}
      <button
        type="button"
        class="absolute right-3 md:right-6 z-20 w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/50 hover:bg-black/75 border border-white/20 text-white flex items-center justify-center backdrop-blur-md transition-all active:scale-95"
        title="下一张 (→)"
        on:click={handleNext}
      >
        <Icon icon="material-symbols:chevron-right-rounded" class="text-2xl" />
      </button>
    {/if}

    <!-- 加载中动画 -->
    {#if imgLoading && !imgError}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 pointer-events-none">
        <div class="w-10 h-10 border-3 border-white/20 border-t-[var(--primary)] rounded-full animate-spin"></div>
        <p class="text-xs text-white/60">正在载入高清图解与思维导图...</p>
      </div>
    {/if}

    <!-- 图片加载失败 / 防盗链降级提示面板 -->
    {#if imgError}
      <div class="max-w-md w-full bg-black/60 border border-amber-500/40 rounded-2xl p-6 text-center backdrop-blur-xl shadow-2xl z-20 animate-fadeIn">
        <div class="w-12 h-12 mx-auto rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mb-3">
          <Icon icon="material-symbols:broken-image-outline-rounded" class="text-2xl" />
        </div>
        <h3 class="text-base font-bold text-white mb-1">
          外链图片加载受阻
        </h3>
        <p class="text-xs text-white/70 leading-relaxed mb-4">
          该图片源站可能启用了 Referer 防盗链校验、跨域限制或暂时不可达。您可以点击下方按钮在新标签页直接打开或重试。
        </p>

        <div class="bg-black/40 rounded-lg p-2.5 mb-4 text-left font-mono text-[11px] text-white/60 break-all select-all border border-white/10">
          {targetUrl}
        </div>

        <div class="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white dark:text-black font-semibold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
            on:click={openInNewTab}
          >
            <Icon icon="material-symbols:open-in-new-rounded" class="text-sm" />
            在新标签页直接打开
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium text-xs flex items-center gap-1.5 transition-colors"
            on:click={retryLoad}
          >
            <Icon icon="material-symbols:refresh-rounded" class="text-sm" />
            重试加载
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium text-xs flex items-center gap-1.5 transition-colors"
            on:click={copyImageUrl}
          >
            <Icon icon="material-symbols:content-copy-outline-rounded" class="text-sm" />
            复制外链
          </button>
        </div>
      </div>
    {/if}

    <!-- 真实大图渲染 -->
    <div
      class="max-w-full max-h-full flex items-center justify-center transition-transform duration-200"
      style="transform: scale({zoomScale}) translate({translateX}px, {translateY}px); cursor: {zoomScale > 1 ? 'grab' : 'zoom-in'};"
      on:click={() => {
        if (zoomScale === 1) {
          zoomScale = 1.6;
        } else {
          handleResetZoom();
        }
      }}
    >
      <img
        src={targetUrl}
        alt={item.title}
        class="max-w-[90vw] max-h-[75vh] object-contain rounded-lg shadow-2xl transition-opacity duration-300 {imgLoading ? 'opacity-0' : 'opacity-100'} {imgError ? 'hidden' : 'block'}"
        on:load={handleImageLoad}
        on:error={handleImageError}
      />
    </div>
  </div>

  <!-- 底栏：核心知识点考点提要与键盘快捷键 -->
  <div class="relative z-10 px-4 py-2.5 bg-black/40 backdrop-blur-lg border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-white/60">
    <div class="flex items-center gap-2 overflow-x-auto max-w-full">
      {#if item.keyPoints && item.keyPoints.length > 0}
        <span class="text-amber-300 font-semibold text-[11px] shrink-0 flex items-center gap-1">
          <Icon icon="material-symbols:lightbulb-outline-rounded" class="text-xs" />
          知识要点：
        </span>
        <div class="text-[11px] text-white/80 truncate">
          {item.keyPoints.join(' ； ')}
        </div>
      {:else}
        <span class="text-[11px] text-white/70 truncate">{item.summary}</span>
      {/if}
    </div>

    <div class="hidden sm:flex items-center gap-3 text-[11px] text-white/40 shrink-0">
      <span>ESC 退出</span>
      <span>← / → 翻页</span>
      <span>+/- 缩放</span>
      <span>双击/单击 缩放</span>
    </div>
  </div>
</div>

<style>
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .animate-fadeIn {
    animation: fadeIn 0.2s ease-out forwards;
  }
</style>
