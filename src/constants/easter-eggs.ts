/**
 * 站点人生 · 彩蛋事件表 (Zero-Maintenance Easter Egg Engine)
 *
 * 事件由访客浏览器按其本地时间在运行时匹配，无需重新构建即可自动生效：
 *  - annual: 每年重复（填 month / day，农历节日请改用 fixed 填当年公历日期）
 *  - fixed : 仅指定日期生效（填 date: "YYYY-MM-DD"）
 *
 * effect 可选能力：
 *  - hue        临时覆盖主题色相（0-360）
 *  - decoration 全站粒子装饰: "confetti" | "fireworks" | "sakura"
 *  - banner     顶部庆典横幅（{n} 会替换为周年/第 n 次）
 *  - notFound   404 页的限定彩蛋文案
 *
 * 调试：控制台执行 __yaoxiEggTest("new-year") 可立即预览任意事件效果喵~
 */

export type EggDecoration = "confetti" | "fireworks" | "sakura";

export interface EasterEggEvent {
	id: string;
	name: string;
	type: "annual" | "fixed";
	/** annual 专用：月（1-12） */
	month?: number;
	/** annual 专用：日（1-31） */
	day?: number;
	/** fixed 专用：YYYY-MM-DD */
	date?: string;
	/** 起始年份：用于计算「第 n 周年 / 第 n 次」 */
	since?: number;
	/** 持续天数（默认 1），支持跨年窗口 */
	duration?: number;
	effect: {
		hue?: number;
		decoration?: EggDecoration;
		banner?: string;
		notFound?: string;
	};
}

export const EASTER_EGGS: EasterEggEvent[] = [
	{
		id: "site-anniversary",
		name: "瑶曦站庆",
		type: "annual",
		month: 12,
		day: 27,
		since: 2025,
		duration: 3,
		effect: {
			hue: 330,
			decoration: "fireworks",
			banner: "🎂 站庆时间到！瑶曦的这个小站已经陪伴大家 {n} 年了，感谢每一次相遇喵~",
			notFound: "这个页面大概也去参加站庆派对啦，等它回来再试吧喵~",
		},
	},
	{
		id: "new-year",
		name: "元旦",
		type: "annual",
		month: 1,
		day: 1,
		duration: 2,
		effect: {
			hue: 280,
			decoration: "fireworks",
			banner: "🎆 新年快乐！愿新的一年代码零 Bug，生活多惊喜喵~",
			notFound: "这个页面穿越到新年去啦，稍后再来找它喵~",
		},
	},
	{
		id: "christmas",
		name: "圣诞季",
		type: "annual",
		month: 12,
		day: 24,
		duration: 2,
		effect: {
			hue: 150,
			decoration: "confetti",
			banner: "🎄 圣诞快乐！本喵精心准备了一场彩带雨为你庆祝喵~",
			notFound: "这个页面被圣诞老人装进礼物袜里了喵！",
		},
	},
	// 示例：站长生日（填上真实日期即可自动生效）
	// {
	// 	id: "owner-birthday",
	// 	name: "站长生日",
	// 	type: "annual",
	// 	month: 6,
	// 	day: 1,
	// 	effect: { decoration: "confetti", banner: "🎂 今天是站长的生日！快留下祝福喵~" },
	// },
	// 示例：农历节日（每年公历日期不同，用 fixed 填当年日期）
	// {
	// 	id: "spring-festival-2027",
	// 	name: "除夕",
	// 	type: "fixed",
	// 	date: "2027-02-05",
	// 	effect: { hue: 10, decoration: "fireworks", banner: "🧧 除夕夜快乐！新年万事顺遂喵~" },
	// },
];
