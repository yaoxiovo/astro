<script lang="ts">
import { onMount } from "svelte";

type Status = "pending" | "approved" | "rejected" | "deleted";
type Action = "approve" | "reject" | "delete" | "restore";
interface Item {
	id: string;
	post: string;
	status: Status;
	kind: string;
	body: string;
	author: string;
	ts: number;
	x: string;
	parentId?: string;
}
const labels: Record<Status, string> = {
	pending: "待审核",
	approved: "已通过",
	rejected: "已拒绝",
	deleted: "已删除",
};
const actions: Record<Action, string> = {
	approve: "通过",
	reject: "拒绝",
	delete: "删除",
	restore: "恢复",
};
const permitted: Record<Status, Action[]> = {
	pending: ["approve", "reject", "delete"],
	approved: ["reject", "delete"],
	rejected: ["restore", "delete"],
	deleted: ["restore"],
};
let status: Status = "pending";
let kind = "all";
let items: Item[] = [];
let selected: string[] = [];
let busy = false;
let hasMore = false;
let message = "打开评论审核后加载列表。";
let requestVersion = 0;

function getToken(): string {
	const auth = (
		window as unknown as { yaoxiAuth?: { getToken?: () => string } }
	).yaoxiAuth;
	const active = auth?.getToken?.();
	if (active) return active;
	for (const key of [
		"yaoxi_auth_token",
		"yaoxi_access_token",
		"access_token",
		"yaoxi_client_token",
	]) {
		const token = localStorage.getItem(key) || sessionStorage.getItem(key);
		if (token) return token;
	}
	return "";
}
async function api(path: string, body?: unknown) {
	const token = getToken();
	if (!token) throw new Error("请先使用管理员账号登录。");
	const response = await fetch(`https://blog-api.yaoxi.cloud${path}`, {
		method: body ? "POST" : "GET",
		cache: "no-store",
		headers: {
			Authorization: `Bearer ${token}`,
			...(body ? { "Content-Type": "application/json" } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await response.json().catch(() => null);
	if (!response.ok)
		throw new Error(
			response.status === 401 || response.status === 403
				? "管理员身份校验失败，请重新登录管理员账号。"
				: data?.message || `请求失败（${response.status}）`,
		);
	if (!data) throw new Error("接口未返回有效数据，请稍后重试。");
	return data;
}
async function load(append = false) {
	const version = ++requestVersion;
	busy = true;
	message = "正在加载…";
	const params = new URLSearchParams({ status, kind });
	const last = append ? items[items.length - 1] : null;
	if (last) {
		params.set("before", String(last.ts));
		params.set("beforeId", last.id);
	}
	if (!append) {
		items = [];
		selected = [];
		hasMore = false;
	}
	try {
		const data = await api(`/api/comments/manage?${params}`);
		if (version !== requestVersion) return;
		items = append ? [...items, ...data.items] : data.items;
		hasMore = data.hasMore === true;
		message = items.length
			? `已加载 ${items.length} 条${labels[status]}内容`
			: `暂无${labels[status]}内容`;
	} catch (error) {
		if (version === requestVersion)
			message = error instanceof Error ? error.message : "加载失败，请重试。";
	} finally {
		if (version === requestVersion) busy = false;
	}
}
async function moderate(action: Action, ids: string[]) {
	if (busy || !ids.length) return;
	if (
		ids.length > 1 &&
		!confirm(`确定${actions[action]}选中的 ${ids.length} 条内容？`)
	)
		return;
	busy = true;
	const failures: string[] = [];
	let succeeded = 0;
	try {
		for (const id of ids) {
			try {
				await api("/api/comments/moderate", { id, action });
				succeeded++;
			} catch (error) {
				failures.push(error instanceof Error ? error.message : "操作失败");
			}
		}
		await load();
		message = `已${actions[action]} ${succeeded} 条${failures.length ? `，失败 ${failures.length} 条：${failures[0]}` : "。"}`;
	} finally {
		busy = false;
	}
}
onMount(() => {
	const open = () => {
		if (!busy) void load();
	};
	const authChange = () => {
		requestVersion++;
		items = [];
		selected = [];
		hasMore = false;
		busy = false;
		message = "登录状态已变化，请刷新列表。";
	};
	window.addEventListener("admin:comments:open", open);
	window.addEventListener("yaoxi:auth:change", authChange);
	return () => {
		requestVersion++;
		window.removeEventListener("admin:comments:open", open);
		window.removeEventListener("yaoxi:auth:change", authChange);
	};
});
</script>

<section class="rounded-2xl border border-[var(--line-divider)] p-4 sm:p-6 bg-white/60 dark:bg-black/20 text-black/80 dark:text-white/80" aria-label="评论审核管理">
 <h2 class="text-lg font-bold mb-2">评论审核</h2>
 <p class="text-sm opacity-70 mb-4">文本安全检测通过后自动展示；需复核的内容在此审核。支持评论和弹幕管理。</p>
 <div class="flex flex-wrap gap-3 items-center mb-4">
  <label>状态 <select bind:value={status} onchange={() => load()} disabled={busy} class="rounded-lg p-2 bg-white dark:bg-black">
   {#each Object.entries(labels) as [value, label]}<option {value}>{label}</option>{/each}
  </select></label>
  <label>类型 <select bind:value={kind} onchange={() => load()} disabled={busy} class="rounded-lg p-2 bg-white dark:bg-black">
   <option value="all">全部</option><option value="comment">评论</option><option value="danmaku">弹幕</option>
  </select></label>
  <button type="button" onclick={() => load()} disabled={busy} class="rounded-lg border px-3 py-2 disabled:opacity-40">刷新列表</button>
 </div>
 <div class="flex flex-wrap gap-3 items-center mb-4">
  <label><input type="checkbox" checked={items.length > 0 && selected.length === items.length} disabled={busy || !items.length} onchange={(event) => selected = event.currentTarget.checked ? items.map(item => item.id) : []} /> 全选当前列表</label>
  {#each permitted[status] as action}
   <button type="button" onclick={() => moderate(action, [...selected])} disabled={busy || !selected.length} class="rounded-lg border px-3 py-2 disabled:opacity-40">一键{actions[action]}{selected.length ? `（${selected.length}）` : ""}</button>
  {/each}
 </div>
 <p role="status" aria-live="polite" class="text-sm mb-4">{message}</p>
 <div class="space-y-3" aria-busy={busy}>
  {#each items as item (item.id)}
   <article class="rounded-xl border border-[var(--line-divider)] p-4">
    <div class="flex flex-wrap gap-3 items-center text-sm mb-2">
     <input type="checkbox" bind:group={selected} value={item.id} disabled={busy} aria-label={`选择 ${item.author} 的内容`} />
     <strong>{item.author}</strong><span>{item.kind === "danmaku" ? "弹幕" : "评论"}{item.parentId ? " · 回复" : ""}</span>
     <time datetime={new Date(item.ts).toISOString()}>{new Date(item.ts).toLocaleString("zh-CN")}</time>
     <a href={`/posts/${item.post.split("/").map(encodeURIComponent).join("/")}/`} target="_blank" rel="noopener noreferrer" class="underline break-all">{item.post}</a>
    </div>
    {#if item.x}<blockquote class="text-sm opacity-60 mb-2">{item.x}</blockquote>{/if}
    <p class="whitespace-pre-wrap break-words mb-3">{item.body}</p>
    <div class="flex gap-3">
     {#each permitted[item.status] as action}
      <button type="button" onclick={() => moderate(action, [item.id])} disabled={busy} class="rounded-lg border px-3 py-1 text-sm disabled:opacity-40">{actions[action]}</button>
     {/each}
    </div>
   </article>
  {/each}
 </div>
 {#if hasMore}<button type="button" onclick={() => load(true)} disabled={busy} class="rounded-lg border px-4 py-2 mt-4 disabled:opacity-40">加载更多</button>{/if}
</section>
