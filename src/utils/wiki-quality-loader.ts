import fs from "node:fs";
import path from "node:path";

export interface QualityBreakdownItem {
	score: number;
	max: number;
	label: string;
}

export interface QualityMetrics {
	totalLines: number;
	codeLines: number;
	codePercentage: string;
	cjkChars: number;
	englishWords: number;
	totalEquivalentWords: number;
	lexicalDiversity: string;
	readingMinutes: number;
	headingsCount: number;
}

export interface QualityIssue {
	type: string;
	severity: "error" | "warning" | "info";
	line: number;
	excerpt: string;
	message: string;
	suggestion?: string;
}

export interface QualityReport {
	slug: string;
	title: string;
	checkedAt: string;
	score: number;
	grade: "S" | "A" | "B" | "C" | "D";
	gradeLabel: string;
	badgeColor: "emerald" | "amber" | "orange" | "rose";
	breakdown: {
		typography: QualityBreakdownItem;
		links: QualityBreakdownItem;
		structure: QualityBreakdownItem;
		readability: QualityBreakdownItem;
	};
	metrics: QualityMetrics;
	issuesCount: {
		total: number;
		errors: number;
		warnings: number;
		infos: number;
	};
	issues: QualityIssue[];
}

const qualityCache = new Map<string, QualityReport | null>();
let matrixCache: Record<string, Partial<QualityReport>> | null = null;

/**
 * 构建期同步读取单篇博文的质量门禁体检报告
 */
export function getPostQualityReportSync(slug: string): QualityReport | null {
	if (qualityCache.has(slug)) {
		return qualityCache.get(slug) || null;
	}

	const reportPath = path.resolve(`src/data/wiki/quality/${slug}.json`);
	if (fs.existsSync(reportPath)) {
		try {
			const raw = fs.readFileSync(reportPath, "utf-8");
			const report = JSON.parse(raw) as QualityReport;
			qualityCache.set(slug, report);
			return report;
		} catch (e) {
			console.warn(`[QualityLoader] 解析 ${slug}.json 失败:`, e);
		}
	}

	qualityCache.set(slug, null);
	return null;
}

/**
 * 构建期获取全站博文质量体检矩阵汇总
 */
export function getAllQualityMatrixSync(): Record<
	string,
	Partial<QualityReport>
> {
	if (matrixCache) return matrixCache;

	const matrixPath = path.resolve("src/data/wiki/quality/matrix.json");
	if (fs.existsSync(matrixPath)) {
		try {
			const raw = fs.readFileSync(matrixPath, "utf-8");
			matrixCache = JSON.parse(raw);
			return matrixCache || {};
		} catch (e) {
			console.warn("[QualityLoader] 解析 matrix.json 失败:", e);
		}
	}

	return {};
}
