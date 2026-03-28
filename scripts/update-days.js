import fs from 'fs';
import path from 'path';

// 1. 获取工作区绝对路径
const rootDir = process.env.GITHUB_WORKSPACE || process.cwd();
const postPath = path.join(rootDir, 'src/content/posts/countdown-to-zhongkao.md');

// 2. 精准日期计算 (锁定北京时间/本地时间的凌晨)
const TARGET_DATE = new Date('2026-06-30T00:00:00');
const today = new Date();
today.setHours(0, 0, 0, 0); // 抹除时分秒误差

// 计算天数：目标时间 - 今天凌晨
const diffTime = TARGET_DATE - today;
const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

try {
    if (!fs.existsSync(postPath)) {
        throw new Error(`找不到文件，请确认路径: ${postPath}`);
    }

    let content = fs.readFileSync(postPath, 'utf8');
    
    // 3. 核心修复：先清理可能存在的 Git 冲突标记（HEAD/main 乱码）
    // 这样即便之前推坏了，脚本也能自动把它修好
    content = content.replace(/<<<<<<< HEAD[\s\S]*?=======/g, '');
    content = content.replace(/>>>>>>> main/g, '');
    content = content.replace(/=======[\s\S]*?main/g, '');

    // 4. 替换倒计时数字
    const regex = /> \*\*当前剩余：\d+ 天\*\*/g;
    const newText = `> **当前剩余：${diffDays} 天**`;
    
    const updatedContent = content.replace(regex, newText);
    
    fs.writeFileSync(postPath, updatedContent);
    console.log(`✅ 成功！中考倒计时校准为：${diffDays} 天`);
} catch (err) {
    console.error(`❌ 脚本运行失败: ${err.message}`);
    process.exit(1);
}