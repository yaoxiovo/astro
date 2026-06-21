import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
    const configPath = path.join(__dirname, 'src', 'config.ts');
    let configStr = fs.readFileSync(configPath, 'utf8');
    
    // Quick hack to extract url and shareId
    const baseUrlMatch = configStr.match(/baseUrl:\s*['"]([^'"]+)['"]/);
    const shareIdMatch = configStr.match(/shareId:\s*['"]([^'"]+)['"]/);
    const baseUrl = baseUrlMatch[1];
    const shareId = shareIdMatch[1];
    
    const tokenRes = await fetch(`${baseUrl}/api/share/${shareId}`);
    const tokenData = await tokenRes.json();
    const token = tokenData.token;
    const websiteId = tokenData.websiteId;
    
    const startAt = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const endAt = Date.now();
    
    const res = await fetch(`${baseUrl}/api/websites/${websiteId}/metrics?type=path&startAt=${startAt}&endAt=${endAt}`, {
        headers: { 'x-umami-share-token': token }
    });
    console.log(await res.text());
}
run();
