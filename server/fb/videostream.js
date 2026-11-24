// 實驗功能：影片分段「邊收邊轉」給臉書（不先把整段讀進 Worker 記憶體）
//   開關存 D1 fb_settings k='video_opts'：{ stream, who:'all'|'some', staff:[員工編號] }；預設關（＝現行 receiveChunk 整段讀完再轉）
//   管理頁「進階設定 → 實驗功能」（敏感卡片 labs）；快取 60 秒（同執行個體存檔立即清）
//   能串流：所有要這段的粉專都剛好要「整段」（Reels 一定是；橫式看臉書回的 end_offset）→ 一個粉專直接轉、多個粉專 tee 分流
//   不能串流（橫式粉專要的長度和這段不同）→ 回 null，由呼叫端改用現行 receiveChunk（本文還沒被讀）
//   串流沒辦法在後端重送同一段：結果不明／5xx／錯誤碼 1、2 時粉專維持上傳中、不前進，回 fb_retry 讓前端重送這段（前端最多重試 2 次）
import { GRAPH_VIDEO, GraphError, graphFetch } from './graph.js';
import { pageTokens } from './pages.js';
import { normOpts, STAFF_RE, MAX_LAB_STAFF } from './comment.js';
import { rows, update, updateIf, finishReady, result, errText, ruploadPart } from './video.js';
import { ensureSettings, cached, forget } from '../core/once.js';

// ---- 設定 ----
const OPTS_KEY = 'video_opts';
// 沿用留言實驗的格式檢查（欄位名 edit → stream）
export function normVideoOpts(v) {
  const o = normOpts(v ? { edit: v.stream, who: v.who, staff: v.staff } : null);
  return { stream: o.edit, who: o.who, staff: o.staff };
}
export function validVideoOpts(b) {
  if (!b || typeof b.stream !== 'boolean') return null;
  const who = b.who === undefined ? 'all' : b.who;
  if (!['all', 'some'].includes(who)) return null;
  if (who === 'some' && (!Array.isArray(b.staff) || b.staff.length > MAX_LAB_STAFF || !b.staff.every((x) => typeof x === 'string' && STAFF_RE.test(x.trim())))) return null;
  return normVideoOpts({ ...b, who });
}
async function readOpts(env) {
  await ensureSettings(env);
  const r = await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind(OPTS_KEY).first();
  let v = null;
  try { v = r ? JSON.parse(r.v) : null; } catch { v = null; }
  return normVideoOpts(v);
}
export async function videoOpts(env) {
  if (!env || !env.DB) return normVideoOpts(null);
  try { return await cached(env.DB, OPTS_KEY, 60000, () => readOpts(env)); } catch { return normVideoOpts(null); }
}
export async function saveVideoOpts(env, opts) {
  await ensureSettings(env);
  await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
    .bind(OPTS_KEY, JSON.stringify(normVideoOpts(opts)), Date.now()).run();
  forget(env.DB, OPTS_KEY);
  return readOpts(env);
}
// 這個上傳的人（員工編號）適不適用
export const streamApplies = (opts, uid) => !!opts.stream && (opts.who === 'all' || (!!uid && opts.staff.includes(String(uid).toUpperCase())));

// ---- 串流工具 ----
// 只用內建串流（request.body、tee、FixedLengthStream、pipeTo）轉送：資料不經過 JS 逐塊處理，不吃 Worker CPU 時間
//   （第一版用 JS TransformStream／pull 處理每一小塊，實測 32MB 分段超過免費方案 CPU 上限）
// 固定長度的通道：Workers 用 FixedLengthStream（送出 Content-Length，長度不符時串流出錯 → 送臉書的請求失敗）
//   Node（單元測試）沒有 FixedLengthStream：用計數的 TransformStream 代替，行為相同
function fixedLength(len) {
  if (typeof globalThis.FixedLengthStream === 'function') { const f = new globalThis.FixedLengthStream(len); return { readable: f.readable, writable: f.writable, init: {} }; }
  let n = 0;
  const t = new TransformStream({
    transform(chunk, c) { n += chunk.byteLength; if (n > len) c.error(new Error('分段比宣告的長')); else c.enqueue(chunk); },
    flush(c) { if (n !== len) c.error(new Error('分段比宣告的短')); }
  });
  return { readable: t.readable, writable: t.writable, init: { duplex: 'half' } };
}
// 一個串流分成 n 份（n＝1 直接用原本的）；request.body 的 tee 是內建的
function split(stream, n) {
  const out = [];
  let s = stream;
  for (let i = 0; i < n - 1; i++) { const [a, b] = s.tee(); out.push(a); s = b; }
  out.push(s);
  return out;
}
// 原樣轉送（Reels）：body → 固定長度通道；回 { body, init, done }（done＝寫完或出錯）
function rawBody(src, len) {
  const f = fixedLength(len);
  const done = src.pipeTo(f.writable);
  return { body: f.readable, init: f.init, done };
}
const enc = new TextEncoder();
// 橫式 transfer 的 multipart：開頭（表單欄位＋檔案標頭）→ 影片資料（內建 pipeTo）→ 結尾；長度事先算好
//   寫入和 fetch 同時進行（先寫完才 fetch 會被背壓卡住）
export function multipartBody(fields, src, fileLen) {
  const boundary = '----tbx' + crypto.randomUUID().replace(/-/g, '');
  let head = '';
  for (const [k, v] of Object.entries(fields)) head += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  head += `--${boundary}\r\nContent-Disposition: form-data; name="video_file_chunk"; filename="chunk"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const h = enc.encode(head), t = enc.encode(`\r\n--${boundary}--\r\n`);
  const f = fixedLength(h.length + fileLen + t.length);
  const done = (async () => {
    let w = f.writable.getWriter();
    try { await w.write(h); } finally { w.releaseLock(); }
    await src.pipeTo(f.writable, { preventClose: true });
    w = f.writable.getWriter();
    await w.write(t);
    await w.close();
  })();
  done.catch(() => { f.writable.abort().catch(() => {}); });
  return { body: f.readable, init: f.init, done, type: 'multipart/form-data; boundary=' + boundary };
}
// fetch 與寫入一起等：任一邊失敗就當失敗（fetch 的錯誤優先，才能分辨臉書回的明確錯誤）
async function sendWith(pipe, send) {
  const sent = send();
  const [r1, r2] = await Promise.allSettled([sent, pipe.done]);
  if (r1.status === 'rejected') throw r1.reason;
  if (r2.status === 'rejected') throw new GraphError(-1, '分段沒有完整傳完（' + String((r2.reason && r2.reason.message) || r2.reason).slice(0, 80) + '）', 0, undefined, true);
  return r1.value;
}

// 結果不明（連不上、5xx、錯誤碼 1／2）：這段可能沒送到，讓前端重送
const retryable = (e) => e instanceof GraphError && (e.uncertain || e.status >= 500 || e.code === 1 || e.code === 2);

// 收到一段 [start, start+len)：能串流就串流轉送，回 result；不能串流回 null（本文沒動）
export async function receiveChunkStream(env, request, uploadId, start, len) {
  const list = await rows(env, uploadId);
  if (!list.length) { await request.body.cancel().catch(() => {}); return { error: 'not_found' }; }
  const end = start + len;
  const targets = list.filter((r) => r.state === 'uploading' && r.next_start === start);
  // 橫式粉專要的長度（臉書 end_offset）和這段不同 → 交回現行做法
  if (targets.some((r) => r.kind === 'video' && (r.next_end > start ? r.next_end : end) !== end)) return null;
  if (!targets.length) { await request.body.cancel().catch(() => {}); return result(env, uploadId); }

  const tokens = await pageTokens(env);
  const ready = [];
  for (const r of targets) {
    const t = tokens.get(r.page);
    if (t) ready.push([r, t]);
    else await update(env, r, { state: 'failed', error: '找不到這個粉專（token 沒有管理權限）' });
  }
  if (!ready.length) { await request.body.cancel().catch(() => {}); await finishReady(env, uploadId); return result(env, uploadId); }

  const branches = split(request.body, ready.length);
  let retryMsg = '';
  const one = async ([r, t], branch) => {
    const t0 = Date.now();
    try {
      if (r.kind === 'video') {
        const mp = multipartBody({ access_token: t.token, upload_phase: 'transfer', upload_session_id: r.session_id, start_offset: String(start) }, branch, len);
        const d = await sendWith(mp, () => graphFetch(env, GRAPH_VIDEO + '/' + r.page + '/videos', { method: 'POST', headers: { 'Content-Type': mp.type }, body: mp.body, ...mp.init }, t.token));
        const ns = Number(d.start_offset), ne = Number(d.end_offset);
        if (!Number.isFinite(ns) || !Number.isFinite(ne)) throw new GraphError(-1, '臉書沒有回傳下一段位置', 200);
        if (ns >= r.size || ns === ne) await updateIf(env, r, { state: 'uploaded', next_start: r.size, next_end: r.size }, 'uploading');
        else await updateIf(env, r, { next_start: ns, next_end: ne }, 'uploading');
      } else {
        const p = rawBody(branch, len);
        await sendWith(p, () => ruploadPart(r, t.token, start, p.body, p.init));
        if (end >= r.size) await updateIf(env, r, { state: 'uploaded', next_start: r.size, next_end: r.size }, 'uploading');
        else await updateIf(env, r, { next_start: end, next_end: end }, 'uploading');
      }
      console.log('video stream ok', r.kind, r.page, start, len, Date.now() - t0 + 'ms');
    } catch (e) {
      console.warn('video stream fail', r.kind, r.page, start, len, Date.now() - t0 + 'ms', String((e && e.message) || e).slice(0, 200));
      if (!(e instanceof GraphError)) throw e;
      if (retryable(e)) { retryMsg = retryMsg || errText(e); return; }   // 維持上傳中、位置不動，等前端重送
      await updateIf(env, r, { state: 'failed', error: `${Math.floor(start / 1048576)}MB 處上傳失敗：${errText(e)}` }, 'uploading');
    }
  };
  await Promise.all(ready.map((x, i) => one(x, branches[i])));
  await finishReady(env, uploadId);
  if (retryMsg) return { error: 'fb_retry', message: '這段影片沒有完整傳到臉書（' + retryMsg + '），會自動重送。' };
  return result(env, uploadId);
}
