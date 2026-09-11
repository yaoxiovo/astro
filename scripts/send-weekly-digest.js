/**
 * 博客每周动态与数据简报发送脚本
 * 触发方式：GitHub Actions 定时运行 (每周日) 或手动 `node scripts/send-weekly-digest.js [--preview]`
 */

const BLOG_ORIGIN = "https://blog.yaoxi.wiki";
const API_BASE = process.env.BLOG_API_BASE || "https://blog-api.yaoxi.cloud";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const args = process.argv.slice(2);
const isPreview = args.includes("--preview");

function getPastMondayStr() {
	const now = new Date();
	const day = now.getDay();
	const diff = now.getDate() - day + (day === 0 ? -6 : 1);
	const monday = new Date(now.setDate(diff));
	return monday.toISOString().slice(0, 10);
}

function getTodayStr() {
	return new Date().toISOString().slice(0, 10);
}

async function main() {
	const mondayStr = getPastMondayStr();
	const todayStr = getTodayStr();
	const weekRange = `${mondayStr} ~ ${todayStr}`;

	console.log(`📊 正在聚合本周周报数据 (${weekRange})...`);

	// 1. 获取朋友圈动态
	let momentsCount = 0;
	let topTags = [];
	try {
		const res = await fetch(`${BLOG_ORIGIN}/api/moments.json`, { signal: AbortSignal.timeout(10000) });
		if (res.ok) {
			const data = await res.json();
			const list = data?.moments || [];
			const thisWeekMoments = list.filter((m) => {
				const d = String(m.published || "").slice(0, 10);
				return d >= mondayStr && d <= todayStr;
			});
			momentsCount = thisWeekMoments.length;

			const tagMap = {};
			for (const m of thisWeekMoments) {
				for (const t of m.tags || []) {
					tagMap[t] = (tagMap[t] || 0) + 1;
				}
			}
			topTags = Object.entries(tagMap)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5)
				.map(([t]) => t);
		}
	} catch (e) {
		console.warn("获取朋友圈动态失败，跳过：", e.message);
	}

	// 2. 获取本周新文章
	let posts = [];
	try {
		const res = await fetch(`${BLOG_ORIGIN}/rss.xml`, { signal: AbortSignal.timeout(10000) });
		if (res.ok) {
			const xml = await res.text();
			const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
			for (const match of itemMatches) {
				const block = match[1];
				const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
				const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
				const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
				const desc =
					(block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || "";

				const d = new Date(pubDate);
				const dStr = !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "";

				// 本周文章
				if (dStr >= mondayStr && dStr <= todayStr && title && link) {
					posts.push({
						title: title.replace(/&amp;/g, "&").trim(),
						url: link.trim(),
						description: desc.replace(/<[^>]+>/g, "").slice(0, 120),
						pubDate: dStr,
					});
				}
			}
		}
	} catch (e) {
		console.warn("获取文章 RSS 失败，跳过：", e.message);
	}

	console.log(`📝 本周新增动态：${momentsCount} 条`);
	console.log(`📰 本周新增文章：${posts.length} 篇`);
	console.log(`🏷️ 热门标签：${topTags.join(", ") || "无"}`);

	if (!ADMIN_TOKEN && !isPreview) {
		console.warn("⚠️ 未配置 ADMIN_TOKEN，跳过调用 API 发送。");
		return;
	}

	const payload = {
		weekRange,
		posts,
		momentsCount,
		topTags,
		preview: isPreview,
	};

	try {
		const res = await fetch(`${API_BASE}/api/newsletter/weekly-digest`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {}),
			},
			body: JSON.stringify(payload),
		});

		const result = await res.json();
		console.log("周报接口响应：", res.status, result);

		if (!res.ok || !result.ok) {
			console.error("❌ 发送周报失败：", result.message || result.error);
			process.exitCode = 1;
		} else {
			console.log(`✅ 周报投递完成！总订阅者：${result.total ?? 0}，成功：${result.sent ?? 0}`);
		}
	} catch (err) {
		console.error("❌ 调用周报接口异常：", err);
		process.exitCode = 1;
	}
}

main();
