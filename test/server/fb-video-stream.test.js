// 實驗功能「影片串流上傳」：開關／對象、串流轉送位元組正確、不能串流時交回現行做法、結果不明讓前端重送
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch, gErr, fakeNamespace } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
const ACCOUNTS = { data: [{ id: '111', name: '新聞', access_token: 'PT111' }, { id: '222', name: '少康', access_token: 'PT222' }] };
const UID = 'b'.repeat(32);
class NoTimer { async fetch() { return Response.json({ ok: true }); } }
const REEL = (id) => 'https://rupload.facebook.com/video-upload/v27.0/' + id;

async function setup(t, handlers) {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS, ...handlers }); t.after(f.restore);
  let env;
  env = mkEnv({ FB_USER_TOKEN: 'U', FB_TIMER: fakeNamespace(NoTimer, () => env) });
  const { signToken } = await tok();
  env.SYS_STAFF_ID = 'SYS1';
  const headers = { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'company', nowSec() + 600, false, 'SYS1', 1)) };
  const adm = { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'admin', nowSec() + 600)) };
  return { f, env, headers, adm };
}
async function call(env, headers, path, body) {
  const w = await load();
  const init = { method: body === undefined ? 'GET' : 'POST', headers: { origin: ORIGIN, ...headers } };
  if (body instanceof Uint8Array) { init.body = body; init.headers['content-type'] = 'application/octet-stream'; init.headers['content-length'] ??= String(body.length); }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  const r = await w.fetch(new Request('https://api.test' + path, init), env, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
}
const seq = (n, from = 0) => Uint8Array.from({ length: n }, (_, i) => (from + i) % 120);
const states = (r) => r.body.data.jobs.map((j) => [j.page, j.state]);
const chunk = (env, h, start, b, extra = {}) => call(env, { ...h, ...extra }, `/fb/video/chunk?u=${UID}&start=${start}`, b);
const turnOn = (env, adm, o = { stream: true, who: 'all' }) => call(env, adm, '/admin/fb/video-opts', o);
const bin = (s) => new TextEncoder().encode(s);   // 替身把 octet-stream 本文讀成字串（測試資料都 <128，可還原）
async function fileBytes(f) { return new Uint8Array(await f.arrayBuffer()); }

test('管理頁 video-opts：預設關；只有已解鎖系統管理者；格式檢查；指定員工', async (t) => {
  const { env, headers, adm } = await setup(t, {});
  assert.equal((await call(env, headers, '/admin/fb/video-opts')).status, 403, '未解鎖不能進');
  const g = (await call(env, adm, '/admin/fb/video-opts')).body.data;
  assert.deepEqual([g.stream, g.who, g.staff], [false, 'all', []]);
  assert.ok(Array.isArray(g.people));
  assert.equal((await turnOn(env, adm, { stream: 'yes' })).status, 400);
  assert.equal((await turnOn(env, adm, { stream: true, who: 'some', staff: ['bad id!'] })).status, 400);
  const s = (await turnOn(env, adm, { stream: true, who: 'some', staff: ['sys1', 'a1'] })).body.data;
  assert.deepEqual([s.stream, s.who, s.staff], [true, 'some', ['SYS1', 'A1']]);
  // 留言實驗的設定不受影響
  assert.equal((await call(env, adm, '/admin/fb/comment-opts')).body.data.edit, false);
});

test('Reels 單一粉專：串流轉送位元組完全相同；結果不明不在後端重試、回 fb_retry（503）讓前端重送', async (t) => {
  const got = [];
  let fail = true;
  const { f, env, headers, adm } = await setup(t, {
    'POST /111/video_reels': (c) => c.body.upload_phase === 'start' ? { video_id: 'R1', upload_url: REEL('R1') } : { success: true },
    [`POST ${REEL('R1')}`]: (c) => { got.push([c.headers.offset, bin(c.body)]); if (fail) { fail = false; return gErr(2, 503); } return { success: true }; }
  });
  await turnOn(env, adm);
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'Reels_x.mp4', size: 300, kind: 'reel', pages: ['111'] });
  const data = seq(300);
  let r = await chunk(env, headers, 0, data);
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'fb_retry');
  assert.equal(got.length, 1, '串流版後端不重送');
  r = await chunk(env, headers, 0, data);   // 前端重送
  assert.deepEqual(states(r), [['111', 'uploaded']]);
  assert.equal(got.length, 2);
  assert.deepEqual(got[1], ['0', data]);
  assert.ok(f.calls.some((c) => c.path === REEL('R1')));
});

test('現行做法（開關關閉／不在名單）：後端照舊自己重試一次', async (t) => {
  let n = 0;
  const { env, headers, adm } = await setup(t, {
    'POST /111/video_reels': (c) => c.body.upload_phase === 'start' ? { video_id: 'R1', upload_url: REEL('R1') } : { success: true },
    [`POST ${REEL('R1')}`]: () => (++n === 1 ? gErr(2, 503) : { success: true })
  });
  await turnOn(env, adm, { stream: true, who: 'some', staff: ['OTHER'] });   // 開了但只給別人
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'Reels_x.mp4', size: 5, kind: 'reel', pages: ['111'] });
  const r = await chunk(env, headers, 0, seq(5));
  assert.deepEqual(states(r), [['111', 'uploaded']]);
  assert.equal(n, 2, '現行做法：後端多試一次');
});

test('橫式兩個粉專：tee 分流，兩邊收到完全相同的 multipart 分段；最後 finish', async (t) => {
  const recv = { 111: [], 222: [] };
  const transfer = (page) => async (c) => {
    recv[page].push([Number(c.body.start_offset), await fileBytes(c.body.video_file_chunk), c.body.access_token, c.body.upload_session_id]);
    const s = Number(c.body.start_offset) + 64;
    return s >= 128 ? { start_offset: '128', end_offset: '128' } : { start_offset: String(s), end_offset: String(s + 64) };
  };
  const vh = (page) => (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S' + page, video_id: 'V' + page, start_offset: '0', end_offset: '64' } : c.body.upload_phase === 'transfer' ? transfer(page)(c) : { success: true };
  const { env, headers, adm } = await setup(t, { 'POST video:/111/videos': vh('111'), 'POST video:/222/videos': vh('222') });
  await turnOn(env, adm, { stream: true, who: 'some', staff: ['SYS1'] });
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'a.mp4', size: 128, kind: 'video', pages: ['111', '222'] });
  let r = await chunk(env, headers, 0, seq(64));
  assert.deepEqual(r.body.data.next, { start: 64, end: 128 });
  r = await call(env, headers, '/fb/video/publish', { uploadId: UID, title: 't', description: 'd', pages: [{ page: '111', at: null }, { page: '222', at: null }] });
  r = await chunk(env, headers, 64, seq(64, 64));
  assert.deepEqual(states(r), [['111', 'processing'], ['222', 'processing']]);
  for (const p of ['111', '222']) {
    assert.deepEqual(recv[p].map((x) => x[0]), [0, 64]);
    assert.deepEqual(recv[p][0][1], seq(64));
    assert.deepEqual(recv[p][1][1], seq(64, 64));
    assert.deepEqual([recv[p][0][2], recv[p][0][3]], ['PT' + p, 'S' + p]);
  }
});

test('粉專要的長度和這段不同 → 交回現行做法（結果正確）', async (t) => {
  const recv = { 111: [], 222: [] };
  const { env, headers, adm } = await setup(t, {
    'POST video:/111/videos': async (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S1', video_id: 'V1', start_offset: '0', end_offset: '6' } : c.body.upload_phase === 'transfer' ? (recv[111].push(await fileBytes(c.body.video_file_chunk)), { start_offset: '6', end_offset: '6' }) : { success: true },
    'POST video:/222/videos': async (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S2', video_id: 'V2', start_offset: '0', end_offset: '3' } : c.body.upload_phase === 'transfer' ? (recv[222].push([Number(c.body.start_offset), await fileBytes(c.body.video_file_chunk)]), Number(c.body.start_offset) === 0 ? { start_offset: '3', end_offset: '6' } : { start_offset: '6', end_offset: '6' }) : { success: true }
  });
  await turnOn(env, adm);
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'a.mp4', size: 6, kind: 'video', pages: ['111', '222'] });
  let r = await chunk(env, headers, 0, seq(6));
  assert.deepEqual(recv[111], [seq(6)]);
  assert.deepEqual(recv[222], [[0, seq(3)]]);
  assert.deepEqual(r.body.data.next, { start: 3, end: 6 });
  r = await chunk(env, headers, 3, seq(3, 3));
  assert.deepEqual(recv[222][1], [3, seq(3, 3)]);
  assert.deepEqual(states(r), [['111', 'uploaded'], ['222', 'uploaded']]);
});

test('串流：明確錯誤只讓那個粉專失敗；宣告長度和實際不符 → 不送出不完整內容、讓前端重送', async (t) => {
  const { env, headers, adm } = await setup(t, {
    'POST /111/video_reels': (c) => c.body.upload_phase === 'start' ? { video_id: 'R1', upload_url: REEL('R1') } : { success: true },
    'POST /222/video_reels': (c) => c.body.upload_phase === 'start' ? { video_id: 'R2', upload_url: REEL('R2') } : { success: true },
    [`POST ${REEL('R1')}`]: () => ({ success: true }),
    [`POST ${REEL('R2')}`]: () => gErr(100, 400, 'bad')
  });
  await turnOn(env, adm);
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'Reels_x.mp4', size: 10, kind: 'reel', pages: ['111', '222'] });
  let r = await chunk(env, headers, 0, seq(10), { 'content-length': '12' });
  assert.equal(r.status, 503, '長度不符：臉書不會收到完整請求');
  r = await chunk(env, headers, 0, seq(10));
  assert.deepEqual(states(r), [['111', 'uploaded'], ['222', 'failed']]);
  assert.match(r.body.data.jobs.find((j) => j.page === '222').error, /^0MB 處上傳失敗/);
});

test('Workers 路徑：用內建 FixedLengthStream（Reels＝分段長度、橫式＝表單總長），資料原樣送到臉書', async (t) => {
  const made = [];
  globalThis.FixedLengthStream = class {
    constructor(n) {
      made.push(n);
      let c = 0;
      const ts = new TransformStream({ transform(ch, ctl) { c += ch.byteLength; if (c > n) ctl.error(new Error('長')); else ctl.enqueue(ch); }, flush(ctl) { if (c !== n) ctl.error(new Error('短')); } });
      this.readable = ts.readable; this.writable = ts.writable;
    }
  };
  t.after(() => { delete globalThis.FixedLengthStream; });
  const recv = [];
  const { env, headers, adm } = await setup(t, {
    'POST /111/video_reels': (c) => c.body.upload_phase === 'start' ? { video_id: 'R1', upload_url: REEL('R1') } : { success: true },
    [`POST ${REEL('R1')}`]: (c) => { recv.push(['reel', bin(c.body)]); return { success: true }; },
    'POST video:/222/videos': async (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S2', video_id: 'V2', start_offset: '0', end_offset: '40' }
      : c.body.upload_phase === 'transfer' ? (recv.push(['video', await fileBytes(c.body.video_file_chunk)]), { start_offset: '40', end_offset: '40' }) : { success: true }
  });
  const nodeFetch = globalThis.fetch;   // Node 的 fetch 送串流要 duplex；Workers 不用
  globalThis.fetch = (input, init = {}) => nodeFetch(input, init.body instanceof ReadableStream ? { ...init, duplex: 'half' } : init);
  t.after(() => { globalThis.fetch = nodeFetch; });
  await turnOn(env, adm);
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'Reels_x.mp4', size: 30, kind: 'reel', pages: ['111'] });
  let r = await chunk(env, headers, 0, seq(30));
  assert.deepEqual(states(r), [['111', 'uploaded']]);
  assert.deepEqual(made, [30]);
  const U2 = 'c'.repeat(32);
  await call(env, headers, '/fb/video/start', { uploadId: U2, name: 'a.mp4', size: 40, kind: 'video', pages: ['222'] });
  r = await call(env, headers, `/fb/video/chunk?u=${U2}&start=0`, seq(40, 5));
  assert.deepEqual(r.body.data.jobs.map((j) => [j.page, j.state]), [['222', 'uploaded']]);
  assert.equal(made.length, 2);
  assert.ok(made[1] > 40, '橫式：表單開頭＋40＋結尾');
  assert.deepEqual(recv, [['reel', seq(30)], ['video', seq(40, 5)]]);
});

test('臉書沒讀完本文就先回錯誤：不會卡住，明確錯誤標失敗、5xx 讓前端重送', async (t) => {
  const { env, headers, adm } = await setup(t, {
    'POST /111/video_reels': (c) => c.body.upload_phase === 'start' ? { video_id: 'R1', upload_url: REEL('R1') } : { success: true },
    'POST video:/222/videos': () => ({ upload_session_id: 'S2', video_id: 'V2', start_offset: '0', end_offset: '300' })
  });
  const inner = globalThis.fetch;   // 替身會讀本文；這裡模擬臉書「不讀本文直接回」
  let code = 100, status = 400;
  globalThis.fetch = (input, init = {}) => {
    const u = String(input && input.url ? input.url : input);
    if (init.body instanceof ReadableStream && (u.startsWith(REEL('R1')) || u.includes('/222/videos')))
      return Promise.resolve(Response.json({ error: { code, message: 'early' } }, { status }));
    return inner(input, init);
  };
  t.after(() => { globalThis.fetch = inner; });
  await turnOn(env, adm);
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'Reels_x.mp4', size: 300, kind: 'reel', pages: ['111'] });
  const U2 = 'c'.repeat(32);
  await call(env, headers, '/fb/video/start', { uploadId: U2, name: 'a.mp4', size: 300, kind: 'video', pages: ['222'] });
  const within = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('卡住了')), 3000))]);
  code = 2; status = 503;
  let r = await within(chunk(env, headers, 0, seq(300)));
  assert.equal(r.body.code, 'fb_retry');
  r = await within(call(env, headers, `/fb/video/chunk?u=${U2}&start=0`, seq(300)));
  assert.equal(r.body.code, 'fb_retry');
  code = 100; status = 400;
  r = await within(chunk(env, headers, 0, seq(300)));
  assert.deepEqual(states(r), [['111', 'failed']]);
  r = await within(call(env, headers, `/fb/video/chunk?u=${U2}&start=0`, seq(300)));
  assert.deepEqual(r.body.data.jobs.map((j) => [j.page, j.state]), [['222', 'failed']]);
});
