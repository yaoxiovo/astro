<script lang="ts">
import Icon from "@iconify/svelte";

const API_BASE = "https://blog-api.yaoxi.cloud";

export let open = false;
export let showTriggerButton = true;
export let triggerText = "联系留言";

let name = "";
let email = "";
let message = "";
let honeypot = "";
let loading = false;
let status: "idle" | "success" | "error" = "idle";
let resultMsg = "";

function closeModal() {
	open = false;
	if (status === "success") {
		name = "";
		email = "";
		message = "";
		status = "idle";
	}
}

async function handleSubmit(e: Event) {
	e.preventDefault();
	if (!email || !message || loading) return;

	loading = true;
	status = "idle";
	resultMsg = "";

	try {
		const res = await fetch(`${API_BASE}/api/contact`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: name || "热心读者",
				email,
				message,
				pageUrl: window.location.href,
				honeypot,
			}),
		});

		const data = await res.json();
		if (res.ok && data.ok) {
			status = "success";
			resultMsg = data.message || "留言已成功送达！站长已收到通知，我们已向您的邮箱发送了自动回执。";
		} else {
			status = "error";
			resultMsg = data.message || "提交失败，请稍后重试。";
		}
	} catch (err) {
		status = "error";
		resultMsg = "网络连接异常，请稍后重试。";
	} finally {
		loading = false;
	}
}
</script>

{#if showTriggerButton}
  <button
    type="button"
    on:click={() => (open = true)}
    class="transition link text-[var(--primary)] font-medium inline bg-transparent border-0 p-0 cursor-pointer text-sm align-baseline"
  >
    {triggerText}
  </button>
{/if}

{#if open}
  <!-- 背景遮罩 -->
  <div
    class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity text-left"
    on:click={closeModal}
    on:keydown={(e) => e.key === "Escape" && closeModal()}
    role="button"
    tabindex="0"
  >
    <!-- 模态弹窗主体 -->
    <div
      class="card-base max-w-md w-full p-6 relative bg-white dark:bg-[#1e232a] rounded-2xl shadow-2xl border border-black/10 dark:border-white/10"
      on:click|stopPropagation
      on:keydown|stopPropagation
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <!-- 关闭按钮 -->
      <button
        type="button"
        on:click={closeModal}
        class="absolute right-4 top-4 p-1.5 text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
        aria-label="关闭"
      >
        <Icon icon="material-symbols:close-rounded" class="text-xl" />
      </button>

      <div class="flex items-center gap-2.5 mb-4">
        <div class="w-9 h-9 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
          <Icon icon="material-symbols:mail-outline-rounded" class="text-xl" />
        </div>
        <div>
          <h3 class="font-bold text-base text-black/90 dark:text-white/90">联系站长 / 意见反馈</h3>
          <p class="text-xs text-black/40 dark:text-white/40">留言将自动流转至站长邮箱，并附带自动回执</p>
        </div>
      </div>

      {#if status === "success"}
        <div class="py-6 text-center flex flex-col items-center">
          <div class="w-12 h-12 rounded-full bg-green-500/10 text-green-500 flex items-center justify-center mb-3">
            <Icon icon="material-symbols:check-circle-rounded" class="text-3xl" />
          </div>
          <h4 class="font-bold text-base text-black/90 dark:text-white/90 mb-1">留言已成功送达</h4>
          <p class="text-xs text-black/60 dark:text-white/60 max-w-xs leading-relaxed mb-5">
            {resultMsg}
          </p>
          <button
            type="button"
            on:click={closeModal}
            class="bg-[var(--primary)] text-white text-xs font-medium py-2 px-6 rounded-lg hover:opacity-90 transition-opacity cursor-pointer"
          >
            完成
          </button>
        </div>
      {:else}
        <form on:submit={handleSubmit} class="flex flex-col gap-3">
          <!-- 蜜罐 -->
          <input type="text" bind:value={honeypot} class="hidden" tabindex="-1" autocomplete="off" />

          <div>
            <label for="contact-name" class="block text-xs font-medium text-black/60 dark:text-white/60 mb-1">您的昵称 / 称呼</label>
            <input
              id="contact-name"
              type="text"
              bind:value={name}
              placeholder="例如：小明（选填）"
              maxlength="50"
              class="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-black/80 dark:text-white/80 focus:border-[var(--primary)] focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label for="contact-email" class="block text-xs font-medium text-black/60 dark:text-white/60 mb-1">您的邮箱 <span class="text-red-500">*</span></label>
            <input
              id="contact-email"
              type="email"
              required
              bind:value={email}
              placeholder="用于接收站长回复与自动回执..."
              class="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-black/80 dark:text-white/80 focus:border-[var(--primary)] focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label for="contact-msg" class="block text-xs font-medium text-black/60 dark:text-white/60 mb-1">留言正文 <span class="text-red-500">*</span></label>
            <textarea
              id="contact-msg"
              required
              rows="4"
              bind:value={message}
              placeholder="写下您的疑问、建议或想说的话（5~3000字）..."
              minlength="5"
              maxlength="3000"
              class="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-black/80 dark:text-white/80 focus:border-[var(--primary)] focus:outline-none resize-none transition-colors"
            ></textarea>
          </div>

          {#if status === "error"}
            <div class="p-2 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-lg text-xs leading-relaxed flex items-center gap-1.5">
              <Icon icon="material-symbols:error-rounded" class="text-sm flex-shrink-0" />
              <span>{resultMsg}</span>
            </div>
          {/if}

          <div class="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              on:click={closeModal}
              class="px-4 py-2 text-xs text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !email || !message}
              class="bg-[var(--primary)] text-white text-xs font-medium py-2 px-5 rounded-lg hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              {#if loading}
                <Icon icon="line-md:loading-loop" class="text-sm animate-spin" />
                <span>发送中...</span>
              {:else}
                <Icon icon="material-symbols:send-rounded" class="text-xs" />
                <span>发送留言</span>
              {/if}
            </button>
          </div>
        </form>
      {/if}
    </div>
  </div>
{/if}
