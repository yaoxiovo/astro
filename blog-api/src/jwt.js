/**
 * 瑶曦评论 · SSO 身份验签（零依赖 WebCrypto 实现）
 *
 * 目标：让 blog-api 也能验证认证中心（accounts.yaoxi.cloud）下发的读者 JWT，
 *       为评论投稿绑定可信身份。验签语义与 zk-bff 的 requireAuth 严格对齐：
 *       候选密钥顺序 JWT_SECRET → AUTH_SECRET → SSO_SECRET，任一验签通过即为可信身份。
 *
 * 安全约束：
 *   - 仅接受 HMAC 族（HS256/HS384/HS512），显式拒绝 none / 非对称算法混淆攻击；
 *   - exp / nbf 强校验（含 60s 时钟容忍），无 exp 的 token 一律拒绝（防永不过期凭证）；
 *   - 验签失败返回 null，由调用方静默降级为游客身份（不暴露失败原因）。
 */

const ALG_HASH = { HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512" };
const CLOCK_TOLERANCE_SEC = 60;
const MAX_TOKEN_LENGTH = 4096;

/** base64url → Uint8Array（兼容缺省 padding） */
function b64urlToBytes(input) {
	const s = String(input).replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
	const padded = s.length % 4 === 0 ? s : s + "=".repeat(4 - (s.length % 4));
	const bin = atob(padded);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

function b64urlToJson(input) {
	try {
		return JSON.parse(new TextDecoder().decode(b64urlToBytes(input)));
	} catch {
		return null;
	}
}

/** exp / nbf 时效校验（无 exp 视为不可信凭证） */
function claimsValid(payload) {
	if (typeof payload.exp !== "number") return false;
	const now = Math.floor(Date.now() / 1000);
	if (now > payload.exp + CLOCK_TOLERANCE_SEC) return false;
	if (typeof payload.nbf === "number" && now + CLOCK_TOLERANCE_SEC < payload.nbf) return false;
	return true;
}

/**
 * 验签 JWT：依次尝试候选密钥，返回 payload 或 null。
 * 使用 WebCrypto HMAC verify（实现层保证常数时间比较，防时序侧信道）。
 */
export async function verifyJwt(token, secrets) {
	if (!token || typeof token !== "string" || !Array.isArray(secrets) || secrets.length === 0) return null;

	const parts = token.split(".");
	if (parts.length !== 3) return null;
	const [headB64, payloadB64, sigB64] = parts;

	const header = b64urlToJson(headB64);
	if (!header || typeof header.alg !== "string") return null;
	const hash = ALG_HASH[header.alg];
	if (!hash) return null; // 拒绝 none 与所有非 HMAC 算法

	const payload = b64urlToJson(payloadB64);
	if (!payload) return null;

	let signature;
	try {
		signature = b64urlToBytes(sigB64);
	} catch {
		return null;
	}
	const signingInput = new TextEncoder().encode(`${headB64}.${payloadB64}`);

	for (const secret of secrets) {
		try {
			const key = await crypto.subtle.importKey(
				"raw",
				new TextEncoder().encode(String(secret)),
				{ name: "HMAC", hash },
				false,
				["verify"],
			);
			const ok = await crypto.subtle.verify("HMAC", key, signature, signingInput);
			if (ok) return claimsValid(payload) ? payload : null;
		} catch {
			// 密钥材料异常：尝试下一个候选
		}
	}
	return null;
}

/** 提取 Bearer Token（超长直接拒绝，防解析型 DoS） */
export function extractBearerToken(request) {
	const auth = request?.headers?.get("Authorization") || "";
	if (!auth.startsWith("Bearer ")) return null;
	const token = auth.slice(7).trim();
	return token && token.length <= MAX_TOKEN_LENGTH ? token : null;
}

/** 收集环境中的候选验签密钥（与 zk-bff / 认证中心对齐） */
export function getCandidateSecrets(env) {
	return [env?.JWT_SECRET, env?.AUTH_SECRET, env?.SSO_SECRET].filter(
		(s) => typeof s === "string" && s.length > 0,
	);
}

/**
 * 从请求解析 SSO 身份：{ sub, username } 或 null（游客）。
 * sub 缺失视为无效身份——绑定必须锚定认证中心下发的唯一主体标识。
 */
export async function resolveIdentity(request, env) {
	const token = extractBearerToken(request);
	if (!token) return null;
	const secrets = getCandidateSecrets(env);
	if (secrets.length === 0) return null;

	const payload = await verifyJwt(token, secrets);
	if (!payload) return null;

	const sub = payload.sub != null ? String(payload.sub).slice(0, 64) : "";
	if (!sub) return null;

	const username = payload.username != null ? String(payload.username) : payload.name != null ? String(payload.name) : "";
	return { sub, username: username.slice(0, 32) };
}
