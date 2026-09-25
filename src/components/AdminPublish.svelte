<script lang="ts">
  import { onMount } from 'svelte';
  import { encryptArticleContent, type AuthorizedRecipient } from '../utils/crypto';

  let slug = '';
  let title = '';
  let markdown = '';
  let tags = '技术,安全,架构';
  let category = '安全实践';
  let enableEncryption = true;

  interface UserKeyItem {
    id: string;
    username: string;
    public_key_jwk: JsonWebKey;
  }

  let recipients: UserKeyItem[] = [];
  let selectedRecipientIds: string[] = [];

  let token = '';
  let statusText = '';
  let isPublishing = false;
  let deployStatus = 'idle'; // 'idle' | 'queued' | 'building' | 'success' | 'failure'
  let currentStage = '';
  let pollInterval: any = null;

  const API_BASE = 'https://zk-api.yaoxi.cloud'; // 或你的 Worker 自定义域名

  onMount(async () => {
    token = localStorage.getItem('yaoxi_access_token') || localStorage.getItem('access_token') || '';
    if (!token) {
      statusText = '⚠️ 未检测到有效管理员凭据，请先在右上角完成 OAuth 2.0 登录 喵！';
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/user/keys`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        recipients = data.users || [];
        selectedRecipientIds = recipients.map(r => r.id);
      } else {
        statusText = '⚠️ 暂未获取到读者公钥库（请确认已有读者初始化过密钥保险库）喵。';
      }
    } catch {
      statusText = '⚠️ 连接密钥后端超时，请检查网络配置 喵。';
    }
  });

  const handlePublish = async () => {
    if (!slug.trim() || !title.trim() || !markdown.trim()) {
      alert('请完整填写文章 Slug、标题和 Markdown 内容 喵！');
      return;
    }

    if (enableEncryption && selectedRecipientIds.length === 0) {
      alert('已开启端到端加密，请至少勾选一位授权读者 喵！');
      return;
    }

    isPublishing = true;
    deployStatus = 'idle';
    statusText = '🔐 正在前端内存执行 Web Crypto 混合加密与数字信封封签...';

    try {
      let finalMarkdownFile = '';

      if (enableEncryption) {
        const authorized: AuthorizedRecipient[] = recipients
          .filter(r => selectedRecipientIds.includes(r.id))
          .map(r => ({
            user_id: r.id,
            public_key_jwk: r.public_key_jwk,
          }));

        const payload = await encryptArticleContent(markdown, authorized);

        const tagsArray = tags.split(',').map(t => t.trim()).filter(Boolean);
        const tagsYaml = tagsArray.map(t => `  - ${t}`).join('\n');

        finalMarkdownFile = `---
title: "${title}"
published: "${new Date().toISOString().split('T')[0]}"
description: "本文受端到端零知识混合加密保护"
tags:
${tagsYaml}
category: "${category}"
encrypted: true
draft: false
---

\`\`\`encrypted-payload
${JSON.stringify(payload, null, 2)}
\`\`\`
`;
      } else {
        const tagsArray = tags.split(',').map(t => t.trim()).filter(Boolean);
        const tagsYaml = tagsArray.map(t => `  - ${t}`).join('\n');

        finalMarkdownFile = `---
title: "${title}"
published: "${new Date().toISOString().split('T')[0]}"
description: "${title}"
tags:
${tagsYaml}
category: "${category}"
encrypted: false
draft: false
---

${markdown}
`;
      }

      statusText = '🚀 正在通过 Worker BFF 向 GitHub Repos API 提交加密 Commit...';

      const pubRes = await fetch(`${API_BASE}/api/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          slug: slug.trim(),
          title: title.trim(),
          fileContent: finalMarkdownFile,
        }),
      });

      if (!pubRes.ok) {
        const errJson = await pubRes.json().catch(() => ({ message: '发布网络请求失败' }));
        throw new Error(errJson.message || errJson.details || '发布异常');
      }

      const pubData = await pubRes.json();
      statusText = `✅ Commit 已提交 (${pubData.commit_sha?.substring(0, 7)})！启动 Cloudflare Pages 部署状态探针...`;
      deployStatus = 'queued';

      startPollingDeploy();
    } catch (err: any) {
      statusText = `❌ 发布失败: ${err.message}`;
      isPublishing = false;
    }
  };

  const startPollingDeploy = () => {
    if (pollInterval) clearInterval(pollInterval);

    pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/deploy-status`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const data = await res.json();
          deployStatus = data.status || 'building';
          currentStage = data.current_stage || 'build';

          if (deployStatus === 'success') {
            statusText = `🎉 恭喜！Cloudflare Pages 构建成功并已完成全球边缘多活发布 喵！`;
            clearInterval(pollInterval);
            isPublishing = false;
          } else if (deployStatus === 'failure') {
            statusText = `❌ Cloudflare Pages 部署失败，请检查 Actions/Pages 构建日志 喵！`;
            clearInterval(pollInterval);
            isPublishing = false;
          } else {
            statusText = `⏳ 部署中... 状态: ${deployStatus.toUpperCase()} (阶段: ${currentStage}) 喵...`;
          }
        }
      } catch {
        statusText = '⚠️ 探针轮询响应微超时，后台继续重试中 喵...';
      }
    }, 3000);
  };
</script>

<div class="card bg-base-100 shadow-xl border border-base-200 p-6 max-w-4xl mx-auto my-8">
  <div class="flex items-center justify-between border-b pb-4 mb-6">
    <div class="flex items-center gap-3">
      <span class="text-3xl">🛡️</span>
      <div>
        <h2 class="text-2xl font-bold">受限文章零知识发布控制台 喵~</h2>
        <p class="text-xs text-base-content/60">
          端到端 AES-GCM-256 + RSA-OAEP 数字信封混合加密，服务器与 D1 数据库全程零知识！
        </p>
      </div>
    </div>
    {#if deployStatus !== 'idle'}
      <div class="badge badge-lg gap-2 font-mono {deployStatus === 'success' ? 'badge-success' : deployStatus === 'failure' ? 'badge-error' : 'badge-warning animate-pulse'}">
        {deployStatus.toUpperCase()}
      </div>
    {/if}
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
    <div>
      <label class="label"><span class="label-text font-bold">文章 Slug (文件名标识)</span></label>
      <input type="text" bind:value={slug} placeholder="e.g. zero-knowledge-core-rfc" class="input input-bordered w-full font-mono text-sm" />
    </div>
    <div>
      <label class="label"><span class="label-text font-bold">文章标题</span></label>
      <input type="text" bind:value={title} placeholder="输入公开发布的标题" class="input input-bordered w-full" />
    </div>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
    <div>
      <label class="label"><span class="label-text font-bold">标签 (逗号分隔)</span></label>
      <input type="text" bind:value={tags} class="input input-bordered w-full text-sm" />
    </div>
    <div>
      <label class="label"><span class="label-text font-bold">分类</span></label>
      <input type="text" bind:value={category} class="input input-bordered w-full text-sm" />
    </div>
  </div>

  <div class="mb-4">
    <label class="label flex justify-between">
      <span class="label-text font-bold">Markdown 正文内容</span>
      <span class="text-xs text-primary">发布时将在浏览器本地直接加密，明文永不上云 喵！</span>
    </label>
    <textarea bind:value={markdown} rows="12" placeholder="# 绝密研发笔记&#10;&#10;在此输入受保护的深度研究内容..." class="textarea textarea-bordered w-full font-mono text-sm"></textarea>
  </div>

  <!-- 零知识加密开关与读者选择 -->
  <div class="p-4 bg-base-200/60 rounded-xl border border-base-300 mb-6">
    <label class="cursor-pointer flex items-center justify-between">
      <div>
        <div class="font-bold text-base">启用端到端数字信封防爬加密 (Hybrid Envelope Encryption)</div>
        <div class="text-xs text-base-content/60">
          生成随机 256 位对称 CEK 加密正文，并使用勾选读者的 RSA-OAEP 公钥分别封装数字信封
        </div>
      </div>
      <input type="checkbox" bind:checked={enableEncryption} class="toggle toggle-primary" />
    </label>

    {#if enableEncryption}
      <div class="mt-4 pt-4 border-t border-base-300">
        <div class="text-sm font-semibold mb-2">选择已授权受限读者 (授权其公钥解封数字信封):</div>
        {#if recipients.length === 0}
          <div class="text-xs text-warning">暂无可用的读者公钥，请先引导读者登录并初始化密钥保险库 喵。</div>
        {:else}
          <div class="flex flex-wrap gap-2">
            {#each recipients as r}
              <label class="badge badge-lg gap-2 cursor-pointer p-3 {selectedRecipientIds.includes(r.id) ? 'badge-primary' : 'badge-outline'}">
                <input type="checkbox" value={r.id} bind:group={selectedRecipientIds} class="checkbox checkbox-xs" />
                <span>@{r.username}</span>
              </label>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <button class="btn btn-primary w-full shadow-md text-base" on:click={handlePublish} disabled={isPublishing}>
    {#if isPublishing}
      <span class="loading loading-spinner"></span>
      正在发布并监听 Pages 构建状态 喵...
    {:else}
      🚀 本地混合加密并触发自动化流水线发布 喵！
    {/if}
  </button>

  {#if statusText}
    <div class="mt-4 p-4 rounded-xl text-sm bg-base-300 border border-base-content/10 flex items-center justify-between">
      <span class="font-mono">{statusText}</span>
      {#if isPublishing}
        <span class="loading loading-dots loading-sm text-primary"></span>
      {/if}
    </div>
  {/if}
</div>
