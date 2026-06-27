/**
 * 搜索引擎 URL 实时提交脚本 (Google Indexing API & IndexNow / Bing)
 * 
 * 运行方式:
 * 1. 自动检测改动提交: node scripts/submit-urls.js
 * 2. 手动指定提交: node scripts/submit-urls.js https://blog.yaoxi.wiki/posts/some-post/
 * 3. 全量 Sitemap 提交: node scripts/submit-urls.js --all
 * 
 * 环境变量配置 (Google Indexing API 必需):
 * export GOOGLE_SERVICE_ACCOUNT_KEY='{"type": "service_account", "project_id": ...}'
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 自动加载根目录下的 .env 配置文件，避免三方库依赖
try {
    const envPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const lines = envContent.split(/\r?\n/);
        let currentKey = null;
        let currentValue = [];
        let inQuotes = false;
        let quoteChar = null;

        for (const line of lines) {
            const cleanLine = line.trim();
            
            if (!inQuotes) {
                if (!cleanLine || cleanLine.startsWith('#')) continue;
                
                const delimiterIndex = cleanLine.indexOf('=');
                if (delimiterIndex !== -1) {
                    const key = cleanLine.substring(0, delimiterIndex).trim();
                    let val = cleanLine.substring(delimiterIndex + 1).trim();
                    
                    // 检测是否以单引号或双引号开头
                    if (val.startsWith('"') || val.startsWith("'")) {
                        quoteChar = val[0];
                        // 检查是否在同一行闭合
                        if (val.endsWith(quoteChar) && val.length > 1) {
                            let finalVal = val.substring(1, val.length - 1);
                            finalVal = finalVal.replace(/\\n/g, '\n');
                            if (!process.env[key]) process.env[key] = finalVal;
                        } else {
                            // 未闭合，跨行读取
                            inQuotes = true;
                            currentKey = key;
                            currentValue.push(val.substring(1));
                        }
                    } else {
                        if (!process.env[key]) process.env[key] = val;
                    }
                }
            } else {
                // 多行追加逻辑
                if (line.endsWith(quoteChar)) {
                    currentValue.push(line.substring(0, line.length - quoteChar.length));
                    inQuotes = false;
                    let finalVal = currentValue.join('\n');
                    finalVal = finalVal.replace(/\\n/g, '\n');
                    if (!process.env[currentKey]) process.env[currentKey] = finalVal;
                    currentKey = null;
                    currentValue = [];
                } else {
                    currentValue.push(line);
                }
            }
        }
    }
} catch (e) {
    console.warn(`[Env] 自动加载 .env 配置文件失败:`, e.message);
}

// 基础配置
const HOST = "blog.yaoxi.wiki";
const SITE_URL = `https://${HOST}`;
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || "b5e805d422e801f439b3a140d0b0bcc39120202c";
const INDEXNOW_KEY_FILE = "046ec0635a134ddfb686f6db24924071.txt";
const INDEXNOW_KEY_LOCATION = `${SITE_URL}/${INDEXNOW_KEY_FILE}`;

// 获取待提交的 URLs
async function getUrls() {
    const args = process.argv.slice(2);
    
    // 1. 手动传参模式
    if (args.length > 0 && !args.includes('--all')) {
        const manualUrls = args.filter(arg => arg.startsWith('http'));
        if (manualUrls.length > 0) {
            console.log(`[URL] 检测到手动指定的 URL: \n${manualUrls.join('\n')}`);
            return manualUrls;
        }
    }

    // 2. 全量 Sitemap 模式
    if (args.includes('--all')) {
        console.log(`[URL] 开始读取 Sitemap 进行全量提交...`);
        try {
            // 优先读取本地打包出来的 sitemap
            const sitemapPath = path.resolve(__dirname, '../dist/sitemap-0.xml');
            if (fs.existsSync(sitemapPath)) {
                const content = fs.readFileSync(sitemapPath, 'utf-8');
                const urls = [...content.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/g)].map(m => m[1]);
                console.log(`[URL] 从本地 sitemap 中读取到 ${urls.length} 个链接`);
                return urls;
            } else {
                console.warn(`[URL] 本地 dist/sitemap-0.xml 不存在，尝试拉取线上 sitemap...`);
                const response = await fetch(`${SITE_URL}/sitemap-0.xml`);
                const content = await response.text();
                const urls = [...content.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/g)].map(m => m[1]);
                console.log(`[URL] 从线上 sitemap 中读取到 ${urls.length} 个链接`);
                return urls;
            }
        } catch (e) {
            console.error(`[URL] 读取 Sitemap 失败:`, e.message);
            return [];
        }
    }

    // 3. 自动 Git 检测模式
    console.log(`[URL] 自动模式：通过 Git 查找最近修改的文章...`);
    const urls = new Set();

    try {
        let diffFiles = [];
        try {
            const gitDiff = execSync('git diff --name-only HEAD~1', { encoding: 'utf-8' });
            diffFiles = diffFiles.concat(gitDiff.split('\n'));
        } catch (e) {
            // ignore
        }
        try {
            const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8' });
            const statusFiles = gitStatus.split('\n').map(l => l.trim().replace(/^[\s\S]*?\s+/, '').replace(/"/g, ''));
            diffFiles = diffFiles.concat(statusFiles);
        } catch (e) {
            // ignore
        }

        let hasRealChange = false;
        for (const file of diffFiles) {
            const cleanLine = file.trim();
            if (!cleanLine) continue;

            // 文章变更
            if (cleanLine.startsWith('src/content/posts/') && cleanLine.endsWith('.md')) {
                const fileBasename = path.basename(cleanLine, '.md');
                if (fileBasename !== 'blog-dev-logs') { // 忽略日志文章
                    urls.add(`${SITE_URL}/posts/${fileBasename}/`);
                    hasRealChange = true;
                }
            }
            // 朋友圈动态变更
            if (cleanLine.startsWith('src/content/moments/') || cleanLine.includes('moments')) {
                urls.add(`${SITE_URL}/moments/`);
                hasRealChange = true;
            }
        }

        // 仅在存在实质性内容变更时，才附带提交首页
        if (hasRealChange) {
            urls.add(SITE_URL + '/');
        }
    } catch (e) {
        console.warn(`[URL] Git 检测失败:`, e.message);
    }

    const finalUrls = Array.from(urls);
    if (finalUrls.length > 0) {
        console.log(`[URL] 自动检测到 ${finalUrls.length} 个相关的 URL 进行提交: \n${finalUrls.join('\n')}`);
    } else {
        console.log(`[URL] 自动检测完毕：工作区无任何新内容更新，已跳过推送以保留 API 额度喵！`);
    }
    return finalUrls;
}

// Base64Url 编码
function base64url(strOrBuffer) {
    const buffer = Buffer.isBuffer(strOrBuffer) ? strOrBuffer : Buffer.from(strOrBuffer);
    return buffer.toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

// 手搓 Google JWT 签名
function generateGoogleJWT(clientEmail, privateKey) {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 3600;

    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/indexing',
        aud: 'https://oauth2.googleapis.com/token',
        exp: exp,
        iat: iat
    };

    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    // 使用 SHA256withRSA (RS256) 签名
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signatureInput);
    const signature = base64url(sign.sign(privateKey));

    return `${signatureInput}.${signature}`;
}

// 换取 Google Access Token
async function getGoogleAccessToken(jwt) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Google Auth 失败: ${errText}`);
    }
    
    const data = await response.json();
    return data.access_token;
}

// 提交至 Google Indexing API
async function submitToGoogle(url, token) {
    const response = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            url: url,
            type: 'URL_UPDATED'
        })
    });
    
    const data = await response.json();
    if (response.ok) {
        console.log(`[Google] 提交成功: ${url}`);
    } else {
        console.error(`[Google] 提交失败: ${url}, 原因:`, data.error?.message || data);
    }
}

// 提交至 IndexNow (Bing / Yandex)
async function submitToIndexNow(urls) {
    if (urls.length === 0) return;
    
    console.log(`[IndexNow] 正在向 IndexNow 提交 ${urls.length} 个 URL...`);
    try {
        const response = await fetch('https://api.indexnow.org/indexnow', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            },
            body: JSON.stringify({
                host: HOST,
                key: INDEXNOW_KEY,
                keyLocation: INDEXNOW_KEY_LOCATION,
                urlList: urls
            })
        });
        
        if (response.status === 200 || response.status === 202) {
            console.log(`[IndexNow] 提交成功 (状态码: ${response.status})！已通过微软 IndexNow 网关推送到各大搜索引擎喵！`);
        } else {
            const text = await response.text();
            console.error(`[IndexNow] 提交失败，状态码: ${response.status}, 回显:`, text);
        }
    } catch (e) {
        console.error(`[IndexNow] 请求出错:`, e.message);
    }
}

// 主程序入口
async function main() {
    const urls = await getUrls();
    if (urls.length === 0) {
        console.log(`[Info] 没有检测到需要提交的 URL，结束任务。`);
        return;
    }

    // 1. 提交至 IndexNow
    await submitToIndexNow(urls);

    // 2. 提交至 Google Indexing API (如有服务账号配置)
    const serviceAccountEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountEnv) {
        console.log(`\n[Google] 提示: 未配置 GOOGLE_SERVICE_ACCOUNT_KEY 环境变量。`);
        console.log(`如果需要向 Google 实时提交 URL，请在环境变量或 GitHub Secret 中配置 Google 服务账号 JSON 密钥喵~`);
        return;
    }

    console.log(`\n[Google] 检测到服务账号密钥，正在生成 JWT Token 进行授权...`);
    try {
        // 极致兼容多行物理换行格式的 JSON 私钥字符串
        let cleanedEnv = serviceAccountEnv.trim();
        const pkRegex = /("private_key"\s*:\s*")([\s\S]*?)(")/;
        const match = cleanedEnv.match(pkRegex);
        if (match) {
            const rawPrivateKey = match[2];
            const cleanPrivateKey = rawPrivateKey.replace(/\r?\n/g, '\\n');
            cleanedEnv = cleanedEnv.replace(pkRegex, `$1${cleanPrivateKey}$3`);
        }
        cleanedEnv = cleanedEnv.replace(/\r?\n/g, ' ');

        const credentials = JSON.parse(cleanedEnv);
        const jwt = generateGoogleJWT(credentials.client_email, credentials.private_key);
        const token = await getGoogleAccessToken(jwt);
        
        console.log(`[Google] 授权成功！正在向 Google Indexing API 批量提交 URL...`);
        // 限制 Google Indexing 速率，这里依次执行
        for (const url of urls) {
            await submitToGoogle(url, token);
            await new Promise(r => setTimeout(r, 200)); // 适当限速
        }
    } catch (e) {
        console.error(`[Google] 提交出错:`, e.message);
    }
}

main().catch(console.error);
