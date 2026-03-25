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
