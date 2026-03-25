import fs from 'fs';
import path from 'path';

// 1. 获取 GitHub Actions 的工作区绝对路径，本地运行时回退到当前目录
const rootDir = process.env.GITHUB_WORKSPACE || process.cwd();

// 2. 定义文件的绝对路径
// 请务必确认仓库中 src/content/posts/ 下确实存在这个 .md 文件
const postPath = path.join(rootDir, 'src/content/posts/countdown-to-zhongkao.md');

// 3. 计算倒计时（2026-06-30）
const TARGET_DATE = new Date('2026-06-30T00:00:00');
const today = new Date();
const diff = TARGET_DATE - today;
const remainingDays = Math.ceil(diff / (1000 * 60 * 60 * 24));

try {
    console.log(`正在尝试打开绝对路径: ${postPath}`);
    
    if (!fs.existsSync(postPath)) {
        throw new Error(`文件不存在！请检查仓库路径是否为 src/content/posts/countdown-to-zhongkao.md`);
    }

    let content = fs.readFileSync(postPath, 'utf8');
    
    // 匹配并替换内容
    const updatedContent = content.replace(/> \*\*当前剩余：\d+ 天\*\*/g, `> **当前剩余：${remainingDays} 天**`);
    
    fs.writeFileSync(postPath, updatedContent);
    console.log(`✅ 成功！绝对路径更新完成，剩余 ${remainingDays} 天`);
} catch (err) {
    console.error(`❌ 失败: ${err.message}`);
    process.exit(1);
}
