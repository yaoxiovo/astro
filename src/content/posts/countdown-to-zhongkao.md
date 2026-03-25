---
title: 冲刺中考：在压力中保持热爱，在代码中构建梦想
published: 2025-03-26
description: '中考倒计时自动更新方案及备考寄语'
tags: [中考, 开发笔记, 自动更新]
category: '成长记录'
draft: false 
lang: ''
---

## 📅 冲刺时刻：2026 中考倒计时

> **当前剩余：97 天**

---

### 💻 技术实现：让倒计时自动起来

为了让博客能够自动更新这个数字，而不是每天手动修改 `.md`，你可以使用以下 **Node.js 自动化脚本**。这非常适合集成在你的 Astro 构建流程或 GitHub Actions 中。

#### 1. 创建自动化脚本 `scripts/update-days.js`

```javascript
const fs = require('fs');
const path = require('path');

// 目标日期：2026年6月30日
const TARGET_DATE = new Date('2026-06-30T00:00:00');
const today = new Date();

// 计算天数差
const diff = TARGET_DATE - today;
const remainingDays = Math.ceil(diff / (1000 * 60 * 60 * 24));

// 目标文件路径
const postPath = path.join(__dirname, '../src/content/posts/countdown-to-zhongkao.md');

try {
    let content = fs.readFileSync(postPath, 'utf8');
    // 使用正则匹配“当前剩余：X 天”并替换
    const updatedContent = content.replace(/> \*\*当前剩余：\d+ 天\*\*/g, `> **当前剩余：${remainingDays} 天**`);
    
    fs.writeFileSync(postPath, updatedContent);
    console.log(`✅ 倒计时已成功更新为 ${remainingDays} 天`);
} catch (err) {
    console.error('❌ 更新失败:', err);
}
