/**
 * Static Content CI/CD Quality Engineering Gate Contracts
 *
 * Provides industrial-grade type definitions for:
 * 1. Content AST Linter matrix & diagnostic violations (QualityIssue)
 * 2. Multi-dimensional inspection cards (CJK, dead links, readability, code-prose ratio)
 * 3. Comprehensive post-level quality scorecards (ContentQualityScorecard)
 * 4. Severity levels (error, warn, info) and rating grades (S, A, B, C)
 * 5. CI/CD automated gate threshold and execution results (QualityGateResult)
 *
 * @module types/quality
 */

/**
 * Diagnostic issue severity levels mapped to CI pipeline gates:
 * - "error": Hard gate failure. Immediately fails CI check.
 * - "warn": Quality score penalty deduction. Does not block unless strict threshold exceeded.
 * - "info": Informational advice, style hint, or educational improvement note.
 */
export type QualitySeverity = "error" | "warn" | "info";

/**
 * Overall quality rating grades:
 * - "S" (Masterpiece): Score >= 95. Impeccable typography, zero broken links, outstanding readability.
 * - "A" (Excellent): Score >= 85. Clean structure, minor stylistic suggestions.
 * - "B" (Acceptable): Score >= 70. Meets baseline publishing threshold, non-blocking warnings present.
 * - "C" (Needs Revision): Score < 70. Critical readability, formatting, or link defects.
 */
export type QualityGrade = "S" | "A" | "B" | "C";

/**
 * Supported quality inspection dimensions across the AST analysis matrix:
 * - "cjk_typography": Pangu spacing, full-width/half-width symbols, proper noun casing, quote pairs.
 * - "dead_links": Broken internal links, 404/500 external links, missing anchor tags, broken images.
 * - "readability": Flesch-Kincaid grade level, reading ease, sentence/paragraph length distribution.
 * - "code_prose_ratio": Balance between explanatory prose and code blocks, orphan snippet detection.
 * - "frontmatter_schema": Title/description lengths, valid tags, publication dates, SEO compliance.
 * - "accessibility_a11y": Image alt texts, heading hierarchy jump checks (e.g. h2 -> h4).
 */
export type QualityDimensionType =
	| "cjk_typography"
	| "dead_links"
	| "readability"
	| "code_prose_ratio"
	| "frontmatter_schema"
	| "accessibility_a11y";

/**
 * Exact code location locator for diagnostics and editor squiggles.
 */
export interface SourceLocation {
	readonly file: string;
	readonly line: number;
	readonly column: number;
	readonly endLine?: number;
	readonly endColumn?: number;
	readonly offset?: number;
}

/**
 * Individual quality diagnostic violation emitted by an AST linter rule.
 */
export interface QualityIssue {
	/** Unique diagnostic rule identifier, e.g. "CJK_PANGU_SPACE", "LINK_BROKEN_INTERNAL" */
	readonly ruleId: string;
	/** Inspection dimension grouping this issue */
	readonly dimension: QualityDimensionType;
	/** Severity of the violation */
	readonly severity: QualitySeverity;
	/** Human-readable explanation of the defect */
	readonly message: string;
	/** Optional source code location in the file */
	readonly location?: SourceLocation;
	/** Code or text snippet containing the defect */
	readonly contextSnippet?: string;
	/** Suggested correction or automated fix string */
	readonly suggestion?: string;
	/** Whether the linter engine can automatically fix this issue via `--fix` */
	readonly fixable: boolean;
	/** Score penalty points deducted for this violation */
	readonly penaltyPoints: number;
	/** Documentation reference URL explaining the rule and remediation */
	readonly docUrl?: string;
}

/**
 * Quantitative metrics for CJK typography inspection.
 */
export interface CjkTypographyMetrics {
	readonly totalChars: number;
	readonly cjkChars: number;
	readonly latinChars: number;
	/** Count of missing spaces between CJK and Latin/numeric characters */
	readonly spacingViolations: number;
	/** Half-width punctuation marks incorrectly used in full CJK context */
	readonly halfwidthPunctViolations: number;
	/** Casing errors in known technical terms (e.g. "github" instead of "GitHub") */
	readonly properNounCaseViolations: number;
	/** Unbalanced or inconsistent quotation marks (e.g. mixed straight and curved quotes) */
	readonly quotePairViolations: number;
}

/**
 * Quantitative metrics for link and resource integrity.
 */
export interface DeadLinkMetrics {
	readonly totalLinks: number;
	readonly internalLinks: number;
	readonly externalLinks: number;
	readonly imageLinks: number;
	readonly brokenInternalLinks: number;
	readonly brokenExternalLinks: number;
	readonly brokenAnchorLinks: number;
	readonly brokenImageLinks: number;
}

/**
 * Quantitative metrics for cognitive complexity and text readability.
 */
export interface ReadabilityMetrics {
	readonly totalWords: number;
	readonly totalSentences: number;
	readonly totalParagraphs: number;
	/** Flesch Reading Ease score (0 - 100, higher indicates easier to read) */
	readonly fleschReadingEase: number;
	/** Flesch-Kincaid Grade Level corresponding to US school grades */
	readonly fleschKincaidGradeLevel: number;
	/** Average word count per sentence */
	readonly avgSentenceLength: number;
	/** Average sentence count per paragraph */
	readonly avgParagraphLength: number;
	/** Longest sentence in characters or words */
	readonly maxSentenceLength: number;
	/** Count of sentences exceeding cognitive fatigue thresholds */
	readonly longSentenceCount: number;
	/** Estimated reading time in minutes */
	readonly estimatedReadingTimeMinutes: number;
}

/**
 * Quantitative metrics for balance between code snippets and narrative prose.
 */
export interface CodeProseMetrics {
	readonly totalLines: number;
	readonly proseLines: number;
	readonly codeLines: number;
	readonly codeBlockCount: number;
	/** Ratio of code lines to total lines (0.0 - 1.0) */
	readonly codeToProseRatio: number;
	/** Code snippets without preceding or succeeding explanatory text */
	readonly orphanCodeBlockCount: number;
	/** Code blocks without explicit syntax highlighting language tag */
	readonly unannotatedCodeBlockCount: number;
}

/**
 * Quantitative metrics for frontmatter schema validation and SEO.
 */
export interface FrontmatterMetrics {
	readonly hasTitle: boolean;
	readonly titleLength: number;
	readonly hasDescription: boolean;
	readonly descriptionLength: number;
	readonly hasCategory: boolean;
	readonly tagCount: number;
	readonly hasPublishedDate: boolean;
	readonly isDraft: boolean;
}

/**
 * Quantitative metrics for web content accessibility (WCAG 2.1 compliance).
 */
export interface AccessibilityMetrics {
	readonly totalImages: number;
	readonly missingAltImages: number;
	readonly headingLevels: readonly number[];
	readonly headingLevelSkips: number;
}

/**
 * Type map linking each dimension identifier to its strongly typed metrics model.
 */
export interface QualityDimensionMetricsMap {
	cjk_typography: CjkTypographyMetrics;
	dead_links: DeadLinkMetrics;
	readability: ReadabilityMetrics;
	code_prose_ratio: CodeProseMetrics;
	frontmatter_schema: FrontmatterMetrics;
	accessibility_a11y: AccessibilityMetrics;
}

/**
 * Scorecard evaluation for a single inspection dimension.
 */
export interface QualityDimensionScorecard<
	D extends QualityDimensionType = QualityDimensionType,
> {
	readonly dimension: D;
	readonly displayName: string;
	/** Calculated score for this dimension (0 - 100) */
	readonly score: number;
	/** Assigned weighting factor in overall composite score (0.0 - 1.0) */
	readonly weight: number;
	/** Whether this dimension satisfied its minimum pass criteria */
	readonly passed: boolean;
	readonly errorCount: number;
	readonly warnCount: number;
	readonly infoCount: number;
	readonly issues: readonly QualityIssue[];
	readonly metrics: D extends keyof QualityDimensionMetricsMap
		? QualityDimensionMetricsMap[D]
		: unknown;
}

/**
 * Badge representation for README / PR / CI summaries.
 */
export interface QualityBadge {
	readonly label: string;
	readonly message: string;
	readonly color: "brightgreen" | "green" | "yellow" | "orange" | "red";
}

/**
 * Comprehensive quality scorecard for a single markdown/wiki document.
 */
export interface ContentQualityScorecard {
	readonly schemaVersion: "1.0.0";
	/** Absolute or relative path to the content file */
	readonly filePath: string;
	/** Document slug identifier */
	readonly slug: string;
	/** Document title */
	readonly title: string;
	/** ISO 8601 evaluation timestamp */
	readonly evaluatedAt: string;
	/** Git commit SHA evaluated */
	readonly gitSha?: string;
	/** Composite quality score (0 - 100) */
	readonly overallScore: number;
	/** Assigned grade: "S" | "A" | "B" | "C" */
	readonly grade: QualityGrade;
	/** CI pass verdict: true if overallScore >= minScore and errorCount === 0 */
	readonly passed: boolean;
	/** Aggregated violation summary */
	readonly summary: {
		readonly totalIssues: number;
		readonly errorCount: number;
		readonly warnCount: number;
		readonly infoCount: number;
		readonly fixableCount: number;
	};
	/** Dimension-specific evaluations */
	readonly dimensions: {
		readonly [D in QualityDimensionType]: QualityDimensionScorecard<D>;
	};
	/** Shield badge visual metadata */
	readonly badge: QualityBadge;
}

/**
 * Configurable thresholds for CI/CD pipeline gate enforcement.
 */
export interface QualityGateThresholds {
	/** Minimum composite score required to pass gate (default: 75) */
	readonly minScore: number;
	/** Minimum grade required to pass gate (default: "B") */
	readonly minGrade: QualityGrade;
	/** Maximum allowable errors before blocking CI (default: 0) */
	readonly maxErrorsAllowed: number;
	/** Maximum allowable warnings before failing CI (default: 10) */
	readonly maxWarningsAllowed: number;
	/** Whether failing the quality gate aborts the build process */
	readonly blockCiOnFailure: boolean;
	/** Custom weights for each inspection dimension (sum must equal 1.0) */
	readonly weights: {
		readonly [D in QualityDimensionType]: number;
	};
}

/**
 * Repository-wide aggregated CI quality gate execution report.
 */
export interface QualityGateResult {
	readonly schemaVersion: "1.0.0";
	readonly timestamp: string;
	readonly runner: string;
	readonly gitCommitSha: string;
	readonly gitBranch?: string;
	/** Master verdict for the entire CI run */
	readonly passed: boolean;
	/** Mean score across all analyzed documents */
	readonly averageScore: number;
	/** Overall repository grade */
	readonly overallGrade: QualityGrade;
	readonly filesScanned: number;
	readonly filesPassed: number;
	readonly filesFailed: number;
	readonly thresholds: QualityGateThresholds;
	readonly scorecards: readonly ContentQualityScorecard[];
}

// ---------------------------------------------------------------------------
// Grade Computation & Helper Utilities
// ---------------------------------------------------------------------------

/**
 * Standard dimension weights totaling 1.0.
 */
export const DEFAULT_QUALITY_WEIGHTS: Readonly<
	Record<QualityDimensionType, number>
> = {
	cjk_typography: 0.25,
	dead_links: 0.25,
	readability: 0.2,
	code_prose_ratio: 0.15,
	frontmatter_schema: 0.1,
	accessibility_a11y: 0.05,
};

/**
 * Standard CI gate thresholds.
 */
export const DEFAULT_QUALITY_THRESHOLDS: QualityGateThresholds = {
	minScore: 75,
	minGrade: "B",
	maxErrorsAllowed: 0,
	maxWarningsAllowed: 10,
	blockCiOnFailure: true,
	weights: DEFAULT_QUALITY_WEIGHTS,
};

/**
 * Compute the letter grade from a numerical score (0 - 100).
 */
export function calculateQualityGrade(score: number): QualityGrade {
	if (score >= 95) {
		return "S";
	}
	if (score >= 85) {
		return "A";
	}
	if (score >= 70) {
		return "B";
	}
	return "C";
}

/**
 * Map quality grade to standard badge color.
 */
export function getQualityGradeBadgeColor(
	grade: QualityGrade,
): QualityBadge["color"] {
	switch (grade) {
		case "S":
			return "brightgreen";
		case "A":
			return "green";
		case "B":
			return "yellow";
		case "C":
			return "red";
	}
}

/**
 * Type guard for QualityGrade.
 */
export function isQualityGrade(value: unknown): value is QualityGrade {
	return value === "S" || value === "A" || value === "B" || value === "C";
}

/**
 * Type guard for QualitySeverity.
 */
export function isQualitySeverity(value: unknown): value is QualitySeverity {
	return value === "error" || value === "warn" || value === "info";
}

/**
 * Type guard for ContentQualityScorecard.
 */
export function isContentQualityScorecard(
	value: unknown,
): value is ContentQualityScorecard {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		candidate.schemaVersion === "1.0.0" &&
		typeof candidate.filePath === "string" &&
		typeof candidate.slug === "string" &&
		typeof candidate.overallScore === "number" &&
		isQualityGrade(candidate.grade) &&
		typeof candidate.passed === "boolean" &&
		typeof candidate.summary === "object" &&
		candidate.summary !== null &&
		typeof candidate.dimensions === "object" &&
		candidate.dimensions !== null
	);
}
