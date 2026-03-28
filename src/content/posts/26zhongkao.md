---
title: 2026年中考实时倒计时
published: 2026-03-28
description: 2026年中考实时倒计时
tags:
  - 中考
category: 记录
draft: false
lang: ""
pinned: true
---

---

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@700&family=Orbitron:wght@700&display=swap" rel="stylesheet">

<style>
  .countdown-container {
    background: rgba(0, 0, 0, 0.05);
    border: 1px solid rgba(var(--primary), 0.3);
    border-radius: 16px;
    padding: 2rem 1rem;
    margin: 2rem 0;
    text-align: center;
    backdrop-filter: blur(4px);
  }

  #countdown-timer {
    /* 使用 Orbitron 字体模拟电子计时器，或者用 JetBrains Mono 保持极客感 */
    font-family: 'JetBrains Mono', 'Orbitron', monospace;
    font-size: 2.2rem;
    font-weight: 700;
    color: #ff4757;
    /* 添加一点发光效果 */
    text-shadow: 0 0 15px rgba(255, 71, 87, 0.4);
    display: inline-block;
    min-width: 300px;
  }

  @media (max-width: 640px) {
    #countdown-timer {
      font-size: 1.5rem;
    }
  }
</style>

## 📅 2026 中考首场考试倒计时

<div class="countdown-container">
  <div id="countdown-timer">正在校准时间...</div>
</div>

<script is:inline>
  function updateCountdown() {
    const targetDate = new Date('2026-06-30T09:00:00').getTime();
    const now = new Date().getTime();
    const diff = targetDate - now;

    const timerElement = document.getElementById('countdown-timer');
    if (!timerElement) return;

    if (diff <= 0) {
      timerElement.innerText = "STARTING! GOOD LUCK!";
      return;
    }

    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);

    // 使用 padStart 保证数字跳动时容器宽度稳定，不晃动
    timerElement.innerText = 
      `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }

  setInterval(updateCountdown, 1000);
  updateCountdown();
</script>

---

