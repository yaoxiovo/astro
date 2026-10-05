import fs from "node:fs";
import path from "node:path";
import type { WikiHistoryData, WikiPostHistory } from "../types/wiki";

let cachedHistory: Record<string, WikiPostHistory> | null = null;

/**
 * 构建期获取全站或单篇文章的维基历史记录
 */
export function getPostWikiHistorySync(slug: string): WikiPostHistory | null {
	if (!cachedHistory) {
		const historyPath = path.resolve("src/data/wiki/history.json");
		if (fs.existsSync(historyPath)) {
			try {
				const raw = fs.readFileSync(historyPath, "utf-8");
				cachedHistory = JSON.parse(raw);
			} catch (e) {
				console.error("[WikiLoader] 读取 history.json 失败:", e);
			}
		}
	}
	return cachedHistory?.[slug] || null;
}

/**
 * 构建期获取指定 commit 快照原始内容
 */
export function getPostRevisionSnapshotSync(
	slug: string,
	sha: string,
): string | null {
	const shortSha = sha.slice(0, 7);
	const snapPath = path.resolve(
		`src/data/wiki/snapshots/${slug}/${shortSha}.json`,
	);
	if (fs.existsSync(snapPath)) {
		try {
			const data = JSON.parse(fs.readFileSync(snapPath, "utf-8"));
			return data.content || null;
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * 获取所有拥有历史记录的文章列表
 */
export function getAllWikiHistoryMap(): Record<string, WikiPostHistory> {
	if (!cachedHistory) {
		const historyPath = path.resolve("src/data/wiki/history.json");
		if (fs.existsSync(historyPath)) {
			try {
				const raw = fs.readFileSync(historyPath, "utf-8");
				cachedHistory = JSON.parse(raw);
			} catch (e) {
				console.error("[WikiLoader] 读取 history.json 失败:", e);
			}
		}
	}
	return cachedHistory || {};
}
