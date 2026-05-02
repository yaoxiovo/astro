---
title: 冲刺中考：在压力中保持热爱，在代码中构建梦想
published: 2026-03-26
description: 中考倒计时自动更新方案及备考寄语
tags:
  - 中考
  - 开发笔记
  - 自动更新
category: 成长记录
draft: false
lang: ""
---

## 📅 冲刺时刻：2026 中考倒计时

> **当前剩余：59 天**

---

### 💻 技术实现：让倒计时自动起来

为了让博客能够自动更新这个数字，而不是每天手动修改 `.md`，你可以使用以下 **Node.js 自动化脚本**。这非常适合集成在你的 Astro 构建流程或 GitHub Actions 中。

#### 1. 创建自动化脚本 `scripts/update-days.js`

```JavaScript
import fs from 'fs';
import path from 'path';

// 1. 获取工作区绝对路径
const rootDir = process.env.GITHUB_WORKSPACE || process.cwd();
const postPath = path.join(rootDir, 'src/content/posts/countdown-to-zhongkao.md');

// 2. 精准日期计算 (锁定北京时间/本地时间的凌晨)
const TARGET_DATE = new Date('2026-06-30T00:00:00');
const today = new Date();
today.setHours(0, 0, 0, 0); // 抹除时分秒误差

const diffTime = TARGET_DATE - today;
const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

try {
    if (!fs.existsSync(postPath)) {
        throw new Error(`找不到文件，请确认路径: ${postPath}`);
    }

    let content = fs.readFileSync(postPath, 'utf8');
    
 
    content = content.replace(//g, '');
    content = content.replace(//g, '');
    content = content.replace(//g, '');

    
    const regex = /> \*\*当前剩余：\d+ 天\*\*/g;
    const newText = `> **当前剩余：${diffDays} 天**`;
    
    const updatedContent = content.replace(regex, newText);
    
    fs.writeFileSync(postPath, updatedContent);
    console.log(`✅ 成功！中考倒计时校准为：${diffDays} 天`);
} catch (err) {
    console.error(`❌ 脚本运行失败: ${err.message}`);
    process.exit(1);
}
```

#### 2. GitHub Actions：`.github/workflows/update-countdown.yml`

这个版本增加了 `rebase` 逻辑，专门对付 `push rejected` 和冲突问题。
```yaml
name: 自动更新中考倒计时

on:
  schedule:
    - cron: '5 16 * * *' # 每天北京时间 00:05 运行
  workflow_dispatch: 

jobs:
  update-md:
    runs-on: ubuntu-latest
    steps:
      - name: 检出代码
        uses: actions/checkout@v4
        with:
          fetch-depth: 0 # 获取完整历史以支持 rebase

      - name: 设置 Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: 运行更新脚本
        run: node ./scripts/update-days.js

      - name: 提交并强制同步推送
        run: |
          git config --local user.email "github-actions[bot]@users.noreply.github.com"
          git config --local user.name "github-actions[bot]"
          git add .
          # 如果有改动则提交
          if ! git diff --quiet --staged; then
            git commit -m "chore: 自动更新中考倒计时"
            # 关键步骤：先拉取远程改动并合并，防止冲突
            git pull origin main --rebase
            git push origin main
          else
            echo "没有天数变化，跳过更新。"
          fi
```
#### 3. 在文章开头初填入
```TXT
> **当前剩余：59 天**
```