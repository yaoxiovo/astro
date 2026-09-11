/**
 * Yaoxi Blog Email Client & Template Builder
 * - 默认直连自建邮件网关：https://mail-api.yaoxi.cloud
 * - 路由前缀支持：
 *     /api/send/notify   -> 订阅验证、文章广播通知
 *     /api/send/service  -> 访客留言通报、自动回执
 *     /api/send/alert    -> 网站存活与监控告警
 *     /api/send/bot      -> 定时周报、机器人推送
 * - 兼容模式：未配置 Token 时本地输出 Mock 日志，若配置了 RESEND_API_KEY 亦可回退兼容
 * - 包含 5 套响应式、多端兼容的 HTML 邮件模板（深浅适配、杂志卡片排版）
 */

const DEFAULT_GATEWAY_URL = "https://mail-api.yaoxi.cloud";
const DEFAULT_SITE_NAME = "瑶曦 Blog";
const DEFAULT_SITE_URL = "https://blog.yaoxi.wiki";

/**
 * 发送邮件统一入口
 * @param {object} env Worker 环境变量
 * @param {object} options 邮件参数
 * @param {string|string[]} options.to 收件人邮箱
 * @param {string} options.subject 邮件主题
 * @param {string} options.html HTML 正文
 * @param {string} [options.text] 纯文本备用内容
 * @param {string} [options.prefix] 网关路由前缀 ('notify' | 'service' | 'alert' | 'bot' | 'admin')
 * @param {string} [options.from] 发件人地址（可选，前缀路由通常有预设身份）
 * @param {string} [options.replyTo] 回复地址（可选）
 * @param {object} [options.headers] 自定义邮件头（如 List-Unsubscribe）
 * @returns {Promise<{ ok: boolean, id?: string, error?: string, mock?: boolean }>}
 */
export async function sendEmail(
	env,
	{ to, subject, html, text, prefix = "notify", from, replyTo, headers = {} },
) {
	const recipient = Array.isArray(to) ? to.join(", ") : to;
	const gatewayUrl = (env?.MAIL_GATEWAY_URL || DEFAULT_GATEWAY_URL).replace(/\/+$/, "");
	const token = env?.MAIL_GATEWAY_TOKEN || env?.AUTH_SECRET || env?.ADMIN_TOKEN;

	// 本地开发或测试模式（未配 Token 且未配 Resend Key，或显式声明 MOCK_EMAIL）
	if ((!token && !env?.RESEND_API_KEY) || env?.MOCK_EMAIL === "true") {
		console.log(`[mock-email] [prefix=${prefix}] To: ${recipient} | Subject: ${subject}`);
		return {
			ok: true,
			id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			mock: true,
		};
	}

	// 1. 优先使用自建邮件网关 (mail-api.yaoxi.cloud)
	if (token) {
		const endpoint = prefix ? `${gatewayUrl}/api/send/${encodeURIComponent(prefix)}` : `${gatewayUrl}/api/send`;
		const payload = {
			to: recipient,
			subject,
			html,
			text: text || stripHtml(html),
			...(from ? { from } : {}),
			...(replyTo ? { replyTo, reply_to: replyTo } : {}),
			...(Object.keys(headers).length ? { headers } : {}),
		};

		try {
			const res = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
					"x-api-key": token,
				},
				body: JSON.stringify(payload),
			});

			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				console.error("[gateway-email-error]", res.status, data);
				return {
					ok: false,
					error: data?.error || data?.message || `HTTP ${res.status}: ${JSON.stringify(data)}`,
				};
			}

			return { ok: true, id: data?.id || `gw-${Date.now()}` };
		} catch (err) {
			console.error("[gateway-email-exception]", err);
			return { ok: false, error: err?.message || String(err) };
		}
	}

	// 2. 回退模式：Resend API
	if (env?.RESEND_API_KEY) {
		try {
			const res = await fetch("https://api.resend.com/emails", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${env.RESEND_API_KEY}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					from: from || env?.EMAIL_FROM || "Yaoxi Blog <newsletter@yaoxi.wiki>",
					to: Array.isArray(to) ? to : [to],
					subject,
					html,
					text: text || stripHtml(html),
					...(replyTo ? { reply_to: replyTo } : {}),
					...(Object.keys(headers).length ? { headers } : {}),
				}),
			});

			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				return { ok: false, error: data?.message || `HTTP ${res.status}` };
			}
			return { ok: true, id: data?.id };
		} catch (err) {
			return { ok: false, error: err?.message || String(err) };
		}
	}

	return { ok: false, error: "未配置任何发信凭证" };
}

/** 简易 HTML 标签剥离（生成纯文本版本） */
function stripHtml(html = "") {
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** HTML 转义 */
function esc(str = "") {
	return String(str)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/* ================= 基础邮件布局容器 ================= */
function wrapLayout({
	title,
	previewText,
	contentHtml,
	unsubscribeUrl,
	siteUrl = DEFAULT_SITE_URL,
	siteName = DEFAULT_SITE_NAME,
}) {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f6f8fc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #1f2937; line-height: 1.6; }
    .container { max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); border: 1px solid #e5e7eb; }
    .header { background: linear-gradient(135deg, #18181b 0%, #09090b 100%); padding: 24px 30px; text-align: left; }
    .header a { color: #ffffff; text-decoration: none; font-size: 19px; font-weight: 700; letter-spacing: -0.2px; }
    .header-tagline { color: #a1a1aa; font-size: 12.5px; margin-top: 4px; }
    .body-content { padding: 32px 30px; }
    .button { display: inline-block; padding: 11px 24px; background-color: #2563eb; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; text-align: center; margin-top: 18px; }
    .footer { padding: 20px 30px; background-color: #fafafa; border-top: 1px solid #f4f4f5; font-size: 12px; color: #71717a; text-align: center; line-height: 1.6; }
    .footer a { color: #3f3f46; text-decoration: underline; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-bottom: 12px; }
    .badge-primary { background-color: #eff6ff; color: #1d4ed8; }
    .badge-red { background-color: #fef2f2; color: #b91c1c; }
    .badge-green { background-color: #f0fdf4; color: #15803d; }
    .badge-purple { background-color: #faf5ff; color: #7e22ce; }
    @media only screen and (max-width: 620px) {
      .container { margin: 10px; border-radius: 10px; }
      .body-content { padding: 22px 18px; }
      .header { padding: 20px 18px; }
    }
  </style>
</head>
<body>
  ${previewText ? `<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${esc(previewText)}</div>` : ""}
  <div class="container">
    <div class="header">
      <a href="${esc(siteUrl)}" target="_blank">${esc(siteName)}</a>
      <div class="header-tagline">生活分享 · AI 实践 · 技术探索</div>
    </div>
    <div class="body-content">
      ${contentHtml}
    </div>
    <div class="footer">
      <p>本邮件由 <a href="${esc(siteUrl)}" target="_blank">${esc(siteName)}</a> 自动化网关 (mail-api.yaoxi.cloud) 投递。</p>
      ${unsubscribeUrl ? `<p>若您不想继续接收此类更新，可随时 <a href="${esc(unsubscribeUrl)}" target="_blank">一键退订</a>。</p>` : ""}
      <p style="margin-top: 8px; color: #a1a1aa;">© ${new Date().getFullYear()} ${esc(siteName)}. 保留所有权利。</p>
    </div>
  </div>
</body>
</html>`;
}

/* ================= 模板 1：新文章 / 动态更新广播 ================= */
export function buildBroadcastHtml({
	title,
	summary,
	url,
	pubDate,
	tags = [],
	author = "瑶曦",
	type = "post",
	unsubscribeUrl,
	siteName = DEFAULT_SITE_NAME,
	siteUrl = DEFAULT_SITE_URL,
}) {
	const typeBadge = type === "post" ? "新文章发布" : "新动态分享";
	const formattedDate = pubDate
		? new Date(pubDate).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })
		: "";
	const tagBadges = (tags || [])
		.map(
			(t) =>
				`<span style="display:inline-block;margin-right:6px;margin-bottom:6px;padding:2px 8px;background:#f4f4f5;color:#52525b;border-radius:4px;font-size:12px;">#${esc(t)}</span>`,
		)
		.join("");

	const content = `
    <span class="badge badge-primary">${typeBadge}</span>
    <h1 style="margin: 0 0 12px 0; font-size: 22px; color: #111827; line-height: 1.35; font-weight: 700;">
      <a href="${esc(url)}" target="_blank" style="color: #111827; text-decoration: none;">${esc(title)}</a>
    </h1>
    <div style="font-size: 13px; color: #6b7280; margin-bottom: 20px;">
      <span>✍️ ${esc(author)}</span>
      ${formattedDate ? `<span style="margin-left: 12px;">🗓️ ${formattedDate}</span>` : ""}
    </div>
    ${tagBadges ? `<div style="margin-bottom: 18px;">${tagBadges}</div>` : ""}
    <div style="background-color: #f8fafc; border-left: 4px solid #2563eb; padding: 14px 18px; border-radius: 0 8px 8px 0; font-size: 14.5px; color: #374151; line-height: 1.7; margin-bottom: 24px;">
      ${esc(summary)}
    </div>
    <div style="text-align: center;">
      <a href="${esc(url)}" target="_blank" class="button">前往博客阅读全文 →</a>
    </div>
  `;

	return wrapLayout({
		title: `${typeBadge}：${title}`,
		previewText: summary ? summary.slice(0, 100) : title,
		contentHtml: content,
		unsubscribeUrl,
		siteUrl,
		siteName,
	});
}

/* ================= 模板 2：双重确认激活邮件 (Double Opt-in) ================= */
export function buildVerificationHtml({
	email,
	verifyUrl,
	siteName = DEFAULT_SITE_NAME,
	siteUrl = DEFAULT_SITE_URL,
}) {
	const content = `
    <h2 style="margin: 0 0 14px 0; font-size: 20px; color: #111827;">🎉 欢迎订阅 ${esc(siteName)}</h2>
    <p style="font-size: 14.5px; color: #4b5563; line-height: 1.7;">
      您好！我们收到了来自 <strong>${esc(email)}</strong> 的博客邮件订阅请求。
    </p>
    <p style="font-size: 14.5px; color: #4b5563; line-height: 1.7;">
      为了保障您的知情权并防止被他人恶意代填，请点击下方按钮确认激活订阅：
    </p>
    <div style="text-align: center; margin: 26px 0;">
      <a href="${esc(verifyUrl)}" target="_blank" class="button">立即激活订阅确认</a>
    </div>
    <p style="font-size: 12.5px; color: #9ca3af; margin-top: 24px; border-top: 1px dashed #e5e7eb; padding-top: 16px;">
      💡 若非您本人操作，请忽略本邮件，系统不会记录任何信息，24小时后链接自动失效。
    </p>
  `;

	return wrapLayout({
		title: `请激活您的 ${siteName} 订阅`,
		previewText: "请在24小时内点击激活您的博客更新订阅",
		contentHtml: content,
		siteUrl,
		siteName,
	});
}

/* ================= 模板 3：访客留言通知站长 ================= */
export function buildContactNotificationHtml({
	name,
	email,
	message,
	pageUrl,
	ip,
	date = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
	siteName = DEFAULT_SITE_NAME,
	siteUrl = DEFAULT_SITE_URL,
}) {
	const content = `
    <span class="badge badge-primary">📬 新访客留言工单</span>
    <h2 style="margin: 0 0 16px 0; font-size: 18px; color: #111827;">站长，有读者在博客给您留言了：</h2>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13.5px;">
      <tr>
        <td style="padding: 6px 0; width: 80px; color: #6b7280;">访客昵称：</td>
        <td style="padding: 6px 0; font-weight: 600; color: #111827;">${esc(name)}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #6b7280;">联系邮箱：</td>
        <td style="padding: 6px 0;"><a href="mailto:${esc(email)}" style="color: #2563eb;">${esc(email)}</a></td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #6b7280;">留言时间：</td>
        <td style="padding: 6px 0; color: #374151;">${esc(date)}</td>
      </tr>
      ${pageUrl ? `<tr><td style="padding: 6px 0; color: #6b7280;">来源页面：</td><td style="padding: 6px 0;"><a href="${esc(pageUrl)}" target="_blank" style="color: #2563eb; word-break: break-all;">${esc(pageUrl)}</a></td></tr>` : ""}
      ${ip ? `<tr><td style="padding: 6px 0; color: #6b7280;">客户端 IP：</td><td style="padding: 6px 0; color: #6b7280;">${esc(ip)}</td></tr>` : ""}
    </table>

    <div style="background-color: #f3f4f6; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
      <div style="font-size: 12px; color: #6b7280; margin-bottom: 6px; font-weight: 600;">留言正文：</div>
      <div style="font-size: 14.5px; color: #1f2937; line-height: 1.7; white-space: pre-wrap;">${esc(message)}</div>
    </div>

    <div style="text-align: center;">
      <a href="mailto:${esc(email)}?subject=Re:%20${encodeURIComponent(siteName)}%20留言回复" class="button">直接邮件回复访客</a>
    </div>
  `;

	return wrapLayout({
		title: `[博客新留言] 来自 ${name} 的消息`,
		previewText: `${name}: ${message.slice(0, 80)}`,
		contentHtml: content,
		siteUrl,
		siteName,
	});
}

/* ================= 模板 4：访客留言自动回执 (Auto-Reply) ================= */
export function buildContactAutoReplyHtml({
	name,
	message,
	siteName = DEFAULT_SITE_NAME,
	siteUrl = DEFAULT_SITE_URL,
}) {
	const content = `
    <h2 style="margin: 0 0 14px 0; font-size: 19px; color: #111827;">👋 你好 ${esc(name)}，已收到您的留言</h2>
    <p style="font-size: 14.5px; color: #4b5563; line-height: 1.7;">
      感谢您造访 <strong>${esc(siteName)}</strong> 并留下宝贵的信息与反馈！
    </p>
    <p style="font-size: 14.5px; color: #4b5563; line-height: 1.7;">
      站长已收到系统自动流转的留言通报，会尽快查阅并回复您的邮件。
    </p>
    
    <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 18px; margin: 20px 0; font-size: 13.5px; color: #6b7280;">
      <div style="font-weight: 600; margin-bottom: 4px; color: #374151;">您的留言内容：</div>
      <div style="font-style: italic; white-space: pre-wrap;">${esc(message)}</div>
    </div>

    <div style="text-align: center; margin-top: 24px;">
      <a href="${esc(siteUrl)}" target="_blank" class="button">返回博客继续逛逛</a>
    </div>
  `;

	return wrapLayout({
		title: `已收到您在 ${siteName} 的留言`,
		previewText: `您好 ${name}，站长已收到您的留言并正在处理`,
		contentHtml: content,
		siteUrl,
		siteName,
	});
}

/* ================= 模板 5：每周运营与动态数据周报 (Weekly Digest) ================= */
export function buildWeeklyDigestHtml({
	weekRange,
	posts = [],
	momentsCount = 0,
	topTags = [],
	unsubscribeUrl,
	siteName = DEFAULT_SITE_NAME,
	siteUrl = DEFAULT_SITE_URL,
}) {
	const postItems = (posts || [])
		.map(
			(p) => `
    <li style="margin-bottom: 12px;">
      <a href="${esc(p.url)}" target="_blank" style="font-weight: 600; color: #2563eb; text-decoration: none; font-size: 15px;">${esc(p.title)}</a>
      <div style="font-size: 12.5px; color: #6b7280; margin-top: 3px;">${esc(p.description || "")}</div>
    </li>
  `,
		)
		.join("");

	const tagPills = (topTags || [])
		.map(
			(t) =>
				`<span style="display:inline-block;margin:3px;padding:3px 8px;background:#f3f4f6;border-radius:6px;font-size:11px;color:#4b5563;">#${esc(t)}</span>`,
		)
		.join("");

	const content = `
    <span class="badge badge-purple">📊 每周精选周报</span>
    <h1 style="margin: 0 0 8px 0; font-size: 21px; color: #111827;">${esc(siteName)} 周报（${esc(weekRange)}）</h1>
    <p style="font-size: 13.5px; color: #6b7280; margin-bottom: 22px;">这是过去一周博客的新动态、文章发布与数据汇总。</p>

    <div style="display: flex; gap: 12px; margin-bottom: 24px;">
      <div style="flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; text-align: center;">
        <div style="font-size: 22px; font-weight: 700; color: #2563eb;">${posts.length}</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 2px;">本周新文章</div>
      </div>
      <div style="flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; text-align: center;">
        <div style="font-size: 22px; font-weight: 700; color: #7c3aed;">${momentsCount}</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 2px;">朋友圈新动态</div>
      </div>
    </div>

    ${
			posts.length > 0
				? `
      <h3 style="font-size: 16px; color: #111827; margin: 20px 0 10px 0; border-bottom: 1px solid #f3f4f6; pb: 6px;">📝 本周文章更新</h3>
      <ul style="padding-left: 20px; margin-bottom: 20px;">${postItems}</ul>
    `
				: `<p style="font-size: 13.5px; color: #9ca3af; font-style: italic;">本周未发布新长文，都在沉淀与思考中～</p>`
		}

    ${
			tagPills
				? `
      <h3 style="font-size: 14px; color: #374151; margin: 18px 0 8px 0;">🏷️ 热门讨论标签</h3>
      <div style="margin-bottom: 20px;">${tagPills}</div>
    `
				: ""
		}

    <div style="text-align: center; margin-top: 26px;">
      <a href="${esc(siteUrl)}" target="_blank" class="button">前往博客主页探索 →</a>
    </div>
  `;

	return wrapLayout({
		title: `${siteName} 周报 (${weekRange})`,
		previewText: `本周新增 ${posts.length} 篇文章与 ${momentsCount} 条动态`,
		contentHtml: content,
		unsubscribeUrl,
		siteUrl,
		siteName,
	});
}
