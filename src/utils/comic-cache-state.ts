import { type Writable, writable } from "svelte/store";
import type { ComicCacheTarget } from "./comic-cache";

export const comicCacheTarget: Writable<ComicCacheTarget | null> =
	writable(null);

export function clearComicCacheTarget(context: string): void {
	comicCacheTarget.update((target) =>
		target?.context === context ? null : target,
	);
}
