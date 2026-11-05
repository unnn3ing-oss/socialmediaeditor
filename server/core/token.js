// 憑證：HMAC-SHA256 簽章，內容 { kind, exp }（比照 -schedulenewnet 的 signSession／sessionExp）
const enc = new TextEncoder();

export function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str)) return null;
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  try {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch (e) { return null; }
}
function hmacKey(secret, usages) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

export const KINDS = ['company', 'admin'];

export async function signToken(secret, kind, exp) {
  const payload = enc.encode(JSON.stringify({ kind, exp }));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, ['sign']), payload);
  return b64urlEncode(payload) + '.' + b64urlEncode(new Uint8Array(sig));
}

// 有效回 { kind, exp }，無效或過期回 null
export async function readToken(secret, token, nowSec) {
  if (typeof token !== 'string' || typeof secret !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const payload = b64urlDecode(parts[0]), sig = b64urlDecode(parts[1]);
  if (!payload || !sig || !payload.length || !sig.length) return null;
  let ok;
  try { ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, ['verify']), sig, payload); } catch (e) { return null; }
  if (!ok) return null;
  let data;
  try { data = JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return null; }
  if (!data || !KINDS.includes(data.kind)) return null;
  if (typeof data.exp !== 'number' || !Number.isFinite(data.exp) || data.exp <= nowSec) return null;
  return { kind: data.kind, exp: data.exp };
}

/* 定時比對密碼：以隨機金鑰對輸入做 HMAC，再用 verify（定時比較）檢查，長度不同也不洩漏 */
export async function passwordMatches(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string' || !expected) return false;
  const k = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const mac = await crypto.subtle.sign('HMAC', k, enc.encode(input));
  return crypto.subtle.verify('HMAC', k, mac, enc.encode(expected));
}
