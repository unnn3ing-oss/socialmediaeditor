const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch, gErr, fakeNamespace } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod, videoMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
const vm = async () => (videoMod = videoMod || (await import('../../server/fb/video.js')));

const ACCOUNTS = { data: [{ id: '111', name: '新聞', access_token: 'PT111' }, { id: '222', name: '少康', access_token: 'PT222' }] };
const UID = 'a'.repeat(32);

class RecTimer { constructor(state) { this.state = state; } async fetch(req) { const u = new URL(req.url); const b = await req.json().catch(() => ({})); RecTimer.log.push([u.pathname, b]); return Response.json(u.pathname === '/status' && RecTimer.status ? RecTimer.status : { ok: true }); } }
RecTimer.log = [];

async function setup(t, handlers) {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS, ...handlers }); t.after(f.restore);
  let env;
  env = mkEnv({ FB_USER_TOKEN: 'U', FB_TIMER: fakeNamespace(RecTimer, () => env) });
  RecTimer.log = []; RecTimer.status = null;
  const { signToken } = await tok();
  env.SYS_STAFF_ID = 'SYS1';
  const headers = { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'company', nowSec() + 600, false, 'SYS1', 1)) };
  return { f, env, headers };
}
async function call(env, headers, path, body, raw) {
  const w = await load();
  const init = { method: body === undefined && !raw ? 'GET' : 'POST', headers: { origin: ORIGIN, ...headers } };
  if (raw) { init.body = raw; init.headers['content-type'] = 'application/octet-stream'; }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  const r = await w.fetch(new Request('https://api.test' + path, init), env, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
}
const bytes = (n, v = 7) => new Uint8Array(n).fill(v);
const states = (r) => r.body.data.jobs.map((j) => [j.page, j.state]);

test('nextRange：取最小 start；同 start 取最大 end；上限 32MB 與檔案大小', async () => {
  const { nextRange, MAX_CHUNK, REEL_CHUNK } = await vm();
  assert.equal(nextRange([], 10), null);
  assert.deepEqual(nextRange([{ state: 'uploading', kind: 'video', next_start: 0, next_end: 100 }, { state: 'uploading', kind: 'video', next_start: 0, next_end: 50 }], 1000), { start: 0, end: 100 });
  assert.deepEqual(nextRange([{ state: 'uploading', kind: 'video', next_start: 100, next_end: 200 }, { state: 'uploading', kind: 'video', next_start: 0, next_end: 50 }], 1000), { start: 0, end: 50 });
  assert.deepEqual(nextRange([{ state: 'uploaded', kind: 'video', next_start: 0, next_end: 0 }], 10), null);
  assert.deepEqual(nextRange([{ state: 'uploading', kind: 'reel', next_start: 0, next_end: 0 }], 100), { start: 0, end: 100 });
  assert.deepEqual(nextRange([{ state: 'uploading', kind: 'reel', next_start: 0, next_end: 0 }], 10 * REEL_CHUNK), { start: 0, end: REEL_CHUNK });
  assert.deepEqual(nextRange([{ state: 'uploading', kind: 'video', next_start: 0, next_end: 99 * 1024 * 1024 }], 200 * 1024 * 1024), { start: 0, end: MAX_CHUNK });
});

test('橫式兩個粉專：一次上傳、後端轉給兩個粉專 → 先送出 → 最後一段傳完自動 finish＋排留言', async (t) => {
  const offs = { 111: [], 222: [] };
  const transfer = (page) => (c) => {
    offs[page].push(Number(c.body.start_offset));
    assert.equal(c.body.upload_session_id, 'S' + page);
    const s = Number(c.body.start_offset) + 4;
    return s >= 8 ? { start_offset: '8', end_offset: '8' } : { start_offset: String(s), end_offset: String(s + 4) };
  };
  const { f, env, headers } = await setup(t, {
    'POST video:/111/videos': (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S111', video_id: 'V111', start_offset: '0', end_offset: '4' } : c.body.upload_phase === 'transfer' ? transfer('111')(c) : { success: true },
    'POST video:/222/videos': (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S222', video_id: 'V222', start_offset: '0', end_offset: '4' } : c.body.upload_phase === 'transfer' ? transfer('222')(c) : { success: true }
  });
  let r = await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'Reels_標題.mp4', size: 8, kind: 'video', pages: ['111', '222'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.data.next, { start: 0, end: 4 });
  const st = f.calls.find((c) => c.path === 'video:/111/videos');
  assert.equal(st.body.file_size, '8');
  assert.equal(st.body.access_token, 'PT111');
  r = await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=0', undefined, bytes(4));
  assert.deepEqual(r.body.data.next, { start: 4, end: 8 });
  // 中途就按送出：存文案，還不 finish
  r = await call(env, headers, '/fb/video/publish', { uploadId: UID, title: '標題', description: '\n【標題】\n#tag', pages: [{ page: '111', at: null }, { page: '222', at: nowSec() + 7200 }], comments: [{ message: '第一則', delay: 0 }, { message: '第二則', delay: 5 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!f.calls.some((c) => c.body && c.body.upload_phase === 'finish'));
  assert.deepEqual(states(r), [['111', 'uploading'], ['222', 'uploading']]);
  r = await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=4', undefined, bytes(4));
  assert.deepEqual(offs, { 111: [0, 4], 222: [0, 4] });
  assert.equal(r.body.data.next, null);
  assert.deepEqual(states(r), [['111', 'processing'], ['222', 'scheduled']], '每個粉專各自時間：新聞立即、娛樂排程');
  const fin = f.calls.filter((c) => c.body && c.body.upload_phase === 'finish');
  assert.equal(fin.length, 2);
  assert.deepEqual([fin[0].body.title, fin[0].body.description, fin[0].body.published], ['標題', '\n【標題】\n#tag', undefined]);
  assert.deepEqual([fin[1].body.published, fin[1].body.unpublished_content_type], ['false', 'SCHEDULED']);
  // 留言交給計時器（影片物件）
  const arms = RecTimer.log.filter((x) => x[0] === '/arm').map((x) => x[1]);
  assert.deepEqual(arms.map((a) => [a.pageId, a.postId, a.kind, a.items.map((i) => i.offset)]), [['111', 'V111', 'video', [0, 5]], ['222', 'V222', 'video', [0, 5]]]);
  // 再送一次不會重複 finish
  await call(env, headers, '/fb/video/publish', { uploadId: UID, title: '標題', description: 'x', pages: [{ page: '111', at: null }, { page: '222', at: null }] });
  assert.equal(f.calls.filter((c) => c.body && c.body.upload_phase === 'finish').length, 2);
  // 狀態：查臉書，好了就是 published
  f.calls.length = 0;
  t.after(() => {});
  const g = installFetch({ 'GET /me/accounts': () => ACCOUNTS, 'GET /V111': () => ({ status: { video_status: 'ready', publishing_phase: { status: 'complete', publish_status: 'published' } } }), 'GET /V222': () => ({ status: { video_status: 'processing', processing_phase: { status: 'in_progress' } } }) });
  t.after(g.restore);
  r = await call(env, headers, '/fb/video/status?u=' + UID);
  assert.deepEqual(states(r), [['111', 'published'], ['222', 'scheduled']]);
  // 列表
  r = await call(env, headers, '/fb/video/jobs');
  assert.deepEqual(r.body.data.map((j) => [j.page, j.title, j.kind]), [['111', '標題', 'video'], ['222', '標題', 'video']]);
  assert.ok(!JSON.stringify(r.body).includes('S111'), '不回傳工作階段');
});

test('offset 不同的粉專：落後的之後自己追上', async (t) => {
  const { env, headers } = await setup(t, {
    'POST video:/111/videos': (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S1', video_id: 'V1', start_offset: '0', end_offset: '6' } : c.body.upload_phase === 'transfer' ? { start_offset: '6', end_offset: '6' } : { success: true },
    'POST video:/222/videos': (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S2', video_id: 'V2', start_offset: '0', end_offset: '3' } : c.body.upload_phase === 'transfer' ? (Number(c.body.start_offset) === 0 ? { start_offset: '3', end_offset: '6' } : { start_offset: '6', end_offset: '6' }) : { success: true }
  });
  let r = await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'a.mp4', size: 6, kind: 'video', pages: ['111', '222'] });
  assert.deepEqual(r.body.data.next, { start: 0, end: 6 });
  r = await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=0', undefined, bytes(6));
  assert.deepEqual(states(r), [['111', 'uploaded'], ['222', 'uploading']]);
  assert.deepEqual(r.body.data.next, { start: 3, end: 6 });
  r = await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=3', undefined, bytes(3));
  assert.deepEqual(states(r), [['111', 'uploaded'], ['222', 'uploaded']]);
});

test('Reels：start → rupload（offset、file_size、OAuth）→ 排程 finish SCHEDULED', async (t) => {
  const at = nowSec() + 3600;
  const { f, env, headers } = await setup(t, {
    'POST /111/video_reels': (c) => c.body.upload_phase === 'start' ? { video_id: 'R1', upload_url: 'https://rupload.facebook.com/video-upload/v27.0/R1' } : { success: true },
    'POST https://rupload.facebook.com/video-upload/v27.0/R1': () => ({ success: true })
  });
  let r = await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'Reels_x.mp4', size: 5, kind: 'reel', pages: ['111'] });
  assert.deepEqual(r.body.data.next, { start: 0, end: 5 });
  r = await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=0', undefined, bytes(5));
  const up = f.calls.find((c) => c.path.startsWith('https://rupload'));
  assert.deepEqual([up.headers.authorization, up.headers.offset, up.headers.file_size], ['OAuth PT111', '0', '5']);
  assert.deepEqual(states(r), [['111', 'uploaded']]);
  // 時間太遠（Reels 29 天內）
  r = await call(env, headers, '/fb/video/publish', { uploadId: UID, title: 'x', description: 'y', pages: [{ page: '111', at: nowSec() + 40 * 86400 }] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /29 天/);
  r = await call(env, headers, '/fb/video/publish', { uploadId: UID, title: 'x', description: 'y', pages: [{ page: '111', at }] });
  assert.deepEqual(states(r), [['111', 'scheduled']]);
  const fin = f.calls.find((c) => c.path === '/111/video_reels' && c.body.upload_phase === 'finish');
  assert.deepEqual([fin.body.video_id, fin.body.video_state, fin.body.scheduled_publish_time], ['R1', 'SCHEDULED', String(at)]);
});

test('finish 結果不明 → 待確認，不重送；其他粉專照常', async (t) => {
  const { f, env, headers } = await setup(t, {
    'POST video:/111/videos': (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S1', video_id: 'V1', start_offset: '0', end_offset: '2' } : c.body.upload_phase === 'transfer' ? { start_offset: '2', end_offset: '2' } : gErr(2, 500),
    'POST video:/222/videos': (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S2', video_id: 'V2', start_offset: '0', end_offset: '2' } : c.body.upload_phase === 'transfer' ? { start_offset: '2', end_offset: '2' } : { success: true }
  });
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'a.mp4', size: 2, kind: 'video', pages: ['111', '222'] });
  await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=0', undefined, bytes(2));
  let r = await call(env, headers, '/fb/video/publish', { uploadId: UID, title: 't', description: 'd', pages: [{ page: '111', at: null }, { page: '222', at: null }] });
  assert.deepEqual(states(r), [['111', 'unknown'], ['222', 'processing']]);
  r = await call(env, headers, '/fb/video/publish', { uploadId: UID, title: 't', description: 'd', pages: [{ page: '111', at: null }, { page: '222', at: null }] });
  assert.equal(f.calls.filter((c) => c.path === 'video:/111/videos' && c.body.upload_phase === 'finish').length, 1);
});

test('上傳失敗只影響那個粉專；停止上傳送 cancel；drop 只取消單一粉專', async (t) => {
  const { f, env, headers } = await setup(t, {
    'POST video:/111/videos': (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S1', video_id: 'V1', start_offset: '0', end_offset: '2' } : c.body.upload_phase === 'transfer' ? gErr(100) : { success: true },
    'POST video:/222/videos': (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S2', video_id: 'V2', start_offset: '0', end_offset: '2' } : c.body.upload_phase === 'transfer' ? { start_offset: '2', end_offset: '4' } : { success: true }
  });
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'a.mp4', size: 4, kind: 'video', pages: ['111', '222'] });
  let r = await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=0', undefined, bytes(2));
  assert.deepEqual(states(r), [['111', 'failed'], ['222', 'uploading']]);
  r = await call(env, headers, '/fb/video/stop', { uploadId: UID });
  assert.deepEqual(states(r), [['111', 'failed'], ['222', 'stopped']]);
  assert.ok(f.calls.some((c) => c.path === 'video:/222/videos' && c.body.upload_phase === 'cancel' && c.body.upload_session_id === 'S2'));
  // 停止後可重新開始（同一個 uploadId 重開工作階段）
  r = await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'a.mp4', size: 4, kind: 'video', pages: ['222'] });
  assert.deepEqual(states(r), [['111', 'failed'], ['222', 'uploading']]);
  r = await call(env, headers, '/fb/video/drop', { uploadId: UID, page: '222' });
  assert.deepEqual(states(r), [['111', 'failed'], ['222', 'canceled']]);
});

test('驗證：start／publish 表單', async () => {
  const { parseStart, parsePublish, timeOkFor } = await vm();
  const ok = { uploadId: UID, name: 'a.mp4', size: 10, kind: 'video', pages: ['111'] };
  assert.ok(parseStart(ok));
  assert.equal(parseStart({ ...ok, uploadId: 'x' }), null);
  assert.equal(parseStart({ ...ok, kind: 'photo' }), null);
  assert.equal(parseStart({ ...ok, size: 0 }), null);
  assert.equal(parseStart({ ...ok, pages: ['111', '111'] }), null);
  const p = { uploadId: UID, title: 't', description: 'd', pages: [{ page: '111', at: null }, { page: '222', at: null }] };
  assert.ok(parsePublish(p));
  assert.equal(parsePublish({ ...p, title: '' }), null);
  assert.equal(parsePublish({ ...p, pages: [] }), null);
  assert.equal(parsePublish({ ...p, pages: undefined }), null);
  assert.equal(parsePublish({ ...p, pages: [{ page: '111', at: null }, { page: '111', at: null }] }), null);
  assert.equal(parsePublish({ ...p, pages: [{ page: '111', at: 1.5 }] }), null);
  assert.equal(parsePublish({ ...p, title: 'a\nb' }), null);
  assert.equal(parsePublish({ ...p, description: '  ' }), null);
  assert.deepEqual(parsePublish({ ...p, comments: [{ message: 'a', delay: 3 }, { message: 'b', delay: 10 }] }).comments.map((c) => c.offset), [3, 13]);
  assert.equal(parsePublish({ ...p, comments: [{ message: 'a', delay: 0 }, { message: 'b', delay: 3 }] }), null);
  assert.equal(parsePublish({ ...p, comments: [{ message: 'a', delay: 1441 }] }), null);
  assert.equal(parsePublish({ ...p, comments: [1, 2, 3, 4].map(() => ({ message: 'a', delay: 5 })) }), null);
  // 警語：插在第 1 則之後、同一時間，不佔 3 則名額；沒有留言＝發布後就留
  assert.deepEqual(parsePublish({ ...p, warn: ' W ', comments: [{ message: 'a', delay: 3 }, { message: 'b', delay: 5 }, { message: 'c', delay: 5 }] }).comments.map((c) => [c.message, c.offset]), [['a', 3], ['W', 3], ['b', 8], ['c', 13]]);
  assert.deepEqual(parsePublish({ ...p, warn: 'W' }).comments, [{ message: 'W', offset: 0 }]);
  assert.deepEqual(parsePublish({ ...p, warn: '' }).comments, []);
  assert.equal(parsePublish({ ...p, warn: 'x'.repeat(2001) }), null);
  const now = nowSec();
  assert.ok(timeOkFor('video', now + 100 * 86400, now));
  assert.ok(!timeOkFor('reel', now + 100 * 86400, now));
  assert.ok(!timeOkFor('video', now + 60, now));
});

test('stateFromStatus', async () => {
  const { stateFromStatus } = await vm();
  assert.equal(stateFromStatus(null), null);
  assert.deepEqual(stateFromStatus({ video_status: 'ready', publishing_phase: { status: 'complete', publish_status: 'published' } }), { state: 'published' });
  assert.equal(stateFromStatus({ video_status: 'processing', processing_phase: { status: 'in_progress' } }), null);
  assert.equal(stateFromStatus({ video_status: 'error', processing_phase: { status: 'error', error: { message: '格式錯' } } }).error, '臉書處理影片失敗：格式錯');
});

test('影片設定：管理頁存讀、驗證；工具讀得到', async (t) => {
  const { env, headers } = await setup(t, {});
  const { signToken } = await tok();
  const adm = { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'admin', nowSec() + 600)) };
  let r = await call(env, adm, '/admin/fb/video-settings');
  assert.deepEqual(r.body.data, { prefixes: [], suffixes: [], reelsTag: '#焦點新聞影音都在TVBS', tags: [] });
  r = await call(env, adm, '/admin/fb/video-settings', { prefixes: [' 1118_ ', '1118_', ''], suffixes: ['_v2'], reelsTag: '#新', tags: ['#國際', '#TVBS新聞'] });
  assert.deepEqual(r.body.data, { prefixes: ['1118_'], suffixes: ['_v2'], reelsTag: '#新', tags: ['#國際', '#TVBS新聞'] });
  assert.deepEqual((await call(env, headers, '/fb/video/settings')).body.data.tags, ['#國際', '#TVBS新聞']);
  assert.equal((await call(env, adm, '/admin/fb/video-settings', { tags: ['a\nb'] })).status, 400);
  assert.equal((await call(env, adm, '/admin/fb/video-settings', { prefixes: ['x'.repeat(31)] })).status, 400);
});

test('RD：style 只收 video', async () => {
  const { rundownBody } = await import('../../server/fb/rundown.js');
  const e = { page: 'news', date: '2026-11-18', time: '12:00', text: '純影/SLUG' };
  assert.deepEqual(rundownBody({ entries: [{ ...e, style: 'video' }] }).entries[0].style, 'video');
  assert.equal(rundownBody({ entries: [{ ...e }] }).entries[0].style, undefined);
  assert.equal(rundownBody({ entries: [{ ...e, style: 'red' }] }), null);
});

test('臉書要的分段超過 32MB：該粉專失敗，不讓前端無限重傳', async (t) => {
  const { env, headers } = await setup(t, {
    'POST video:/111/videos': () => ({ upload_session_id: 'S1', video_id: 'V1', start_offset: '0', end_offset: String(99 * 1024 * 1024) })
  });
  const size = 200 * 1024 * 1024;
  let r = await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'a.mp4', size, kind: 'video', pages: ['111'] });
  const { MAX_CHUNK } = await vm();
  assert.deepEqual(r.body.data.next, { start: 0, end: MAX_CHUNK });
  r = await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=0', undefined, bytes(MAX_CHUNK));
  assert.deepEqual(states(r), [['111', 'failed']]);
  assert.equal(r.body.data.next, null);
});

test('慢回來的最後一段不會蓋掉「停止」：停止後不 finish', async (t) => {
  let stopFn;
  const { f, env, headers } = await setup(t, {
    'POST video:/111/videos': async (c) => {
      if (c.body.upload_phase === 'start') return { upload_session_id: 'S1', video_id: 'V1', start_offset: '0', end_offset: '4' };
      if (c.body.upload_phase === 'transfer') { await stopFn(); return { start_offset: '4', end_offset: '4' }; }
      return { success: true };
    }
  });
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'a.mp4', size: 4, kind: 'video', pages: ['111'] });
  await call(env, headers, '/fb/video/publish', { uploadId: UID, title: 't', description: 'd', pages: [{ page: '111', at: null }, { page: '222', at: null }], comments: [] });
  stopFn = async () => { await call(env, headers, '/fb/video/stop', { uploadId: UID }); };
  const r = await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=0', undefined, bytes(4));
  assert.deepEqual(states(r), [['111', 'stopped']]);
  assert.ok(!f.calls.some((c) => c.body && c.body.upload_phase === 'finish'));
});

test('封面：存 KV → 發布成功後換到各粉專影片（is_preferred）；失敗不影響發布、查狀態再試；格式檢查', async (t) => {
  let fail222 = 1;
  const { f, env, headers } = await setup(t, {
    'POST video:/111/videos': (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S1', video_id: 'V1', start_offset: '0', end_offset: '2' } : c.body.upload_phase === 'transfer' ? { start_offset: '2', end_offset: '2' } : { success: true },
    'POST video:/222/videos': (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S2', video_id: 'V2', start_offset: '0', end_offset: '2' } : c.body.upload_phase === 'transfer' ? { start_offset: '2', end_offset: '2' } : { success: true },
    'POST /V1/thumbnails': () => ({ success: true }),
    'POST /V2/thumbnails': () => (fail222-- > 0 ? gErr(100) : { success: true }),
    'GET /V1': () => ({ status: { video_status: 'processing' } }),
    'GET /V2': () => ({ status: { video_status: 'processing' } })
  });
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'a.mp4', size: 2, kind: 'video', pages: ['111', '222'] });
  assert.equal((await call(env, headers, '/fb/video/cover?u=' + UID, undefined, new Uint8Array([1, 2, 3, 4, 5]))).status, 400, '不是圖片');
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  let r = await call(env, headers, '/fb/video/cover?u=' + UID, undefined, jpg);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.data.jobs.map((j) => j.cover), ['pending', 'pending']);
  await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=0', undefined, bytes(2));
  r = await call(env, headers, '/fb/video/publish', { uploadId: UID, title: 't', description: 'd', pages: [{ page: '111', at: null }, { page: '222', at: null }] });
  assert.deepEqual(r.body.data.jobs.map((j) => [j.state, j.cover]), [['processing', 'done'], ['processing', 'pending']], '失敗不影響發布');
  const th = f.calls.find((c) => c.path === '/V1/thumbnails');
  assert.deepEqual([th.body.is_preferred, th.body.access_token, th.body.source && th.body.source.size], ['true', 'PT111', jpg.length]);
  r = await call(env, headers, '/fb/video/status?u=' + UID);
  assert.deepEqual(r.body.data.jobs.map((j) => j.cover), ['done', 'pending'], '60 秒內不重試');
  env.DB.raw.prepare('UPDATE fb_video_jobs SET cover_at = cover_at - 61000').run();
  r = await call(env, headers, '/fb/video/status?u=' + UID);
  assert.deepEqual(r.body.data.jobs.map((j) => j.cover), ['done', 'done'], '超過 60 秒查狀態時再試成功');
});

test('RD：slot 草稿／多文（多文只收橫式；slot 一定要 style video 與 kind）', async () => {
  const { rundownBody } = await import('../../server/fb/rundown.js');
  const e = { page: 'news', date: '2026-11-19', time: '12:00', text: '純影/SLUG', style: 'video' };
  assert.deepEqual(rundownBody({ entries: [{ ...e, slot: 'draft', kind: 'reel' }] }).entries[0], { ...e, slot: 'draft', kind: 'reel' });
  assert.equal(rundownBody({ entries: [{ ...e, slot: 'cross', kind: 'video' }] }).entries[0].slot, 'cross');
  assert.equal(rundownBody({ entries: [{ ...e, slot: 'cross', kind: 'reel' }] }), null);
  assert.equal(rundownBody({ entries: [{ ...e, slot: 'x', kind: 'video' }] }), null);
  assert.equal(rundownBody({ entries: [{ ...e, slot: 'draft' }] }), null);
  assert.equal(rundownBody({ entries: [{ ...e, style: undefined, slot: 'draft', kind: 'video' }] }), null);
  assert.equal(rundownBody({ entries: [{ ...e, kind: 'video' }] }), null, '沒有 slot 不收 kind');
});

test('驗證：草稿／多文表單', async () => {
  const { parsePublish } = await vm();
  const p = { uploadId: UID, title: 't', description: 'd' };
  assert.deepEqual(parsePublish({ ...p, pages: [{ page: '111', at: null, draft: true }] }).pages, [{ page: '111', at: null, draft: true, cross: [] }]);
  assert.equal(parsePublish({ ...p, pages: [{ page: '111', at: nowSec() + 3600, draft: true }] }), null, '草稿不能有時間');
  assert.equal(parsePublish({ ...p, pages: [{ page: '111', at: null, draft: 'yes' }] }), null);
  assert.deepEqual(parsePublish({ ...p, pages: [{ page: '111', at: null, cross: ['222', '333'] }] }).pages[0].cross, ['222', '333']);
  for (const pages of [
    [{ page: '111', at: null, cross: [] }],
    [{ page: '111', at: null, cross: ['111'] }],
    [{ page: '111', at: null, cross: ['222', '222'] }],
    [{ page: '111', at: nowSec() + 3600, cross: ['222'] }],
    [{ page: '111', at: null, draft: true, cross: ['222'] }],
    [{ page: '111', at: null, cross: ['222'] }, { page: '222', at: null }],
    [{ page: '111', at: null, cross: ['333'] }, { page: '222', at: null, cross: ['333'] }],
    [{ page: '111', at: null, cross: ['x'] }],
    [{ page: '111', at: null, cross: Array.from({ length: 11 }, (_, i) => String(500 + i)) }]
  ]) assert.equal(parsePublish({ ...p, pages }), null, JSON.stringify(pages));
});

test('草稿：橫式 DRAFT、Reels video_state DRAFT；不排留言；多文交給計時器；Reels 不能多文', async (t) => {
  const { f, env, headers } = await setup(t, {
    'POST video:/111/videos': (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S111', video_id: 'V111', start_offset: '0', end_offset: '4' } : c.body.upload_phase === 'transfer' ? { start_offset: '4', end_offset: '4' } : { success: true },
    'POST video:/222/videos': (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S222', video_id: 'V222', start_offset: '0', end_offset: '4' } : c.body.upload_phase === 'transfer' ? { start_offset: '4', end_offset: '4' } : { success: true }
  });
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'a.mp4', size: 4, kind: 'video', pages: ['111', '222'] });
  await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=0', undefined, bytes(4));
  const r = await call(env, headers, '/fb/video/publish', { uploadId: UID, title: '標題', description: 'd', comments: [{ message: '留言', delay: 0 }], pages: [{ page: '111', at: null, draft: true }, { page: '222', at: null, cross: ['333'] }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(states(r), [['111', 'draft'], ['222', 'processing']]);
  const fin = f.calls.filter((c) => c.body && c.body.upload_phase === 'finish');
  const f111 = fin.find((c) => c.path === 'video:/111/videos').body, f222 = fin.find((c) => c.path === 'video:/222/videos').body;
  assert.deepEqual([f111.published, f111.unpublished_content_type, f111.scheduled_publish_time], ['false', 'DRAFT', undefined]);
  assert.deepEqual([f222.published, f222.unpublished_content_type], [undefined, undefined]);
  const arms = RecTimer.log.filter((x) => x[0] === '/arm').map((x) => x[1]);
  assert.deepEqual(arms.map((a) => [a.pageId, a.postId, a.items.length, a.cross]), [['222', 'V222', 1, ['333']]], '草稿不排留言；多文來源照排留言＋多文');
  assert.deepEqual(r.body.data.jobs.find((j) => j.page === '222').cross, [{ page: '333', status: 'pending', error: '' }]);
  assert.equal(r.body.data.jobs.find((j) => j.page === '111').draft, true);
});

test('Reels 草稿：video_state DRAFT；Reels 送多文 → 400', async (t) => {
  const { f, env, headers } = await setup(t, {
    'POST /111/video_reels': (c) => c.body.upload_phase === 'start' ? { video_id: 'R1', upload_url: 'https://rupload.facebook.com/video-upload/v27.0/R1' } : { success: true },
    'POST https://rupload.facebook.com/video-upload/v27.0/R1': () => ({ success: true })
  });
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'r.mp4', size: 4, kind: 'reel', pages: ['111'] });
  assert.equal((await call(env, headers, '/fb/video/publish', { uploadId: UID, title: 't', description: 'd', pages: [{ page: '111', at: null, cross: ['222'] }] })).status, 400);
  await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=0', undefined, bytes(4));
  const r = await call(env, headers, '/fb/video/publish', { uploadId: UID, title: 't', description: 'd', pages: [{ page: '111', at: null, draft: true }] });
  assert.deepEqual(states(r), [['111', 'draft']]);
  const fin = f.calls.find((c) => c.body && c.body.upload_phase === 'finish');
  assert.equal(fin.body.video_state, 'DRAFT');
  assert.equal(RecTimer.log.length, 0);
});

test('多文來源 finish 失敗 → 多文顯示失敗（前端不會一直等）', async (t) => {
  const { env, headers } = await setup(t, {
    'POST video:/111/videos': (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S111', video_id: 'V111', start_offset: '0', end_offset: '4' } : c.body.upload_phase === 'transfer' ? { start_offset: '4', end_offset: '4' } : gErr(100, 400, '參數錯誤')
  });
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'a.mp4', size: 4, kind: 'video', pages: ['111'] });
  await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=0', undefined, bytes(4));
  const r = await call(env, headers, '/fb/video/publish', { uploadId: UID, title: 't', description: 'd', pages: [{ page: '111', at: null, cross: ['222'] }] });
  assert.deepEqual(states(r), [['111', 'failed']]);
  assert.deepEqual(r.body.data.jobs[0].cross, [{ page: '222', status: 'failed', error: '原影片沒有發布' }]);
  assert.equal(RecTimer.log.length, 0);
});

test('分段轉送：臉書 5xx 同一段再試一次就成功；兩次都 5xx 標失敗並寫出位置', async (t) => {
  let n111 = 0, n222 = 0;
  const { env, headers } = await setup(t, {
    'POST /111/video_reels': (c) => c.body.upload_phase === 'start' ? { video_id: 'R1', upload_url: 'https://rupload.facebook.com/video-upload/v27.0/R1' } : { success: true },
    'POST /222/video_reels': (c) => c.body.upload_phase === 'start' ? { video_id: 'R2', upload_url: 'https://rupload.facebook.com/video-upload/v27.0/R2' } : { success: true },
    'POST https://rupload.facebook.com/video-upload/v27.0/R1': () => (++n111 === 1 ? gErr(2, 503) : { success: true }),
    'POST https://rupload.facebook.com/video-upload/v27.0/R2': () => { n222++; return gErr(2, 503); }
  });
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'Reels_x.mp4', size: 5, kind: 'reel', pages: ['111', '222'] });
  const r = await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=0', undefined, bytes(5));
  assert.deepEqual(states(r), [['111', 'uploaded'], ['222', 'failed']]);
  assert.equal(n111, 2); assert.equal(n222, 2, '只多試一次');
  assert.match(r.body.data.jobs.find((j) => j.page === '222').error, /^0MB 處上傳失敗/);
});

test('分段轉送：明確錯誤（400）不重試', async (t) => {
  let n = 0;
  const { env, headers } = await setup(t, {
    'POST /111/video_reels': (c) => c.body.upload_phase === 'start' ? { video_id: 'R1', upload_url: 'https://rupload.facebook.com/video-upload/v27.0/R1' } : { success: true },
    'POST https://rupload.facebook.com/video-upload/v27.0/R1': () => { n++; return gErr(100, 400); }
  });
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'Reels_x.mp4', size: 5, kind: 'reel', pages: ['111'] });
  const r = await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=0', undefined, bytes(5));
  assert.deepEqual(states(r), [['111', 'failed']]);
  assert.equal(n, 1);
});

test('多文完成：查狀態時存下目標粉專的影片 ID，送出紀錄回傳 videoId（失敗不回）', async (t) => {
  const { env, headers } = await setup(t, {
    'POST video:/222/videos': (c) => c.body.upload_phase === 'start' ? { upload_session_id: 'S222', video_id: 'V222', start_offset: '0', end_offset: '4' } : c.body.upload_phase === 'transfer' ? { start_offset: '4', end_offset: '4' } : { success: true },
    'GET /V222': () => ({ status: { video_status: 'processing' } })
  });
  await call(env, headers, '/fb/video/start', { uploadId: UID, name: 'a.mp4', size: 4, kind: 'video', pages: ['222'] });
  await call(env, headers, '/fb/video/chunk?u=' + UID + '&start=0', undefined, bytes(4));
  await call(env, headers, '/fb/video/publish', { uploadId: UID, title: 't', description: 'd', pages: [{ page: '222', at: null, cross: ['333', '444'] }] });
  RecTimer.status = { ok: true, cross: [{ page: '333', status: 'done', videoId: '98765' }, { page: '444', status: 'failed', videoId: '55555', error: '不行' }] };
  await call(env, headers, '/fb/video/status?u=' + UID);
  const r = await call(env, headers, '/fb/video/jobs');
  assert.deepEqual(r.body.data[0].cross, [{ page: '333', status: 'done', error: '', videoId: '98765' }, { page: '444', status: 'failed', error: '不行' }]);
  assert.equal(r.body.data[0].videoId, 'V222');
});
