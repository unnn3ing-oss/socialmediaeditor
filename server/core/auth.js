import { signToken, readToken, passwordMatches } from './token.js';
import { ok, fail, readBody, sleep } from './http.js';
import { cardsFor } from './levels.js';
import { findStaff, normId, touchLogin, getProfile, setContact, cleanContact, CONTACT_MSG } from './staff.js';

export const MIN_SECRET = 32;
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
export const nowSec = () => Math.floor(Date.now() / 1000);
export const sessionTtl = (env) => num(env.SESSION_DAYS, 30) * 86400;
export const secretOk = (env) => typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= MIN_SECRET;
export const failDelay = (env) => num(env.FAIL_DELAY_MS, 1000);

// 驗 Bearer 憑證，kind 必須相符；有效回 { kind, exp, adm, uid, staff }，否則 null
//   員工編號登入的憑證（uid）每次都查授權名單：被移除或停用就當成無效（立即撤銷），staff＝{ id, name, group, groupName, perms }
export async function bearer(request, env, kind) {
  if (!secretOk(env)) return null;
  const m = /^Bearer (\S+)$/.exec(request.headers.get('authorization') || '');
  if (!m) return null;
  const t = await readToken(env.SESSION_SECRET, m[1], nowSec());
  if (!t || t.kind !== kind) return null;
  if (t.uid) {
    const staff = await findStaff(env, t.uid);
    if (!staff) return null;
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

// 前端登入：公司密碼 → 公司憑證；管理密碼 → 帶 adm 的公司憑證（12 小時、不續期，不受暫停排程發布限制；不能進 /admin/*）
export const ADMIN_FRONT_TTL = 12 * 3600;
// 員工編號登入：{ staffId } → 名單內且啟用就發帶 uid 的公司憑證（效期同公司密碼、會續期）
async function staffLogin(request, env, staffId) {
  const id = normId(staffId);
  const staff = id ? await findStaff(env, id) : null;
  if (!staff) { await sleep(failDelay(env)); return fail(request, env, 'bad_staff'); }
  await touchLogin(env, staff.id);
  const exp = nowSec() + sessionTtl(env);
  const manage = (await cardsFor(env, staff.level)).length > 0;
  return ok(request, env, { token: await signToken(env.SESSION_SECRET, 'company', exp, false, staff.id), exp, staff: { id: staff.id, name: staff.name, group: staff.groupName, level: staff.level }, manage });
}

async function companyLogin(request, env) {
  if (!secretOk(env)) return fail(request, env, 'misconfigured');
  const body = await readLogin(request);
  if (body === null) return fail(request, env, 'bad_request');
  if (typeof body.staffId === 'string') return staffLogin(request, env, body.staffId);
  if (typeof env.COMPANY_PASSWORD !== 'string' || !env.COMPANY_PASSWORD) return fail(request, env, 'misconfigured');
  const password = typeof body.password === 'string' ? body.password : '';
  let adm = false;
  if (!(await passwordMatches(password, env.COMPANY_PASSWORD))) {
    adm = typeof env.ADMIN_PASSWORD === 'string' && !!env.ADMIN_PASSWORD && (await passwordMatches(password, env.ADMIN_PASSWORD));
    if (!adm) { await sleep(failDelay(env)); return fail(request, env, 'bad_password'); }
  }
  const exp = nowSec() + (adm ? ADMIN_FRONT_TTL : sessionTtl(env));
  return ok(request, env, { token: await signToken(env.SESSION_SECRET, 'company', exp, adm), exp, ...(adm ? { admin: true, manage: true } : {}) });
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
  if (path === '/auth/status' && request.method === 'GET') {
    if (!secretOk(env)) return fail(request, env, 'misconfigured');
    const t = await bearer(request, env, 'company');
    if (!t) return fail(request, env, 'unauthorized');
    const data = { company: true, exp: t.exp, ...(t.adm ? { admin: true } : {}), ...(t.staff ? { staff: { id: t.staff.id, name: t.staff.name, group: t.staff.groupName, level: t.staff.level } } : {}) };
    // manage：首頁要不要顯示「管理頁」按鈕（管理員密碼登入，或員工層級至少有一張卡片）
    data.manage = !!t.adm || (!!t.staff && (await cardsFor(env, t.staff.level)).length > 0);
    // 剩不到一半效期就續一張；舊的到期前仍有效。管理員憑證不續（續了會變成普通憑證，到期請重新輸入）
    if (!t.adm && t.exp - nowSec() < sessionTtl(env) / 2) {
      const exp = nowSec() + sessionTtl(env);
      data.renew = { token: await signToken(env.SESSION_SECRET, 'company', exp, false, t.uid), exp };
    }
    return ok(request, env, data);
  }
  return null;
}
