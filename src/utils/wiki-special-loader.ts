import fs from "node:fs";
import path from "node:path";

export interface RecentChangeEntry {
	slug: string;
	sha: string;
	shortSha: string;
	prevShortSha: string | null;
	date: string;
	displayDate: string;
	author: string;
	message: string;
	section: string | null;
	cleanMessage: string;
	byteSize: number;
	byteDelta: number;
	linesAdded: number;
	linesDeleted: number;
	isMinor: boolean;
	tags: string[];
}

export interface RecentChangesData {
	generatedAt: string;
	totalEntries: number;
	articles: Record<string, string>;
	entries: RecentChangeEntry[];
}

export interface BacklinkEntry {
	slug: string;
	title?: string;
	count: number;
}

export interface BacklinksData {
	generatedAt: string;
	backlinks: Record<string, BacklinkEntry[]>;
	outbound: Record<string, BacklinkEntry[]>;
}

export interface MaintenanceItem {
	slug: string;
	title: string;
	lastUpdated?: string | null;
	totalRevisions?: number;
	daysSinceUpdate?: number;
}

export interface MaintenanceLowQualityItem {
	slug: string;
	title: string;
	score: number;
	grade: string;
	issuesCount: number;
}

export interface MaintenanceBrokenLinkItem {
	slug: string;
	title: string;
	type: string;
	line: number;
	excerpt: string;
	message: string;
}

export interface MaintenanceReport {
	generatedAt: string;
	staleThresholdDays: number;
	stats: {
		totalPosts: number;
		totalRevisions: number;
		totalInternalLinks: number;
		totalOrphans: number;
		totalDeadEnds: number;
		totalStale: number;
		totalLowQuality: number;
		totalBrokenLinks: number;
	};
	orphans: MaintenanceItem[];
	deadEnds: MaintenanceItem[];
	stale: MaintenanceItem[];
	lowQuality: MaintenanceLowQualityItem[];
	brokenLinks: MaintenanceBrokenLinkItem[];
}

function readJsonSafe<T>(filePath: string): T | null {
	try {
		if (fs.existsSync(filePath)) {
			return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
		}
	} catch (e) {
		console.warn(`[WikiSpecialLoader] 解析 ${filePath} 失败:`, e);
	}
	return null;
}

let recentChangesCache: RecentChangesData | null | undefined;
let backlinksCache: BacklinksData | null | undefined;
let maintenanceCache: MaintenanceReport | null | undefined;

/**
 * 构建期读取全站最近更改流
 */
export function getRecentChangesSync(): RecentChangesData | null {
	if (recentChangesCache === undefined) {
		recentChangesCache = readJsonSafe<RecentChangesData>(
			path.resolve("src/data/wiki/recent-changes.json"),
		);
	}
	return recentChangesCache;
}

/**
 * 构建期读取指定条目的链入页面列表
 */
export function getBacklinksSync(slug: string): BacklinkEntry[] {
	if (backlinksCache === undefined) {
		backlinksCache = readJsonSafe<BacklinksData>(
			path.resolve("src/data/wiki/backlinks.json"),
		);
	}
	return backlinksCache?.backlinks?.[slug] || [];
}

/**
 * 构建期读取条目维护巡检报告
 */
export function getMaintenanceSync(): MaintenanceReport | null {
	if (maintenanceCache === undefined) {
		maintenanceCache = readJsonSafe<MaintenanceReport>(
			path.resolve("src/data/wiki/maintenance.json"),
		);
	}
	return maintenanceCache;
}
