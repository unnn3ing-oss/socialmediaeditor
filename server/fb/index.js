// 排程發布後端：/fb/*（權限見 access.js：管理頁切換只開放管理員／開放公司帳號）與管理路由 /admin/fb/*、/admin/rundown*
import { ok, fail, readBody } from '../core/http.js';
import { fbAccess, accessMode, accessState, setAccessState, ACCESS_MODES, MAX_REASON } from './access.js';
import { audit } from '../core/staff.js';
import { listPages, validPages, savePages, clearPageCache, tokenStatus, connectToken, refreshPages, quickWarn, FbSetupError } from './pages.js';
import { saveToken, clearToken, savePageTokens, appCred, saveAppCred, clearAppCred, APP_ID_RE, APP_SECRET_RE, readProfiles, createProfile, renameProfile, activateProfile, deleteProfile, forProfile, storedPageTokens, userToken, brokenAt, PROFILE_ID_RE, MAX_PROFILES } from './tokenstore.js';
import { GraphError, checkAppCred } from './graph.js';
import { parsePostForm, createPosts, MAX_IMAGE } from './post.js';
import { rundownAdd, adminRundown } from './rundown.js';
import { listPresets, validPresets, savePresets } from './presets.js';
import { pageToken, listScheduled, listPublished, reschedule, removePost, timeOk } from './manage.js';
import { parseStart, startUpload, receiveChunk, parsePublish, publish, refreshStatus, stopUpload, listJobs, validUploadId, MAX_CHUNK, saveCover, MAX_COVER } from './video.js';
import { getVideoSettings, validVideoSettings, saveVideoSettings } from './videoset.js';
import { webhookState } from './webhook.js';

// 把例外轉成回應：設定錯誤（fb_off／fb_token）、臉書錯誤（fb_error 附原因）
export function fbFail(request, env, e) {
  if (e instanceof FbSetupError) return fail(request, env, e.code);
  if (e instanceof GraphError) return fail(request, env, 'fb_error', '臉書：' + String(e.message).slice(0, 200));
  throw e;
}

export async function readJsonBody(request, max = 65536) {
  const buf = await readBody(request, max);
  if (!buf) return null;
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { return null; }
}

// [method, RegExp, handler(request, env, ctx, match, me), need]；need＝需要的權限（null＝名單內即可），me＝fbAccess 的結果
const routes = [];
export function route(method, re, handler, need = null) { routes.push([method, re, handler, need]); }

// 自己是誰、能做什麼（前端依此隱藏按鈕）
// tokenWarn＝臉書權杖快到期／失效的提醒（只給管理員；不呼叫臉書）
route('GET', /^\/fb\/me$/, async (request, env, ctx, m, me) => ok(request, env, {
  admin: me.admin, id: me.staff ? me.staff.id : '', name: me.who.name, group: me.staff ? me.staff.groupName : '', perms: me.perms, mode: me.mode,
  tokenWarn: me.admin ? await quickWarn(env).catch(() => null) : null
}));

route('GET', /^\/fb\/pages$/, async (request, env) => {
  const pages = await listPages(env);
  return ok(request, env, pages.map((p) => ({ id: p.id, short: p.short, order: p.order, rd: p.rd, noTextUtm: !p.utmText })));
});
route('GET', /^\/fb\/access$/, async (request, env) => ok(request, env, { mode: await accessMode(env) }));

route('GET', /^\/fb\/presets$/, async (request, env) => ok(request, env, await listPresets(env)));

route('POST', /^\/fb\/post$/, async (request, env, ctx, m, me) => {
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('multipart/form-data')) return fail(request, env, 'bad_request');
  const buf = await readBody(request, MAX_IMAGE + 512 * 1024);
  if (!buf) return fail(request, env, 'too_large');
  let fd;
  try { fd = await new Response(buf, { headers: { 'content-type': ct } }).formData(); } catch { return fail(request, env, 'bad_request'); }
  const form = parsePostForm(fd);
  if (!form) return fail(request, env, 'bad_request');
  const results = await createPosts(env, form);
  for (const r of results) {
    if (r.ok && !r.dup) await audit(env, me.who, r.scheduled ? 'schedule' : 'publish', r.page, r.postId || '', r.scheduled && r.at ? 'at=' + r.at : '');
  }
  return ok(request, env, { results });
}, 'post');

route('GET', /^\/fb\/scheduled$/, async (request, env) => {
  const page = new URL(request.url).searchParams.get('page') || '';
  const token = await pageToken(env, page);
  if (!token) return fail(request, env, 'bad_request');
  return ok(request, env, await listScheduled(env, page, token));
}, 'view');
route('GET', /^\/fb\/published$/, async (request, env) => {
  const q = new URL(request.url).searchParams;
  const page = q.get('page') || '';
  const after = q.get('after') || '';
  const token = await pageToken(env, page);
  if (!token || after.length > 500) return fail(request, env, 'bad_request');
  return ok(request, env, await listPublished(env, page, token, after));
}, 'view');
route('POST', /^\/fb\/posts\/(\d{1,30}(?:_\d{1,30})?)\/(reschedule|cancel|delete)$/, async (request, env, ctx, m, me) => {
  const body = await readJsonBody(request, 4096);
  const need = m[2] === 'reschedule' ? 'edit' : 'delete';
  if (!me.perms.includes(need)) return fail(request, env, 'fb_no_perm');
  if (!body) return fail(request, env, 'bad_request');
  if (m[2] === 'reschedule' && !timeOk(body.at)) return fail(request, env, 'fb_bad_time');   // 先檢查時間，不碰臉書
  const token = await pageToken(env, body.page);
  if (!token) return fail(request, env, 'bad_request');
  if (m[2] === 'reschedule') {
    await reschedule(env, m[1], token, body.at);
    await audit(env, me.who, 'reschedule', body.page, m[1], 'at=' + body.at);
  } else {
    await removePost(env, m[1], token);
    await audit(env, me.who, 'delete', body.page, m[1]);
  }
  return ok(request, env, { ok: true });
}, 'view');

// 影片發布（tools/fbvideo，見 video.js）
const vout = (request, env, r) => (r.error ? fail(request, env, r.error, r.message) : ok(request, env, r));
route('GET', /^\/fb\/video\/settings$/, async (request, env) => ok(request, env, await getVideoSettings(env)), 'view');
route('POST', /^\/fb\/video\/start$/, async (request, env, ctx, m, me) => {
  const form = parseStart(await readJsonBody(request, 8192));
  if (!form) return fail(request, env, 'bad_request');
  return vout(request, env, await startUpload(env, form, me.who));
}, 'post');
route('POST', /^\/fb\/video\/chunk$/, async (request, env) => {
  const q = new URL(request.url).searchParams;
  const u = q.get('u') || '', start = Number(q.get('start'));
  if (!validUploadId(u) || !Number.isInteger(start) || start < 0) return fail(request, env, 'bad_request');
  const buf = await readBody(request, MAX_CHUNK);
  if (!buf) return fail(request, env, 'too_large');
  if (!buf.length) return fail(request, env, 'bad_request');
  return vout(request, env, await receiveChunk(env, u, start, buf));
}, 'post');
route('POST', /^\/fb\/video\/cover$/, async (request, env) => {
  const u = new URL(request.url).searchParams.get('u') || '';
  if (!validUploadId(u)) return fail(request, env, 'bad_request');
  const buf = await readBody(request, MAX_COVER);
  if (!buf) return fail(request, env, 'too_large');
  if (buf.length < 4) return fail(request, env, 'bad_request');
  return vout(request, env, await saveCover(env, u, buf));
}, 'post');
route('POST', /^\/fb\/video\/publish$/, async (request, env, ctx, m, me) => {
  const form = parsePublish(await readJsonBody(request, 300000));
  if (!form) return fail(request, env, 'bad_request');
  return vout(request, env, await publish(env, form, me.who));
}, 'post');
route('POST', /^\/fb\/video\/(stop|drop)$/, async (request, env, ctx, m) => {
  const b = await readJsonBody(request, 4096);
  if (!b || !validUploadId(b.uploadId) || (m[1] === 'drop' && !/^\d{1,30}$/.test(String(b.page || '')))) return fail(request, env, 'bad_request');
  return vout(request, env, await stopUpload(env, b.uploadId, m[1] === 'drop' ? String(b.page) : null));
}, 'post');
route('GET', /^\/fb\/video\/status$/, async (request, env) => {
  const u = new URL(request.url).searchParams.get('u') || '';
  if (!validUploadId(u)) return fail(request, env, 'bad_request');
  return vout(request, env, await refreshStatus(env, u));
}, 'view');
route('GET', /^\/fb\/video\/jobs$/, async (request, env) => ok(request, env, await listJobs(env)), 'view');

route('POST', /^\/rundown$/, async (request, env) => rundownAdd(request, env, await readJsonBody(request, 16384)), 'post');

export async function handleFb(request, env, ctx, path) {
  if (!path.startsWith('/fb/') && path !== '/rundown') return null;
  // 首頁用（不需登入）：只回有沒有開放，不含關閉原因
  if (path === '/fb/open' && request.method === 'GET') return ok(request, env, { open: (await accessMode(env)) === 'company' }, { 'cache-control': 'no-store' });
  for (const [method, re, handler, need] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    if (request.method !== method) continue;
    const me = await fbAccess(request, env, need);
    if (me.denied) return me.denied;
    try { return await handler(request, env, ctx, m, me); } catch (e) { return fbFail(request, env, e); }
  }
  return fail(request, env, 'not_found');
}

const adminRoutes = [];
export function adminRoute(method, re, handler) { adminRoutes.push([method, re, handler]); }

adminRoute('GET', /^\/admin\/fb\/status$/, async (request, env) => ok(request, env, await tokenStatus(env)));
adminRoute('GET', /^\/admin\/fb\/pages$/, async (request, env) => ok(request, env, await listPages(env, { all: true })));
adminRoute('POST', /^\/admin\/fb\/pages$/, async (request, env) => {
  const pages = validPages(await readJsonBody(request));
  if (!pages) return fail(request, env, 'bad_request');
  await savePages(env, pages);
  return ok(request, env, await listPages(env, { all: true }));
});
adminRoute('GET', /^\/admin\/fb\/presets$/, async (request, env) => ok(request, env, await listPresets(env)));
adminRoute('POST', /^\/admin\/fb\/presets$/, async (request, env) => {
  const list = validPresets(await readJsonBody(request, 400000));
  if (!list) return fail(request, env, 'bad_request');
  await savePresets(env, list);
  return ok(request, env, await listPresets(env));
});
// 管理頁換權杖：驗證 → 自動延長（有 App 密鑰時）→ 換粉專權杖並確認不過期 → 才存；回傳狀態，不回傳權杖
adminRoute('POST', /^\/admin\/fb\/token$/, async (request, env) => {
  const body = await readJsonBody(request, 8192);
  const token = body && typeof body.token === 'string' ? body.token.trim() : '';
  if (!token || token.length > 1000 || /\s/.test(token)) return fail(request, env, 'bad_request', '請貼上完整的權杖。');
  const c = await connectToken(env, token, async (ut, rec) => { await saveToken(env, ut); await savePageTokens(env, rec); });
  if (!c.ok) return fail(request, env, 'fb_token', c.error);
  await clearPageCache(env);
  return ok(request, env, { ...(await tokenStatus(env)), extended: c.extended });
});
adminRoute('DELETE', /^\/admin\/fb\/token$/, async (request, env) => {
  await clearToken(env);
  await clearPageCache(env);
  return ok(request, env, await tokenStatus(env));
});
// App 密鑰（自動延長權杖用）：只回有沒有設定、App ID、來源、設定時間；App Secret 永不回傳
async function appState(env) {
  const c = await appCred(env);
  return c ? { configured: true, appId: c.appId, source: c.source, savedAt: c.savedAt } : { configured: false, appId: '', source: null, savedAt: null };
}
adminRoute('GET', /^\/admin\/fb\/app$/, async (request, env) => ok(request, env, await appState(env)));
adminRoute('POST', /^\/admin\/fb\/app$/, async (request, env) => {
  const body = await readJsonBody(request, 2048);
  const appId = body && typeof body.appId === 'string' ? body.appId.trim() : '';
  const secret = body && typeof body.secret === 'string' ? body.secret.trim() : '';
  if (!APP_ID_RE.test(appId)) return fail(request, env, 'bad_request', 'App ID 是 1～20 位數字。');
  if (!APP_SECRET_RE.test(secret)) return fail(request, env, 'bad_request', 'App Secret 是 32 位英數字。');
  try { await checkAppCred(env, appId, secret); } catch (e) {
    if (e instanceof GraphError) return fail(request, env, 'fb_error', 'App ID 和 App Secret 對不上（臉書：' + String(e.message).slice(0, 120) + '）。');
    throw e;
  }
  await saveAppCred(env, appId, secret);
  return ok(request, env, await appState(env));
});
adminRoute('DELETE', /^\/admin\/fb\/app$/, async (request, env) => { await clearAppCred(env); return ok(request, env, await appState(env)); });
adminRoute('GET', /^\/admin\/fb\/webhook$/, async (request, env) => ok(request, env, await webhookState(request, env)));
adminRoute('GET', /^\/admin\/fb\/video-settings$/, async (request, env) => ok(request, env, await getVideoSettings(env)));
adminRoute('POST', /^\/admin\/fb\/video-settings$/, async (request, env) => {
  const v = validVideoSettings(await readJsonBody(request, 16384));
  if (!v) return fail(request, env, 'bad_request', '前後綴每項最多 30 字、hashtag 按鈕每個最多 50 字，各最多 20 個，不能換行。');
  await saveVideoSettings(env, v);
  return ok(request, env, await getVideoSettings(env));
});
adminRoute('GET', /^\/admin\/fb\/access$/, async (request, env) => ok(request, env, await accessState(env)));
// 開放／關閉＋關閉原因；沒帶 reason＝保留原本的原因
adminRoute('POST', /^\/admin\/fb\/access$/, async (request, env) => {
  const body = await readJsonBody(request, 2048);
  if (!body || !ACCESS_MODES.includes(body.mode)) return fail(request, env, 'bad_request');
  if (body.reason !== undefined && (typeof body.reason !== 'string' || [...body.reason.trim()].length > MAX_REASON)) return fail(request, env, 'bad_request', '關閉原因最多 ' + MAX_REASON + ' 字。');
  const reason = body.reason !== undefined ? body.reason : (await accessState(env)).reason;
  await setAccessState(env, { mode: body.mode, reason });
  return ok(request, env, await accessState(env));
});
adminRoute('POST', /^\/admin\/fb\/refresh$/, async (request, env) => ok(request, env, await refreshPages(env)));

// 權杖組別：不呼叫臉書，只讀存好的資料；權杖與 Secret 一律不回傳
async function profilesState(env) {
  const st = await readProfiles(env);
  const list = [];
  for (const p of st.list) {
    const pe = forProfile(env, p.id);
    const [stored, ut, app, broken] = await Promise.all([storedPageTokens(pe), userToken(pe), appCred(pe), brokenAt(pe)]);
    list.push({
      id: p.id, name: p.name, created: p.created, active: p.id === st.active,
      hasToken: !!(stored || ut.token), source: stored ? 'admin' : ut.source,
      pages: stored ? stored.pages.map((x) => x.name) : [], dataExpires: stored ? stored.dataExpires : null,
      appName: stored ? stored.app : '', appId: app ? app.appId : '', broken: !!broken
    });
  }
  return { active: st.active, max: MAX_PROFILES, list };
}
const profileBody = async (request) => { const b = await readJsonBody(request, 2048); return b && typeof b.name === 'string' ? b.name : null; };
adminRoute('GET', /^\/admin\/fb\/profiles$/, async (request, env) => ok(request, env, await profilesState(env)));
adminRoute('POST', /^\/admin\/fb\/profiles$/, async (request, env) => {
  const name = await profileBody(request);
  if (name === null) return fail(request, env, 'bad_request');
  const r = await createProfile(env, name);
  if (r.error) return fail(request, env, 'bad_request', r.error);
  return ok(request, env, { ...(await profilesState(env)), created: r.id });
});
adminRoute('POST', /^\/admin\/fb\/profiles\/(p[0-9a-f]{1,8})$/, async (request, env, m) => {
  const name = await profileBody(request);
  if (name === null) return fail(request, env, 'bad_request');
  const r = await renameProfile(env, m[1], name);
  if (r.error) return fail(request, env, 'bad_request', r.error);
  return ok(request, env, await profilesState(env));
});
adminRoute('POST', /^\/admin\/fb\/profiles\/(p[0-9a-f]{1,8})\/activate$/, async (request, env, m) => {
  const r = await activateProfile(env, m[1]);
  if (r.error) return fail(request, env, 'bad_request', r.error);
  await clearPageCache(env);
  return ok(request, env, await profilesState(env));
});
adminRoute('DELETE', /^\/admin\/fb\/profiles\/(p[0-9a-f]{1,8})$/, async (request, env, m) => {
  const r = await deleteProfile(env, m[1]);
  if (!r.error) await clearPageCache(forProfile(env, m[1]));
  if (r.error) return fail(request, env, 'bad_request', r.error);
  return ok(request, env, await profilesState(env));
});

// 掛在 core/admin.js 的 adminExtras（已通過管理憑證）
export async function adminFb(request, env, path) {
  const rd = await adminRundown(request, env, path);
  if (rd) return rd;
  for (const [method, re, handler] of adminRoutes) {
    const m = re.exec(path);
    if (!m || request.method !== method) continue;
    try {
      // ?p=<組別>：臉書連線／App 密鑰／重新讀取粉專改作用在指定的權杖組別（預設＝使用中）
      let e = env;
      const pid = /^\/admin\/fb\/(status|token|app|refresh)$/.test(path) ? new URL(request.url).searchParams.get('p') : null;
      if (pid) {
        if (!PROFILE_ID_RE.test(pid) || !(await readProfiles(env)).list.some((x) => x.id === pid)) return fail(request, env, 'bad_request', '找不到這個組別。');
        e = forProfile(env, pid);
      }
      return await handler(request, e, m);
    } catch (err) { return fbFail(request, env, err); }
  }
  return null;
}
