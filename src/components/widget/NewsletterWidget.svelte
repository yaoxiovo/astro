<script lang="ts">
import Icon from "@iconify/svelte";

const API_BASE = "https://blog-api.yaoxi.cloud";

let email = "";
let honeypot = "";
let loading = false;
let status: "idle" | "success" | "error" = "idle";
let message = "";

async function handleSubmit(e: Event) {
	e.preventDefault();
	if (!email || loading) return;

	loading = true;
	status = "idle";
	message = "";

	try {
		const res = await fetch(`${API_BASE}/api/newsletter/subscribe`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, honeypot }),
		});

		const data = await res.json();
		if (res.ok && data.ok) {
			status = "success";
			message = data.message || "订阅激活邮件已发送，请前往邮箱查收！";
			email = "";
		} else {
			status = "error";
			message = data.message || "订阅失败，请稍后重试。";
		}
	} catch (err) {
		status = "error";
		message = "网络请求失败，请检查网络连接后重试。";
	} finally {
		loading = false;
	}
}
</script>

<div class="card-base p-4 border border-[var(--primary)]/20 relative overflow-hidden group transition-all">
  <!-- 装饰图标背景 -->
  <div class="absolute -right-3 -top-3 opacity-10 group-hover:opacity-15 transition-opacity pointer-events-none">
    <Icon icon="material-symbols:mark-email-unread-outline-rounded" class="text-7xl text-[var(--primary)]" />
  </div>

  <div class="flex items-center gap-2 mb-2 relative z-10">
    <div class="w-8 h-8 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center flex-shrink-0">
      <Icon icon="material-symbols:mail-rounded" class="text-base" />
    </div>
    <div>
      <div class="font-bold text-sm text-black/80 dark:text-white/80 tracking-wide">博客更新订阅</div>
      <div class="text-[11px] text-black/40 dark:text-white/40">新文章发布时自动邮件通知</div>
    </div>
  </div>

  <form on:submit={handleSubmit} class="relative z-10 mt-3 flex flex-col gap-2">
    <!-- 蜜罐字段（防机器人垃圾邮件） -->
    <input type="text" bind:value={honeypot} class="hidden" tabindex="-1" autocomplete="off" />

    <div class="flex items-center gap-1.5 bg-black/5 dark:bg-white/5 rounded-lg border border-black/10 dark:border-white/10 px-2.5 py-1.5 focus-within:border-[var(--primary)] transition-colors">
      <Icon icon="material-symbols:alternate-email" class="text-black/30 dark:text-white/30 text-sm flex-shrink-0" />
      <input
        type="email"
        required
        placeholder="输入您的邮箱地址..."
        bind:value={email}
        disabled={loading}
        class="w-full bg-transparent border-none text-xs text-black/80 dark:text-white/80 placeholder:text-black/30 dark:placeholder:text-white/30 focus:outline-none focus:ring-0 disabled:opacity-50"
      />
    </div>

    <button
      type="submit"
      disabled={loading || !email}
      class="w-full flex items-center justify-center gap-1.5 bg-[var(--primary)] text-white text-xs font-medium py-1.5 px-3 rounded-lg hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-40 disabled:pointer-events-none shadow-sm cursor-pointer"
    >
      {#if loading}
        <Icon icon="line-md:loading-loop" class="text-sm animate-spin" />
        <span>发送激活信中...</span>
      {:else}
        <Icon icon="material-symbols:send-rounded" class="text-xs" />
        <span>免费订阅推送</span>
      {/if}
    </button>
  </form>

  {#if status === "success"}
    <div class="mt-2.5 p-2 bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-300 rounded-lg text-xs leading-relaxed flex items-start gap-1.5">
      <Icon icon="material-symbols:check-circle-rounded" class="text-sm flex-shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  {:else if status === "error"}
    <div class="mt-2.5 p-2 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-lg text-xs leading-relaxed flex items-start gap-1.5">
      <Icon icon="material-symbols:error-rounded" class="text-sm flex-shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  {/if}

  <div class="mt-2 text-[10px] text-black/30 dark:text-white/30 text-center">
    双重确认保护 · 随时一键退订 · 零广告骚扰
  </div>
</div>
