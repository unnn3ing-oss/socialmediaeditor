import { signToken, readToken, passwordMatches } from './token.js';
import { ok, fail, readBody, sleep } from './http.js';

export const MIN_SECRET = 32;
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
export const nowSec = () => Math.floor(Date.now() / 1000);
export const sessionTtl = (env) => num(env.SESSION_DAYS, 30) * 86400;
export const secretOk = (env) => typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= MIN_SECRET;
export const failDelay = (env) => num(env.FAIL_DELAY_MS, 1000);

// 驗 Bearer 憑證，kind 必須相符；有效回 { kind, exp }，否則 null
export async function bearer(request, env, kind) {
  if (!secretOk(env)) return null;
  const m = /^Bearer (\S+)$/.exec(request.headers.get('authorization') || '');
  if (!m) return null;
  const t = await readToken(env.SESSION_SECRET, m[1], nowSec());
  return t && t.kind === kind ? t : null;
}

// 讀 JSON 裡的 password；本文壞掉或太大回 null
async function readPassword(request) {
  const buf = await readBody(request, 2048);
  if (!buf) return null;
  try {
    const b = JSON.parse(new TextDecoder().decode(buf));
    return b && typeof b.password === 'string' ? b.password : '';
  } catch (e) { return null; }
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
async function companyLogin(request, env) {
  if (!secretOk(env) || typeof env.COMPANY_PASSWORD !== 'string' || !env.COMPANY_PASSWORD) return fail(request, env, 'misconfigured');
  const password = await readPassword(request);
  if (password === null) return fail(request, env, 'bad_request');
  let adm = false;
  if (!(await passwordMatches(password, env.COMPANY_PASSWORD))) {
    adm = typeof env.ADMIN_PASSWORD === 'string' && !!env.ADMIN_PASSWORD && (await passwordMatches(password, env.ADMIN_PASSWORD));
    if (!adm) { await sleep(failDelay(env)); return fail(request, env, 'bad_password'); }
  }
  const exp = nowSec() + (adm ? ADMIN_FRONT_TTL : sessionTtl(env));
  return ok(request, env, { token: await signToken(env.SESSION_SECRET, 'company', exp, adm), exp, ...(adm ? { admin: true } : {}) });
}

export async function handleAuth(request, env, path) {
  if (path === '/auth' && request.method === 'POST') return companyLogin(request, env);
  if (path === '/auth/status' && request.method === 'GET') {
    if (!secretOk(env)) return fail(request, env, 'misconfigured');
    const t = await bearer(request, env, 'company');
    if (!t) return fail(request, env, 'unauthorized');
    const data = { company: true, exp: t.exp, ...(t.adm ? { admin: true } : {}) };
    // 剩不到一半效期就續一張；舊的到期前仍有效。管理員憑證不續（續了會變成普通憑證，到期請重新輸入）
    if (!t.adm && t.exp - nowSec() < sessionTtl(env) / 2) {
      const exp = nowSec() + sessionTtl(env);
      data.renew = { token: await signToken(env.SESSION_SECRET, 'company', exp), exp };
    }
    return ok(request, env, data);
  }
  return null;
}
