import { defineCollection, z } from "astro:content";

const postsCollection = defineCollection({
	schema: z.object({
		title: z.string(),
		published: z.date(),
		updated: z.date().optional(),
		draft: z.boolean().optional().default(false),
		description: z.string().optional().default(""),
		image: z.string().optional().default(""),
		tags: z.array(z.string()).optional().default([]),
		category: z.string().optional().default(""),
		lang: z.string().optional().default(""),
		pinned: z.boolean().optional().default(false),
		series: z.string().optional().default(""),

		/* For internal use */
		prevTitle: z.string().default(""),
		prevSlug: z.string().default(""),
		nextTitle: z.string().default(""),
		nextSlug: z.string().default(""),
	}),
});

const assetsCollection = defineCollection({
	type: 'data',
	schema: z.object({
		title: z.string().optional(),
		description: z.string().optional(),
	}),
});

const momentsCollection = defineCollection({
	schema: z.object({
		published: z.date(),
		author: z.string().optional(),
		avatar: z.string().optional(),
		images: z.array(z.string()).optional().default([]),
		verifyType: z.enum(['blue', 'yellow', 'none']).optional().default('none'),
		verifySubject: z.string().optional().default(''),
		source: z.string().optional(),
		pinned: z.boolean().optional().default(false),
		replyTo: z.string().optional(),
	}),
});

const musicCollection = defineCollection({
	schema: z.object({
		title: z.string(),
		artist: z.string(),
		src: z.string(),
		cover: z.string().optional(),
		lrc: z.string().optional(),
		published: z.date(),
		author: z.string().optional(),
		avatar: z.string().optional(),
		verifyType: z.enum(['blue', 'yellow', 'none']).optional().default('none'),
		verifySubject: z.string().optional().default(''),
		source: z.string().optional(),
		likes: z.number().optional().default(0),
		comments: z.number().optional().default(0),
	}),
});

export const collections = {
	posts: postsCollection,
	assets: assetsCollection,
	moments: momentsCollection,
	music: musicCollection,
};

