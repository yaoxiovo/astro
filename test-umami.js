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
    const startAt = 0; // Test startAt=0
    const endAt = Date.now();
    
    try {
        console.log("Sending request with startAt=0...");
        const res = await fetch(`${baseUrl}/api/websites/${websiteId}/metrics?type=path&startAt=${startAt}&endAt=${endAt}`, {
            headers: { 'x-umami-share-token': token }
        });
        console.log("METRICS RESP STATUS:", res.status);
        const text = await res.text();
        console.log("METRICS RESP LENGTH:", text.length);
        if (res.status !== 200) {
            console.log("METRICS ERROR BODY:", text);
        }
    } catch(e) {
        console.error("METRICS ERROR:", e);
    }
}
run();
