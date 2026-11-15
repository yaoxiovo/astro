<script lang="ts">
import { onMount } from "svelte";
interface Account {
	sub: string;
	username: string;
	displayName: string;
	avatarUrl: string;
	isAdmin: boolean;
	verified: boolean;
	verificationLabel: string;
	state: string;
	mutedUntil: number;
	allowComment: boolean;
	allowDanmaku: boolean;
	requireReview: boolean;
	note: string;
	version: number;
	lastSeen: number;
}
type Patch = Partial<
	Pick<
		Account,
		| "verified"
		| "verificationLabel"
		| "state"
		| "mutedUntil"
		| "allowComment"
		| "allowDanmaku"
		| "requireReview"
		| "note"
	>
>;
interface Audit {
	id: number;
	actor: string;
	changes: Record<string, { from: unknown; to: unknown }>;
	createdAt: number;
}
let items: Account[] = [];
let selected: string[] = [];
let query = "";
let filter = "all";
let busy = false;
let message = "打开本站账号后加载列表。";
let hasMore = false;
let editing: Account | null = null;
let audit: Audit[] = [];
let until = "";
let version = 0;
const fields: Record<string, string> = {
	verified: "本站认证",
	verificationLabel: "认证说明",
	state: "互动状态",
	mutedUntil: "禁言期限",
	allowComment: "评论权限",
	allowDanmaku: "弹幕权限",
	requireReview: "强制人工审核",
	note: "管理备注",
};
const buttonClass = "rounded-lg border px-3 py-2 text-sm disabled:opacity-40";
const inputClass =
	"rounded-lg border border-[var(--line-divider)] bg-white dark:bg-black p-2 min-w-0";
function token() {
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
		const value = localStorage.getItem(key) || sessionStorage.getItem(key);
		if (value) return value;
	}
	return "";
}
async function api(path: string, body?: unknown) {
	const credential = token();
	if (!credential) throw new Error("请先登录管理员账号。");
	const response = await fetch(`https://blog-api.yaoxi.cloud${path}`, {
		method: body ? "POST" : "GET",
		cache: "no-store",
		headers: {
			Authorization: `Bearer ${credential}`,
			...(body ? { "Content-Type": "application/json" } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await response.json().catch(() => null);
	if (!response.ok || !data)
		throw new Error(data?.message || "账号管理请求失败，请稍后重试。");
	return data;
}
async function load(append = false) {
	const current = ++version;
	busy = true;
	message = "正在加载…";
	const params = new URLSearchParams({ q: query, filter });
	if (append && items.length) params.set("after", items[items.length - 1].sub);
	if (!append) {
		items = [];
		selected = [];
		hasMore = false;
		editing = null;
		audit = [];
	}
	try {
		const data = await api(`/api/admin/accounts?${params}`);
		if (current !== version) return;
		items = append ? [...items, ...data.items] : data.items;
		hasMore = data.hasMore;
		message = items.length
			? `已加载 ${items.length} 个本站账号`
			: "暂无符合条件的本站账号。账号登录访问博客后会自动加入。";
	} catch (error) {
		if (current === version)
			message = error instanceof Error ? error.message : "加载失败";
	} finally {
		if (current === version) busy = false;
	}
}
function muted(item: Account) {
	return item.mutedUntil === -1 || item.mutedUntil > Date.now();
}
function muteLabel(item: Account) {
	return item.mutedUntil === -1
		? "永久禁言"
		: muted(item)
			? `禁言至 ${new Date(item.mutedUntil).toLocaleString("zh-CN")}`
			: "正常发言";
}
async function update(accounts: Account[], patch: Patch, label: string) {
	if (busy || !accounts.length) return;
	if (
		(accounts.length > 1 || patch.state === "suspended") &&
		!confirm(`确定对 ${accounts.length} 个账号执行「${label}」？`)
	)
		return;
	const current = version;
	busy = true;
	let passed = 0;
	const errors: string[] = [];
	try {
		for (const account of accounts) {
			if (current !== version) break;
			try {
				await api("/api/admin/accounts/update", {
					sub: account.sub,
					version: account.version,
					patch,
				});
				passed++;
			} catch (error) {
				errors.push(error instanceof Error ? error.message : "操作失败");
			}
		}
		if (current !== version) return;
		await load();
		message = `${label}：成功 ${passed} 个${errors.length ? `，失败 ${errors.length} 个：${errors[0]}` : "。"}`;
	} finally {
		if (current === version || current + 1 === version) busy = false;
	}
}
function chosen() {
	return items.filter((item) => selected.includes(item.sub));
}
async function edit(item: Account) {
	editing = { ...item };
	until =
		item.mutedUntil > 0
			? new Date(
					item.mutedUntil -
						new Date(item.mutedUntil).getTimezoneOffset() * 60000,
				)
					.toISOString()
					.slice(0, 16)
			: "";
	audit = [];
	try {
		const data = await api(
			`/api/admin/accounts/events?sub=${encodeURIComponent(item.sub)}`,
		);
		if (editing?.sub === item.sub) audit = data.items;
	} catch (error) {
		message = error instanceof Error ? error.message : "记录读取失败";
	}
}
function describe(key: string, value: unknown): string {
	if (key === "mutedUntil") {
		const n = Number(value);
		return n === -1
			? "永久禁言"
			: n === 0
				? "未禁言"
				: new Date(n).toLocaleString("zh-CN");
	}
	if (key === "state") return value === "active" ? "启用" : "停用";
	if (
		["verified", "allowComment", "allowDanmaku", "requireReview"].includes(key)
	)
		return value ? "是" : "否";
	return String(value || "（空）");
}
onMount(() => {
	const open = () => {
		if (!busy) void load();
	};
	const change = () => {
		version++;
		items = [];
		selected = [];
		editing = null;
		audit = [];
		busy = false;
		hasMore = false;
		message = "登录状态已变化，请刷新列表。";
	};
	window.addEventListener("admin:accounts:open", open);
	window.addEventListener("yaoxi:auth:change", change);
	if (!document.getElementById("panel-accounts")?.classList.contains("hidden"))
		open();
	return () => {
		version++;
		window.removeEventListener("admin:accounts:open", open);
		window.removeEventListener("yaoxi:auth:change", change);
	};
});
</script>

<section class="rounded-2xl border border-[var(--line-divider)] p-4 sm:p-6 bg-white/60 dark:bg-black/20 text-black/80 dark:text-white/80" aria-label="本站账号管理">
 <h2 class="text-lg font-bold mb-2">本站账号管理</h2>
 <p class="text-sm opacity-70 mb-4">管理访问过博客的账号。认证标记、禁言和权限仅在本站生效。</p>
 <form class="flex flex-wrap gap-3 mb-4" onsubmit={event=>{event.preventDefault();void load();}}>
  <input aria-label="搜索账号" class={inputClass} placeholder="用户名、昵称或账号 ID" bind:value={query} disabled={busy} maxlength="80" />
  <select aria-label="筛选账号" class={inputClass} bind:value={filter} onchange={()=>load()} disabled={busy}>
   <option value="all">全部账号</option><option value="verified">本站认证</option><option value="muted">禁言中</option><option value="suspended">已停用</option><option value="review">强制人工审核</option>
  </select>
  <button type="submit" class={buttonClass} disabled={busy}>搜索 / 刷新</button>
 </form>
 <div class="flex flex-wrap gap-2 items-center mb-4">
  <label><input type="checkbox" disabled={busy || !items.length} checked={items.length>0 && selected.length===items.length} onchange={event=>selected=event.currentTarget.checked?items.map(item=>item.sub):[]} /> 全选当前列表</label>
  <button type="button" class={buttonClass} disabled={busy || !selected.length} onclick={()=>update(chosen(),{verified:true},"授予认证")}>一键认证</button>
  <button type="button" class={buttonClass} disabled={busy || !selected.length} onclick={()=>update(chosen(),{mutedUntil:Date.now()+86400000},"禁言一天")}>一键禁言一天</button>
  <button type="button" class={buttonClass} disabled={busy || !selected.length} onclick={()=>update(chosen(),{mutedUntil:0},"解除禁言")}>一键解禁</button>
  <button type="button" class={buttonClass} disabled={busy || !selected.length} onclick={()=>update(chosen(),{requireReview:true},"强制人工审核")}>一键转人工审核</button>
 </div>
 <p role="status" aria-live="polite" class="text-sm mb-4">{message}</p>
 <div class="space-y-3" aria-busy={busy}>
  {#each items as item(item.sub)}
   <article class="rounded-xl border border-[var(--line-divider)] p-4">
    <div class="flex flex-wrap items-center gap-3">
     <input type="checkbox" bind:group={selected} value={item.sub} disabled={busy} aria-label={`选择账号 ${item.username}`} />
     {#if item.avatarUrl}<img src={item.avatarUrl} alt="" width="36" height="36" class="rounded-full object-cover" referrerpolicy="no-referrer" onerror={event=>event.currentTarget.style.display="none"} />{/if}
     <div class="min-w-0"><strong>{item.displayName || item.username}</strong><div class="text-xs opacity-60 break-all">{item.username} · {item.sub}</div></div>
     {#if item.isAdmin}<span class="text-xs">认证中心管理员</span>{/if}
     {#if item.verified}<span class="text-xs text-blue-500">✓ {item.verificationLabel || "本站认证"}</span>{/if}
    </div>
    <p class="text-sm mt-3">{item.state==="suspended"?"本站互动已停用":"本站互动已启用"} · {muteLabel(item)} · 评论{item.allowComment?"允许":"禁止"} · 弹幕{item.allowDanmaku?"允许":"禁止"}{item.requireReview?" · 强制人工审核":""}</p>
    <div class="flex flex-wrap gap-2 mt-3">
     <button type="button" class={buttonClass} disabled={busy} onclick={()=>edit(item)}>详细设置 / 操作记录</button>
     <button type="button" class={buttonClass} disabled={busy} onclick={()=>update([item],{verified:!item.verified},item.verified?"取消认证":"授予认证")}>{item.verified?"取消认证":"认证"}</button>
     <button type="button" class={buttonClass} disabled={busy || item.isAdmin} onclick={()=>update([item],{mutedUntil:muted(item)?0:Date.now()+86400000},muted(item)?"解除禁言":"禁言一天")}>{muted(item)?"解除禁言":"禁言一天"}</button>
    </div>
   </article>
  {/each}
 </div>
 {#if hasMore}<button type="button" class={`${buttonClass} mt-4`} disabled={busy} onclick={()=>load(true)}>加载更多账号</button>{/if}
 {#if editing}
  <form class="mt-5 rounded-xl border border-[var(--line-divider)] p-4 space-y-4" onsubmit={event=>{event.preventDefault();if(editing)void update([editing],{verified:editing.verified,verificationLabel:editing.verificationLabel,state:editing.state,mutedUntil:editing.mutedUntil,allowComment:editing.allowComment,allowDanmaku:editing.allowDanmaku,requireReview:editing.requireReview,note:editing.note},"保存账号设置");}}>
   <h3 class="font-bold break-all">账号设置：{editing.username}</h3>
   <div class="flex flex-wrap gap-4">
    <label><input type="checkbox" bind:checked={editing.verified} disabled={busy} /> 本站认证</label>
    <label><input type="checkbox" bind:checked={editing.allowComment} disabled={busy || editing.isAdmin} /> 允许评论</label>
    <label><input type="checkbox" bind:checked={editing.allowDanmaku} disabled={busy || editing.isAdmin} /> 允许弹幕</label>
    <label><input type="checkbox" bind:checked={editing.requireReview} disabled={busy} /> 强制人工审核</label>
   </div>
   <label class="block">认证说明 <input class={`${inputClass} w-full`} bind:value={editing.verificationLabel} maxlength="40" disabled={busy} placeholder="例如：创作者" /></label>
   <div class="flex flex-wrap gap-2 items-center">
    <span>禁言：</span>
    <button type="button" class={buttonClass} disabled={busy || editing.isAdmin} onclick={()=>{if(editing)editing.mutedUntil=0;}}>解除禁言</button>
    <button type="button" class={buttonClass} disabled={busy || editing.isAdmin} onclick={()=>{if(editing)editing.mutedUntil=Date.now()+3600000;}}>一小时</button>
    <button type="button" class={buttonClass} disabled={busy || editing.isAdmin} onclick={()=>{if(editing)editing.mutedUntil=Date.now()+7*86400000;}}>七天</button>
    <button type="button" class={buttonClass} disabled={busy || editing.isAdmin} onclick={()=>{if(editing)editing.mutedUntil=-1;}}>永久</button>
   </div>
   <label class="block">自定义禁言截止 <input type="datetime-local" class={inputClass} bind:value={until} disabled={busy || editing.isAdmin} onchange={()=>{if(editing && until)editing.mutedUntil=new Date(until).getTime();}} /></label>
   <p class="text-sm">当前设置：{muteLabel(editing)}</p>
   <label class="block">本站互动 <select class={inputClass} bind:value={editing.state} disabled={busy || editing.isAdmin}><option value="active">启用</option><option value="suspended">停用</option></select></label>
   <label class="block">管理备注 <textarea class={`${inputClass} block w-full`} maxlength="500" bind:value={editing.note} disabled={busy}></textarea></label>
   <div class="flex gap-3"><button type="submit" class={buttonClass} disabled={busy}>保存账号设置</button><button type="button" class={buttonClass} onclick={()=>{editing=null;audit=[];}} disabled={busy}>关闭</button></div>
   <h4 class="font-bold">最近操作记录</h4>
   {#if !audit.length}<p class="text-sm opacity-60">暂无操作记录。</p>{/if}
   {#each audit as entry(entry.id)}
    <div class="text-sm border-t border-[var(--line-divider)] pt-2">
     <p>{new Date(entry.createdAt).toLocaleString("zh-CN")} · {entry.actor}</p>
     {#each Object.entries(entry.changes) as [key,change]}<p class="break-words">{fields[key] || key}：{describe(key,change.from)} → {describe(key,change.to)}</p>{/each}
    </div>
   {/each}
  </form>
 {/if}
</section>
