<script lang="ts">
import type { DiffChunk, DiffLine, DiffResult } from "../../types/wiki";
import { renderTokensToHtml } from "../../utils/wiki-diff";

export let diffResult: DiffResult;
export let oldTitle = "旧版本";
export let newTitle = "新版本";
export let oldDate = "";
export let newDate = "";
export let oldAuthor = "";
export let newAuthor = "";
export let oldMessage = "";
export let newMessage = "";
export let oldSha = "";
export let newSha = "";
export let slug = "";
export let onClose: (() => void) | undefined = undefined;
export let deltaInfo:
	| {
			isDeltaHit?: boolean;
			patchSize?: number;
			compressionRatio?: string;
			loadDurationMs?: number;
	  }
	| undefined = undefined;
// 相邻版本时传入逆向回滚补丁地址（新版本 → 旧版本，RFC 6902）
export let rollbackPatchUrl = "";

let viewMode: "side-by-side" | "inline" = "side-by-side";
let expandAllContext = false;
let copiedLink = false;

function toggleViewMode(mode: "side-by-side" | "inline") {
	viewMode = mode;
}

async function copyPermalink() {
	try {
		await navigator.clipboard.writeText(window.location.href);
		copiedLink = true;
		setTimeout(() => {
			copiedLink = false;
		}, 1500);
	} catch {
		alert("复制失败，请手动复制地址栏链接 喵~");
	}
}

function toggleExpandContext() {
	expandAllContext = !expandAllContext;
}
</script>

<div class="wiki-diff-viewer rounded-2xl border border-[var(--line-divider)] bg-[var(--card-bg)] shadow-xl overflow-hidden mb-6 transition-all">
	<!-- 顶部标题与控制栏 -->
	<div class="px-5 py-4 bg-black/[0.03] dark:bg-white/[0.03] border-b border-[var(--line-divider)] flex flex-wrap items-center justify-between gap-3">
		<div class="flex flex-wrap items-center gap-2">
			<div class="w-2.5 h-2.5 rounded-full bg-[var(--primary)] animate-pulse"></div>
			<span class="text-sm font-bold text-black/90 dark:text-white/90">维基版本差异对比 (Wikipedia Diff)</span>
			<span class="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono font-semibold">
				+{diffResult.stats.added}
			</span>
			<span class="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 font-mono font-semibold">
				-{diffResult.stats.deleted}
			</span>

			{#if deltaInfo?.isDeltaHit}
				<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 font-mono text-[11px] font-medium border border-violet-500/20 shadow-sm" title="命中相邻版本增量差分补丁，实现秒级原地热更新">
					<span class="w-1.5 h-1.5 rounded-full bg-violet-500 animate-ping"></span>
					<span>⚡ RFC 6902 热补丁 ({deltaInfo.patchSize || 0} B · 节省 {deltaInfo.compressionRatio || '90%'} · {deltaInfo.loadDurationMs}ms)</span>
				</span>
			{/if}
		</div>

		<div class="flex items-center gap-2 text-xs">
			<!-- 视图切换 -->
			<div class="inline-flex rounded-lg p-0.5 bg-black/5 dark:bg-white/10 font-medium">
				<button
					type="button"
					class="px-2.5 py-1 rounded-md transition-all {viewMode === 'side-by-side' ? 'bg-white dark:bg-black/40 text-[var(--primary)] shadow-sm font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'}"
					on:click={() => toggleViewMode("side-by-side")}
				>
					双栏并排 (Side-by-side)
				</button>
				<button
					type="button"
					class="px-2.5 py-1 rounded-md transition-all {viewMode === 'inline' ? 'bg-white dark:bg-black/40 text-[var(--primary)] shadow-sm font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'}"
					on:click={() => toggleViewMode("inline")}
				>
					单栏行内 (Inline)
				</button>
			</div>

			<button
				type="button"
				class="px-2.5 py-1 rounded-lg font-medium border border-[var(--line-divider)] text-black/60 dark:text-white/60 hover:text-[var(--primary)] hover:border-[var(--primary)]/40 transition-colors"
				title="复制当前对比的深链地址（可直接分享或收藏）"
				on:click={copyPermalink}
			>
				{copiedLink ? "已复制 ✓" : "复制链接"}
			</button>

			{#if rollbackPatchUrl}
				<a
					href={rollbackPatchUrl}
					download
					class="px-2.5 py-1 rounded-lg font-medium border border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition-colors"
					title="下载 RFC 6902 逆向回滚补丁（可将新版本还原为旧版本）"
				>
					回滚补丁
				</a>
			{/if}

			{#if onClose}
				<button
					type="button"
					class="p-1 rounded-lg text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
					title="关闭对比"
					on:click={onClose}
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
					</svg>
				</button>
			{/if}
		</div>
	</div>

	<!-- 维基百科经典两栏表头 -->
	<div class="grid grid-cols-1 md:grid-cols-2 border-b border-[var(--line-divider)] divide-y md:divide-y-0 md:divide-x divide-[var(--line-divider)] bg-black/[0.01] dark:bg-white/[0.01]">
		<!-- 左侧：旧版本 -->
		<div class="p-3.5 flex flex-col justify-between text-xs">
			<div>
				<div class="flex items-center gap-1.5 font-bold text-red-600 dark:text-red-400 mb-1">
					<span>← 基准旧版本</span>
					{#if oldSha}
						<span class="font-mono text-[11px] px-1 py-0.2 rounded bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60">
							{oldSha.slice(0, 7)}
						</span>
					{/if}
				</div>
				<div class="text-black/70 dark:text-white/70 line-clamp-1 font-medium">{oldMessage || oldTitle}</div>
				{#if oldDate}
					<div class="text-[11px] text-black/40 dark:text-white/40 mt-1">
						{oldDate} · 提交者: <span class="font-medium text-black/60 dark:text-white/60">{oldAuthor}</span>
					</div>
				{/if}
			</div>
			{#if slug && oldSha}
				<div class="mt-2 pt-2 border-t border-[var(--line-divider)]/40 flex items-center justify-between text-[11px]">
					<a href={`/posts/${slug}/revision/${oldSha.slice(0, 7)}/`} class="text-[var(--primary)] hover:underline">
						查看此版本完整快照 →
					</a>
				</div>
			{/if}
		</div>

		<!-- 右侧：新版本 -->
		<div class="p-3.5 flex flex-col justify-between text-xs">
			<div>
				<div class="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400 mb-1">
					<span>新版本 (修改后) →</span>
					{#if newSha}
						<span class="font-mono text-[11px] px-1 py-0.2 rounded bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60">
							{newSha.slice(0, 7)}
						</span>
					{/if}
				</div>
				<div class="text-black/70 dark:text-white/70 line-clamp-1 font-medium">{newMessage || newTitle}</div>
				{#if newDate}
					<div class="text-[11px] text-black/40 dark:text-white/40 mt-1">
						{newDate} · 提交者: <span class="font-medium text-black/60 dark:text-white/60">{newAuthor}</span>
					</div>
				{/if}
			</div>
			{#if slug && newSha}
				<div class="mt-2 pt-2 border-t border-[var(--line-divider)]/40 flex items-center justify-between text-[11px]">
					<a href={`/posts/${slug}/revision/${newSha.slice(0, 7)}/`} class="text-[var(--primary)] hover:underline">
						查看此版本完整快照 →
					</a>
				</div>
			{/if}
		</div>
	</div>

	<!-- 差异内容区 -->
	<div class="overflow-x-auto font-mono text-[12px] leading-relaxed select-text">
		{#if diffResult.chunks.length === 0}
			<div class="py-12 text-center text-black/40 dark:text-white/40 text-xs">
				两个选中的版本完全一致，没有发生文字改动 喵~
			</div>
		{:else}
			{#if viewMode === 'side-by-side'}
				<!-- 经典双栏并排 (Side-by-side) -->
				<table class="w-full border-collapse table-fixed">
					<colgroup>
						<col class="w-10" />
						<col class="w-5" />
						<col class="w-[calc(50%-3.75rem)]" />
						<col class="w-10" />
						<col class="w-5" />
						<col class="w-[calc(50%-3.75rem)]" />
					</colgroup>
					<tbody>
						{#each diffResult.chunks as chunk, chunkIdx}
							<!-- 分段标记提示行 -->
							<tr class="bg-black/[0.04] dark:bg-white/[0.04] text-[10px] text-black/40 dark:text-white/40 border-y border-[var(--line-divider)] font-sans">
								<td colspan="6" class="px-3 py-1 font-mono">
									@@ 行 {chunk.oldStart} 与 行 {chunk.newStart} @@ (第 {chunkIdx + 1} 个差异段落)
								</td>
							</tr>

							{#each chunk.lines as line}
								{#if line.type === 'same'}
									<tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] border-b border-[var(--line-divider)]/20">
										<td class="text-right px-2 py-0.5 text-black/30 dark:text-white/30 select-none bg-black/[0.01] dark:bg-white/[0.01]">{line.oldLineNo}</td>
										<td class="text-center px-1 py-0.5 text-black/20 select-none"></td>
										<td class="px-2 py-0.5 text-black/75 dark:text-white/75 whitespace-pre-wrap break-all">{line.oldContent}</td>
										<td class="text-right px-2 py-0.5 text-black/30 dark:text-white/30 select-none bg-black/[0.01] dark:bg-white/[0.01] border-l border-[var(--line-divider)]">{line.newLineNo}</td>
										<td class="text-center px-1 py-0.5 text-black/20 select-none"></td>
										<td class="px-2 py-0.5 text-black/75 dark:text-white/75 whitespace-pre-wrap break-all">{line.newContent}</td>
									</tr>
								{:else if line.type === 'modified'}
									<tr class="border-b border-[var(--line-divider)]/40">
										<!-- 左侧：删除 -->
										<td class="text-right px-2 py-0.5 text-red-600/70 dark:text-red-400/70 select-none bg-red-500/10 font-bold">{line.oldLineNo}</td>
										<td class="text-center px-1 py-0.5 text-red-600 dark:text-red-400 font-bold bg-red-500/10 select-none">-</td>
										<td class="px-2 py-0.5 bg-red-500/[0.06] dark:bg-red-500/[0.12] text-black/85 dark:text-white/85 whitespace-pre-wrap break-all">
											{@html renderTokensToHtml(line.oldTokens, line.oldContent)}
										</td>
										<!-- 右侧：新增 -->
										<td class="text-right px-2 py-0.5 text-emerald-600/70 dark:text-emerald-400/70 select-none bg-emerald-500/10 font-bold border-l border-[var(--line-divider)]">{line.newLineNo}</td>
										<td class="text-center px-1 py-0.5 text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-500/10 select-none">+</td>
										<td class="px-2 py-0.5 bg-emerald-500/[0.06] dark:bg-emerald-500/[0.12] text-black/85 dark:text-white/85 whitespace-pre-wrap break-all">
											{@html renderTokensToHtml(line.newTokens, line.newContent)}
										</td>
									</tr>
								{:else if line.type === 'del'}
									<tr class="border-b border-[var(--line-divider)]/40">
										<td class="text-right px-2 py-0.5 text-red-600/70 dark:text-red-400/70 select-none bg-red-500/10 font-bold">{line.oldLineNo}</td>
										<td class="text-center px-1 py-0.5 text-red-600 dark:text-red-400 font-bold bg-red-500/10 select-none">-</td>
										<td class="px-2 py-0.5 bg-red-500/[0.06] dark:bg-red-500/[0.12] text-red-700 dark:text-red-300 whitespace-pre-wrap break-all">
											<del class="no-underline">{line.oldContent}</del>
										</td>
										<td class="text-right px-2 py-0.5 text-black/10 select-none bg-black/[0.01] dark:bg-white/[0.01] border-l border-[var(--line-divider)]"></td>
										<td class="text-center px-1 py-0.5 text-black/10 select-none"></td>
										<td class="px-2 py-0.5 bg-black/[0.01] dark:bg-white/[0.01]"></td>
									</tr>
								{:else if line.type === 'add'}
									<tr class="border-b border-[var(--line-divider)]/40">
										<td class="text-right px-2 py-0.5 text-black/10 select-none bg-black/[0.01] dark:bg-white/[0.01]"></td>
										<td class="text-center px-1 py-0.5 text-black/10 select-none"></td>
										<td class="px-2 py-0.5 bg-black/[0.01] dark:bg-white/[0.01]"></td>
										<td class="text-right px-2 py-0.5 text-emerald-600/70 dark:text-emerald-400/70 select-none bg-emerald-500/10 font-bold border-l border-[var(--line-divider)]">{line.newLineNo}</td>
										<td class="text-center px-1 py-0.5 text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-500/10 select-none">+</td>
										<td class="px-2 py-0.5 bg-emerald-500/[0.06] dark:bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap break-all">
											<ins class="no-underline">{line.newContent}</ins>
										</td>
									</tr>
								{/if}
							{/each}
						{/each}
					</tbody>
				</table>
			{:else}
				<!-- 移动端/单栏行内 (Inline) -->
				<table class="w-full border-collapse table-fixed">
					<colgroup>
						<col class="w-10" />
						<col class="w-10" />
						<col class="w-5" />
						<col class="w-[calc(100%-6.25rem)]" />
					</colgroup>
					<tbody>
						{#each diffResult.chunks as chunk, chunkIdx}
							<tr class="bg-black/[0.04] dark:bg-white/[0.04] text-[10px] text-black/40 dark:text-white/40 border-y border-[var(--line-divider)] font-sans">
								<td colspan="4" class="px-3 py-1 font-mono">
									@@ 行 {chunk.oldStart}, {chunk.newStart} @@ (段落 {chunkIdx + 1})
								</td>
							</tr>
							{#each chunk.lines as line}
								{#if line.type === 'same'}
									<tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] border-b border-[var(--line-divider)]/20">
										<td class="text-right px-2 py-0.5 text-black/30 dark:text-white/30 select-none">{line.oldLineNo}</td>
										<td class="text-right px-2 py-0.5 text-black/30 dark:text-white/30 select-none">{line.newLineNo}</td>
										<td class="text-center px-1 py-0.5 text-black/20 select-none"></td>
										<td class="px-2 py-0.5 text-black/75 dark:text-white/75 whitespace-pre-wrap break-all">{line.oldContent}</td>
									</tr>
								{:else if line.type === 'modified'}
									<!-- 先显示删除行 -->
									<tr class="bg-red-500/[0.06] dark:bg-red-500/[0.12] border-b border-red-500/10">
										<td class="text-right px-2 py-0.5 text-red-600 dark:text-red-400 select-none bg-red-500/10 font-bold">{line.oldLineNo}</td>
										<td class="text-right px-2 py-0.5 select-none"></td>
										<td class="text-center px-1 py-0.5 text-red-600 dark:text-red-400 font-bold bg-red-500/10 select-none">-</td>
										<td class="px-2 py-0.5 text-red-700 dark:text-red-300 whitespace-pre-wrap break-all">
											{@html renderTokensToHtml(line.oldTokens, line.oldContent)}
										</td>
									</tr>
									<!-- 后显示新增行 -->
									<tr class="bg-emerald-500/[0.06] dark:bg-emerald-500/[0.12] border-b border-emerald-500/10">
										<td class="text-right px-2 py-0.5 select-none"></td>
										<td class="text-right px-2 py-0.5 text-emerald-600 dark:text-emerald-400 select-none bg-emerald-500/10 font-bold">{line.newLineNo}</td>
										<td class="text-center px-1 py-0.5 text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-500/10 select-none">+</td>
										<td class="px-2 py-0.5 text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap break-all">
											{@html renderTokensToHtml(line.newTokens, line.newContent)}
										</td>
									</tr>
								{:else if line.type === 'del'}
									<tr class="bg-red-500/[0.06] dark:bg-red-500/[0.12] border-b border-red-500/10">
										<td class="text-right px-2 py-0.5 text-red-600 dark:text-red-400 select-none bg-red-500/10 font-bold">{line.oldLineNo}</td>
										<td class="text-right px-2 py-0.5 select-none"></td>
										<td class="text-center px-1 py-0.5 text-red-600 dark:text-red-400 font-bold bg-red-500/10 select-none">-</td>
										<td class="px-2 py-0.5 text-red-700 dark:text-red-300 whitespace-pre-wrap break-all">
											<del class="no-underline">{line.oldContent}</del>
										</td>
									</tr>
								{:else if line.type === 'add'}
									<tr class="bg-emerald-500/[0.06] dark:bg-emerald-500/[0.12] border-b border-emerald-500/10">
										<td class="text-right px-2 py-0.5 select-none"></td>
										<td class="text-right px-2 py-0.5 text-emerald-600 dark:text-emerald-400 select-none bg-emerald-500/10 font-bold">{line.newLineNo}</td>
										<td class="text-center px-1 py-0.5 text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-500/10 select-none">+</td>
										<td class="px-2 py-0.5 text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap break-all">
											<ins class="no-underline">{line.newContent}</ins>
										</td>
									</tr>
								{/if}
							{/each}
						{/each}
					</tbody>
				</table>
			{/if}
		{/if}
	</div>
</div>
