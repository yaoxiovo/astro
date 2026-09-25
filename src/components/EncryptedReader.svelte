<script lang="ts">
  import { onMount } from 'svelte';
  import {
    unlockPrivateKeyVault,
    decryptArticleContent,
    type EncryptedArticlePayload,
    type VaultData
  } from '../utils/crypto';

  export let rawPayloadJson: string = '';

  let payload: EncryptedArticlePayload | null = null;
  let decryptedMarkdown = '';
  let masterPassword = '';
  let showModal = false;
  let isDecrypting = false;
  let errorMsg = '';
  let currentUserId = '';
  let hasMatchingEnvelope = false;

  const API_BASE = 'https://zk-api.yaoxi.cloud';

  onMount(() => {
    try {
      if (typeof rawPayloadJson === 'string') {
        payload = JSON.parse(rawPayloadJson);
      } else {
        payload = rawPayloadJson;
      }

      currentUserId = localStorage.getItem('yaoxi_user_id') || localStorage.getItem('user_id') || '';

      if (payload && currentUserId) {
        hasMatchingEnvelope = payload.envelopes.some(e => e.user_id === currentUserId);
      }
    } catch {
      errorMsg = '文章加密数据解析异常，可能格式已损坏 喵！';
    }
  });

  const handleUnlock = async () => {
    if (!masterPassword.trim()) {
      errorMsg = '请输入您的阅读主密码 喵！';
      return;
    }

    if (!payload) {
      errorMsg = '未检测到有效的加密正文载荷 喵！';
      return;
    }

    isDecrypting = true;
    errorMsg = '';

    try {
      const token = localStorage.getItem('yaoxi_access_token') || localStorage.getItem('access_token');
      if (!token) {
        throw new Error('未检测到登录授权凭据，请先在右上角完成统一身份认证 喵！');
      }

      // 1. 从 Worker BFF 安全拉取当前读者的私钥密文 Vault
      const res = await fetch(`${API_BASE}/api/user/vault`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        throw new Error('未在云端检索到您的密钥保险库，请先初始化您的客户端密钥对 喵！');
      }

      const vaultData: VaultData = await res.json();

      // 2. 本地内存执行 PBKDF2(100k, SHA-256) 派生对称密钥，解锁出 RSA-OAEP 私钥
      const userPrivateKey = await unlockPrivateKeyVault(vaultData, masterPassword);

      // 3. 拆封专属数字信封，解出一次性 CEK 并还原 Markdown 正文
      decryptedMarkdown = await decryptArticleContent(payload, userPrivateKey, currentUserId);

      // 4. 立即清理主密码内存
      masterPassword = '';
      showModal = false;
    } catch (err: any) {
      errorMsg = err.message || '解密失败：主密码校验未通过 喵！';
    } finally {
      isDecrypting = false;
    }
  };
</script>

{#if decryptedMarkdown}
  <!-- 解密成功：直接在客户端平滑呈现解密后的 Markdown 文档内容 -->
  <div class="prose max-w-none dark:prose-invert animate-fade-in my-6 p-6 bg-base-100 rounded-2xl border border-base-200 shadow-sm">
    <div class="badge badge-success gap-2 mb-4 font-mono text-xs">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      已在本地内存通过专属数字信封成功解密
    </div>
    <div class="whitespace-pre-wrap font-sans leading-relaxed text-base">
      {decryptedMarkdown}
    </div>
  </div>
{:else}
  <!-- 未解密保护层：防爬虫锁定展示卡片 -->
  <div class="my-8 p-8 border-2 border-dashed border-primary/30 rounded-2xl bg-base-200/40 text-center backdrop-blur-sm shadow-inner">
    <div class="inline-flex p-4 bg-primary/10 text-primary rounded-full mb-3 text-3xl">
      🔐
    </div>
    <h3 class="text-xl font-bold mb-2">本文受端到端零知识混合加密保护 喵~</h3>
    <p class="text-sm text-base-content/70 max-w-lg mx-auto mb-6 leading-relaxed">
      文稿已通过 AES-GCM-256 算法加密，且对称密钥被封闭在针对授权读者公钥的 RSA-OAEP 数字信封中。
      即使静态文件被全量爬取拖库，没有授权私钥也无法破译任何明文字符。
    </p>

    <div class="flex flex-col sm:flex-row gap-3 justify-center items-center">
      <button class="btn btn-primary shadow-md gap-2" on:click={() => (showModal = true)}>
        <span>🔑</span>
        输入主密码现场解密 喵！
      </button>
    </div>

    {#if errorMsg}
      <div class="mt-4 p-3 bg-error/10 text-error rounded-xl text-xs max-w-md mx-auto border border-error/20">
        {errorMsg}
      </div>
    {/if}
  </div>
{/if}

<!-- 输入 Master Password 的安全解密弹窗 -->
{#if showModal}
  <div class="modal modal-open">
    <div class="modal-box max-w-md border border-base-300">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-2xl">🛡️</span>
        <h3 class="font-bold text-lg">零知识阅读安全验证</h3>
      </div>
      <p class="text-xs text-base-content/60 mb-4 leading-relaxed">
        主密码仅在当前设备内存中经由 PBKDF2 (100,000 次计算) 派生解密密钥，<b>绝不上云传输，亦不持久化存储</b> 喵！
      </p>

      <input
        type="password"
        bind:value={masterPassword}
        placeholder="请输入您的 Reader Master Password"
        class="input input-bordered w-full mb-3 font-mono text-sm"
        on:keydown={(e) => e.key === 'Enter' && handleUnlock()}
      />

      {#if errorMsg}
        <div class="text-error text-xs mb-3 font-mono">{errorMsg}</div>
      {/if}

      <div class="modal-action flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" on:click={() => (showModal = false)} disabled={isDecrypting}>
          取消
        </button>
        <button class="btn btn-primary btn-sm" on:click={handleUnlock} disabled={isDecrypting}>
          {#if isDecrypting}
            <span class="loading loading-spinner loading-xs"></span>
            内存计算中...
          {:else}
            解密阅读 喵！
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
