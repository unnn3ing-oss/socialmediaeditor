// 排入 Rundown：驗格式後補 RUNDOWN_TOKEN 轉給 FB RUNDOWN 的 Apps Script（gas/rundown.gs，在 -schedulenewnet，不改）
import { ok, fail } from '../core/http.js';

const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
const PAGES = ['news', 'ent', 'shaokang', 'intl'];

export const rundownReady = (env) => URL_RE.test(env.RUNDOWN_URL || '') && typeof env.RUNDOWN_TOKEN === 'string' && env.RUNDOWN_TOKEN.length >= 12;

// 只留格式正確的欄位；不合法回 null
export function rundownBody(body) {
  const list = body && body.entries;
  if (!Array.isArray(list) || list.length < 1 || list.length > 10) return null;
  const entries = [];
  for (const e of list) {
    if (!e || !PAGES.includes(e.page) || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !/^\d{2}:\d{2}$/.test(e.time)) return null;
    if (typeof e.text !== 'string' || !e.text.trim() || e.text.length > 100 || /[\r\n]/.test(e.text)) return null;
    entries.push({ page: e.page, date: e.date, time: e.time, text: e.text });
  }
  return { action: 'add', entries };
}

// 轉送；回 { ok:true, data } 或 { code, error }
async function forward(env, body) {
  let j = null;
  try {
    // Apps Script 會 302 到 googleusercontent 再回 JSON
    const r = await fetch(env.RUNDOWN_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: env.RUNDOWN_TOKEN, ...body }) });
    j = await r.json().catch(() => null);
  } catch { j = null; }
  if (!j || typeof j !== 'object') return { code: 'rundown_failed', error: 'Rundown 的 Apps Script 沒有回 JSON（確認部署的「誰可以存取」是「所有人」）。' };
  if (!j.ok) return { code: 'rundown_failed', error: 'Rundown：' + String(j.error || '失敗').slice(0, 200) };
  return { ok: true, data: j };
}

export async function rundownAdd(request, env, body) {
  if (!rundownReady(env)) return fail(request, env, 'rundown_off');
  const clean = rundownBody(body);
  if (!clean) return fail(request, env, 'bad_request');
  const r = await forward(env, clean);
  if (!r.ok) return fail(request, env, r.code, r.error);
  return ok(request, env, { results: Array.isArray(r.data.results) ? r.data.results : [] });
}

// 管理頁（已通過管理憑證）
export async function adminRundown(request, env, path) {
  if (path === '/admin/rundown' && request.method === 'GET') return ok(request, env, { configured: rundownReady(env) });
  if (path === '/admin/rundown/ping' && request.method === 'POST') {
    if (!rundownReady(env)) return fail(request, env, 'rundown_off');
    const r = await forward(env, { action: 'ping' });
    if (!r.ok) return fail(request, env, r.code, r.error);
    return ok(request, env, { title: String(r.data.title || ''), sheets: Array.isArray(r.data.sheets) ? r.data.sheets.slice(0, 6).map(String) : [] });
  }
  return null;
}
