<script lang="ts">
import { onMount } from "svelte";
import {
	type ComicCacheInfo,
	type ComicCacheTarget,
	readComicCacheInfo,
} from "../../utils/comic-cache";
import { comicCacheTarget } from "../../utils/comic-cache-state";

let target: ComicCacheTarget | null = null;
let info: ComicCacheInfo | null = null;
let loading = false;
let error = "";
let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;
let generation = 0;

async function inspectCache() {
	if (!target) return;
	const url = target.url;
	const request = ++generation;
	controller?.abort();
	const active = new AbortController();
	controller = active;
	loading = true;
	error = "";
	const timeout = setTimeout(() => active.abort(), 10000);
	const started = performance.now();
	try {
		const response = await fetch(url, {
			method: "HEAD",
			credentials: "omit",
			signal: active.signal,
		});
		if (request === generation) {
			info = readComicCacheInfo(response, performance.now() - started);
		}
	} catch {
		if (request === generation) {
			info = null;
			error = "暂时无法读取响应头，请稍后重试。";
		}
	} finally {
		clearTimeout(timeout);
		if (request === generation) loading = false;
	}
}

onMount(() => {
	const unsubscribe = comicCacheTarget.subscribe((next) => {
		const changed = target?.url !== next?.url;
		target = next;
		if (!changed) return;
		generation++;
		controller?.abort();
		clearTimeout(timer);
		info = null;
		error = "";
		loading = !!next;
		if (next) timer = setTimeout(() => void inspectCache(), 600);
	});
	return () => {
		generation++;
		unsubscribe();
		clearTimeout(timer);
		controller?.abort();
	};
});
</script>

{#if target}
	<section class="card-base rounded-2xl p-4 space-y-3 text-xs" aria-label="漫画缓存状态">
		<div class="flex items-center justify-between gap-2">
			<h2 class="font-bold text-sm text-black/85 dark:text-white/85">漫画缓存状态</h2>
			<button type="button" on:click={() => void inspectCache()} disabled={loading} class="rounded-lg px-2 py-1 text-[var(--primary)] hover:bg-[var(--primary)]/10 disabled:opacity-50">刷新</button>
		</div>
		<p class="text-black/60 dark:text-white/60">{target.source} · 第 {target.page} 页</p>
		<p class="break-words text-black/50 dark:text-white/50">{target.title}</p>
		<div aria-live="polite" class="font-semibold" class:text-green-600={info?.hit === true} class:text-amber-600={info?.hit === false}>
			{loading ? "正在检查…" : error || info?.status || "等待检查"}
		</div>
		{#if info && !loading}
			<dl class="space-y-2 text-black/65 dark:text-white/65">
				<div class="flex justify-between gap-2"><dt>HTTP 状态</dt><dd>{info.httpStatus}</dd></div>
				<div class="flex justify-between gap-2"><dt>检查耗时</dt><dd>{info.durationMs} ms</dd></div>
				<div class="flex justify-between gap-2"><dt>检查时间</dt><dd>{new Date(info.checkedAt).toLocaleTimeString()}</dd></div>
				{#each info.headers as header (header.name)}
					<div class="space-y-0.5"><dt class="font-mono text-[10px] text-black/45 dark:text-white/45">{header.name}</dt><dd class="break-all font-mono text-[11px]">{header.value}{header.name === "Age" ? " 秒" : ""}</dd></div>
				{/each}
			</dl>
		{/if}
		<a href={target.url} target="_blank" rel="noopener noreferrer" class="block break-all text-[var(--primary)] hover:underline">{new URL(target.url).host}</a>
		<p class="text-[10px] leading-relaxed text-black/45 dark:text-white/45">检查当前页图片的 HEAD 响应，不下载图片正文。结果对应本次检查，可能复用浏览器缓存；未公开缓存头时显示未知。</p>
	</section>
{/if}
