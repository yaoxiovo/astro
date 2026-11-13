/** Tencent TMS TextModeration, using Web Crypto so Worker and Node share one client. */
const HOST = "tms.tencentcloudapi.com";
const CONTENT_TYPE = "application/json; charset=utf-8";
const SIGNED_HEADERS = "content-type;host;x-tc-action";
const encoder = new TextEncoder();

const hex = (bytes) =>
	Array.from(new Uint8Array(bytes), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
const sha256 = async (text) =>
	hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));

async function hmac(key, text) {
	const material = typeof key === "string" ? encoder.encode(key) : key;
	const imported = await crypto.subtle.importKey(
		"raw",
		material,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return crypto.subtle.sign("HMAC", imported, encoder.encode(text));
}

export function isTencentTmsEnabled(env) {
	return ["1", "true", "yes"].includes(
		String(env?.TENCENT_TMS_ENABLED || "").toLowerCase(),
	);
}

/** TC3 signs the exact JSON bytes sent to the fixed Tencent endpoint. */
export async function createTmsHeaders(env, body, timestamp) {
	const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
	const scope = `${date}/tms/tc3_request`;
	const canonicalHeaders = `content-type:${CONTENT_TYPE}\nhost:${HOST}\nx-tc-action:textmoderation\n`;
	const canonical = `POST\n/\n\n${canonicalHeaders}\n${SIGNED_HEADERS}\n${await sha256(body)}`;
	const toSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${await sha256(canonical)}`;
	const dateKey = await hmac(`TC3${env.TENCENTCLOUD_SECRET_KEY}`, date);
	const serviceKey = await hmac(dateKey, "tms");
	const signingKey = await hmac(serviceKey, "tc3_request");
	const signature = hex(await hmac(signingKey, toSign));
	return {
		"Content-Type": CONTENT_TYPE,
		"X-TC-Action": "TextModeration",
		"X-TC-Version": "2020-12-29",
		"X-TC-Timestamp": String(timestamp),
		"X-TC-Region": env.TENCENT_TMS_REGION || "ap-guangzhou",
		...(env.TENCENTCLOUD_TOKEN ? { "X-TC-Token": env.TENCENTCLOUD_TOKEN } : {}),
		Authorization: `TC3-HMAC-SHA256 Credential=${env.TENCENTCLOUD_SECRET_ID}/${scope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`,
	};
}

/** Only return bounded audit metadata, never raw provider errors, text or credentials. */
export async function moderateTencentText(
	env,
	text,
	{ fetchImpl = fetch, now = Date.now } = {},
) {
	if (!isTencentTmsEnabled(env))
		return { provider: "tencent-tms", suggestion: "Disabled" };
	const error = (code) => ({
		provider: "tencent-tms",
		suggestion: "Error",
		error: code,
	});
	if (!env.TENCENTCLOUD_SECRET_ID || !env.TENCENTCLOUD_SECRET_KEY)
		return error("not_configured");
	try {
		const bytes = encoder.encode(text);
		const content = btoa(
			Array.from(bytes, (b) => String.fromCharCode(b)).join(""),
		);
		const body = JSON.stringify({
			Content: content,
			Type: "TEXT",
			...(env.TENCENT_TMS_BIZ_TYPE
				? { BizType: env.TENCENT_TMS_BIZ_TYPE }
				: {}),
		});
		const headers = await createTmsHeaders(env, body, Math.floor(now() / 1000));
		const response = await fetchImpl(`https://${HOST}/`, {
			method: "POST",
			headers,
			body,
			signal: AbortSignal.timeout(5000),
			redirect: "error",
		});
		if (!response.ok) return error(`http_${response.status}`);
		const result = (await response.json())?.Response;
		if (result?.Error) return error("provider_error");
		if (!["Pass", "Review", "Block"].includes(result?.Suggestion))
			return error("invalid_response");
		return {
			provider: "tencent-tms",
			suggestion: result.Suggestion,
			requestId:
				typeof result.RequestId === "string"
					? result.RequestId.slice(0, 128)
					: "",
			label: typeof result.Label === "string" ? result.Label.slice(0, 64) : "",
			...(typeof result.Score === "number" && Number.isFinite(result.Score)
				? { score: result.Score }
				: {}),
		};
	} catch {
		return error("request_failed");
	}
}
