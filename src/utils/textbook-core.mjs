/**
 * 教材与知识库核心纯函数算法引擎 (Textbook Core Engine)
 *
 * 包含学科元数据注册表、多维度过滤算法、模糊搜索、外链 URL 安全校验、
 * 统计聚合与 Schema 契约校验等纯算法逻辑。
 * 无 Astro 虚拟模块依赖，支持 Node.js 单元测试与浏览器/SSR 原生导入。
 */

/**
 * 经典学科元数据映射注册表
 */
export const SUBJECT_METADATA_MAP = {
	math: {
		id: "math",
		name: "数学基础 / 微积分",
		label: "数学",
		labelEn: "Mathematics",
		icon: "material-symbols:functions",
		color: "text-blue-500",
		borderClass: "border-blue-500/20",
		badgeClass:
			"bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
		description:
			"从微积分极限、偏导梯度、线性代数矩阵到概率论的核心数学推导与几何直观",
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
		badgeClass:
			"bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
		description:
			"算法与数据结构、动态规划、系统架构设计与底层并发高可用工程实践",
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
		badgeClass:
			"bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300",
		description:
			"牛顿力学、分析力学、拉格朗日量、变分原理与电磁场的自然物理建模",
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
		badgeClass:
			"bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
		description:
			"先秦诸子风骨、文言文法考辨、古典诗词意象与传统哲学美学名篇精析",
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
		badgeClass:
			"bg-cyan-50 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-300",
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
		badgeClass:
			"bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300",
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
		badgeClass:
			"bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-300",
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
		badgeClass:
			"bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300",
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
		badgeClass:
			"bg-slate-50 text-slate-600 dark:bg-slate-950/40 dark:text-slate-300",
		description: "跨学科视野、科学学习方法论与通识综合素养",
		order: 99,
	},
};

export const SUBJECT_METAS = SUBJECT_METADATA_MAP;

/**
 * 默认兜底占位图（SVG Data URI，零外部网络依赖）
 */
export const DEFAULT_FALLBACK_IMAGE =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 500'%3E%3Crect width='100%25' height='100%25' fill='%231e293b'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='24' fill='%2394a3b8' text-anchor='middle' dominant-baseline='middle'%3ETextbook Knowledge Matrix%3C/text%3E%3C/svg%3E";

/**
 * 外链图片与媒体 URL 安全校验器
 * 拦截非法协议、恶意 URI 注入与空路径，并支持安全兜底降级
 */
export function validateImageUrl(rawUrl, fallbackUrl = DEFAULT_FALLBACK_IMAGE) {
	if (!rawUrl || typeof rawUrl !== "string") {
		return {
			valid: false,
			url: fallbackUrl,
			isExternal: false,
			isHttps: false,
			isDataUri: false,
			reason: "URL 为空或非字符串类型",
		};
	}

	const trimmed = rawUrl.trim();
	if (!trimmed) {
		return {
			valid: false,
			url: fallbackUrl,
			isExternal: false,
			isHttps: false,
			isDataUri: false,
			reason: "URL 仅包含空白字符",
		};
	}

	// 允许内联 SVG/图片 Data URI
	if (trimmed.startsWith("data:image/")) {
		return {
			valid: true,
			url: trimmed,
			isExternal: false,
			isHttps: false,
			isDataUri: true,
		};
	}

	// 允许站内绝对路径（如 /assets/...）
	if (trimmed.startsWith("/")) {
		return {
			valid: true,
			url: trimmed,
			isExternal: false,
			isHttps: false,
			isDataUri: false,
		};
	}

	// 外链解析校验
	try {
		const parsed = new URL(trimmed);
		const protocol = parsed.protocol.toLowerCase();

		if (protocol === "https:") {
			return {
				valid: true,
				url: trimmed,
				isExternal: true,
				isHttps: true,
				isDataUri: false,
			};
		}

		if (protocol === "http:") {
			return {
				valid: true,
				url: trimmed,
				isExternal: true,
				isHttps: false,
				isDataUri: false,
				warning: "HTTP 明文协议，建议升级为 HTTPS",
			};
		}

		// 拦截 javascript:, file:, ftp: 等非法/危险协议
		return {
			valid: false,
			url: fallbackUrl,
			isExternal: false,
			isHttps: false,
			isDataUri: false,
			reason: `不支持或不安全的协议: ${protocol}`,
		};
	} catch {
		return {
			valid: false,
			url: fallbackUrl,
			isExternal: false,
			isHttps: false,
			isDataUri: false,
			reason: "URL 格式解析失败 (Malformed URL)",
		};
	}
}

/**
 * 获取学科元数据，未登记学科自动生成优雅降级元数据
 */
export function getSubjectMeta(subject) {
	const key = (subject || "other").toLowerCase().trim();
	if (SUBJECT_METADATA_MAP[key]) {
		return SUBJECT_METADATA_MAP[key];
	}
	return {
		id: key,
		name: subject || "其他领域",
		label: subject || "其他",
		labelEn: subject ? subject.toUpperCase() : "Other",
		icon: "material-symbols:menu-book",
		color: "text-slate-500",
		borderClass: "border-slate-500/20",
		badgeClass:
			"bg-slate-50 text-slate-600 dark:bg-slate-950/40 dark:text-slate-300",
		description: `关于 ${subject} 的系统化知识整理与教材笔记`,
		order: 50,
	};
}

/**
 * 剥离 ID 中的拓展名与多余前缀，得到纯净 Slug
 */
export function stripTextbookSlug(id = "") {
	const clean = String(id).replace(/\.(md|mdx)$/, "");
	const parts = clean.split("/");
	return parts[parts.length - 1] || clean;
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
export function formatTextbookDate(dateInput) {
	try {
		const date = new Date(dateInput);
		if (Number.isNaN(date.getTime())) {
			return "2026-01-01";
		}
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, "0");
		const d = String(date.getDate()).padStart(2, "0");
		return `${y}-${m}-${d}`;
	} catch {
		return "2026-01-01";
	}
}

/**
 * 计算纯文字数（支持中英双模统计）
 */
export function countTextbookWords(body = "") {
	if (!body) return 0;
	const text = String(body)
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/\$\$[\s\S]*?\$\$/g, " ")
		.replace(/\$[^$]*\$/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[#>*_`~|-]/g, " ")
		.trim();

	const chineseMatches = text.match(/[\u4e00-\u9fa5]/g) || [];
	const englishMatches = text.match(/[a-zA-Z0-9_-]+/g) || [];

	return chineseMatches.length + englishMatches.length;
}

/**
 * 估算阅读耗时（分钟）
 */
export function estimateTextbookReadingTime(wordCount) {
	const wordsPerMinute = 300;
	const minutes = Math.ceil((wordCount || 0) / wordsPerMinute);
	return Math.max(1, minutes);
}

/**
 * 纯函数：根据学科过滤教材知识点
 */
export function filterTextbooksBySubject(items = [], subject = "all") {
	if (!subject || subject === "all") {
		return [...items];
	}
	const target = subject.toLowerCase().trim();
	return items.filter(
		(item) =>
			(item.subject && item.subject.toLowerCase() === target) ||
			(item.data?.subject && item.data.subject.toLowerCase() === target),
	);
}

/**
 * 纯函数：根据表现类型过滤教材知识点
 */
export function filterTextbooksByType(items = [], type = "all") {
	if (!type || type === "all") {
		return [...items];
	}
	const target = type.toLowerCase().trim();
	return items.filter(
		(item) =>
			(item.type && item.type.toLowerCase() === target) ||
			(item.data?.type && item.data.type.toLowerCase() === target),
	);
}

/**
 * 纯函数：多维度搜索与过滤算法
 */
export function filterTextbooks(items = [], options = {}) {
	const {
		subject = "all",
		type = "all",
		grade,
		chapter,
		tag,
		difficulty,
		keyword,
		includeDrafts = false,
		sortBy = "order",
	} = options;

	const filtered = items.filter((item) => {
		// 草稿过滤
		const isDraft = Boolean(item.draft || item.data?.draft);
		if (!includeDrafts && isDraft) {
			return false;
		}

		// 学科过滤
		const itemSubject = (
			item.subject ||
			item.data?.subject ||
			""
		).toLowerCase();
		if (subject && subject !== "all" && itemSubject !== subject.toLowerCase()) {
			return false;
		}

		// 类型过滤
		const itemType = (item.type || item.data?.type || "").toLowerCase();
		if (type && type !== "all" && itemType !== type.toLowerCase()) {
			return false;
		}

		// 难度过滤
		const itemDiff = item.difficulty || item.data?.difficulty;
		if (difficulty && itemDiff && itemDiff !== difficulty) {
			return false;
		}

		// 年级过滤
		const itemGrade = item.grade || item.data?.grade || "";
		if (grade && !itemGrade.includes(grade)) {
			return false;
		}

		// 章节过滤
		const itemChapter = item.chapter || item.data?.chapter || "";
		if (chapter && !itemChapter.includes(chapter)) {
			return false;
		}

		// 标签过滤
		if (tag) {
			const tagLower = tag.toLowerCase().trim();
			const itemTags = item.tags || item.data?.tags || [];
			const hasTag = itemTags.some(
				(t) => String(t).toLowerCase().trim() === tagLower,
			);
			if (!hasTag) return false;
		}

		// 关键词搜索（全字段匹配）
		if (keyword) {
			const kw = keyword.toLowerCase().trim();
			const title = (item.title || item.data?.title || "").toLowerCase();
			const desc = (
				item.summary ||
				item.description ||
				item.data?.description ||
				""
			).toLowerCase();
			const itemTags = item.tags || item.data?.tags || [];
			const tagMatch = itemTags.some((t) =>
				String(t).toLowerCase().includes(kw),
			);
			const keyPoints = item.keyPoints || [];
			const keyPointsMatch = keyPoints.some((p) =>
				String(p).toLowerCase().includes(kw),
			);
			const content = (item.content || item.body || "").toLowerCase();

			if (
				!title.includes(kw) &&
				!desc.includes(kw) &&
				!tagMatch &&
				!keyPointsMatch &&
				!content.includes(kw)
			) {
				return false;
			}
		}

		return true;
	});

	return sortTextbooks(filtered, sortBy);
}

/**
 * 纯函数：排序教材列表
 */
export function sortTextbooks(items = [], sortBy = "order") {
	return [...items].sort((a, b) => {
		switch (sortBy) {
			case "date-desc": {
				const dateA = new Date(
					a.updatedAt || a.published || a.data?.published || 0,
				).getTime();
				const dateB = new Date(
					b.updatedAt || b.published || b.data?.published || 0,
				).getTime();
				return dateB - dateA;
			}
			case "date-asc": {
				const dateA = new Date(
					a.updatedAt || a.published || a.data?.published || 0,
				).getTime();
				const dateB = new Date(
					b.updatedAt || b.published || b.data?.published || 0,
				).getTime();
				return dateA - dateB;
			}
			case "title": {
				const titleA = a.title || a.data?.title || "";
				const titleB = b.title || b.data?.title || "";
				return titleA.localeCompare(titleB, "zh-CN");
			}
			default: {
				const orderA = a.order ?? a.data?.order ?? 0;
				const orderB = b.order ?? b.data?.order ?? 0;
				if (orderA !== orderB) {
					return orderA - orderB;
				}
				const dateA = new Date(
					a.updatedAt || a.published || a.data?.published || 0,
				).getTime();
				const dateB = new Date(
					b.updatedAt || b.published || b.data?.published || 0,
				).getTime();
				return dateB - dateA;
			}
		}
	});
}

/**
 * 纯函数：按学科聚合归类
 */
export function groupTextbooksBySubject(items = []) {
	const map = new Map();

	for (const item of items) {
		const subj = (item.subject || item.data?.subject || "other").toLowerCase();
		if (!map.has(subj)) {
			map.set(subj, []);
		}
		map.get(subj).push(item);
	}

	const categories = [];

	for (const [subj, groupItems] of map.entries()) {
		const meta = getSubjectMeta(subj);
		const sortedItems = sortTextbooks(groupItems, "order");

		const chapters = Array.from(
			new Set(
				sortedItems
					.map((i) => (i.chapter || i.data?.chapter || "").trim())
					.filter(Boolean),
			),
		);

		categories.push({
			subject: subj,
			meta,
			items: sortedItems,
			count: sortedItems.length,
			chapters,
		});
	}

	return categories.sort((a, b) => a.meta.order - b.meta.order);
}

/**
 * 别名：getSubjectCategories（纯数据模式）
 */
export function getSubjectCategories(items = []) {
	return groupTextbooksBySubject(items);
}

/**
 * 纯函数：提取所有标签与计数
 */
export function extractAllTextbookTags(items = []) {
	const tagCountMap = new Map();

	for (const item of items) {
		if (item.draft || item.data?.draft) continue;
		const tags = item.tags || item.data?.tags || [];
		for (const tag of tags) {
			const cleanTag = String(tag).trim();
			if (!cleanTag) continue;
			tagCountMap.set(cleanTag, (tagCountMap.get(cleanTag) || 0) + 1);
		}
	}

	return Array.from(tagCountMap.entries())
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"));
}

/**
 * 纯函数：计算教材全景统计信息
 */
export function calculateTextbookStats(items = []) {
	const publishedItems = items.filter((i) => !i.draft && !i.data?.draft);
	const subjectCounts = {};
	const typeCounts = {
		article: 0,
		image: 0,
		hybrid: 0,
	};
	const difficultyCounts = {
		beginner: 0,
		intermediate: 0,
		advanced: 0,
	};

	let totalWords = 0;

	for (const item of publishedItems) {
		const words =
			item.wordCount || countTextbookWords(item.content || item.body || "");
		totalWords += words;

		const subj = (item.subject || item.data?.subject || "other").toLowerCase();
		subjectCounts[subj] = (subjectCounts[subj] || 0) + 1;

		const t = (item.type || item.data?.type || "hybrid").toLowerCase();
		if (t in typeCounts) {
			typeCounts[t]++;
		}

		const d = (
			item.difficulty ||
			item.data?.difficulty ||
			"intermediate"
		).toLowerCase();
		if (d in difficultyCounts) {
			difficultyCounts[d]++;
		}
	}

	const tags = extractAllTextbookTags(publishedItems);

	return {
		total: publishedItems.length,
		totalWords,
		subjectCounts,
		typeCounts,
		difficultyCounts,
		tags,
	};
}

/**
 * Frontmatter / Item Schema 校验器
 */
export function validateTextbookSchema(data) {
	const errors = [];

	if (!data || typeof data !== "object") {
		return { valid: false, errors: ["条目数据必须为非空对象"] };
	}

	if (!data.title || typeof data.title !== "string" || !data.title.trim()) {
		errors.push("缺少必填字段: title (标题必须为非空字符串)");
	}

	if (
		!data.subject ||
		typeof data.subject !== "string" ||
		!data.subject.trim()
	) {
		errors.push("缺少必填字段: subject (学科必须为非空字符串)");
	}

	const validTypes = ["article", "image", "hybrid"];
	if (data.type && !validTypes.includes(data.type)) {
		errors.push(
			`非法 type 类型 '${data.type}', 必须是 [${validTypes.join(", ")}] 之一`,
		);
	}

	const validDifficulties = [
		"beginner",
		"intermediate",
		"advanced",
		"easy",
		"medium",
		"hard",
	];
	if (data.difficulty && !validDifficulties.includes(data.difficulty)) {
		errors.push(`非法 difficulty 等级 '${data.difficulty}'`);
	}

	if (data.tags !== undefined && !Array.isArray(data.tags)) {
		errors.push("tags 必须为字符串数组");
	}

	if (data.order !== undefined && typeof data.order !== "number") {
		errors.push("order 必须为数字类型");
	}

	// 校验图片 URL 合法性
	const img = data.imageUrl || data.coverImage;
	if (img) {
		const imgValidation = validateImageUrl(img);
		if (!imgValidation.valid) {
			errors.push(`图片 URL 格式不合法: ${imgValidation.reason}`);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		data: {
			title: String(data.title || "").trim(),
			subject: String(data.subject || "other").trim(),
			type: data.type || "hybrid",
			grade: data.grade || "",
			chapter: data.chapter || "",
			description: data.description || data.summary || "",
			imageUrl: data.imageUrl || data.coverImage || "",
			imageAlt: data.imageAlt || "",
			tags: Array.isArray(data.tags)
				? data.tags.map((t) => String(t).trim()).filter(Boolean)
				: [],
			externalUrl: data.externalUrl || data.articleUrl || "",
			order: typeof data.order === "number" ? data.order : 0,
			difficulty: data.difficulty || "intermediate",
			draft: Boolean(data.draft),
		},
	};
}
