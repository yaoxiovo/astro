/**
 * crypto.ts - Astro 博客零知识端到端混合加密与数字信封核心工具库
 * 
 * 技术标准：
 * - 纯原生 Web Crypto API (window.crypto.subtle)
 * - 密钥派生：PBKDF2 (100,000 次迭代, SHA-256, 16 字节随机盐)
 * - 对称加密：AES-GCM-256 (12 字节随机 IV)
 * - 非对称密钥与数字信封：RSA-OAEP 2048 (SHA-256)
 */

export interface VaultData {
  public_key_jwk: JsonWebKey;
  encrypted_vault: string; // Base64 (AES-GCM 加密后的私钥 JWK JSON)
  salt: string;            // Base64 (16 bytes)
  iv: string;              // Base64 (12 bytes)
  iterations?: number;
}

export interface KeyEnvelope {
  user_id: string;
  encrypted_cek: string;   // Base64 (经读者 RSA-OAEP 公钥加密的一次性 CEK)
}

export interface EncryptedArticlePayload {
  version: '1.0';
  algorithm: 'AES-GCM-256';
  iv: string;              // Base64 (12 bytes AES-GCM IV)
  ciphertext: string;      // Base64 (正文密文)
  envelopes: KeyEnvelope[];
}

export interface AuthorizedRecipient {
  user_id: string;
  public_key_jwk: JsonWebKey;
}

// ------------------------------------------------------------
// 基础二进制转换工具函数 (Base64 / ArrayBuffer / UTF-8)
// ------------------------------------------------------------

export const bufferToBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const base64ToBuffer = (b64: string): ArrayBuffer => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

// ------------------------------------------------------------
// 1. PBKDF2 主密码密钥派生 (Key Derivation Function)
// ------------------------------------------------------------

export async function deriveKeyFromPassword(
  password: string,
  saltBuffer: ArrayBuffer,
  iterations = 100000
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ------------------------------------------------------------
// 2. 读者 RSA-OAEP 2048 密钥对生成
// ------------------------------------------------------------

export async function generateUserKeyPair(): Promise<CryptoKeyPair> {
  return window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), // 65537
      hash: 'SHA-256',
    },
    true, // 允许导出以在本地加密存入 Vault
    ['encrypt', 'decrypt']
  );
}

// ------------------------------------------------------------
// 3. 本地锁定：使用 Master Password 加密私钥，构造密文 Vault
// ------------------------------------------------------------

export async function lockPrivateKeyVault(
  keyPair: CryptoKeyPair,
  masterPassword: string
): Promise<VaultData> {
  // 1. 导出私钥与公钥为标准 JWK 格式
  const privateJwk = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateJson = JSON.stringify(privateJwk);

  // 2. 生成高熵密码学随机 Salt (16 字节) 与 IV (12 字节)
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // 3. PBKDF2 派生 AES-GCM-256 密钥
  const derivedKey = await deriveKeyFromPassword(masterPassword, salt.buffer, 100000);

  // 4. AES-GCM 加密私钥 JWK 字符串
  const encryptedBuf = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    new TextEncoder().encode(privateJson)
  );

  return {
    public_key_jwk: publicJwk,
    encrypted_vault: bufferToBase64(encryptedBuf),
    salt: bufferToBase64(salt.buffer),
    iv: bufferToBase64(iv.buffer),
    iterations: 100000,
  };
}

// ------------------------------------------------------------
// 4. 新设备解锁：输入 Master Password，从密文 Vault 还原私钥至内存
// ------------------------------------------------------------

export async function unlockPrivateKeyVault(
  vault: VaultData,
  masterPassword: string
): Promise<CryptoKey> {
  const saltBuf = base64ToBuffer(vault.salt);
  const ivBuf = base64ToBuffer(vault.iv);
  const encryptedBuf = base64ToBuffer(vault.encrypted_vault);

  // 派生对称密钥
  const derivedKey = await deriveKeyFromPassword(
    masterPassword,
    saltBuf,
    vault.iterations || 100000
  );

  try {
    const decryptedBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(ivBuf) },
      derivedKey,
      encryptedBuf
    );

    const privateJwk = JSON.parse(new TextDecoder().decode(decryptedBuf));

    // 将 JWK 还原为 RSA-OAEP 私钥对象 (仅驻留内存，用于解封数字信封)
    return window.crypto.subtle.importKey(
      'jwk',
      privateJwk,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt']
    );
  } catch {
    throw new Error('Master Password 校验失败：密码错误或密文保险库损坏！');
  }
}

// ------------------------------------------------------------
// 5. 发布受限文章：生成一次性 CEK 加密正文，并为每个读者封装数字信封
// ------------------------------------------------------------

export async function encryptArticleContent(
  markdownText: string,
  authorizedRecipients: AuthorizedRecipient[]
): Promise<EncryptedArticlePayload> {
  if (authorizedRecipients.length === 0) {
    throw new Error('至少需要选择一个授权读者公钥以封装数字信封！');
  }

  // 1. 生成一次性 32 字节 AES-GCM-256 对称内容加密密钥 (CEK)
  const cek = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // 允许导出用于非对称信封封装
    ['encrypt', 'decrypt']
  );

  // 2. 生成 12 字节 IV 并加密 Markdown 正文全文
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuf = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cek,
    new TextEncoder().encode(markdownText)
  );

  // 3. 导出原始 CEK 字节 (32 字节)
  const rawCek = await window.crypto.subtle.exportKey('raw', cek);

  // 4. 使用每个授权读者的 RSA-OAEP 公钥分别加密 CEK 生成专属数字信封
  const envelopes: KeyEnvelope[] = [];
  for (const recipient of authorizedRecipients) {
    const pubKey = await window.crypto.subtle.importKey(
      'jwk',
      recipient.public_key_jwk,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );

    const encryptedCekBuf = await window.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      pubKey,
      rawCek
    );

    envelopes.push({
      user_id: recipient.user_id,
      encrypted_cek: bufferToBase64(encryptedCekBuf),
    });
  }

  return {
    version: '1.0',
    algorithm: 'AES-GCM-256',
    iv: bufferToBase64(iv.buffer),
    ciphertext: bufferToBase64(ciphertextBuf),
    envelopes,
  };
}

// ------------------------------------------------------------
// 6. 读者现场解封数字信封与正文解密
// ------------------------------------------------------------

export async function decryptArticleContent(
  payload: EncryptedArticlePayload,
  userPrivateKey: CryptoKey,
  currentUserId: string
): Promise<string> {
  // 1. 查找匹配当前读者的数字信封
  const envelope = payload.envelopes.find((env) => env.user_id === currentUserId);
  if (!envelope) {
    throw new Error('未在本文档中找到针对您账号的授权数字信封，无权查看！');
  }

  // 2. 使用读者的私钥解密数字信封，获取对称密钥 CEK
  const encryptedCekBuf = base64ToBuffer(envelope.encrypted_cek);
  let rawCek: ArrayBuffer;
  try {
    rawCek = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      userPrivateKey,
      encryptedCekBuf
    );
  } catch {
    throw new Error('数字信封解密失败：私钥不匹配！');
  }

  // 3. 导入还原出的 CEK
  const cek = await window.crypto.subtle.importKey(
    'raw',
    rawCek,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // 4. 使用 CEK 与 IV 解密文章正文 Markdown
  const ivBuf = base64ToBuffer(payload.iv);
  const ciphertextBuf = base64ToBuffer(payload.ciphertext);
  try {
    const decryptedBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(ivBuf) },
      cek,
      ciphertextBuf
    );
    return new TextDecoder().decode(decryptedBuf);
  } catch {
    throw new Error('正文密文校验失败：密文可能被篡改！');
  }
}
