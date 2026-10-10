<script lang="ts">
import { onMount } from "svelte";

export let title = "";
export let author = "";
export let siteTitle = "";
export let siteUrl = "";
export let slug = "";
export let publishedISO = "";
export let updatedISO = "";
export let revisionShortSha = "";
export let revisionDateISO = "";

interface CitationFormat {
	key: string;
	label: string;
	text: string;
}

let formats: CitationFormat[] = [];
let activeKey = "gb";
let copiedKey: string | null = null;

const EN_MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

interface DateParts {
	year: number;
	month: number;
	day: number;
	ymd: string;
}

function toDateParts(iso: string): DateParts | null {
	if (!iso) return null;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	const year = d.getFullYear();
	const month = d.getMonth() + 1;
	const day = d.getDate();
	return { year, month, day, ymd: `${year}-${pad(month)}-${pad(day)}` };
}

onMount(() => {
	const now = new Date();
	const accessDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

	const revParts = toDateParts(revisionDateISO);
	const pubParts = revParts ??
		toDateParts(publishedISO) ?? {
			year: now.getFullYear(),
			month: 1,
			day: 1,
			ymd: `${now.getFullYear()}-01-01`,
		};
	const updParts = toDateParts(updatedISO) ?? revParts ?? pubParts;

	const pageUrl = revisionShortSha
		? `${siteUrl}/posts/${slug}/revision/${revisionShortSha}/`
		: `${siteUrl}/posts/${slug}/`;

	const citeKey = `${slug.replace(/[^a-zA-Z0-9]/g, "")}${pubParts.year}`;

	formats = [
		{
			key: "gb",
			label: "GB/T 7714",
			text: `${author}. ${title}[EB/OL]. ${siteTitle}. (${pubParts.ymd})[${accessDate}]. ${pageUrl}.`,
		},
		{
			key: "apa",
			label: "APA",
			text: `${author}. (${pubParts.year}, ${EN_MONTHS[pubParts.month - 1]} ${pubParts.day}). ${title}. ${siteTitle}. ${pageUrl}`,
		},
		{
			key: "mla",
			label: "MLA",
			text: `${author}. "${title}." ${siteTitle}, ${pubParts.day} ${EN_MONTHS[pubParts.month - 1]} ${pubParts.year}, ${pageUrl}.`,
		},
		{
			key: "bibtex",
			label: "BibTeX",
			text: [
				`@misc{${citeKey},`,
				`  author       = {${author}},`,
				`  title        = {${title}},`,
				`  year         = {${pubParts.year}},`,
				`  month        = {${EN_MONTHS[pubParts.month - 1].toLowerCase()}},`,
				`  howpublished = {\\url{${pageUrl}}},`,
				`  note         = {发布于 ${pubParts.ymd}${updParts.ymd !== pubParts.ymd ? `，最后更新于 ${updParts.ymd}` : ""}}`,
				"}",
			].join("\n"),
		},
		{
			key: "plain",
			label: "纯文本",
			text: `${author}：《${title}》，${siteTitle}，${pubParts.ymd} 发布${updParts.ymd !== pubParts.ymd ? `，${updParts.ymd} 更新` : ""}。${pageUrl}`,
		},
	];

	activeKey = "gb";
});

$: activeCitation = formats.find((f) => f.key === activeKey)?.text || "";

async function copyText(key: string, text: string) {
	if (!text) return;
	try {
		await navigator.clipboard.writeText(text);
		copiedKey = key;
		setTimeout(() => {
			if (copiedKey === key) copiedKey = null;
		}, 1500);
	} catch {
		alert("复制失败，请手动选中文本复制 喵~");
	}
}
</script>

<div class="mb-6 p-5 rounded-2xl border border-[var(--line-divider)] bg-black/[0.02] dark:bg-white/[0.02] shadow-sm onload-animation">
	<div class="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-[var(--line-divider)]">
		<div class="flex items-center gap-2">
			<span class="w-5 h-5 rounded-md bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
				<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
				</svg>
			</span>
			<h3 class="text-sm font-bold text-black/90 dark:text-white/90">引用此文 (Cite this article)</h3>
			{#if revisionShortSha}
				<span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400" title="引用将永久指向该历史修订版本">
					已固定版本 {revisionShortSha}
				</span>
			{/if}
		</div>
		<span class="text-[11px] text-black/40 dark:text-white/40">遵循维基百科引用规范 · 支持一键复制</span>
	</div>

	<!-- 引用格式切换 -->
	<div class="flex flex-wrap items-center gap-1.5 mb-3">
		{#each formats as format}
			<button
				type="button"
				class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all {activeKey === format.key ? 'bg-[var(--primary)] text-white dark:text-black/80 shadow-sm' : 'bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60 hover:text-[var(--primary)]'}"
				on:click={() => (activeKey = format.key)}
			>
				{format.label}
			</button>
		{/each}
	</div>

	{#if formats.length === 0}
		<div class="py-4 text-center text-[11px] text-black/40 dark:text-white/40">正在生成引用格式... 喵~</div>
	{:else}
		<div class="relative">
			<pre class="p-3.5 pr-20 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-[var(--line-divider)] text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all text-black/75 dark:text-white/75 select-text">{activeCitation}</pre>
			<button
				type="button"
				class="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all {copiedKey === activeKey ? 'bg-emerald-500 text-white' : 'bg-[var(--primary)] text-white dark:text-black/80 hover:opacity-90'} active:scale-95"
				on:click={() => copyText(activeKey, activeCitation)}
			>
				{copiedKey === activeKey ? "已复制 ✓" : "复制"}
			</button>
		</div>
	{/if}
</div>
