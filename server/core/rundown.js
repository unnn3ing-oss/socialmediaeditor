// 排入 Rundown：POST /rundown（需公司憑證）→ 轉給 FB RUNDOWN 的 Apps Script（-schedulenewnet 的 gas/rundown.gs，沿用已部署的那份）。
// 網址與金鑰只放在後端 Secrets：RUNDOWN_URL（Apps Script 網頁應用程式 /exec 網址）、RUNDOWN_TOKEN（同 Apps Script 指令碼屬性 TOKEN，至少 12 字）。
// 本文：{ action:'ping' } 或 { action:'add', entries:[{ page, date:'YYYY-MM-DD', time:'HH:mm', text:'4041548/圖文/颱風假' }] }
import { ok, fail, readBody } from './http.js';
import { bearer } from './auth.js';

export const RUNDOWN_PAGES = ['news', 'ent', 'shaokang', 'intl'];
const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
const TEXT_RE = /^[^\r\n]*\/(圖文|文字)\/[^\r\n]*$/;

export const rundownReady = (env) => URL_RE.test(env.RUNDOWN_URL || '') && typeof env.RUNDOWN_TOKEN === 'string' && env.RUNDOWN_TOKEN.length >= 12;

// 只轉送格式正確的排入資料；Apps Script 那邊再驗 TOKEN、找格子
export function rundownBody(body) {
  if (!body || (body.action !== 'ping' && body.action !== 'add')) return null;
  if (body.action === 'ping') return { action: 'ping' };
  const list = body.entries;
  if (!Array.isArray(list) || !list.length || list.length > 10) return null;
  const entries = [];
  for (const e of list) {
    if (!e || !RUNDOWN_PAGES.includes(e.page) || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !/^\d{2}:\d{2}$/.test(e.time)) return null;
    if (typeof e.text !== 'string' || !e.text.trim() || e.text.length > 100 || !TEXT_RE.test(e.text)) return null;
    entries.push({ page: e.page, date: e.date, time: e.time, text: e.text });
  }
  return { action: 'add', entries };
}

async function readJson(request) {
  const buf = await readBody(request, 8192);
  if (!buf) return null;
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch (e) { return null; }
}

export async function handleRundown(request, env, path) {
  if (path !== '/rundown') return null;
  if (request.method !== 'POST') return fail(request, env, 'not_found');
  if (!(await bearer(request, env, 'company'))) return fail(request, env, 'unauthorized');
  if (!rundownReady(env)) return fail(request, env, 'rundown_off');
  const body = rundownBody(await readJson(request));
  if (!body) return fail(request, env, 'bad_request');
  let j = null;
  try {
    // Apps Script 會 302 到 googleusercontent 再回 JSON
    const r = await fetch(env.RUNDOWN_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: env.RUNDOWN_TOKEN, ...body }) });
    j = await r.json().catch(() => null);
  } catch (e) { j = null; }
  if (!j || typeof j !== 'object') return fail(request, env, 'rundown_failed', 'Rundown 的 Apps Script 沒有回 JSON（確認部署的「誰可以存取」是「所有人」）。');
  if (!j.ok) return fail(request, env, 'rundown_failed', 'Rundown：' + String(j.error || '失敗').slice(0, 200));
  return ok(request, env, j.results ? { results: j.results } : { title: j.title, sheets: j.sheets });
}
