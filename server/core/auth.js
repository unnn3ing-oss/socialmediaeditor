import { signToken, readToken, passwordMatches } from './token.js';
import { ok, fail, readBody, sleep } from './http.js';
import { findStaff, cardsOf, normId, touchLogin, getProfile, setContact, cleanContact, CONTACT_MSG, authRow, recordFail, clearFails, storePassword } from './staff.js';
import { pwProblem, hashPassword, verifyPassword, codeHash, safeEqual, MAX_FAILS, LOCK_MS } from './password.js';

export const MIN_SECRET = 32;
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
export const nowSec = () => Math.floor(Date.now() / 1000);
export const sessionTtl = (env) => num(env.SESSION_DAYS, 30) * 86400;
export const secretOk = (env) => typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= MIN_SECRET;
export const failDelay = (env) => num(env.FAIL_DELAY_MS, 1000);

// 驗 Bearer 憑證，kind 必須相符；有效回 { kind, exp, adm, uid, staff }，否則 null
//   員工登入的憑證（uid）每次都查授權名單：被移除、停用，或密碼版本（pv）對不上（改過密碼／被重置）就當成無效（立即撤銷）
//   staff＝{ id, name, group, groupName, perms, level, pwVer }
export async function bearer(request, env, kind) {
  if (!secretOk(env)) return null;
  const m = /^Bearer (\S+)$/.exec(request.headers.get('authorization') || '');
  if (!m) return null;
  const t = await readToken(env.SESSION_SECRET, m[1], nowSec());
  if (!t || t.kind !== kind) return null;
  // 公司密碼與首頁管理員密碼都已拿掉：沒有員工編號的舊公司憑證（含 adm:1）一律無效
  if (kind === 'company' && !t.uid) return null;
  if (t.uid) {
    const staff = await findStaff(env, t.uid);
    if (!staff || staff.pwVer !== t.pv) return null;
    t.staff = staff;
  }
  return t;
}

// 讀登入 JSON；本文壞掉或太大回 null
async function readLogin(request) {
  const buf = await readBody(request, 2048);
  if (!buf) return null;
  try {
    const b = JSON.parse(new TextDecoder().decode(buf));
    return b && typeof b === 'object' ? b : {};
  } catch (e) { return null; }
}
async function readPassword(request) {
  const b = await readLogin(request);
  return b === null ? null : typeof b.password === 'string' ? b.password : '';
}

// 密碼登入共用（公司、管理各用一組）：secretName 是 env 裡的密碼名稱
export async function loginWith(request, env, kind, secretName, ttlSec) {
  if (!secretOk(env) || typeof env[secretName] !== 'string' || !env[secretName]) return fail(request, env, 'misconfigured');
  const password = await readPassword(request);
  if (password === null) return fail(request, env, 'bad_request');
  if (!(await passwordMatches(password, env[secretName]))) {
    await sleep(failDelay(env));
    return fail(request, env, 'bad_password');
  }
  const exp = nowSec() + ttlSec;
  return ok(request, env, { token: await signToken(env.SESSION_SECRET, kind, exp), exp });
}

// 前端登入（只有員工編號＋自己的密碼；公司密碼與首頁管理員密碼登入已拿掉）。POST /auth 本文：
//   { staffId }                         → 查下一步：{ next:'password' | 'setup' }（查不到或停用 bad_staff）
//   { staffId, password }               → 登入
//   { staffId, code, newPassword }      → 第一次登入／被重置：用設定碼設密碼並登入（系統管理者可用管理員密碼代替設定碼）
//   連錯（密碼或設定碼）5 次鎖 15 分鐘：locked（detail.until 毫秒）；錯誤回 bad_password（detail.left 剩幾次）
export const ADMIN_FRONT_TTL = 12 * 3600;   // 舊版首頁管理員憑證（已不再發出，留著讀舊憑證）
const staffInfo = (s) => ({ id: s.id, name: s.name, group: s.groupName, level: s.level });

async function issue(request, env, id, ver) {
  const staff = await findStaff(env, id);
  if (!staff) return fail(request, env, 'bad_staff');
  await touchLogin(env, staff.id);
  const exp = nowSec() + sessionTtl(env);
  const manage = staff.level === 'sys' || cardsOf(staff.perms).length > 0;
  return ok(request, env, { token: await signToken(env.SESSION_SECRET, 'company', exp, false, staff.id, ver), exp, staff: staffInfo(staff), manage });
}
const lockedRes = (request, env, row) => fail(request, env, 'locked', '連續輸入錯誤太多次，請 ' + Math.max(1, Math.ceil((row.lockUntil - Date.now()) / 60000)) + ' 分鐘後再試，或請管理者重置密碼。', { until: row.lockUntil });
async function wrong(request, env, row, msg, clearSetup = false) {
  const r = await recordFail(env, row, MAX_FAILS, LOCK_MS, clearSetup);
  await sleep(failDelay(env));
  if (r.locked) return lockedRes(request, env, { lockUntil: r.until });
  return fail(request, env, 'bad_password', msg + '還可以再試 ' + r.left + ' 次。', { left: r.left });
}

async function companyLogin(request, env) {
  if (!secretOk(env)) return fail(request, env, 'misconfigured');
  const body = await readLogin(request);
  if (body === null) return fail(request, env, 'bad_request');
  if (typeof body.staffId !== 'string') return fail(request, env, 'bad_request', '請輸入員工編號。');
  const row = await authRow(env, body.staffId).catch(() => null);
  if (!row) { await sleep(failDelay(env)); return fail(request, env, 'bad_staff'); }
  if (row.lockUntil > Date.now()) return lockedRes(request, env, row);
  const next = row.hasPw ? 'password' : 'setup';

  // 設定密碼
  if (typeof body.code === 'string' || typeof body.newPassword === 'string') {
    if (row.hasPw) return fail(request, env, 'bad_request', '這個帳號已經設過密碼，請直接輸入密碼登入。');
    const problem = pwProblem(body.newPassword);
    if (problem) return fail(request, env, 'bad_request', problem);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    let good = !!row.setupHash && row.setupExp > Date.now() && /^\d{6}$/.test(code) && safeEqual(await codeHash(env.SESSION_SECRET, row.id, code), row.setupHash);
    let guard = 'setup';
    // 系統管理者本人：可以用管理員密碼代替設定碼（部署後第一次設定用）
    if (!good && row.sys && typeof env.ADMIN_PASSWORD === 'string' && env.ADMIN_PASSWORD) { good = await passwordMatches(code, env.ADMIN_PASSWORD); if (good) guard = 'nopw'; }
    if (!good) {
      if (!row.sys && (!row.setupHash || row.setupExp <= Date.now())) { await sleep(failDelay(env)); return fail(request, env, 'setup_expired'); }
      return wrong(request, env, row, '設定碼不對，', true);
    }
    const ver = await storePassword(env, row, await hashPassword(body.newPassword), guard);
    if (!ver) return wrong(request, env, row, '設定碼不對，', true);
    return issue(request, env, row.id, ver);
  }

  // 登入
  if (typeof body.password === 'string') {
    if (!row.hasPw) return fail(request, env, 'need_setup');
    if (!(await verifyPassword(body.password, row.hash, row.salt))) return wrong(request, env, row, '密碼不對，');
    if (row.fails) await clearFails(env, row.id);
    return issue(request, env, row.id, row.ver);
  }

  // 只查下一步
  return ok(request, env, { next });
}

// 變更自己的密碼：{ password（目前）, newPassword } → 新憑證（其他裝置登出）
async function changePassword(request, env) {
  const t = await bearer(request, env, 'company');
  if (!t) return fail(request, env, 'unauthorized');
  if (!t.staff) return fail(request, env, 'fb_need_staff', '需要用員工編號登入。');
  const b = await readLogin(request);
  if (!b) return fail(request, env, 'bad_request');
  const problem = pwProblem(b.newPassword);
  if (problem) return fail(request, env, 'bad_request', problem);
  const row = await authRow(env, t.staff.id);
  if (!row) return fail(request, env, 'unauthorized');
  if (row.lockUntil > Date.now()) return lockedRes(request, env, row);
  if (!row.hasPw || !(await verifyPassword(typeof b.password === 'string' ? b.password : '', row.hash, row.salt))) return wrong(request, env, row, '目前密碼不對，');
  const ver = await storePassword(env, row, await hashPassword(b.newPassword));
  return issue(request, env, row.id, ver);
}

// 員工自己的資料：GET 讀（姓名、權限組、分機），POST { contact } 只能改自己的分機
async function staffMe(request, env) {
  const t = await bearer(request, env, 'company');
  if (!t) return fail(request, env, 'unauthorized');
  if (!t.staff) return fail(request, env, 'fb_need_staff', '需要用員工編號登入。');
  if (request.method === 'POST') {
    const b = await readLogin(request);
    const contact = b ? cleanContact(b.contact) : null;
    if (contact === null) return fail(request, env, 'bad_request', CONTACT_MSG);
    await setContact(env, t.staff.id, contact);
  }
  return ok(request, env, await getProfile(env, t.staff.id));
}

export async function handleAuth(request, env, path) {
  if (path === '/auth' && request.method === 'POST') return companyLogin(request, env);
  if (path === '/staff/me' && (request.method === 'GET' || request.method === 'POST')) return staffMe(request, env);
  if (path === '/staff/me/password' && request.method === 'POST') return changePassword(request, env);
  if (path === '/auth/status' && request.method === 'GET') {
    if (!secretOk(env)) return fail(request, env, 'misconfigured');
    const t = await bearer(request, env, 'company');
    if (!t) return fail(request, env, 'unauthorized');
    const data = { company: true, exp: t.exp, ...(t.staff ? { staff: staffInfo(t.staff) } : {}) };
    // manage：首頁要不要顯示「管理頁」按鈕（管理員密碼登入，或員工層級至少有一張卡片）
    data.manage = !!t.staff && (t.staff.level === 'sys' || cardsOf(t.staff.perms).length > 0);
    // 剩不到一半效期就續一張；舊的到期前仍有效。管理員憑證不續（續了會變成普通憑證，到期請重新輸入）
    if (t.exp - nowSec() < sessionTtl(env) / 2) {
      const exp = nowSec() + sessionTtl(env);
      data.renew = { token: await signToken(env.SESSION_SECRET, 'company', exp, false, t.uid, t.pv), exp };
    }
    return ok(request, env, data);
  }
  return null;
}
