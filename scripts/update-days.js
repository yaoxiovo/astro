import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 在 ES Module 中需要手动定义 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 目标日期：2026年6月30日
const TARGET_DATE = new Date('2026-06-30T00:00:00');
const today = new Date();

// 计算天数差
const diff = TARGET_DATE - today;
const remainingDays = Math.ceil(diff / (1000 * 60 * 60 * 24));

// 目标文件路径（请根据你的实际目录层级调整 ../ 的数量）
const postPath = path.join(__dirname, '../src/content/posts/countdown-to-zhongkao.md');

try {
    let content = fs.readFileSync(postPath, 'utf8');
    // 匹配“当前剩余：X 天”并替换
    const updatedContent = content.replace(/> \*\*当前剩余：\d+ 天\*\*/g, `> **当前剩余：${remainingDays} 天**`);
    
    fs.writeFileSync(postPath, updatedContent);
    console.log(`✅ 倒计时已成功更新为 ${remainingDays} 天`);
} catch (err) {
    console.error('❌ 更新失败:', err);
    process.exit(1);
}
