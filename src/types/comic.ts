/**
 * 漫画板块强类型数据契约 (Comic Library & Reader Model)
 *
 * 适配海量章节漫画（如 700+ 话、10,000+ 页）的静态构建与按需加载架构：
 * - 书架目录与章节索引保持轻量（用于 `/comics/` 与 `/comics/[comic]/` 以及阅读器抽屉按需请求）
 * - 单话详情与图片页列表仅在对应 `/comics/[comic]/[chapter]/` 静态路由构建时注入
 * - 同时保留本地静态路径与原始图床兜底链接，兼顾本地自托管与无大文件仓库构建场景
 */

export type ComicStatus = "ongoing" | "completed" | "hiatus";

export type ComicChapterKind = "main" | "extra" | "notice";

export type ComicReadingMode = "scroll" | "page";

export type ComicWidthPreset = "compact" | "standard" | "wide" | "full";

export interface ComicPage {
	/** 页码（从 1 开始） */
	page: number;
	/** 图片原始宽度（px），用于锁定 aspect-ratio 避免 CLS 抖动 */
	width: number;
	/** 图片原始高度（px） */
	height: number;
	/** 主图片 URL（优先本地 /comics/... 静态资源） */
	src: string;
	/** 远程图床兜底 URL（本地图片缺失时自动回退） */
	fallbackUrl?: string;
	/** 文件体积（字节） */
	bytes?: number;
	/** 图片 SHA-256 校验值 */
	sha256?: string;
}

export interface ComicChapterSummary {
	/** 顺序号（1..N） */
	index: number;
	/** URL slug（如 "0001"） */
	slug: string;
	/** 章节标题 */
	title: string;
	/** 章节类型：正篇 / 番外 / 公告休刊 */
	kind: ComicChapterKind;
	/** 本话总页数 */
	pageCount: number;
	/** 原站参考链接 */
	sourceUrl?: string;
}

export interface ComicChapterDetail extends ComicChapterSummary {
	/** 当前话的全部页信息 */
	pages: ComicPage[];
}

export interface ComicSeriesMeta {
	/** 漫画唯一标识（URL slug，如 "huyao-xiaohongniang"） */
	slug: string;
	/** 漫画主标题 */
	title: string;
	/** 英文或副标题 */
	subtitle?: string;
	/** 原作者 / 编绘 */
	author: string;
	/** 制作工作室 / 出品方 */
	studio?: string;
	/** 连载状态 */
	status: ComicStatus;
	/** 题材主分类 */
	category: string;
	/** 标签列表 */
	tags: string[];
	/** 作品简介 */
	description: string;
	/** 封面图 URL（本地静态路径） */
	cover: string;
	/** 封面图远程兜底 URL */
	coverFallback?: string;
	/** 详情页横幅背景图 URL */
	banner?: string;
	/** 横幅图远程兜底 URL */
	bannerFallback?: string;
	/** 总章节数（含番外与公告） */
	totalChapters: number;
	/** 正篇章节数 */
	mainChapters: number;
	/** 番外章节数 */
	extraChapters: number;
	/** 公告/休刊章节数 */
	noticeChapters: number;
	/** 全部图片总页数 */
	totalPages: number;
	/** 资源总体积（字节） */
	totalBytes: number;
	/** 最后更新时间（YYYY-MM-DD） */
	updatedAt: string;
	/** 来源说明 */
	source?: string;
	/** 排序权重（越大越靠前） */
	order?: number;
}

export interface ComicSeriesIndex {
	meta: ComicSeriesMeta;
	chapters: ComicChapterSummary[];
}

export interface ComicSeriesManifest {
	meta: ComicSeriesMeta;
	chapters: ComicChapterDetail[];
}

export interface ComicChapterGroup {
	id: string;
	label: string;
	startIndex: number;
	endIndex: number;
	chapters: ComicChapterSummary[];
}

export interface ComicChapterFilterOptions {
	keyword?: string;
	kind?: ComicChapterKind | "all";
	sort?: "asc" | "desc";
}

export interface ComicReadingProgress {
	comicSlug: string;
	comicTitle: string;
	chapterIndex: number;
	chapterSlug: string;
	chapterTitle: string;
	page: number;
	totalPages: number;
	updatedAt: string;
}
