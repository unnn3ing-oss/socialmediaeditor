import { ok, fail, readBody, corsHeaders } from './http.js';
import { bearer } from './auth.js';
import { all, first, run } from './db.js';

export const ASSET_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const MAX_ASSET = 10 * 1024 * 1024;
export const TIERS = ['public', 'company'];

const startsWith = (b, sig, at = 0) => sig.every((v, i) => b[at + i] === v);

// 由檔頭判斷型別；不支援回 null
export function sniffType(b) {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith(b, [0x77, 0x4f, 0x46, 0x32])) return 'font/woff2';
  const head = new TextDecoder().decode(b.subarray(0, 256)).replace(/^﻿/, '').trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return head.includes('<svg') ? 'image/svg+xml' : null;
  return null;
}

const publicRow = (r) => ({ key: r.key, tier: r.tier, type: r.type, size: r.size, updated: r.updated });

export async function handleAssets(request, env, path) {
  if (request.method !== 'GET') return null;
  if (path === '/assets/manifest') {
    const company = await bearer(request, env, 'company');
    const rows = company
      ? await all(env, 'SELECT key, tier, type, size, updated FROM assets ORDER BY key')
      : await all(env, "SELECT key, tier, type, size, updated FROM assets WHERE tier = 'public' ORDER BY key");
    return ok(request, env, rows.map(publicRow), { 'cache-control': 'no-store' });
  }
  const m = /^\/assets\/([^/]+)$/.exec(path);
  if (!m) return null;
  const key = m[1];
  if (!ASSET_KEY_RE.test(key)) return fail(request, env, 'not_found');
  const row = await first(env, 'SELECT tier, type FROM assets WHERE key = ?', key);
  if (!row) return fail(request, env, 'not_found');
  if (row.tier === 'company' && !(await bearer(request, env, 'company'))) return fail(request, env, 'unauthorized');
  const obj = await env.FILES.get('assets/' + key);
  if (!obj) return fail(request, env, 'not_found');
  const headers = {
    'content-type': row.type,
    'cache-control': row.tier === 'company' ? 'private, max-age=300' : 'public, max-age=300',
    'x-content-type-options': 'nosniff',
    // SVG 直接開啟時不執行任何腳本
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    ...corsHeaders(request, env)
  };
  // 公司素材的回應依憑證而異，不讓共用快取混用
  if (row.tier === 'company') headers.Vary = 'Origin, Authorization';
  return new Response(obj.body, { headers });
}

/* ---- 管理端（呼叫前已驗過 admin 憑證）---- */
export async function adminList(request, env) {
  return ok(request, env, (await all(env, 'SELECT key, tier, type, size, updated FROM assets ORDER BY key')).map(publicRow));
}

export async function adminPut(request, env, key) {
  if (!ASSET_KEY_RE.test(key)) return fail(request, env, 'bad_request', '素材名稱只能用小寫英文、數字、點、底線、減號，最長 64 字。');
  const tier = request.headers.get('x-tier');
  if (!TIERS.includes(tier)) return fail(request, env, 'bad_request', '等級必須是 public 或 company。');
  const bytes = await readBody(request, MAX_ASSET);
  if (!bytes) return fail(request, env, 'too_large', '檔案超過 10 MB。');
  if (!bytes.length) return fail(request, env, 'bad_request', '檔案是空的。');
  const type = sniffType(bytes);
  if (!type) return fail(request, env, 'bad_request', '只接受 PNG、JPEG、WebP、SVG、WOFF2。');
  await env.FILES.put('assets/' + key, bytes, { httpMetadata: { contentType: type } });
  const updated = Date.now();
  await run(env, `INSERT INTO assets (key, tier, type, size, updated) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET tier = excluded.tier, type = excluded.type, size = excluded.size, updated = excluded.updated`,
  key, tier, type, bytes.length, updated);
  return ok(request, env, { key, tier, type, size: bytes.length, updated });
}

export async function adminDelete(request, env, key) {
  if (!ASSET_KEY_RE.test(key)) return fail(request, env, 'not_found');
  const row = await first(env, 'SELECT key FROM assets WHERE key = ?', key);
  if (!row) return fail(request, env, 'not_found');
  await env.FILES.delete('assets/' + key);
  await run(env, 'DELETE FROM assets WHERE key = ?', key);
  return ok(request, env, { key });
}
