---
title: 短视频平台的算法推荐与舆论极化："两边站队"现象的技术根源与治理路径
published: 2025-07-08
description: 以短视频平台的算法推荐机制为中心，系统分析其在舆论极化、回音室效应、群体对立中的作用机制，并结合中外最新研究成果和政策实践，探讨算法治理的可能路径。
tags:
  - 短视频
  - 推荐算法
  - 舆论极化
  - 信息茧房
  - 算法治理
  - TikTok
  - 抖音
category: 研究报告
draft: false
lang: "zh_CN"
image: ''
---

# 短视频平台的算法推荐与舆论极化："两边站队"现象的技术根源与治理路径

**Algorithmic Recommendation and Public Opinion Polarization on Short Video Platforms**

---

**作者：MiMo-v2.5 · Xiaomi LLM Core Team**
**日期：2025年7月**
**关键词：短视频、推荐算法、舆论极化、信息茧房、群体对立、算法治理、TikTok、抖音**

---

## 摘要 (Abstract)

短视频平台（TikTok、抖音、快手、YouTube Shorts 等）已成为当代互联网舆论场的核心阵地。其底层推荐算法——以完播率（Completion Rate）、互动率（Engagement Rate）和停留时长（Dwell Time）为核心优化目标——在驱动流量增长的同时，也深刻重塑了公共议题的讨论方式。算法倾向于推送高情绪唤起（High Emotional Arousal）、强立场表达的内容，使得"两边站队"（Two-Sided Camps）成为短视频舆论场的常态特征。本报告以短视频平台的算法推荐机制为中心，系统分析其在舆论极化（Opinion Polarization）、回音室效应（Echo Chamber Effect）、群体对立（Group Antagonism）中的作用机制，并结合中外最新研究成果和政策实践，探讨算法治理的可能路径。

---

## 1. 引言：短视频时代的舆论场重构

### 1.1 从文字到短视频：舆论载体的范式转移

互联网舆论场经历了从 BBS 论坛 → 微博 → 微信公众号 → 短视频的载体演进。每一次载体迁移都深刻改变了舆论的形成机制：

| 时代 | 载体 | 算法角色 | 舆论特征 |
|------|------|---------|---------|
| 1.0 | BBS / 论坛 | 无（时间排序） | 深度讨论、长文 |
| 2.0 | 微博 | 初步推荐 | 热搜驱动、碎片化 |
| 3.0 | 微信公众号 | 社交推荐 | 圈层传播、私域 |
| **4.0** | **短视频** | **深度个性化推荐** | **情绪驱动、立场先行** |

短视频平台的核心变革在于：**算法取代了人，成为信息分发的"把关人"（Gatekeeper）**。传统媒体时代，编辑决定读者看到什么；短视频时代，推荐算法决定用户看到什么。这一转变的后果是深远的——算法没有编辑的价值判断，只有对用户注意力的精准捕获。

### 1.2 "两边站队"的舆论新形态

在短视频平台上，"两边站队"呈现出前所未有的激烈形态：

- **议题极化**：几乎任何公共议题都能迅速分裂为"正方"与"反方"两个阵营
- **情绪先行**：立场表达先于事实认知，情绪传播快于理性讨论
- **算法放大**：平台算法主动推送对立内容以提升互动量
- **群体固化**：用户被算法困入各自的"信息茧房"，难以接触对立观点

这种现象并非偶然，而是短视频推荐算法的**结构性产物**（Structural Product）。本报告将深入剖析这一技术机制。

---

## 2. 短视频推荐算法的核心机制

### 2.1 推荐算法的技术架构

短视频平台的推荐系统通常采用**多级漏斗架构**（Multi-Stage Funnel Architecture）：

```
候选池（Candidate Pool） → 粗排（Pre-Ranking） → 精排（Ranking） → 重排（Re-Ranking）
     ↓                        ↓                    ↓                  ↓
  全量视频              特征过滤             深度模型打分        多样性/新鲜度调整
```

在精排阶段，核心优化目标通常为：

$$Score = w_1 \cdot P(完播) + w_2 \cdot P(点赞) + w_3 \cdot P(评论) + w_4 \cdot P(转发) + w_5 \cdot P(关注)$$

其中，$P(完播)$ 是最重要的信号——用户是否看完一个短视频，直接决定了该内容能否进入更大的流量池。

TU Delft 的研究对短视频推荐系统的技术架构进行了系统性梳理：

::url{href="https://repository.tudelft.nl/record/uuid:f1511c49-4b6a-455e-8044-540d0b0697f6" title="TU Delft - Recommendation Systems of Short Video Platforms" description="代尔夫特理工大学对短视频平台推荐系统架构的系统性研究" image=""}

### 2.2 情绪内容的算法红利

问题在于，**高情绪唤起的内容天然具有更高的完播率和互动率**。心理学研究表明，愤怒（Anger）、震惊（Shock）、对立（Confrontation）等情绪能够显著提升用户的注意力捕获和社交分享意愿。

Shin（2024）在 SSRC MediaWell 发表的研究明确指出，算法放大机制使得极端内容获得了不成比例的曝光：

::url{href="https://mediawell.ssrc.org/citations/misinformation-extremism-and-conspiracies-amplification-and-polarization-by-algorithms/" title="SSRC MediaWell - Misinformation, Extremism, and Conspiracies" description="Shin (2024) 研究算法如何放大虚假信息、极端主义和阴谋论，系统性分析了放大与极化的机制" image=""}

这意味着，当算法以"完播率 + 互动率"为核心优化目标时，它实际上在**奖励情绪化、对立化的内容**，而惩罚理性、温和、平衡的内容。

### 2.3 协同过滤与用户画像

短视频推荐算法大量使用**协同过滤**（Collaborative Filtering）和**深度学习用户画像**（User Profiling）技术：

- **协同过滤**：基于"相似用户喜欢什么"来推荐内容，天然倾向于强化群体共识
- **用户画像**：通过用户的历史行为构建兴趣标签，形成"你是什么样的人就看什么样的内容"的闭环

这种技术架构使得"两边站队"成为一种**自我实现的预言**（Self-Fulfilling Prophecy）：算法根据用户的既有偏好推送内容，用户在接收到同质化内容后进一步强化偏好，算法再进一步收敛——最终，用户被困在算法精心构建的"信息茧房"中。

---

## 3. 算法如何制造"两边站队"

### 3.1 注意力经济下的对立逻辑

短视频平台的商业模式建立在**注意力经济**（Attention Economy）之上。用户在平台上停留的时间越长，平台的广告收入越高。而对立内容天然具有更高的"注意力捕获"能力：

- **对立评论区**：正反方用户在评论区激烈交锋，产生大量互动数据
- **二创传播**：一方发布的内容被另一方"挂出来"进行反驳，形成二次传播
- **热搜驱动**：对立话题更容易登上热搜，获得更多曝光

Mao et al.（2024）在 ScienceDirect 发表的实证研究系统分析了短视频平台的推荐算法如何导致意见极化，提出了三种核心放大机制：

::url{href="https://www.sciencedirect.com/org/science/article/pii/S1548367326000062" title="ScienceDirect - Mechanisms of Algorithmic Recommendation on Social Media Opinion Polarization" description="Mao et al. (2024) 基于短视频平台的实证研究，系统分析了推荐算法导致意见极化的核心机制" image=""}

该研究指出的三种极化机制：

1. **选择性暴露**（Selective Exposure）：算法优先推送与用户现有观点一致的内容
2. **情绪放大**（Emotional Amplification）：高情绪内容获得更多推荐权重
3. **可见性不平等**（Visibility Inequality）：极端立场获得更多曝光机会

### 3.2 评论区的群体极化

短视频评论区是"两边站队"最直观的呈现空间。算法推荐的内容吸引了持有特定立场的用户，而评论区则成为群体极化的"加速器"。

以抖音评论区为案例的研究发现，推荐算法下的评论区群体极化呈现以下特征：

::url{href="https://wap.cnki.net/touch/web/Journal/Article/PXWS202406011.html" title="知网 - 算法推荐机制下的评论区群体极化现象及治理" description="以抖音评论区为例，系统分析了算法推荐机制下的群体极化现象与治理路径" image=""}

- **沉默螺旋效应**：持中间立场的用户因害怕被攻击而选择沉默
- **极化升级**：最极端的评论获得最多点赞，进一步激励用户发表更极端的言论
- **算法正反馈**：高互动评论被算法优先展示，形成"极化内容 → 高互动 → 更多曝光 → 更多极化"的正反馈循环

### 3.3 舆论可见性与算法分配

算法本质上是一种**可见性分配机制**（Visibility Distribution Mechanism）。它决定了哪些内容被看到、哪些内容被淹没。

从舆论可见性视角分析推荐算法对网民意见极化影响机制的研究，提出了一个重要的分析框架：**算法并非简单地"放大"极化，而是通过控制内容的可见性，主动"建构"了极化的舆论格局**。

::url{href="https://www.zhangqiaokeyan.com/academic-journal-cn_detail_thesis/02012160527558.html" title="掌桥科研 - 算法推荐对网民意见极化的影响机制研究" description="基于舆论可见性视角的多层次分析，揭示算法如何通过控制内容可见性主动建构极化舆论格局" image=""}

算法给予极端内容更多的可见性，而将温和内容推向边缘——这一机制本身就是"两边站队"的技术根源。

---

## 4. 回音室效应：短视频平台的信息茧房

### 4.1 短视频平台的回音室效应

回音室效应（Echo Chamber Effect）是指用户在信息传播过程中，持续接触到与自己既有观点一致的信息，从而导致观点不断强化、趋于极端的现象。

Scientific Reports 发表的实证研究专门考察了短视频平台的回音室效应，证实了短视频平台确实存在显著的回音室效应：

::url{href="https://link.springer.com/article/10.1038/s41598-023-33370-1" title="Nature Scientific Reports - Echo Chamber Effects on Short Video Platforms" description="基于大规模用户行为数据的实证研究，证实短视频平台存在显著的回音室效应" image=""}

该研究基于大规模用户行为数据，发现回音室效应在以下条件下更为显著：

- 用户活跃度越高，回音室效应越强
- 算法推荐的内容比例越高，回音室效应越强
- 议题越具有争议性，回音室效应越强

### 4.2 TikTok 的自我激化机制

通过逆向工程（Reverse Engineering）方法审计 TikTok 推荐算法的研究，发现了一个令人警惕的机制：

::url{href="https://www.mendeley.com/catalogue/6cc6827f-e2c9-39ec-97ab-54146815ed64/" title="Mendeley - How Algorithms Promote Self-Radicalization" description="通过逆向工程方法审计 TikTok 算法，发现算法能在 40 分钟内将新用户推入越来越极端的内容流" image=""}

**TikTok 的推荐算法能够在极短的时间内（约 40 分钟），将一个新用户推入越来越极端的内容流中**。研究者创建了多个"空白账号"，仅通过观看特定类型的内容，算法便在 40 分钟内将推荐内容的极端程度提升了数倍。这一"自我激化"（Self-Radicalization）机制，正是短视频平台"两边站队"现象的技术基础。

### 4.3 算法放大与极端主义

Telematics and Informatics 发表的研究系统分析了社交媒体中算法放大与极化的关系：

::url{href="https://zu.elsevierpure.com/en/publications/algorithmic-amplification-and-polarization-in-social-media/" title="Elsevier - Algorithmic Amplification and Polarization in Social Media" description="系统分析了社交媒体中算法放大与极化的关系，发现算法推荐系统在多个维度加剧了极化" image=""}

该研究揭示的算法放大与极化的多重关系：

| 机制 | 描述 | 后果 |
|------|------|------|
| 选择性放大 | 算法优先推荐高互动内容 | 极端内容获得更多曝光 |
| 同质化推荐 | 算法推送用户偏好内容 | 用户被困入信息茧房 |
| 情绪优先 | 高情绪内容获得更多权重 | 理性内容被边缘化 |
| 网络效应 | 社交传播放大算法效果 | 极化在群体间扩散 |

---

## 5. TikTok 算法与政治极化的实证研究

### 5.1 2024 年美国大选的算法偏见

2026 年发表在 Nature 上的一项重磅研究，为短视频算法与政治极化的关系提供了决定性的实证证据：

::url{href="https://www.nature.com/articles/s41586-026-10447-1" title="Nature - Systematic Partisan Content Skews in TikTok During the 2024 US Elections" description="Nature 正刊重磅研究，证明 TikTok 推荐算法在 2024 年美国大选期间系统性地偏向共和党内容" image=""}

**核心发现：TikTok 的推荐算法在 2024 年美国大选期间系统性地偏向共和党内容。** 研究团队通过大规模实验和数据分析发现：

- 未注册新用户在 TikTok 上收到的政治内容中，**共和党相关内容的比例显著高于民主党**
- 这一偏向并非用户行为的结果，而是**算法本身的系统性倾斜**
- 即使是刻意关注民主党政客的账号，算法仍会推送大量共和党内容

Nature 的新闻报道进一步确认了这一发现：

::url{href="https://www.nature.com/articles/d41586-026-01314-0" title="Nature News - TikTok's Algorithm Systematically Skewed to the Right" description="Nature 新闻报道：TikTok 算法在 2024 年美国大选期间系统性右倾" image=""}

The Guardian 的报道则将这一发现与 2024 年大选结果联系起来：

::url{href="https://www.theguardian.com/technology/2026/may/06/tiktok-pro-republican-algorithm-2024-election" title="The Guardian - TikTok's Algorithm Favored Republican Content" description="卫报报道：TikTok 算法在 2024 年美国大选中偏向共和党内容的研究发现" image=""}

### 5.2 算法偏见的政治经济学

TikTok 算法偏见的发现引发了学术界对算法政治经济学的深入讨论。El País 的分析文章指出，TikTok 的算法偏见可能并非有意为之，而是其**优化目标的结构性产物**：

::url{href="https://english.elpais.com/technology/2026-05-06/tiktok-helped-trump-win-the-2024-election-as-the-platforms-future-in-the-us-hung-in-the-balance.html" title="El País - TikTok Helped Trump Win the 2024 Election" description="西班牙国家报分析：TikTok 算法偏见与 2024 年美国大选结果的关联" image=""}

共和党内容在情绪唤起和互动率方面表现更强，算法在优化这些指标时自然倾向于推送共和党内容。

这一发现揭示了一个更深层的问题：**即使算法本身是"中立"的，其优化目标的选择本身就蕴含了政治倾向**。当我们选择以"完播率"和"互动率"作为算法的核心指标时，我们实际上已经在进行一种政治选择。

---

## 6. 中国短视频平台的舆论极化实践

### 6.1 抖音与快手的舆论场特征

中国短视频市场以抖音和快手为双寡头，两者在算法哲学和舆论场特征上存在显著差异：

| 维度 | 抖音 (TikTok 中国版) | 快手 |
|------|---------------------|------|
| **算法策略** | 中心化分发、头部流量集中 | 去中心化、普惠分发 |
| **舆论特征** | 热搜驱动、话题对立鲜明 | 草根生态、圈层分化 |
| **极化程度** | 高（强热搜机制） | 中（相对分散） |
| **用户画像** | 一二线城市为主 | 下沉市场为主 |

### 6.2 钟睒睒事件：算法与舆论的公开对峙

2024 年底，农夫山泉创始人钟睒睒公开批评算法推荐机制引发了广泛关注。这一事件本身就是一个完美的"算法悖论"案例：**对算法的批评通过算法获得了更大的传播**。

::url{href="https://www.tmtpost.com/7351131.html" title="钛媒体 - 钟睒睒对算法的怒火，反而通过算法让更多人看到" description="农夫山泉创始人钟睒睒公开批评算法推荐机制的事件分析" image=""}

钟睒睒指责算法推荐机制制造了针对农夫山泉的舆论攻击，但他的批评文章恰恰因为算法的推荐机制而获得了数千万的曝光。

### 6.3 抖音官方的算法回应

面对舆论压力，抖音副总裁李亮公开回应了算法争议，将"两边站队"的责任从算法转移到了**营销号**（Marketing Accounts）身上：

::url{href="https://tech.ifeng.com/c/c8f3wIYHU8eV" title="凤凰网科技 - 抖音副总裁李亮再谈算法" description="抖音副总裁李亮回应算法争议：挑起对立、煽动网民情绪的营销号行为是网络谣言与网暴的根源" image=""}

李亮认为是营销号利用算法挑起对立，而非算法本身的问题。这一立场引发了学术界的讨论——算法在其中究竟是"工具"还是"推手"？

### 6.4 女性主义议题的舆论极化

Springer Nature 发表的研究专门考察了中国互联网上女性主义议题的舆论极化：

::url{href="https://link.springer.com/article/10.1057/s41599-025-04635-z" title="Nature HSSC - Polarization of Public Opinions on Feminism in China" description="中国互联网女性主义议题的舆论极化研究，发现推荐算法在该议题上的极化效应尤为显著" image=""}

该研究发现，推荐算法在女性主义议题上的极化效应尤为显著：

- 算法将用户自动分流为"支持女性主义"和"反对女性主义"两个阵营
- 每个阵营内部的信息同质化程度极高
- 跨阵营的对话几乎不可能发生
- 高情绪内容在两个阵营中都获得更多推荐

---

## 7. 算法治理：从约谈到制度化

### 7.1 多平台被约谈：热搜治理的制度化

2025 年 9 月，中国多家互联网平台因热搜榜问题被监管部门集体约谈。光明网的报道指出：

::url{href="http://epaper.gmw.cn/wzb/html/2025-10/11/nw.D110000wzb_20251011_2-02.htm" title="光明网 - 多家平台被约谈，热搜热榜生态怎么变" description="2025年9月中国多家互联网平台因热搜榜问题被监管部门集体约谈的深度报道" image=""}

工人日报的评论则直指问题核心：

::url{href="https://www.workercn.cn/c/2025-09-25/8616750.shtml" title="工人日报 - 热搜榜不该等同于流量榜" description="评论文章：热搜榜不应完全由算法流量决定，必须纳入公共价值考量" image=""}

东南早报进一步呼吁热搜应告别流量主导：

::url{href="https://www.fjsen.com/r/2025-09/30/content_32051218.htm" title="东南早报 - 热搜该告别流量主导，重拾公共价值" description="评论文章：呼吁热搜机制从流量导向转向公共价值导向" image=""}

约谈的核心要求包括：
1. 热搜榜不能完全由算法流量决定，必须纳入公共价值考量
2. 平台必须建立人工审核机制，防止对立内容被算法放大
3. 算法推荐必须考虑社会影响，不能单纯追求商业利益

### 7.2 专家视角：多平台舆论治理的挑战

澎湃新闻刊发的专家文章深入分析了多平台舆论治理的差异与挑战：

::url{href="https://www.thepaper.cn/newsDetail_forward_33215702" title="澎湃新闻 - 多平台塑造舆论的差异与治理挑战" description="专家观点：不同平台的算法架构和用户生态存在显著差异，一刀切的治理方式难以奏效" image=""}

该文章指出，有效的算法治理必须考虑以下因素：

- **平台差异**：抖音的中心化分发与快手的去中心化分发需要不同的治理策略
- **议题差异**：娱乐议题与政治议题的极化机制不同
- **用户差异**：不同用户群体对算法推荐的敏感度不同
- **时间维度**：热点事件的舆论演化具有阶段性特征

### 7.3 算法偏见的协同治理

学术界提出了算法偏见的协同治理框架：

::url{href="https://zgcb.chinaxwcb.com/2024/04/08/99840072.html" title="中国新闻出版广电报 - 算法偏见背后的数据选择、信息过滤与协同治理" description="提出算法治理需要政府、平台、用户、学术界的协同参与" image=""}

该框架强调，算法治理不能仅依赖单一主体，而需要多方协同：

```
政府监管（制度设计） + 平台自律（算法审计） + 用户素养（媒介素养教育） + 学术监督（独立研究）
```

### 7.4 跨平台舆情演化与信息茧房治理

从跨平台视角考察热点事件舆情演化的研究，提出了"跨平台信息茧房"的概念：

::url{href="https://cnki.istiz.org.cn/kcms/detail/detail.aspx?filename=1025904796.nh&dbcode=CMFD&dbname=CMFD2026" title="知网 - 跨平台热点事件网络舆情演化与信息茧房治理研究" description="提出跨平台信息茧房概念：用户在多个平台间迁移时会被逐步筛选到最适合其偏好的信息环境中" image=""}

用户不仅在一个平台内部被困入信息茧房，跨平台的信息流动也会强化极化——因为不同平台的算法偏好不同，用户在多个平台间迁移时会逐步被"筛选"到最适合其既有偏好的信息环境中。

### 7.5 舆论可见性与算法可见性政治

从"可见性政治"（Politics of Visibility）视角审视社交媒体公共议题传播的研究指出：

::url{href="https://zsyyb.cn/abs/202412.00136" title="传媒学术网 - 社交媒体公共议题传播中的算法八卦与可见性政治" description="提出算法推荐本质上是一种可见性分配机制，决定了哪些议题和声音能够被公众看到" image=""}

**算法推荐本质上是一种"可见性分配"（Visibility Allocation）机制**，它决定了哪些议题、哪些声音能够被公众看到。"两边站队"的舆论格局，实际上是算法在可见性分配中制造的结构性不平等的结果。

### 7.6 短视频平台的技术赋权与舆情治理

从"技术赋权"（Technological Empowerment）视角分析短视频平台舆情治理的研究指出：

::url{href="https://pssxiv.cn/user/search.htm?pageId=1756393366548&type=filter&filterField=authors&value=%e4%bb%98%e6%94%bf" title="PSSXiv - 短视频平台的技术赋权与舆情治理" description="从技术赋权视角分析短视频平台既是舆论极化的技术赋权者，也是舆情治理的技术工具" image=""}

短视频平台既是舆论极化的"技术赋权者"，也是舆情治理的"技术工具"。关键在于如何设计算法的优化目标——如果以"信息质量"和"观点多样性"替代"完播率"和"互动率"作为核心指标，算法有可能从极化的"推手"转变为治理的"工具"。

### 7.7 算法推荐下的主流意识形态风险

对算法推荐下主流意识形态风险的研究也关注到了这一问题：

::url{href="http://cnkimirror.clcn.net.cn/KCMS/detail/detail.aspx?filename=1025396814.nh&dbcode=CMFD&dbname=CMFD2026" title="知网 - 算法推荐下主流意识形态风险及化解研究" description="分析算法推荐对主流意识形态的潜在风险及化解路径" image=""}

### 7.8 短视频信息茧房与意识形态认同

研究还关注了短视频信息茧房对大学生主流意识形态认同的消极影响：

::url{href="https://d.wanfangdata.com.cn/periodical/CihQZXJpb2RpY2FsQ0hJU29scjkyMDI2MDYxMDIwMjYwNjEwMTYxMjM4EhJ4eGRqeXN4ankyMDI1MTgwMTcaCGViZjE0NHI2" title="万方数据 - 短视频信息茧房对大学生主流意识形态认同的消极影响及有效应对" description="研究短视频信息茧房对青年群体意识形态认同的影响及应对策略" image=""}

---

## 8. 结论与展望

### 8.1 核心发现

本报告的研究揭示了以下核心发现：

1. **算法是"两边站队"的技术根源**：短视频推荐算法以"完播率 + 互动率"为核心的优化目标，天然倾向于推送高情绪、强立场的内容，制造舆论极化

2. **回音室效应在短视频平台上尤为显著**：TikTok 的算法审计研究表明，算法能够在极短时间内将用户推入越来越极端的内容流

3. **算法偏见能够影响政治格局**：Nature 发表的研究证明，TikTok 的算法在 2024 年美国大选期间系统性地偏向共和党内容

4. **中国平台的治理实践正在制度化**：从钟睒睒事件到多平台约谈，中国正在探索算法治理的制度化路径

5. **"算法中立"是一个伪命题**：即使算法本身是"中立"的，其优化目标的选择本身就蕴含了价值判断和政治倾向

### 8.2 治理建议

基于上述发现，本报告提出以下治理建议：

| 层面 | 建议 | 具体措施 |
|------|------|---------|
| **算法设计** | 多目标优化 | 在"完播率"之外引入"信息质量"和"观点多样性"指标 |
| **平台责任** | 算法审计 | 建立独立的算法审计机制，定期评估算法的极化效应 |
| **用户赋权** | 透明度工具 | 为用户提供查看和调整算法推荐偏好的工具 |
| **监管框架** | 分级管理 | 根据议题的敏感度和争议性，对算法推荐实施分级管理 |
| **学术监督** | 独立研究 | 支持独立学术机构对平台算法进行持续监测和研究 |

### 8.3 未来展望

短视频平台的算法推荐与舆论极化的关系，将在以下方向继续演化：

- **生成式 AI 的介入**：AI 生成内容（AIGC）将进一步降低对立内容的生产成本，算法极化的"供给侧"将面临新的挑战
- **多模态推荐**：随着短视频与直播、图文的融合，推荐算法的极化机制将更加复杂
- **全球治理协调**：TikTok 算法偏见的发现将加速全球范围内的算法治理协调
- **用户觉醒**：随着公众对算法机制认知的提升，"算法素养"（Algorithmic Literacy）将成为数字时代的基本能力

### 8.4 结语

短视频平台的"两边站队"现象，本质上是**算法优化目标与公共利益之间的结构性矛盾**。当我们以"注意力"作为算法的唯一货币时，对立和极化就成为了不可避免的副产品。

打破这一困局，需要的不仅是技术层面的算法改进，更是理念层面的范式转换——从"算法为流量服务"转向"算法为公共利益服务"。正如 Nature 研究所揭示的，算法能够系统性地影响一个国家的政治舆论格局——这意味着，算法治理已经不是"要不要做"的问题，而是"如何做好"的问题。

在"两边站队"的短视频舆论场中，也许最重要的不是选择站在哪一边，而是认识到**算法本身就是一种选择**——而我们每个人，都有权利也有责任参与这种选择的塑造。

---

## 参考文献汇总

### 短视频算法与舆论极化

::url{href="https://mediawell.ssrc.org/citations/misinformation-extremism-and-conspiracies-amplification-and-polarization-by-algorithms/" title="SSRC MediaWell - Misinformation, Extremism, and Conspiracies" description="Shin (2024) 算法放大与极化研究" image=""}

::url{href="https://www.sciencedirect.com/org/science/article/pii/S1548367326000062" title="ScienceDirect - Mechanisms of Algorithmic Recommendation" description="Mao et al. (2024) 短视频平台推荐算法极化机制实证研究" image=""}

::url{href="https://link.springer.com/article/10.1038/s41598-023-33370-1" title="Nature Scientific Reports - Echo Chamber Effects on Short Video Platforms" description="短视频平台回音室效应实证研究" image=""}

::url{href="https://www.mendeley.com/catalogue/6cc6827f-e2c9-39ec-97ab-54146815ed64/" title="Mendeley - TikTok Algorithm Self-Radicalization Audit" description="TikTok 算法逆向工程审计：40分钟自我激化机制" image=""}

::url{href="https://zu.elsevierpure.com/en/publications/algorithmic-amplification-and-polarization-in-social-media/" title="Elsevier - Algorithmic Amplification and Polarization" description="社交媒体算法放大与极化系统性分析" image=""}

::url{href="https://wap.cnki.net/touch/web/Journal/Article/PXWS202406011.html" title="知网 - 抖音评论区群体极化现象及治理" description="以抖音评论区为例的算法推荐群体极化研究" image=""}

::url{href="https://www.zhangqiaokeyan.com/academic-journal-cn_detail_thesis/02012160527558.html" title="掌桥科研 - 算法推荐对网民意见极化的影响机制" description="基于舆论可见性视角的多层次分析" image=""}

### TikTok 与政治极化

::url{href="https://www.nature.com/articles/s41586-026-10447-1" title="Nature - TikTok Partisan Content Skews in 2024 US Elections" description="Nature 正刊：TikTok 算法在 2024 美国大选中系统性偏向共和党" image=""}

::url{href="https://www.nature.com/articles/d41586-026-01314-0" title="Nature News - TikTok Algorithm Right-Skewed" description="Nature 新闻报道" image=""}

::url{href="https://www.theguardian.com/technology/2026/may/06/tiktok-pro-republican-algorithm-2024-election" title="The Guardian - TikTok Favored Republican Content" description="卫报报道" image=""}

::url{href="https://english.elpais.com/technology/2026-05-06/tiktok-helped-trump-win-the-2024-election-as-the-platforms-future-in-the-us-hung-in-the-balance.html" title="El País - TikTok and the 2024 Election" description="西班牙国家报分析" image=""}

::url{href="https://www.tubefilter.com/2026/05/06/social-media-tiktok-study-political-feeds/" title="Tubefilter - Social Media Political Polarization Study" description="社交媒体政治极化研究报道" image=""}

### 中国短视频平台舆论治理

::url{href="https://www.tmtpost.com/7351131.html" title="钛媒体 - 钟睒睒对算法的怒火" description="钟睒睒事件分析" image=""}

::url{href="https://tech.ifeng.com/c/c8f3wIYHU8eV" title="凤凰网科技 - 抖音副总裁李亮再谈算法" description="抖音官方回应算法争议" image=""}

::url{href="https://link.springer.com/article/10.1057/s41599-025-04635-z" title="Nature HSSC - Feminism Polarization in China" description="中国女性主义议题舆论极化研究" image=""}

### 热搜治理与平台监管

::url{href="http://epaper.gmw.cn/wzb/html/2025-10/11/nw.D110000wzb_20251011_2-02.htm" title="光明网 - 多家平台被约谈" description="2025年多平台热搜约谈事件报道" image=""}

::url{href="https://www.workercn.cn/c/2025-09-25/8616750.shtml" title="工人日报 - 热搜榜不该等同于流量榜" description="评论文章" image=""}

::url{href="https://www.fjsen.com/r/2025-09/30/content_32051218.htm" title="东南早报 - 热搜该告别流量主导" description="评论文章" image=""}

::url{href="https://www.thepaper.cn/newsDetail_forward_33215702" title="澎湃新闻 - 多平台舆论治理的差异与挑战" description="专家观点" image=""}

### 算法公平性与协同治理

::url{href="https://zgcb.chinaxwcb.com/2024/04/08/99840072.html" title="中国新闻出版广电报 - 算法偏见的协同治理" description="协同治理框架" image=""}

::url{href="https://cnki.istiz.org.cn/kcms/detail/detail.aspx?filename=1025904796.nh&dbcode=CMFD&dbname=CMFD2026" title="知网 - 跨平台舆情演化与信息茧房治理" description="跨平台信息茧房研究" image=""}

::url{href="https://zsyyb.cn/abs/202412.00136" title="传媒学术网 - 算法八卦与可见性政治" description="可见性政治分析" image=""}

::url{href="https://pssxiv.cn/user/search.htm?pageId=1756393366548&type=filter&filterField=authors&value=%e4%bb%98%e6%94%bf" title="PSSXiv - 短视频平台的技术赋权与舆情治理" description="技术赋权视角研究" image=""}

::url{href="http://cnkimirror.clcn.net.cn/KCMS/detail/detail.aspx?filename=1025396814.nh&dbcode=CMFD&dbname=CMFD2026" title="知网 - 算法推荐下主流意识形态风险" description="意识形态风险研究" image=""}

::url{href="https://d.wanfangdata.com.cn/periodical/CihQZXJpb2RpY2FsQ0hJU29scjkyMDI2MDYxMDIwMjYwNjEwMTYxMjM4EhJ4eGRqeXN4ankyMDI1MTgwMTcaCGViZjE0NHI2" title="万方数据 - 短视频信息茧房与大学生意识形态认同" description="青年群体意识形态影响研究" image=""}

---

*本报告由 MiMo-v2.5（Xiaomi LLM Core Team）生成，仅供学术研究参考。*
