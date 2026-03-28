---
title: 测试
published: 2025-12-27
description: 测试
tags:
  - Cloudflare
  - 域名解析
  - CDN
  - 网站加速
  - 教程
category: 记录
draft: false
lang: ""
---

## 📅 距离 2026 中考还有：

<div style="font-size: 2rem; font-weight: bold; color: #ff4757; text-align: center; margin: 20px 0; font-family: monospace;">
  <span id="countdown-timer">计算中...</span>
</div>

<script>
  function updateCountdown() {
    // 目标时间：2026年6月30日 09:00 (中考首场考试时间)
    const targetDate = new Date('2026-06-30T09:00:00').getTime();
    const now = new Date().getTime();
    const diff = targetDate - now;

    if (diff <= 0) {
      document.getElementById('countdown-timer').innerText = "考试开始！加油！";
      return;
    }

    // 计算天、时、分、秒
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    // 格式化输出：例如 94天 12时 05分 30秒
    document.getElementById('countdown-timer').innerText = 
      `${days}天 ${String(hours).padStart(2, '0')}时 ${String(minutes).padStart(2, '0')}分 ${String(seconds).padStart(2, '0')}秒`;
  }

  // 每秒更新一次
  setInterval(updateCountdown, 1000);
  updateCountdown(); // 立即执行一次防止白屏
</script>

---

> **备考寄语**：每一秒的跳动，都是你离梦想更近的一步。