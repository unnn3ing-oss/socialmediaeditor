// 臉書文字背景（管理頁可管理）：D1 fb_backgrounds 一列一個背景；圖樣圖片存 R2 fbbg/<代號>。
//   匯入＝貼上擷取腳本（docs/fb-text-backgrounds/extract-fb-backgrounds.js）的 JSON；先 dry 預覽新增／更新／臉書已沒有，再套用。
//   圖片由管理頁分批下載（每次 ≤ FETCH_BATCH 張，Workers 免費方案每個請求 50 個子請求）。
//   只收 https *.fbcdn.net、image/*、≤ MAX_IMG，不跟轉址。
//   表裡沒資料＝還沒匯入過 → bgpresets.js 退回內建清單（純色＋漸層）。
import { ensureOnce, cached, forget } from '../core/once.js';

export const MAX_ITEMS = 200, MAX_NAME = 20, FETCH_BATCH = 10, MAX_IMG = 2 * 1024 * 1024;
export const TYPES = ['solid', 'gradient', 'image'];
export const ID_RE = /^\d{6,20}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const DIRS = ['BL_TR', 'TR_BL', 'TL_BR', 'BR_TL'];
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const R2_PREFIX = 'fbbg/';

const SQL = 'CREATE TABLE IF NOT EXISTS fb_backgrounds (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, bg TEXT NOT NULL, text TEXT NOT NULL, grad TEXT, dir TEXT, url TEXT, img INTEGER NOT NULL DEFAULT 0, err TEXT, tried INTEGER, show INTEGER NOT NULL DEFAULT 1, ord INTEGER NOT NULL, updated INTEGER NOT NULL)';
const ensure = (env) => ensureOnce(env.DB, SQL);
const CACHE_KEY = 'fb_backgrounds';

// 圖片網址：只收 https、*.fbcdn.net、沒有帳密與連接埠
export function validImgUrl(s) {
  if (typeof s !== 'string' || s.length > 2000) return false;
  let u;
  try { u = new URL(s); } catch { return false; }
  return u.protocol === 'https:' && !u.port && !u.username && !u.password && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.fbcdn\.net$/i.test(u.hostname);
}

// 擷取資料一筆 → 列；格式不對回 null
export function normPreset(p) {
  if (!p || typeof p !== 'object' || !ID_RE.test(String(p.preset_id)) || !TYPES.includes(p.type)) return null;
  const bg = String(p.background_color || ''), text = String(p.text_color || '');
  if (!HEX.test(bg) || !HEX.test(text)) return null;
  const row = { id: String(p.preset_id), type: p.type, bg: bg.toUpperCase(), text: text.toUpperCase(), grad: null, dir: null, url: null };
  if (p.type === 'gradient') {
    if (!HEX.test(String(p.gradient_color || ''))) return null;
    row.grad = String(p.gradient_color).toUpperCase();
    row.dir = DIRS.includes(p.gradient_direction) ? p.gradient_direction : null;
  }
  if (p.type === 'image' && validImgUrl(p.background_image_url)) row.url = p.background_image_url;
  row.name = [...String(p.label || p.fb_description || '').trim()].slice(0, MAX_NAME).join('') || row.id;
  return row;
}

// 匯入內容 → { rows, bad }；整份不合法回 null
export function parseImport(body) {
  const list = body && (Array.isArray(body.presets) ? body.presets : null);
  if (!list || !list.length || list.length > MAX_ITEMS) return null;
  const rows = [], seen = new Set();
  let bad = 0;
  for (const p of list) {
    const r = normPreset(p);
    if (!r || seen.has(r.id)) { bad++; continue; }
    seen.add(r.id); rows.push(r);
  }
  return rows.length ? { rows, bad } : null;
}

async function readAll(env) {
  await ensure(env);
  const { results } = await env.DB.prepare('SELECT * FROM fb_backgrounds ORDER BY ord, id').all();
  return results || [];
}

// 排程發布用：60 秒快取（同執行個體寫入後立即清）
export function storedBackgrounds(env) { return cached(env.DB, CACHE_KEY, 60000, () => readAll(env)); }
const changed = (env) => forget(env.DB, CACHE_KEY);

const adminRow = (r) => ({ id: r.id, name: r.name, type: r.type, bg: r.bg, text: r.text, grad: r.grad, dir: r.dir, img: !!r.img, hasUrl: !!r.url, err: r.err || '', show: !!r.show });

export async function adminState(env) {
  const rows = await readAll(env);
  return { list: rows.map(adminRow), batch: FETCH_BATCH };
}

// 預覽：新增／更新／臉書已沒有（現有但這份沒有）
export async function importDiff(env, rows) {
  const cur = await readAll(env);
  const has = new Map(cur.map((r) => [r.id, r]));
  const ids = new Set(rows.map((r) => r.id));
  return {
    add: rows.filter((r) => !has.has(r.id)).length,
    update: rows.filter((r) => has.has(r.id)).length,
    gone: cur.filter((r) => !ids.has(r.id)).map((r) => ({ id: r.id, name: r.name, type: r.type }))
  };
}

// 套用：新增的照擷取資料；已有的保留名稱、顯示與已下載的圖，其他欄位更新；順序照這份；remove 的刪除（連 R2 圖片）
export async function importApply(env, rows, remove = []) {
  const cur = await readAll(env);
  const has = new Map(cur.map((r) => [r.id, r]));
  const now = Date.now();
  const ids = new Set(rows.map((r) => r.id));
  const del = cur.filter((r) => remove.includes(r.id) && !ids.has(r.id)).map((r) => r.id);
  const base = rows.length;
  const stmts = rows.map((r, i) => {
    const old = has.get(r.id);
    if (!old) {
      return env.DB.prepare('INSERT INTO fb_backgrounds (id, name, type, bg, text, grad, dir, url, img, err, tried, show, ord, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 1, ?, ?)')
        .bind(r.id, r.name, r.type, r.bg, r.text, r.grad, r.dir, r.url, i, now);
    }
    // 換了網址就重新允許下載（之前失敗的原因清掉）；種類從圖樣改成別的就把圖當作沒有
    const url = r.url || old.url;
    const img = r.type === 'image' ? old.img : 0;
    const reset = r.url && r.url !== old.url;
    return env.DB.prepare('UPDATE fb_backgrounds SET type = ?, bg = ?, text = ?, grad = ?, dir = ?, url = ?, img = ?, err = ?, tried = ?, ord = ?, updated = ? WHERE id = ?')
      .bind(r.type, r.bg, r.text, r.grad, r.dir, r.type === 'image' ? url : null, img, reset ? null : old.err, reset ? null : old.tried, i, now, r.id);
  });
  // 這份沒有、也沒選刪除的：排在後面，順序不變
  cur.filter((r) => !ids.has(r.id) && !del.includes(r.id)).forEach((r, k) => {
    stmts.push(env.DB.prepare('UPDATE fb_backgrounds SET ord = ? WHERE id = ?').bind(base + k, r.id));
  });
  for (const id of del) stmts.push(env.DB.prepare('DELETE FROM fb_backgrounds WHERE id = ?').bind(id));
  await env.DB.batch(stmts);
  if (del.length && env.FILES) await env.FILES.delete(del.map((id) => R2_PREFIX + id)).catch(() => {});
  changed(env);
}

// 改名稱／顯示；找不到回 false
export async function updateOne(env, id, { name, show }) {
  await ensure(env);
  const r = await env.DB.prepare('SELECT id FROM fb_backgrounds WHERE id = ?').bind(id).first();
  if (!r) return false;
  if (name !== undefined) await env.DB.prepare('UPDATE fb_backgrounds SET name = ?, updated = ? WHERE id = ?').bind(name, Date.now(), id).run();
  if (show !== undefined) await env.DB.prepare('UPDATE fb_backgrounds SET show = ?, updated = ? WHERE id = ?').bind(show ? 1 : 0, Date.now(), id).run();
  changed(env);
  return true;
}

export async function deleteOne(env, id) {
  await ensure(env);
  await env.DB.prepare('DELETE FROM fb_backgrounds WHERE id = ?').bind(id).run();
  if (env.FILES) await env.FILES.delete(R2_PREFIX + id).catch(() => {});
  changed(env);
}

// 下載一張；成功回 null，失敗回原因
async function downloadOne(env, r, fetchImpl) {
  if (!validImgUrl(r.url)) return '網址不是臉書圖片網址';
  let res;
  try { res = await fetchImpl(r.url, { redirect: 'manual' }); } catch { return '連不到臉書'; }
  if (res.status === 403 || res.status === 410) return '網址已過期，請重新擷取';
  if (res.status !== 200) return '臉書回應 ' + res.status;
  const ct = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!IMG_TYPES.includes(ct)) return '不是圖片';
  if (Number(res.headers.get('content-length') || 0) > MAX_IMG) return '圖片太大';
  let buf;
  try { buf = await res.arrayBuffer(); } catch { return '讀取失敗'; }
  if (!buf.byteLength) return '圖片是空的';
  if (buf.byteLength > MAX_IMG) return '圖片太大';
  try { await env.FILES.put(R2_PREFIX + r.id, buf, { httpMetadata: { contentType: ct } }); } catch { return '存入失敗'; }
  return null;
}

// 下載一批：還沒有圖、有網址、這一輪（since 之後）還沒試過的；回 { done, failed, left }
export async function fetchBatch(env, since, fetchImpl = fetch) {
  await ensure(env);
  if (!env.FILES) return { done: 0, failed: 0, left: 0, error: '後端沒有綁定 R2（FILES）。' };
  const cond = "type = 'image' AND img = 0 AND url IS NOT NULL AND (tried IS NULL OR tried < ?)";
  const { results } = await env.DB.prepare(`SELECT id, url FROM fb_backgrounds WHERE ${cond} ORDER BY ord LIMIT ${FETCH_BATCH}`).bind(since).all();
  let done = 0, failed = 0;
  for (const r of results || []) {
    const err = await downloadOne(env, r, fetchImpl);
    const now = Date.now();
    if (err) failed++; else done++;
    await env.DB.prepare('UPDATE fb_backgrounds SET img = ?, err = ?, tried = ? WHERE id = ?').bind(err ? 0 : 1, err, Math.max(now, since), r.id).run();
  }
  const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM fb_backgrounds WHERE ${cond}`).bind(since).first();
  if (done) changed(env);
  return { done, failed, left: left ? Number(left.n) : 0 };
}

// 讀圖（/fb/bg/<代號>）：只給有列、顯示中、已下載的；管理頁（any）隱藏的也讀得到
export async function readImage(env, id, any = false) {
  if (!ID_RE.test(id) || !env.FILES) return null;
  const rows = any ? await readAll(env) : await storedBackgrounds(env);
  const r = rows.find((x) => x.id === id);
  if (!r || !r.img || (!r.show && !any)) return null;
  return env.FILES.get(R2_PREFIX + id);
}
