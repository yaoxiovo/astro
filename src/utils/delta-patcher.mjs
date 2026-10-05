export * from "./delta-core.mjs";

export async function fetchDeltaPatch(slug, fromShortSha, toShortSha) {
	try {
		const res = await fetch(
			`/api/wiki/deltas/${slug}/${fromShortSha}--${toShortSha}.json`,
		);
		if (!res.ok) return null;
		return await res.json();
	} catch (e) {
		console.warn(
			"[DeltaPatcher] 无法获取增量补丁",
			fromShortSha,
			"->",
			toShortSha,
			e,
		);
		return null;
	}
}
