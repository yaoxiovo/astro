---
title: 经典力学的拉格朗日表述与最小作用量原理
subject: physics
grade: 大学本科 / 理论物理
chapter: 第三章 分析力学与变分原理
type: hybrid
imageUrl: https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?w=1200&auto=format&fit=crop&q=80
imageAlt: 广义坐标系下的变分路径与作用量极值示意图
tags:
  - 理论力学
  - 分析力学
  - 拉格朗日量
  - 最小作用量原理
  - 欧拉-拉格朗日方程
description: 超越牛顿第二定律的向量分析局限，建立广义坐标系下的标量力学体系。通过欧拉-拉格朗日方程的变分法推导，领略自然界最深刻的优雅规律与对称性。
externalUrl: https://en.wikipedia.org/wiki/Lagrangian_mechanics
published: 2026-05-02T14:30:00Z
order: 3
difficulty: advanced
draft: false
---

## 从牛顿向量力学到分析力学

在牛顿力学体系中，核心方程是矢量动力学公式：

$$
\mathbf{F} = \frac{d\mathbf{p}}{dt} = m\mathbf{a}
$$

然而，在处理具有复杂几何约束的系统（例如双摆、在曲面上滚动的刚体或分子构型动力学）时，牛顿体系暴露出明显的局限性：
1. **未知约束反力**：必须显式引入法向支持力、张力等约束力，而这些力往往是运动求解的副产物而非我们关心的物理量。
2. **坐标系转换繁琐**：笛卡尔坐标系下的牛顿方程在极坐标或曲线坐标中形式变得极其冗长丑陋。

1788 年，约瑟夫·拉格朗日（Joseph-Louis Lagrange）发表了巨著《分析力学》（*Mécanique analytique*）。他自豪地宣称：“全书没有一张图，完全由代数分析构成。”拉格朗日将力学建立在**能量标量**与**广义坐标**之上，实现了经典物理学的一次辉煌飞跃。

![广义坐标系下的变分路径与作用量极值示意图](https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?w=1200&auto=format&fit=crop&q=80)

---

## 广义坐标与约束消除

对于一个含有 $N$ 个质点、受 $k$ 个完整约束（Holonomic Constraints）的系统，其系统的独立运动自由度为：

$$
s = 3N - k
$$

我们可以选取一组彼此独立的参数 $q_1, q_2, \dots, q_s$ 来唯一确定系统的空间构型，这组参数被称为 **广义坐标 (Generalized Coordinates)**。而广义坐标的一阶时间导数 $\dot{q}_i = \frac{dq_i}{dt}$ 则被称为 **广义速度 (Generalized Velocities)**。

借助广义坐标，约束条件在运动微分方程建立之初便被自动消除，不再需要繁冗的几何约束受力分析。

---

## 哈密顿最小作用量原理 (Hamilton's Principle)

自然界似乎遵循某种极致的经济学法则。物理学家哈密顿提出：**在所有可能连接初始构型 $(q, t_1)$ 与终末构型 $(q, t_2)$ 的虚拟运动路径中，真实发生的物理运动路径使得系统的“作用量”取平稳值（极值）。**

我们定义系统的 **拉格朗日函数 (Lagrangian)** $L$ 为系统的动能 $T$ 减去势能 $V$：

$$
L(q, \dot{q}, t) = T(q, \dot{q}, t) - V(q)
$$

则在时间区间 $[t_1, t_2]$ 内的 **作用量泛函 (Action Integral)** $S$ 定义为：

$$
S[q(t)] = \int_{t_1}^{t_2} L(q_1, \dots, q_s, \dot{q}_1, \dots, \dot{q}_s, t) \, dt
$$

最小作用量原理的数学表述为泛函变分为零：

$$
\delta S = 0
$$

---

## 欧拉-拉格朗日方程的变分法推导

对路径施加一个任意微扰 $\delta q_i(t)$，且在端点处微扰归零：$\delta q_i(t_1) = \delta q_i(t_2) = 0$。

作用量泛函的一阶变分为：

$$
\delta S = \int_{t_1}^{t_2} \sum_{i=1}^s \left( \frac{\partial L}{\partial q_i} \delta q_i + \frac{\partial L}{\partial \dot{q}_i} \delta \dot{q}_i \right) dt
$$

注意 $\delta \dot{q}_i = \frac{d}{dt}(\delta q_i)$，我们对第二项应用分部积分法（Integration by parts）：

$$
\int_{t_1}^{t_2} \frac{\partial L}{\partial \dot{q}_i} \frac{d}{dt}(\delta q_i) \, dt = \left[ \frac{\partial L}{\partial \dot{q}_i} \delta q_i \right]_{t_1}^{t_2} - \int_{t_1}^{t_2} \frac{d}{dt}\left( \frac{\partial L}{\partial \dot{q}_i} \right) \delta q_i \, dt
$$

由于端点处微扰 $\delta q_i(t_1) = \delta q_i(t_2) = 0$，边界项完全消失。代回原式合并同类项得到：

$$
\delta S = \int_{t_1}^{t_2} \sum_{i=1}^s \left[ \frac{\partial L}{\partial q_i} - \frac{d}{dt}\left( \frac{\partial L}{\partial \dot{q}_i} \right) \right] \delta q_i \, dt = 0
$$

由于微扰 $\delta q_i(t)$ 是在自由度内任意选取的独立变分，根据变分学基本引理，括号内的被积函数必须对每个自由度恒为零：

$$
\frac{d}{dt}\left( \frac{\partial L}{\partial \dot{q}_i} \right) - \frac{\partial L}{\partial q_i} = 0, \quad (i = 1, 2, \dots, s)
$$

这便是光辉璀璨的 **欧拉-拉格朗日方程 (Euler-Lagrange Equation)**。

---

## 诺特定理与守恒律的对称美

拉格朗日形式的真正力量，在于它将**守恒定律**与**空间时间的对称性**完美融为一体：

- **循环坐标 (Cyclic Coordinate)**：若拉格朗日量显式不包含某个广义坐标 $q_k$（即 $\frac{\partial L}{\partial q_k} = 0$），则其共轭广义动量 $p_k = \frac{\partial L}{\partial \dot{q}_k}$ 是运动守恒量：

$$
\frac{d}{dt} p_k = 0 \implies p_k = \text{常数}
$$

- **空间平移不变性 $\implies$ 动量守恒**
- **空间旋转不变性 $\implies$ 角动量守恒**
- **时间平移不变性 $\implies$ 能量守恒**

这种“对称性决定物理规律”的思想，直接孕育了爱因斯坦广义相对论与现代粒子物理标准模型中的规范场论。
