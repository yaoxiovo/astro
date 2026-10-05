<script lang="ts">
import type {
	DiffResult,
	WikiPostHistory,
	WikiRevision,
} from "../../types/wiki";
import { generateWikiDiff } from "../../utils/wiki-diff";
import WikiDiffViewer from "./WikiDiffViewer.svelte";

export let history: WikiPostHistory;
export let slug: string;
export let standalone = false;

let revisions: WikiRevision[] = history?.revisions || [];

// 初始默认选中：Radio B (新版本) 选第 0 项(最新)，Radio A (旧版本) 选第 1 项(次新)
let selectedNewIndex = 0;
let selectedOldIndex = revisions.length > 1 ? 1 : 0;

let isComparing = false;
let isLoadingDiff = false;
let diffResult: DiffResult | null = null;
let diffContainerEl: HTMLDivElement | null = null;

// 处理 Radio A (旧版本，左列) 点击
function handleOldSelect(idx: number) {
	selectedOldIndex = idx;
	// 约束：Radio B (新版本) 必须在更上方（index 更小，时间更晚）
	if (selectedNewIndex >= idx) {
		selectedNewIndex = Math.max(0, idx - 1);
	}
}

// 处理 Radio B (新版本，右列) 点击
function handleNewSelect(idx: number) {
	selectedNewIndex = idx;
	// 约束：Radio A (旧版本) 必须在更下方（index 更大，时间更早）
	if (selectedOldIndex <= idx) {
		selectedOldIndex = Math.min(revisions.length - 1, idx + 1);
	}
}

// 异步加载快照并生成差异比对
async function performDiff(oldIdx: number, newIdx: number) {
	if (revisions.length === 0) return;
	const oldRev = revisions[oldIdx];
	const newRev = revisions[newIdx];
	if (!oldRev || !newRev) return;

	isLoadingDiff = true;
	isComparing = true;

	try {
		// 并行获取两个版本的 Markdown 快照
		const [oldRes, newRes] = await Promise.all([
			fetch(`/api/wiki/snapshots/${slug}/${oldRev.shortSha}.json`),
			fetch(`/api/wiki/snapshots/${slug}/${newRev.shortSha}.json`),
		]);

		if (!oldRes.ok || !newRes.ok) {
			throw new Error("无法读取指定快照数据");
		}

		const oldData = await oldRes.json();
		const newData = await newRes.json();

		diffResult = generateWikiDiff(
			oldData.content || "",
			newData.content || "",
			{
				oldSha: oldRev.sha,
				newSha: newRev.sha,
				contextLines: 3,
			},
		);

		// 平滑滚动至比对区
		setTimeout(() => {
			diffContainerEl?.scrollIntoView({ behavior: "smooth", block: "start" });
		}, 50);
	} catch (err) {
		console.error("[WikiDiff Error]", err);
		alert("获取版本内容失败，请检查网络或构建产物 喵~");
		isComparing = false;
	} finally {
		isLoadingDiff = false;
	}
}

// 点击顶部“比较所选版本”按钮
function compareSelected() {
	performDiff(selectedOldIndex, selectedNewIndex);
}

// 快捷点击：与当前最新版本比对 (cur)
function compareWithCurrent(idx: number) {
	selectedNewIndex = 0;
	selectedOldIndex = idx;
	performDiff(idx, 0);
}

// 快捷点击：与上一版本比对 (prev)
function compareWithPrevious(idx: number) {
	if (idx >= revisions.length - 1) return;
	selectedNewIndex = idx;
	selectedOldIndex = idx + 1;
	performDiff(idx + 1, idx);
}

function closeDiff() {
	isComparing = false;
	diffResult = null;
}
</script>

<div class="wiki-history-wrapper w-full">
	<!-- 差异比对容器锚点 -->
	<div bind:this={diffContainerEl}></div>

	{#if isComparing}
		{#if isLoadingDiff}
			<div class="p-8 mb-6 rounded-2xl border border-[var(--line-divider)] bg-[var(--card-bg)] text-center">
				<div class="inline-block w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mb-2"></div>
				<div class="text-xs text-black/50 dark:text-white/50">正在提取快照并计算词级差异 (Intraline Diff)... 喵~</div>
			</div>
		{:else if diffResult}
			<WikiDiffViewer
				{diffResult}
				oldTitle={revisions[selectedOldIndex]?.message}
				newTitle={revisions[selectedNewIndex]?.message}
				oldDate={revisions[selectedOldIndex]?.displayDate}
				newDate={revisions[selectedNewIndex]?.displayDate}
				oldAuthor={revisions[selectedOldIndex]?.author}
				newAuthor={revisions[selectedNewIndex]?.author}
				oldMessage={revisions[selectedOldIndex]?.cleanMessage}
				newMessage={revisions[selectedNewIndex]?.cleanMessage}
				oldSha={revisions[selectedOldIndex]?.sha}
				newSha={revisions[selectedNewIndex]?.sha}
				{slug}
				onClose={closeDiff}
			/>
		{/if}
	{/if}

	<!-- 维基百科经典控制栏 -->
	<div class="flex flex-wrap items-center justify-between gap-3 mb-4">
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--primary)] text-white hover:opacity-90 active:scale-95 transition-all shadow-sm disabled:opacity-50"
				disabled={revisions.length < 2 || isLoadingDiff}
				on:click={compareSelected}
			>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path>
				</svg>
				<span>比较所选版本 (Compare)</span>
			</button>

			<span class="text-xs text-black/50 dark:text-white/50">
				共 <strong class="text-black/80 dark:text-white/80">{revisions.length}</strong> 次修订版本
			</span>
		</div>

		{#if !standalone}
			<a
				href={`/posts/${slug}/history/`}
				class="text-xs text-[var(--primary)] hover:underline inline-flex items-center gap-1 font-medium"
			>
				<span>在新页面打开全功能维基历史</span>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
				</svg>
			</a>
		{/if}
	</div>

	<!-- 维基百科经典历史版本列表表格 -->
	<div class="overflow-x-auto border border-[var(--line-divider)] rounded-xl bg-black/[0.01] dark:bg-white/[0.01]">
		<table class="w-full text-left text-xs border-collapse">
			<thead>
				<tr class="border-b border-[var(--line-divider)] bg-black/[0.03] dark:bg-white/[0.03] text-black/60 dark:text-white/60 font-semibold select-none">
					<th class="py-2.5 px-3 w-16 text-center">快捷对比</th>
					<th class="py-2.5 px-2 w-16 text-center" title="左列选基准旧版本，右列选目标新版本">比对单选</th>
					<th class="py-2.5 px-3 min-w-[160px]">修订时间 (快照永久链)</th>
					<th class="py-2.5 px-3 w-28">贡献者</th>
					<th class="py-2.5 px-3 w-28">体量变化</th>
					<th class="py-2.5 px-3">编辑摘要 / Git Commit 记录</th>
					<th class="py-2.5 px-3 w-16 text-center">Git</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-[var(--line-divider)]/40">
				{#each revisions as rev, idx}
					<tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors {idx === selectedNewIndex || idx === selectedOldIndex ? 'bg-[var(--primary)]/[0.04]' : ''}">
						<!-- 快捷对比超链接 (当前 | 上一) -->
						<td class="py-2.5 px-3 text-center text-[11px] whitespace-nowrap text-black/40 dark:text-white/40 font-sans select-none">
							<span class="text-black/30 dark:text-white/30">(</span>
							{#if idx === 0}
								<span class="text-black/30 dark:text-white/30 cursor-not-allowed">当前</span>
							{:else}
								<button
									type="button"
									class="text-[var(--primary)] hover:underline cursor-pointer"
									title="与当前最新版本比对"
									on:click={() => compareWithCurrent(idx)}
								>
									当前
								</button>
							{/if}
							<span class="text-black/30 dark:text-white/30"> | </span>
							{#if idx === revisions.length - 1}
								<span class="text-black/30 dark:text-white/30 cursor-not-allowed">上一</span>
							{:else}
								<button
									type="button"
									class="text-[var(--primary)] hover:underline cursor-pointer"
									title="与紧挨的上一个历史版本比对"
									on:click={() => compareWithPrevious(idx)}
								>
									上一
								</button>
							{/if}
							<span class="text-black/30 dark:text-white/30">)</span>
						</td>

						<!-- 维基百科经典双单选框 (Radio A: 旧版, Radio B: 新版) -->
						<td class="py-2.5 px-2 text-center whitespace-nowrap select-none">
							<div class="inline-flex items-center gap-1.5">
								<!-- 左列 Radio A (旧版本)：最新的一行不需要 Radio A -->
								{#if idx === 0}
									<span class="w-3.5 h-3.5 inline-block"></span>
								{:else}
									<input
										type="radio"
										name="wiki-radio-old"
										class="w-3.5 h-3.5 text-[var(--primary)] cursor-pointer accent-[var(--primary)]"
										checked={selectedOldIndex === idx}
										on:change={() => handleOldSelect(idx)}
										title="以此旧版本作为对比基准"
									/>
								{/if}

								<!-- 右列 Radio B (新版本)：最旧的一行不需要 Radio B -->
								{#if idx === revisions.length - 1}
									<span class="w-3.5 h-3.5 inline-block"></span>
								{:else}
									<input
										type="radio"
										name="wiki-radio-new"
										class="w-3.5 h-3.5 text-[var(--primary)] cursor-pointer accent-[var(--primary)]"
										checked={selectedNewIndex === idx}
										on:change={() => handleNewSelect(idx)}
										title="以此新版本作为对比目标"
									/>
								{/if}
							</div>
						</td>

						<!-- 修订时间与快照永久链接 -->
						<td class="py-2.5 px-3 whitespace-nowrap">
							<a
								href={`/posts/${slug}/revision/${rev.shortSha}/`}
								class="font-medium text-[var(--primary)] hover:underline inline-flex items-center gap-1"
								title="查看当时文章的完整渲染快照"
							>
								<span>{rev.displayDate}</span>
							</a>
						</td>

						<!-- 贡献者 -->
						<td class="py-2.5 px-3 whitespace-nowrap">
							<div class="flex items-center gap-1.5 text-black/80 dark:text-white/80">
								<div class="w-4 h-4 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center text-[9px] font-bold">
									{rev.author.slice(0, 1).toUpperCase()}
								</div>
								<span class="font-medium truncate max-w-[80px]" title={rev.author}>{rev.author}</span>
							</div>
						</td>

						<!-- 字节大小与增减统计 -->
						<td class="py-2.5 px-3 whitespace-nowrap font-mono text-[11px]">
							<span class="text-black/50 dark:text-white/50">{rev.byteSize.toLocaleString()} 字节</span>
							{#if rev.byteDelta > 0}
								<span class="ml-1 text-emerald-600 dark:text-emerald-400 {Math.abs(rev.byteDelta) >= 500 ? 'font-bold' : ''}">
									(+{rev.byteDelta})
								</span>
							{:else if rev.byteDelta < 0}
								<span class="ml-1 text-red-600 dark:text-red-400 {Math.abs(rev.byteDelta) >= 500 ? 'font-bold' : ''}">
									({rev.byteDelta})
								</span>
							{:else}
								<span class="ml-1 text-black/30 dark:text-white/30 font-normal">(0)</span>
							{/if}
						</td>

						<!-- 编辑摘要与 Flag 标签 -->
						<td class="py-2.5 px-3">
							<div class="flex flex-wrap items-center gap-1.5">
								<!-- 维基 Flag 标签 -->
								{#each rev.tags as tag}
									<span class="px-1.5 py-0.2 rounded text-[10px] font-mono {tag === '小修改' ? 'bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50' : 'bg-[var(--primary)]/10 text-[var(--primary)] font-semibold'}">
										{tag}
									</span>
								{/each}

								<!-- 章节锚点标记 /* 章节名 */ -->
								{#if rev.section}
									<span class="font-mono text-black/50 dark:text-white/50 bg-black/5 dark:bg-white/5 px-1 rounded text-[11px]">
										/* {rev.section} */
									</span>
								{/if}

								<!-- 净化后的提交说明 -->
								<span class="text-black/85 dark:text-white/85 line-clamp-1">{rev.cleanMessage}</span>
							</div>
						</td>

						<!-- GitHub Commit 链接 -->
						<td class="py-2.5 px-3 text-center whitespace-nowrap">
							{#if rev.diffUrl}
								<a
									href={rev.diffUrl}
									target="_blank"
									rel="noopener noreferrer"
									class="font-mono text-[11px] text-black/40 hover:text-[var(--primary)] dark:text-white/40 dark:hover:text-[var(--primary)] transition-colors inline-flex items-center gap-0.5"
									title={`在 GitHub 查看提交 ${rev.shortSha}`}
								>
									<span>{rev.shortSha}</span>
								</a>
							{:else}
								<span class="font-mono text-[11px] text-black/30">{rev.shortSha}</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- 底部同样放置比较按钮，符合维基百科超长列表的操作规范 -->
	{#if revisions.length > 5}
		<div class="mt-4 flex items-center justify-between">
			<button
				type="button"
				class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--primary)] text-white hover:opacity-90 active:scale-95 transition-all shadow-sm disabled:opacity-50"
				disabled={revisions.length < 2 || isLoadingDiff}
				on:click={compareSelected}
			>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path>
				</svg>
				<span>比较所选版本 (Compare)</span>
			</button>
		</div>
	{/if}
</div>
