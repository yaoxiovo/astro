/**
 * 教材与知识库强类型契约规范 (Textbook Knowledge Model)
 *
 * 遵循 Astro 5.x Content Collections 架构，针对结构化教材展示页、知识图谱与图文知识点
 * 提供严密的类型约束、枚举定义与分类聚合契约。
 */

/** 学科分类枚举 */
export type SubjectType =
	| "math" // 数学 / 高等数学 / 线性代数 / 概率论
	| "cs" // 计算机科学 / 算法与数据结构 / 系统设计
	| "physics" // 物理学 / 普通物理 / 理论力学 / 电磁学
	| "chinese" // 语文 / 古典文学 / 现当代文学 / 语言学
	| "english" // 英语 / 外语语言学
	| "chemistry" // 化学
	| "biology" // 生物学
	| "history" // 历史学
	| "philosophy" // 哲学 / 认知科学
	| "other" // 其他通识
	| (string & {});

export type TextbookSubjectId =
	| "math"
	| "physics"
	| "chemistry"
	| "cs"
	| "english"
	| "biology"
	| "chinese"
	| "history"
	| "philosophy"
	| "other"
	| (string & {});

export type SubjectFilter = "all" | TextbookSubjectId;

/** 教材知识点表现类型 */
export type TextbookType = "article" | "image" | "hybrid";
export type KnowledgeTypeFilter = "all" | TextbookType;

/** 难度等级定义 */
export type DifficultyLevel = "beginner" | "intermediate" | "advanced" | "easy" | "medium" | "hard";

/** 知识点完成/状态标记 */
export type TextbookStatus = "completed" | "in-progress" | "archived";

/**
 * 教材 Frontmatter 元数据规范 (由 Zod 严格校验)
 */
export interface TextbookFrontmatter {
	/** 知识点/章节标题 */
	title: string;
	/** 所属学科代号或名称，如 'math', 'cs' */
	subject: SubjectType;
	/** 学段或层级，如 '大学本科 / 高等数学', '高中拔高', '工程实战' */
	grade?: string;
	/** 章节/主题模块，如 '第一章 极限与微积分', '动态规划专题' */
	chapter?: string;
	/** 呈现模式：纯文章 (article)、纯图解 (image)、图文并茂 (hybrid) */
	type?: TextbookType;
	/** 封面图或外链核心图解/脑图/拓扑图 URL */
	imageUrl?: string;
	/** 图片无障碍替代文本与摘要说明 */
	imageAlt?: string;
	/** 知识点关键词与标签 */
	tags?: string[];
	/** 核心概念摘要、导读或定理精要 */
	description?: string;
	/** 外部参考资料、课本教材出处或拓展学习链接 */
	externalUrl?: string;
	/** 发布或编撰时间 */
	published: Date;
	/** 最近修订更新时间 */
	updated?: Date;
	/** 排序权重，默认 0，数值越小越靠前显示 */
	order?: number;
	/** 难度层级：入门 (beginner)、进阶 (intermediate)、深研 (advanced) */
	difficulty?: DifficultyLevel;
	/** 是否为草稿模式 */
	draft?: boolean;
	/** 自定义图标（Iconify 语法），如 'material-symbols:functions' */
	icon?: string;
}

/**
 * 学科元数据配置规范
 */
export interface SubjectMeta {
	/** 学科标识符，与 SubjectType 对应 */
	id: string;
	/** 学科中文展示名称 */
	name: string;
	/** 兼容卡片组件简写标签 */
	label?: string;
	/** 学科英文或拼音标识 */
	labelEn: string;
	/** 图标标识（支持 Iconify，如 'material-symbols:menu-book'） */
	icon: string;
	/** 学科代表色（Hex 或 CSS 变量，便于 Badge / Tag 渲染） */
	color: string;
	/** 边框样式类名 */
	borderClass?: string;
	/** 徽章样式类名 */
	badgeClass?: string;
	/** 学科简要描述 */
	description: string;
	/** 推荐显示排序序号 */
	order: number;
}

/**
 * 经典学科元数据配置注册表
 */
export const SUBJECT_METAS: Record<string, SubjectMeta> = {
	math: {
		id: "math",
		name: "数学基础 / 微积分",
		label: "数学",
		labelEn: "Mathematics",
		icon: "material-symbols:functions",
		color: "text-blue-500",
		borderClass: "border-blue-500/20",
		badgeClass: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
		description: "从微积分极限、偏导梯度、线性代数矩阵到概率论的核心数学推导与几何直观",
		order: 1,
	},
	cs: {
		id: "cs",
		name: "计算机科学 / 算法",
		label: "计算机",
		labelEn: "Computer Science",
		icon: "material-symbols:code-blocks",
		color: "text-emerald-500",
		borderClass: "border-emerald-500/20",
		badgeClass: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
		description: "算法与数据结构、动态规划、系统架构设计与底层并发高可用工程实践",
		order: 2,
	},
	physics: {
		id: "physics",
		name: "物理学 / 理论力学",
		label: "物理",
		labelEn: "Physics",
		icon: "material-symbols:science",
		color: "text-purple-500",
		borderClass: "border-purple-500/20",
		badgeClass: "bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300",
		description: "牛顿力学、分析力学、拉格朗日量、变分原理与电磁场的自然物理建模",
		order: 3,
	},
	chinese: {
		id: "chinese",
		name: "语文与中国古典文学",
		label: "语文",
		labelEn: "Chinese Literature",
		icon: "material-symbols:history-edu",
		color: "text-amber-500",
		borderClass: "border-amber-500/20",
		badgeClass: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
		description: "先秦诸子风骨、文言文法考辨、古典诗词意象与传统哲学美学名篇精析",
		order: 4,
	},
	english: {
		id: "english",
		name: "英语 / 外语语言学",
		label: "英语",
		labelEn: "English & Linguistics",
		icon: "material-symbols:translate",
		color: "text-cyan-500",
		borderClass: "border-cyan-500/20",
		badgeClass: "bg-cyan-50 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-300",
		description: "学术英语写作、词源语义演化与跨文化交际表达精要",
		order: 5,
	},
	chemistry: {
		id: "chemistry",
		name: "化学 / 物质科学",
		label: "化学",
		labelEn: "Chemistry",
		icon: "material-symbols:experiment",
		color: "text-rose-500",
		borderClass: "border-rose-500/20",
		badgeClass: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300",
		description: "无机化学构型、有机机理反应与物理化学动力学分析",
		order: 6,
	},
	biology: {
		id: "biology",
		name: "生物学 / 生命科学",
		label: "生物",
		labelEn: "Biology",
		icon: "material-symbols:genetics",
		color: "text-green-500",
		borderClass: "border-green-500/20",
		badgeClass: "bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-300",
		description: "分子生物学、基因组学、细胞代谢机理与生态进化探秘",
		order: 7,
	},
	philosophy: {
		id: "philosophy",
		name: "哲学 / 逻辑与认知",
		label: "哲学",
		labelEn: "Philosophy",
		icon: "material-symbols:psychology",
		color: "text-indigo-500",
		borderClass: "border-indigo-500/20",
		badgeClass: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300",
		description: "数理逻辑、科学哲学、认识论与现代认知科学交叉思考",
		order: 8,
	},
	other: {
		id: "other",
		name: "综合通识",
		label: "通识",
		labelEn: "General Studies",
		icon: "material-symbols:menu-book",
		color: "text-slate-500",
		borderClass: "border-slate-500/20",
		badgeClass: "bg-slate-50 text-slate-600 dark:bg-slate-950/40 dark:text-slate-300",
		description: "跨学科视野、科学学习方法论与通识综合素养",
		order: 99,
	},
};

/**
 * 统一教材知识点对象 (兼容静态数据集、UI 组件与 Astro 集合运行时)
 */
export interface TextbookItem {
	/** 唯一标识符 */
	id: string;
	/** 标题 */
	title: string;
	/** 学科 */
	subject: SubjectType;
	/** 学科中文展示短标签 (如 '数学') */
	subjectLabel?: string;
	/** 呈现类型 */
	type: TextbookType;
	/** 学段或层级 */
	grade?: string;
	/** 章节/专题 */
	chapter?: string;
	/** 摘要导读 */
	summary?: string;
	/** 详细描述 */
	description?: string;
	/** 关键词标签 */
	tags?: string[];
	/** 封面图片外链/内链 */
	coverImage?: string;
	/** 高清大图/思维导图外链 */
	imageUrl?: string;
	/** 图片无障碍说明 */
	imageAlt?: string;
	/** 关联完整讲义文章路由 */
	articleUrl?: string;
	/** 外部参考链接 */
	externalUrl?: string;
	/** 核心要点考点列表 */
	keyPoints?: string[];
	/** 正文 Markdown 内容 */
	content?: string;
	/** 难度层级 */
	difficulty?: DifficultyLevel;
	/** 更新日期字符串 */
	updatedAt?: string;
	/** 作者 */
	author?: string;
	/** 排序权重 */
	order?: number;
	/** 草稿标识 */
	draft?: boolean;
	/** 图标 */
	icon?: string;

	/* Astro 集合与衍生字段 (运行时或映射后可用) */
	slug?: string;
	body?: string;
	data?: TextbookFrontmatter;
	formattedDate?: string;
	readingTime?: number;
	wordCount?: number;
	subjectMeta?: SubjectMeta;
}

/**
 * 按学科聚合的分类视图数据契约
 */
export interface SubjectCategory {
	/** 学科代号，如 'math' */
	subject: string;
	/** 学科元数据 */
	meta: SubjectMeta;
	/** 包含的教材知识点列表 */
	items: TextbookItem[];
	/** 该学科下知识点总数 */
	count: number;
	/** 该学科下的主要章节列表 */
	chapters: string[];
}

/**
 * 教材多维度筛选与过滤参数契约
 */
export interface TextbookFilterOptions {
	/** 按学科过滤 */
	subject?: string;
	/** 按内容类型过滤 ('article' | 'image' | 'hybrid') */
	type?: TextbookType | "all";
	/** 按学段/年级过滤 */
	grade?: string;
	/** 按章节过滤 */
	chapter?: string;
	/** 按标签过滤 */
	tag?: string;
	/** 按难度过滤 */
	difficulty?: DifficultyLevel;
	/** 关键词全局检索（匹配标题、摘要、标签与正文） */
	keyword?: string;
	/** 是否包含草稿（默认 false） */
	includeDrafts?: boolean;
	/** 排序规则：'order' (默认) | 'date-desc' | 'date-asc' | 'title' */
	sortBy?: "order" | "date-desc" | "date-asc" | "title";
}

/**
 * 教材库全局统计指标数据契约
 */
export interface TextbookStats {
	/** 总知识点数（不含草稿） */
	total: number;
	/** 总阅读字数统计 */
	totalWords: number;
	/** 按学科统计文章数 */
	subjectCounts: Record<string, number>;
	/** 按内容类型统计文章数 */
	typeCounts: Record<string, number>;
	/** 按难度统计文章数 */
	difficultyCounts: Record<string, number>;
	/** 标签词频统计列表 */
	tags: Array<{ tag: string; count: number }>;
}
