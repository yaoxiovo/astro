---
title: 动态规划核心方法论：从记忆化搜索到底层状态压缩
subject: cs
grade: 大学本科 / 计算机科学与工程
chapter: 第二章 算法设计与高级数据结构
type: hybrid
imageUrl: https://images.unsplash.com/photo-1516116211227-bbc804566f12?w=1200&auto=format&fit=crop&q=80
imageAlt: 动态规划重叠子问题 DAG 与状态转移决策树
tags:
  - 动态规划
  - 算法与数据结构
  - 状态转移方程
  - 状态压缩
  - 时间复杂度
description: 解构动态规划的三大特征（最优子结构、无后效性、重叠子问题），通过经典的背包问题与最长递增子序列（LIS），展示从递归自顶向下到递推滚动数组的性能跃迁。
externalUrl: https://en.wikipedia.org/wiki/Dynamic_programming
published: 2026-04-10T10:00:00Z
order: 2
difficulty: advanced
draft: false
---

## 动态规划的本质公理

动态规划（Dynamic Programming，简称 DP）并非某种特定的数据结构，而是一种求解最优化问题的数学归纳与拓扑剪枝范式。其核心在于通过记录历史状态的解，避免指数级暴力的重复计算。

能够使用动态规划高效求解的问题，必须严格满足以下三大基石特征：

1. **最优子结构 (Optimal Substructure)**：大问题的全局最优解，必然由其各个子问题的局部最优解组合推导而来。
2. **无后效性 (Markov Property / No-aftereffect)**：一旦某一个阶段的状态确定，未来决策的发展只取决于当前状态的值，而与该状态是如何被历史推导出来的过程无关。
3. **重叠子问题 (Overlapping Subproblems)**：在自顶向下的递归分解树中，相同的子问题会被多次反复计算，形成有向无环图（DAG）的重叠汇聚。

![动态规划重叠子问题 DAG 与状态转移决策树](https://images.unsplash.com/photo-1516116211227-bbc804566f12?w=1200&auto=format&fit=crop&q=80)

---

## 演化路径：从纯递归到滚动数组

理解动态规划的思考脉络，可以通过以下三层架构演化清晰透视：

```
暴搜递归 (Brute Force Recursion) - O(2^N) 指数级爆炸
        ↓ (增加 Memoization 哈希/缓存表)
记忆化搜索 (Top-Down Memoization) - O(N) 线性剪枝
        ↓ (消除递归调用栈，转为拓扑递推)
迭代表驱动 (Bottom-Up Tabulation) - O(N) 状态转移
        ↓ (观察历史依赖深度，丢弃无用历史)
空间状态压缩 (Rolling Array / State Compression) - O(1) 极致内存优化
```

---

## 经典实战一：0-1 背包问题

### 状态定义与转移方程

给定 $N$ 个物品和一个容量为 $V$ 的背包。第 $i$ 个物品的体积为 $w[i]$，价值为 $v[i]$。每个物品仅能选择放入或不放入一次。求背包能容纳的最大价值总和。

定义状态 $dp[i][j]$ 为：仅考虑前 $i$ 件物品，且当前背包剩余或已占用容积为 $j$ 时的最大价值。

对于第 $i$ 件物品，决策空间只有两种：
- **不选第 $i$ 件物品**：$dp[i][j] = dp[i - 1][j]$
- **选择第 $i$ 件物品**（前提是 $j \ge w[i]$）：$dp[i][j] = dp[i - 1][j - w[i]] + v[i]$

综上，状态转移方程为：

$$
dp[i][j] = \max\Big( dp[i - 1][j], \; dp[i - 1][j - w[i]] + v[i] \Big)
$$

### 空间复杂度压缩至一维

观察上述方程，$dp[i][j]$ 的计算仅依赖于上一层状态 $dp[i - 1][\dots]$，完全不需要保留 $i - 2$ 及更早的历史数据。

如果我们直接复用一维数组 $dp[j]$，为了防止更新 $dp[j]$ 时覆盖掉上一轮计算所需的旧值 $dp[j - w[i]]$，**遍历背包容量时必须逆序（从大到小）遍历**：

```typescript
export function knapsack01(
  weights: number[],
  values: number[],
  capacity: number
): number {
  const n = weights.length;
  // 一维滚动数组压缩：空间复杂度 O(capacity)
  const dp: number[] = new Array(capacity + 1).fill(0);

  for (let i = 0; i < n; i++) {
    const w = weights[i];
    const v = values[i];
    // 逆序遍历保证上一轮的历史状态不被提前覆盖
    for (let j = capacity; j >= w; j--) {
      dp[j] = Math.max(dp[j], dp[j - w] + v);
    }
  }

  return dp[capacity];
}
```

---

## 经典实战二：最长递增子序列 (LIS)

### 二分贪心与耐人寻味的耐心排序 (Patience Sorting)

对于数组 `nums`，寻找其严格递增子序列的最长长度。

传统的动态规划定义 $dp[i]$ 为以 `nums[i]` 结尾的 LIS 长度，时间复杂度为 $O(N^2)$：

$$
dp[i] = \max_{0 \le j < i, \, nums[j] < nums[i]} (dp[j] + 1)
$$

而借助贪心策略与二分搜索（Patience Sorting 扑克牌分堆原理），我们可以将复杂度降低到 $O(N \log N)$：维护一个单调数组 `tails`，其中 `tails[k]` 记录长度为 $k + 1$ 的所有递增子序列中最小的末尾元素。

```typescript
export function lengthOfLIS(nums: number[]): number {
  if (nums.length === 0) return 0;
  
  const tails: number[] = [];

  for (const x of nums) {
    let left = 0;
    let right = tails.length;
    
    // 二分搜索首个大于等于 x 的位置
    while (left < right) {
      const mid = (left + right) >> 1;
      if (tails[mid] < x) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    
    if (left === tails.length) {
      tails.push(x);
    } else {
      tails[left] = x;
    }
  }

  return tails.length;
}
```

---

## 状态压缩技巧：Bitmask 与高维降维

在 TSP（旅行商问题）或集合覆盖问题中，当状态维度为离散集合时，我们可以将布尔集合编码为二进制位整数（Bitmask）：

$$
S \in \{0, 1\}^N \implies \text{state} \in [0, 2^N - 1]
$$

- 检查第 $k$ 位是否被访问：`(state >> k) & 1`
- 将第 $k$ 位标记为已访问：`state | (1 << k)`

动态规划的魅力在于：**把指数级的全空间漫游，收敛在严整的 DAG 拓扑序中。** 掌握好状态定义的维度划分与无后效性检验，是每一个高级算法工程师的必修基本功。
