import type { TextbookItem } from "../types/textbook";

export const TEXTBOOK_ITEMS: TextbookItem[] = [
	{
		id: "math-derivative-monotonicity",
		title: "导数单调性与分类讨论全题型深度拆解",
		subject: "math",
		subjectLabel: "数学",
		type: "article",
		grade: "高中核心",
		chapter: "选修第二册 · 导数及其应用",
		summary:
			"深入归纳导函数变号零点探测、参数区间分离、构造辅助函数与二阶导数凹凸性判定的标准解题范式。",
		tags: ["微积分", "导数", "极值", "分类讨论", "函数构造"],
		coverImage:
			"https://images.unsplash.com/photo-1635070041078-e363dbe005cb?q=80&w=800&auto=format&fit=crop",
		articleUrl: "/posts/26zhongkao/",
		keyPoints: [
			"一阶导数 f'(x) > 0 对应原函数严格单增，注意端点变号充要性",
			"含参二次导函数求根：判别式 Δ、对称轴与定义域三维区间交叉讨论",
			"超越函数零点不可求时，利用零点存在性定理设出 x₀ 并代换降次",
			"常见构造模型：f(x) - x、eˣ·f(x) 与 x·f(x) 的导数特征反推",
		],
		content: `## 导数核心题型方法论精粹

### 一、求导与单调区间基本功
函数的单调性由导数的正负符号决定。在求单调区间时，务必**首要确立定义域**！
1. 求 $f'(x)$ 并通分因式分解。
2. 若导函数恒大于等于 0 且仅在孤立点为 0，则函数在区间上严格单增。
3. 遇到含参导函数，优先观察能否提出 $(x - x_0)$ 因式；若无法因式分解，转而研究导函数判别式或二阶导数。

### 二、隐零点代换设而不求法
当方程 $f'(x) = 0$ 无法直接解析解出时：
1. 证明 $f'(x)$ 在区间 $(a, b)$ 上严格单调且存在唯一零点 $x_0$；
2. 记录关系式 $f'(x_0) = 0$（如 $\\ln x_0 + 2x_0 = 0 \\implies \\ln x_0 = -2x_0$）；
3. 将极值表达式中的高阶项或对数项利用该关系替换为 $x_0$ 的单调式，完成最值估算。`,
		difficulty: "hard",
		updatedAt: "2026-03-15",
		author: "瑶曦",
	},
	{
		id: "math-function-mindmap",
		title: "高中数学核心思维导图：函数与解析几何全景拓扑",
		subject: "math",
		subjectLabel: "数学",
		type: "image",
		grade: "高中总复习",
		chapter: "专题突破 · 几何与代数交汇网络",
		summary:
			"高清结构化导图：从指对幂函数图象性质、三角变换公式群，到圆锥曲线齐次化联立与极点极线投影。",
		tags: ["思维导图", "解析几何", "圆锥曲线", "函数图象", "知识网络"],
		coverImage:
			"https://images.unsplash.com/photo-1509228468518-180dd4864904?q=80&w=800&auto=format&fit=crop",
		imageUrl:
			"https://images.unsplash.com/photo-1509228468518-180dd4864904?q=80&w=2400&auto=format&fit=crop",
		keyPoints: [
			"函数性质主轴：奇偶性、周期性、对称中心与对称轴的代数方程特征",
			"圆锥曲线弦长公式与韦达定理联立的标准降次模板",
			"抛物线焦点弦性质与第三定义（斜率之积为定值）的几何速解技巧",
		],
		difficulty: "medium",
		updatedAt: "2026-03-20",
		author: "瑶曦",
	},
	{
		id: "math-linear-algebra-eigen",
		title: "线性代数几何直观：特征值、特征向量与空间基变换图解",
		subject: "math",
		subjectLabel: "数学",
		type: "image",
		grade: "大学/考研核心",
		chapter: "线性空间 · 矩阵对角化与几何映射",
		summary:
			"突破干瘪的矩阵行列式计算，直观图解矩阵如何将基底向量拉伸、剪切与旋转，深刻领悟特征空间的本质。",
		tags: ["线性代数", "特征值", "空间变换", "3Blue1Brown", "考研数学"],
		coverImage:
			"https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=800&auto=format&fit=crop",
		imageUrl:
			"https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2400&auto=format&fit=crop",
		keyPoints: [
			"矩阵 $A$ 就是一种线性空间变换，列向量为变换后基底向量的新坐标",
			"特征向量在矩阵变换后保持方向不变，仅发生标量 $\\lambda$ 倍数的缩放",
			"特征分解 $A = PDP^{-1}$ 等价于：换基到特征坐标系 -> 纯拉伸 -> 换回原坐标系",
		],
		difficulty: "medium",
		updatedAt: "2026-02-18",
		author: "瑶曦",
	},
	{
		id: "cs-fullstack-architecture-evolution",
		title: "现代全栈架构演进：零知识 BFF、Edge 反向代理与即时发布流",
		subject: "cs",
		subjectLabel: "计算机",
		type: "article",
		grade: "工程实战",
		chapter: "分布式系统 · 现代静态与边缘全栈架构",
		summary:
			"立足本博客与生产级项目经验，深度剖析 Cloudflare Workers 边缘计算、Astro 孤岛架构与 D1 数据库的高并发高安全工程实践。",
		tags: [
			"全栈架构",
			"Astro",
			"Cloudflare Workers",
			"BFF",
			"数字主权",
		],
		coverImage:
			"https://images.unsplash.com/photo-1558494949-ef010cbdcc31?q=80&w=800&auto=format&fit=crop",
		articleUrl:
			"/posts/blog-fullstack-architecture-evolution-2026/",
		keyPoints: [
			"SSG 极致静态产物结合边缘反代实现全球毫秒级 TTFB 首包到达",
			"Zero-Knowledge BFF 隔离数据库凭证，杜绝直接暴露私有接口",
			"Svelte 5 Runes 驱动局部动态微交互，整站保持零冗余运行开销",
			"基于 HMAC 签名与令牌桶算法抵御恶意爬虫与 DDoS 洪水攻击",
		],
		content: `## 生产级全栈架构核心技术路线

### 1. 边缘双活与动静解耦
通过将高频静态 HTML/CSS 资源托管于全球 CDN 边缘，动态交互（如评论审核、单点登录 SSO、点赞鉴权）收敛于 Serverless Worker。

### 2. 局部孤岛水合（Partial Hydration）
拒绝庞大的 SPA 单体打包方案，利用 Astro Island 仅针对需要客户端响应的组件（如教材搜索框、图片 Lightbox 浮层）下发微量 JS，保证极端低功耗和秒开体验。`,
		difficulty: "hard",
		updatedAt: "2026-04-01",
		author: "瑶曦",
	},
	{
		id: "cs-tcp-network-handshake-diagram",
		title: "计算机网络协议全景图：TCP 三次握手、四次挥手与状态机转移",
		subject: "cs",
		subjectLabel: "计算机",
		type: "image",
		grade: "CS核心考点",
		chapter: "传输层 · TCP 连接管理与可靠传输保障",
		summary:
			"超清晰序列思维导图：深入剖析 SYN/ACK 序号递增、SYN-Flood 攻击防范、TIME_WAIT 状态 2MSL 存在必要性与拥塞控制。",
		tags: ["计算机网络", "TCP/IP", "三次握手", "思维导图", "高并发"],
		coverImage:
			"https://images.unsplash.com/photo-1544197150-b99a580bb7a8?q=80&w=800&auto=format&fit=crop",
		imageUrl:
			"https://images.unsplash.com/photo-1544197150-b99a580bb7a8?q=80&w=2400&auto=format&fit=crop",
		keyPoints: [
			"三次握手的核心原因：双向确认双方收发能力，防止已失效连接请求突然到达服务端",
			"四次挥手服务端 ACK 与 FIN 分步发送的原因：应对半关闭状态（Half-Close）",
			"TIME_WAIT 保持 2MSL：确保远端收到最终 ACK 并平稳重发，同时让网络中残留报文全部消逝",
		],
		difficulty: "medium",
		updatedAt: "2026-03-10",
		author: "瑶曦",
	},
	{
		id: "cs-backdrop-filter-perf",
		title: "移动端液态玻璃 UI 性能调优完全指南：backdrop-filter 陷阱与降级策略",
		subject: "cs",
		subjectLabel: "计算机",
		type: "article",
		grade: "前端深度工程",
		chapter: "渲染引擎 · GPU 合成层与光栅化开销",
		summary:
			"从 WebKit 渲染树、GPU FBO 离屏重绘机制到低端设备 requestAnimationFrame 丢帧测试，制定液态毛玻璃视觉自适应降级规范。",
		tags: ["前端性能", "GPU渲染", "CSS", "液态玻璃", "移动端优化"],
		coverImage:
			"https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=800&auto=format&fit=crop",
		articleUrl:
			"/posts/backdrop-filter-performance-guide/",
		keyPoints: [
			"backdrop-filter 触发昂贵的 GPU 离屏帧缓冲纹理采样与全屏双重混合",
			"移动端滑动时频繁发生 Composite 重绘引发严重 FPS 掉帧",
			"优雅降级策略：利用 @supports、prefers-reduced-transparency 与设备算力探测动态切换纯色半透明",
		],
		content: `## 为什么液态玻璃 backdrop-filter 会卡死低端手机？

### 渲染管线的物理限制
当元素应用了 \`backdrop-filter: blur(20px)\` 时，浏览器不能直接利用已经光栅化的图层缓存。
在每一次页面滚动或父容器微小位移时：
1. GPU 必须将该元素覆盖的背景区域完整拷贝到临时帧缓冲（FBO）。
2. 在着色器中执行高斯模糊卷积运算（多次采样相邻像素）。
3. 将模糊结果混合写回最终图层并输出至屏幕。

在 60Hz 甚至 120Hz 高刷新率屏幕上，高分辨率下的多次模糊合成瞬间压垮移动端 GPU 显存带宽，导致掉帧到 20fps 以下。`,
		difficulty: "hard",
		updatedAt: "2026-03-25",
		author: "瑶曦",
	},
	{
		id: "physics-faraday-electromagnetic-map",
		title: "电磁感应全景解题拓扑：法拉第定律、楞次定律与双棒动量微元模型",
		subject: "physics",
		subjectLabel: "物理",
		type: "image",
		grade: "高中强基/高考",
		chapter: "电磁学 · 动生电动势与能量转化",
		summary:
			"图解电磁感应动力学三大主干：动生与感生电动势成因、右手定则与楞次定律增反减同、导轨双棒碰撞与电荷量积分模型。",
		tags: ["电磁感应", "动量定理", "楞次定律", "思维导图", "物理高考"],
		coverImage:
			"https://images.unsplash.com/photo-1507413245164-6160d8298b31?q=80&w=800&auto=format&fit=crop",
		imageUrl:
			"https://images.unsplash.com/photo-1507413245164-6160d8298b31?q=80&w=2400&auto=format&fit=crop",
		keyPoints: [
			"动生电动势本质是洛伦兹力非静电力做功：$E = BLv$",
			"感生电动势本质是变化的磁场激发涡旋电场：$E = -n \\frac{\\Delta \\Phi}{\\Delta t}$",
			"通过回路截面的总电量只与磁通量改变量及总电阻有关：$q = \\frac{\\Delta \\Phi}{R_{总}}$",
			"电磁阻尼安培力冲量：$\\sum F_{安}\\Delta t = -\\frac{B^2 L^2}{R} x$",
		],
		difficulty: "hard",
		updatedAt: "2026-02-28",
		author: "瑶曦",
	},
	{
		id: "physics-relativity-spacetime",
		title: "狭义相对论时空观精析：洛伦兹变换与光锥因果律图示",
		subject: "physics",
		subjectLabel: "物理",
		type: "article",
		grade: "大学物理/通识",
		chapter: "现代物理学基础 · 相对论力学与时空结构",
		summary:
			"从光速不变原理出发推导尺缩钟慢效应，建立闵可夫斯基时空图，深刻阐明为什么超光速会导致时间倒流并破坏微观因果律。",
		tags: ["相对论", "洛伦兹变换", "光速不变", "现代物理", "时空哲学"],
		coverImage:
			"https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=800&auto=format&fit=crop",
		articleUrl:
			"/posts/digital-sovereign-blog-architecture-philosophy/",
		keyPoints: [
			"爱因斯坦两大基本假设：相对性原理 + 光速在所有惯性系中恒为 c",
			"时间延缓效应（钟慢）：$\\Delta t = \\frac{\\Delta t_0}{\\sqrt{1 - v^2/c^2}}$",
			"长度收缩效应（尺缩）：$L = L_0 \\sqrt{1 - v^2/c^2}$（仅在运动方向收缩）",
			"时空间隔不变性：$s^2 = c^2\\Delta t^2 - \\Delta x^2$ 保证物理定律的协变性",
		],
		content: `## 狭义相对论的物理认知重构

### 同时性的相对性
牛顿绝对时空观假设存在一个全宇宙统一跳动的“上帝之钟”。然而，只要承认光速的有限性与测量不变性，“在惯性系 A 中同时发生的两个事件，在相对运动的惯性系 B 中必然存在时间先后差”。

### 闵可夫斯基光锥与因果律
以时空点为原点，光速传播的轨迹构成双锥面。
- **类时间隔**：位于未来光锥内，可以通过低于光速的物理信号产生因果作用。
- **类空间隔**：位于光锥之外，没有任何物理信息能够跨越这一距离建立因果联系。`,
		difficulty: "medium",
		updatedAt: "2026-01-10",
		author: "瑶曦",
	},
	{
		id: "chemistry-organic-reaction-web",
		title: "有机化学官能团转化思维导图：烃、卤、醇、醛、酸、酯网络全通",
		subject: "chemistry",
		subjectLabel: "化学",
		type: "image",
		grade: "高中/大学通用",
		chapter: "有机化学基础 · 核心反应类型与逆合成分析",
		summary:
			"超全有机合成大招图解：加成、取代、消去、氧化、还原、酯化、聚合反应条件全标注，考场逆推合成路线一网打尽。",
		tags: [
			"有机化学",
			"官能团",
			"逆合成分析",
			"思维导图",
			"高考化学",
		],
		coverImage:
			"https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?q=80&w=800&auto=format&fit=crop",
		imageUrl:
			"https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?q=80&w=2400&auto=format&fit=crop",
		keyPoints: [
			"卤代烃关键分支：NaOH 水溶液加热发生水解（取代），NaOH 醇溶液加热发生消去",
			"醇的氧化规律：伯醇氧化得醛再氧化得酸，仲醇氧化得酮，叔醇无 α-H 不能被催化氧化",
			"消去反应扎伊采夫规则：优先消除含氢较少的相邻碳原子上的氢，生成取代基更多的稳定烯烃",
		],
		difficulty: "medium",
		updatedAt: "2026-03-05",
		author: "瑶曦",
	},
	{
		id: "chemistry-redox-four-steps",
		title: "复杂氧化还原反应方程式配平：价态升降与介质四步通杀法",
		subject: "chemistry",
		subjectLabel: "化学",
		type: "article",
		grade: "高中核心",
		chapter: "化学基本概念 · 电子转移与氧化还原规律",
		summary:
			"告别盲目拼凑配平！从确定氧化剂还原剂、标出变价元素、根据电子守恒求最小公倍数，到依据酸碱酸介质补水完成电荷平衡。",
		tags: ["化学配平", "氧化还原", "电荷守恒", "电子转移", "必考基础"],
		coverImage:
			"https://images.unsplash.com/photo-1603126857599-f6e157fa2fe6?q=80&w=800&auto=format&fit=crop",
		keyPoints: [
			"第一步：标变价，确定变价元素的初态与终态",
			"第二步：列升降，计算单个微粒得失电子数，乘以脚标求总变价",
			"第三步：求公倍，让化合价升降总数严格相等（求最小公倍数）",
			"第四步：查电荷与介质，酸性环境用 H⁺ 补电荷，碱性环境用 OH⁻ 补电荷，最后以 H₂O 查平氧原子",
		],
		content: `## 氧化还原反应配平底层法则

### 酸性介质经典配平演练
以高锰酸钾氧化草酸为例：
$$\\text{MnO}_4^- + \\text{H}_2\\text{C}_2\\text{O}_4 + \\text{H}^+ \\to \\text{Mn}^{2+} + \\text{CO}_2 \\uparrow + \\text{H}_2\\text{O}$$

1. **变价标示**：
   - $\\text{Mn}^{+7} \\to \\text{Mn}^{+2}$：化合价降低 5。
   - $\\text{C}^{+3}_2 \\to 2\\text{C}^{+4}$：每个碳升 1 价，草酸分子含 2 个碳，共升高 2。
2. **最小公倍数**：
   - 降低 5 与升高 2 的公倍数为 10。
   - 因此 $\\text{MnO}_4^-$ 系数配 2，草酸 $\\text{H}_2\\text{C}_2\\text{O}_4$ 系数配 5，生成物 $\\text{Mn}^{2+}$ 配 2，$\\text{CO}_2$ 配 10。
3. **电荷平衡（酸性环境）**：
   - 反应物左边负电荷为 $2 \\times (-1) = -2$。
   - 生成物右边正电荷为 $2 \\times (+2) = +4$。
   - 左边需补 $6\\text{H}^+$ 达到 $+4$ 电荷守恒。
4. **配平水分子**：
   - 左边总氢原子数：$5 \\times 2 + 6 = 16$ 个 H。
   - 右边应配 $8\\text{H}_2\\text{O}$。检查氧原子：左边 $2 \\times 4 + 5 \\times 4 = 28$ 个 O；右边 $10 \\times 2 + 8 = 28$ 个 O，完全守恒！`,
		difficulty: "easy",
		updatedAt: "2026-02-12",
		author: "瑶曦",
	},
	{
		id: "english-clauses-grammar-map",
		title: "高考与学术英语三大从句拓扑图：定语、名词性、状语从句全网解析",
		subject: "english",
		subjectLabel: "英语",
		type: "image",
		grade: "高中/四六级",
		chapter: "英语语法精粹 · 复合句结构与连接词选用规则",
		summary:
			"彻底解决 that / which / where / whose / what 混淆难题！图解定语从句先行词判定、主语/宾语/同位语从句缺不缺成分判定速算法。",
		tags: [
			"英语语法",
			"定语从句",
			"名词性从句",
			"思维导图",
			"长难句突破",
		],
		coverImage:
			"https://images.unsplash.com/photo-1457369804613-52c61a468e7d?q=80&w=800&auto=format&fit=crop",
		imageUrl:
			"https://images.unsplash.com/photo-1457369804613-52c61a468e7d?q=80&w=2400&auto=format&fit=crop",
		keyPoints: [
			"定语从句核心法则：从句必须修饰先行词；从句内缺主/宾选 which/that，缺状语选 when/where/why",
			"that 在同位语从句中只起连接作用，不充当任何句子成分且不可省略",
			"what 相当于 the thing that，在名词性从句中必定充当主语、宾语或表语",
		],
		difficulty: "easy",
		updatedAt: "2026-01-25",
		author: "瑶曦",
	},
	{
		id: "biology-cellular-respiration-flowchart",
		title: "细胞呼吸与光合作用物质与能量流动拓扑图解",
		subject: "biology",
		subjectLabel: "生物",
		type: "image",
		grade: "高中必修一",
		chapter: "分子与细胞 · 细胞能量供应与利用",
		summary:
			"超高分辨率反应拓扑图：细胞质基质糖酵解、线粒体基质三羧酸循环（TCA）、类囊体薄膜光反应水光解与卡尔文循环 [H] 与 ATP 的闭环传递。",
		tags: ["生物必修", "光合作用", "细胞呼吸", "思维导图", "ATP转化"],
		coverImage:
			"https://images.unsplash.com/photo-1530026405186-ed1f139313f8?q=80&w=800&auto=format&fit=crop",
		imageUrl:
			"https://images.unsplash.com/photo-1530026405186-ed1f139313f8?q=80&w=2400&auto=format&fit=crop",
		keyPoints: [
			"有氧呼吸第一阶段在细胞质基质，第二阶段在线粒体基质，第三阶段在线粒体内膜（生成大量 ATP）",
			"光反应产物：NADPH 与 ATP 提供还原剂与能量，用于暗反应三碳化合物的还原",
			"同位素标记法实验：¹⁸O 追踪水光解释放 O₂，¹⁴C 追踪 CO₂ 转化为糖类的路径（CO₂ -> C₃ -> (CH₂O)）",
		],
		difficulty: "medium",
		updatedAt: "2026-02-05",
		author: "瑶曦",
	},
	{
		id: "cs-git-dag-merge-conflict",
		title: "Git 底层模型与有向无环图（DAG）分支变基原理图解",
		subject: "cs",
		subjectLabel: "计算机",
		type: "image",
		grade: "工程师工具箱",
		chapter: "版本控制 · Git 内部对象存储与历史演变",
		summary:
			"用图示看透 Git 的本质：Blob、Tree、Commit 三大哈希对象、HEAD 指针游离、Three-way Merge 三路合并算法与 Rebase 历史线性化原理。",
		tags: ["Git", "DAG", "版本控制", "工程规范", "底层原理"],
		coverImage:
			"https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?q=80&w=800&auto=format&fit=crop",
		imageUrl:
			"https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?q=80&w=2400&auto=format&fit=crop",
		keyPoints: [
			"Git 的每一次 Commit 并不是差异补丁，而是对全仓库文件系统树的快照（Snapshot）指针",
			"Branch 本质上只是一个指向特定 Commit 哈希的 41 字节轻量级游标",
			"Rebase 变基原理：寻找共同祖先 base，将当前分支的补丁一个一个重放到目标分支顶部",
		],
		difficulty: "medium",
		updatedAt: "2026-03-18",
		author: "瑶曦",
	},
	{
		id: "textbook-fallback-test-sample",
		title: "图解微积分极限 ε-δ 语言几何定义（外部冷门镜像/容错测试样例）",
		subject: "math",
		subjectLabel: "数学",
		type: "image",
		grade: "高等数学",
		chapter: "函数与极限 · 严格分析基础",
		summary:
			"展示柯西与维尔斯特拉斯 ε-δ 语言的开区间几何包含关系。特别设计用于测试外部镜像在不可达或防盗链时的容错降级与用户重试机制。",
		tags: ["高等数学", "极限", "分析学", "容错降级", "测试样本"],
		coverImage: "https://invalid-non-existent-domain-test.xyz/cover.jpg",
		imageUrl:
			"https://invalid-non-existent-domain-test.xyz/epsilon-delta-diagram.png",
		keyPoints: [
			"任意给定 $\\varepsilon > 0$，都存在 $\\delta > 0$，使得当 $0 < |x - x_0| < \\delta$ 时恒有 $|f(x) - A| < \\varepsilon$",
			"$\\varepsilon$ 衡量函数值输出的控制精度，$\\delta$ 衡量自变量输入的容许波动范围",
			"本条目自带防盗链 / 404 图片容错 Fallback 演示能力",
		],
		difficulty: "hard",
		updatedAt: "2026-03-30",
		author: "瑶曦",
	},
	{
		id: "high-school-math-compulsory-1",
		title: "普通高中教科书·数学（A版）必修 第一册 —— 全景深度浓缩总结",
		subject: "math",
		subjectLabel: "数学",
		type: "hybrid",
		grade: "高中 / 必修第一册",
		chapter: "全册全景架构（集合逻辑、不等式、函数模型与三角函数）",
		summary:
			"人教A版高中数学必修一核心知识网络：集合逻辑基石、基本不等式最值、函数单调性奇偶性模型、指数对数运算律及三角函数全景精解与解题SOP。",
		tags: ["高中数学", "必修第一册", "函数性质", "基本不等式", "三角函数", "指对数运算"],
		coverImage:
			"https://images.unsplash.com/photo-1509228468518-180dd4864904?w=1200&auto=format&fit=crop&q=80",
		imageUrl:
			"https://images.unsplash.com/photo-1509228468518-180dd4864904?w=1200&auto=format&fit=crop&q=80",
		articleUrl: "/textbook/high-school-math-compulsory-1",
		externalUrl: "https://image.yaoxi.cloud/textbooks/high-school-math-compulsory-1.pdf",
		keyPoints: [
			"以集合与数理逻辑为底层通信协议，严格区分充分必要条件与量词转化",
			"基本不等式 a+b >= 2√ab 求解最值三要素：一正二定三相等",
			"函数单调性判定与对称性/奇偶性代数方程特征统一分析",
			"初等超越函数（指数、对数、幂函数）图像性质与换底公式计算范式",
			"任意角三角函数定义与同角三角基本关系式推导",
		],
		difficulty: "medium",
		updatedAt: "2026-10-17",
		author: "瑶曦",
	},
	{
		id: "high-school-physics-compulsory-1",
		title: "普通高中教科书·物理 必修 第一册 —— 全景深度浓缩总结",
		subject: "physics",
		subjectLabel: "物理",
		type: "hybrid",
		grade: "高中 / 必修第一册",
		chapter: "全册全景核心架构（运动学与牛顿动力学）",
		summary:
			"经典力学奠基全景梳理：从运动学的时空几何描述（Kinematics，怎么动）到动力学的因果律探寻（Dynamics，为何动）的完整逻辑闭环与防坑指南。",
		tags: ["高中物理", "必修第一册", "质点运动学", "牛顿运动定律", "受力分析与平衡"],
		coverImage:
			"https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?w=1200&auto=format&fit=crop&q=80",
		imageUrl:
			"https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?w=1200&auto=format&fit=crop&q=80",
		articleUrl: "/textbook/high-school-physics-compulsory-1",
		externalUrl: "https://image.yaoxi.cloud/textbooks/high-school-physics-compulsory-1-summary.md",
		keyPoints: [
			"质点与参考系：运动描述的相对性与几何坐标系选择",
			"匀变速直线运动四大基本公式与 v-t 图像面积斜率物理意义",
			"力的合成与分解：正交分解法求解共点力静态平衡",
			"牛顿第二定律 F_合 = ma：连接运动学与动力学的因果纽带",
			"超重与失重的加速度动力学本质及牛顿第三定律相互作用力",
		],
		difficulty: "medium",
		updatedAt: "2026-10-17",
		author: "瑶曦",
	},
	{
		id: "high-school-chemistry-compulsory-1",
		title: "普通高中教科书·化学 必修 第一册 —— 全景深度浓缩总结",
		subject: "chemistry",
		subjectLabel: "化学",
		type: "hybrid",
		grade: "高中 / 必修第一册",
		chapter: "全册全景架构（物质分类、微观计量、氯钠金属与元素周期律）",
		summary:
			"人教版高中化学必修一核心反应网络：离子反应与氧化还原电子转移、物质的量核心计量公式链、钠氯金属转化与元素周期律微观模型精解与解题SOP。",
		tags: ["高中化学", "必修第一册", "氧化还原反应", "物质的量", "钠与氯", "铁三角", "元素周期律"],
		coverImage:
			"https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=1200&auto=format&fit=crop&q=80",
		imageUrl:
			"https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=1200&auto=format&fit=crop&q=80",
		articleUrl: "/textbook/high-school-chemistry-compulsory-1",
		externalUrl: "https://image.yaoxi.cloud/textbooks/high-school-chemistry-compulsory-1.pdf",
		keyPoints: [
			"胶体丁达尔效应与分散系微粒直径尺度关系（1~100 nm）",
			"氧化还原反应本质：电子得失或共用电子对偏移，化合价升降守恒",
			"物质的量 n = m/M = V/Vm = N/NA = cV 五大核心计量转换链条",
			"钠、氯元素及其化合物特性：过氧化钠强供氧与次氯酸漂白",
			"铁三角 Fe、Fe²⁺、Fe³⁺ 氧化还原转化与元素周期律微观模型",
		],
		difficulty: "medium",
		updatedAt: "2026-10-17",
		author: "瑶曦",
	},
];
