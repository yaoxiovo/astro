import { escapeHtml } from "./wiki-diff";

/**
 * 健壮的轻量级 Markdown 渲染器
 * 优先动态尝试使用 markdown-it（生产环境 npm install 具备），
 * 若处于无网络/轻量环境则回退至纯正则解析引擎，100% 杜绝构建崩溃喵！
 */
export async function renderMarkdownToHtml(markdown: string): Promise<string> {
	if (!markdown) return "";

	// 1. 去除 frontmatter 元数据
	const content = markdown.replace(/^---[\s\S]*?---\s*/, "");

	// 2. 尝试动态加载 markdown-it
	try {
		const mdModule = await import("markdown-it");
		const MarkdownIt = mdModule.default || mdModule;
		if (typeof MarkdownIt === "function") {
			const md = new MarkdownIt({ html: true, linkify: true, breaks: true });
			return md.render(content);
		}
	} catch {
		// 回退至内置轻量解析引擎
	}

	// 3. 内置高容错轻量解析器
	let html = content;

	// 代码块 ```lang ... ```
	html = html.replace(
		/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,
		(_, lang, code) => {
			return `<pre class="bg-black/5 dark:bg-white/5 p-4 rounded-xl font-mono text-xs overflow-x-auto my-4 border border-[var(--line-divider)]"><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`;
		},
	);

	// 行内代码 `code`
	html = html.replace(/`([^`]+)`/g, (_, code) => {
		return `<code class="bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded font-mono text-xs text-[var(--primary)]">${escapeHtml(code)}</code>`;
	});

	// 标题 # ~ ######
	html = html.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, text) => {
		const level = hashes.length;
		return `<h${level} class="font-bold my-4 text-black/90 dark:text-white/90">${escapeHtml(text)}</h${level}>`;
	});

	// 引用块 > quote
	html = html.replace(/^>\s+(.+)$/gm, (_, text) => {
		return `<blockquote class="border-l-4 border-[var(--primary)] pl-3 my-2 text-black/60 dark:text-white/60 italic">${escapeHtml(text)}</blockquote>`;
	});

	// 无序列表 - or *
	html = html.replace(/^[\*\-]\s+(.+)$/gm, (_, text) => {
		return `<li class="ml-4 list-disc text-black/80 dark:text-white/80 my-0.5">${escapeHtml(text)}</li>`;
	});

	// 粗体 **text**
	html = html.replace(/\*\*([^*]+)\*\*/g, (_, text) => {
		return `<strong>${escapeHtml(text)}</strong>`;
	});

	// 斜体 *text*
	html = html.replace(/\*([^*]+)\*/g, (_, text) => {
		return `<em>${escapeHtml(text)}</em>`;
	});

	// 链接 [text](url)
	html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
		return `<a href="${escapeHtml(href)}" class="text-[var(--primary)] hover:underline" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
	});

	// 图片 ![alt](url)
	html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
		return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" class="rounded-xl max-w-full my-3 border border-[var(--line-divider)]" />`;
	});

	// 段落分段
	return html
		.split(/\n{2,}/)
		.map((block) => {
			const trimmedBlock = block.trim();
			if (!trimmedBlock) return "";
			if (
				trimmedBlock.startsWith("<h") ||
				trimmedBlock.startsWith("<pre") ||
				trimmedBlock.startsWith("<blockquote") ||
				trimmedBlock.startsWith("<li")
			) {
				return trimmedBlock;
			}
			return `<p class="my-3 leading-relaxed text-black/80 dark:text-white/80">${trimmedBlock.replace(/\n/g, "<br/>")}</p>`;
		})
		.join("\n");
}
