/**
 * footprint.ts - 阅读足迹本地存储引擎（纯客户端，零基础设施）
 *
 * 设计要点：
 * - 全部数据仅存于读者设备 localStorage，绝不上云
 * - 按用户分区（登录 sub / 游客桶），登录时自动合并游客足迹
 * - 供 ReadingFootprint.astro（采集）与 /reader/ 读者中心（展示）共用
 */

export interface FootprintItem {
	slug: string;
	title: string;
	progress: number; // 0-100 最大阅读进度
	active: number;   // 累计活跃秒数（页面可见时）
	reads: number;    // 有效阅读次数（单次 ≥10s 计 1 次）
	first: number;    // 首次阅读时间戳 (ms)
	last: number;     // 最近阅读时间戳 (ms)
	tags: string[];
	pub?: string;     // 文章发布日期 ISO
}

export interface FootprintBucket {
	items: Record<string, FootprintItem>;
	days: Record<string, number>; // "YYYY-MM-DD" -> 当日活跃秒数
	created: number;
}

export interface FootprintStore {
	v: 1;
	buckets: Record<string, FootprintBucket>;
}

export const FOOTPRINT_KEY = "yaoxi_footprint_v1";
export const GUEST_BUCKET = "guest";
export const MAX_ITEMS = 500;
export const MAX_DAYS = 420;

export function todayKey(d = new Date()): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export function resolveBucketId(): string {
	try {
		let uid = localStorage.getItem("yaoxi_user_id") || localStorage.getItem("user_id") || "";
		if (!uid) {
			const raw = localStorage.getItem("yaoxi_auth_user") || localStorage.getItem("user_profile") || "";
			if (raw) {
				const u = JSON.parse(raw);
				uid = u?.sub || u?.id || "";
			}
		}
		return uid ? `u:${uid}` : GUEST_BUCKET;
	} catch {
		return GUEST_BUCKET;
	}
}

export function emptyBucket(): FootprintBucket {
	return { items: {}, days: {}, created: Date.now() };
}

export function loadStore(): FootprintStore {
	try {
		const raw = localStorage.getItem(FOOTPRINT_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (parsed && parsed.v === 1 && parsed.buckets && typeof parsed.buckets === "object") {
				return parsed as FootprintStore;
			}
		}
	} catch {}
	return { v: 1, buckets: {} };
}

export function saveStore(store: FootprintStore): void {
	try {
		localStorage.setItem(FOOTPRINT_KEY, JSON.stringify(store));
	} catch {}
}

export function getBucket(store: FootprintStore, id: string): FootprintBucket {
	if (!store.buckets[id]) store.buckets[id] = emptyBucket();
	return store.buckets[id];
}

export function mergeBuckets(dst: FootprintBucket, src: FootprintBucket): FootprintBucket {
	for (const [slug, item] of Object.entries(src.items || {})) {
		const cur = dst.items[slug];
		if (!cur) {
			dst.items[slug] = { ...item, tags: Array.isArray(item.tags) ? [...item.tags] : [] };
		} else {
			cur.progress = Math.max(cur.progress || 0, item.progress || 0);
			cur.active = (cur.active || 0) + (item.active || 0);
			cur.reads = (cur.reads || 0) + (item.reads || 0);
			cur.first = Math.min(cur.first || item.first || Date.now(), item.first || cur.first || Date.now());
			cur.last = Math.max(cur.last || 0, item.last || 0);
			if (!cur.title && item.title) cur.title = item.title;
			if ((!cur.tags || cur.tags.length === 0) && Array.isArray(item.tags)) cur.tags = [...item.tags];
			if (!cur.pub && item.pub) cur.pub = item.pub;
		}
	}
	for (const [day, sec] of Object.entries(src.days || {})) {
		dst.days[day] = (dst.days[day] || 0) + sec;
	}
	dst.created = Math.min(dst.created || Date.now(), src.created || Date.now());
	return dst;
}

export function pruneBucket(bucket: FootprintBucket, keepSlugs: string[] = []): void {
	const entries = Object.entries(bucket.items);
	if (entries.length > MAX_ITEMS) {
		const keep = new Set(keepSlugs);
		entries.sort((a, b) => (b[1].last || 0) - (a[1].last || 0));
		const kept: Record<string, FootprintItem> = {};
		for (const [slug, item] of entries) {
			if (Object.keys(kept).length >= MAX_ITEMS && !keep.has(slug)) continue;
			kept[slug] = item;
		}
		bucket.items = kept;
	}
	const days = Object.keys(bucket.days);
	if (days.length > MAX_DAYS) {
		days.sort();
		for (const d of days.slice(0, days.length - MAX_DAYS)) delete bucket.days[d];
	}
}

/** 连续打卡天数：从今天（或昨天）向前逐日回溯 */
export function computeStreak(days: Record<string, number>): number {
	const keys = new Set(Object.keys(days || {}));
	if (keys.size === 0) return 0;
	let streak = 0;
	const cursor = new Date();
	if (!keys.has(todayKey(cursor))) {
		cursor.setDate(cursor.getDate() - 1);
		if (!keys.has(todayKey(cursor))) return 0;
	}
	while (keys.has(todayKey(cursor))) {
		streak++;
		cursor.setDate(cursor.getDate() - 1);
	}
	return streak;
}

export function formatDuration(totalSec: number): string {
	const sec = Math.max(0, Math.floor(totalSec || 0));
	if (sec < 60) return `${sec} 秒`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min} 分钟`;
	const hours = Math.floor(min / 60);
	const remMin = min % 60;
	if (hours < 24) return remMin > 0 ? `${hours} 小时 ${remMin} 分` : `${hours} 小时`;
	const days = Math.floor(hours / 24);
	const remHours = hours % 24;
	return remHours > 0 ? `${days} 天 ${remHours} 小时` : `${days} 天`;
}

export function formatDate(ts: number): string {
	if (!ts) return "—";
	const d = new Date(ts);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 登录时把游客桶合并进用户桶，成功合并返回 true */
export function mergeGuestInto(store: FootprintStore, bucketId: string): boolean {
	if (bucketId === GUEST_BUCKET) return false;
	const guest = store.buckets[GUEST_BUCKET];
	if (!guest) return false;
	const hasContent = Object.keys(guest.items || {}).length > 0 || Object.keys(guest.days || {}).length > 0;
	if (!hasContent) {
		delete store.buckets[GUEST_BUCKET];
		return false;
	}
	const target = getBucket(store, bucketId);
	mergeBuckets(target, guest);
	pruneBucket(target);
	delete store.buckets[GUEST_BUCKET];
	return true;
}
