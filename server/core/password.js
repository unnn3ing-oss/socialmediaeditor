// 員工密碼：PBKDF2-SHA256 加鹽雜湊（只存雜湊與鹽，不存明碼）；設定碼：6 位數字，存 HMAC（SESSION_SECRET）
import { b64urlEncode } from './token.js';

const enc = new TextEncoder();
export const PW_MIN = 8;
export const PW_MAX = 128;
export const PW_ITER = 100000;          // Workers 的 PBKDF2 上限
export const MAX_FAILS = 5;             // 連錯 5 次
export const LOCK_MS = 15 * 60 * 1000;  // 鎖 15 分鐘
export const SETUP_MS = 24 * 3600 * 1000; // 設定碼 24 小時

// 密碼長度檢查：合格回 ''，不合格回訊息
export function pwProblem(pw) {
  if (typeof pw !== 'string') return '請輸入密碼。';
  const n = [...pw].length;
  if (n < PW_MIN) return '密碼至少 ' + PW_MIN + ' 個字。';
  if (n > PW_MAX) return '密碼最多 ' + PW_MAX + ' 個字。';
  return '';
}

async function derive(pw, saltBytes) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: PW_ITER }, key, 256);
  return new Uint8Array(bits);
}
const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

// 新密碼 → { hash, salt }（base64url）
export async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: b64urlEncode(await derive(pw, salt)), salt: b64urlEncode(salt) };
}

// 定時比較（逐位元組 XOR，長度固定 32）
export async function verifyPassword(pw, hash, salt) {
  if (typeof pw !== 'string' || !hash || !salt) return false;
  let a, b;
  try { a = await derive(pw, fromB64(salt)); b = fromB64(hash); } catch { return false; }
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// 6 位數設定碼
export function newSetupCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}
export async function codeHash(secret, id, code) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode('setup:' + id + ':' + code))));
}

// 定時比較兩個字串（長度不同直接 false；雜湊長度固定）
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
