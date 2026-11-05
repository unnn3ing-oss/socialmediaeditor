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

export async function handleAuth(request, env, path) {
  if (path === '/auth' && request.method === 'POST') {
    return loginWith(request, env, 'company', 'COMPANY_PASSWORD', sessionTtl(env));
  }
  if (path === '/auth/status' && request.method === 'GET') {
    if (!secretOk(env)) return fail(request, env, 'misconfigured');
    const t = await bearer(request, env, 'company');
    if (!t) return fail(request, env, 'unauthorized');
    const data = { company: true, exp: t.exp };
    // 剩不到一半效期就續一張；舊的到期前仍有效
    if (t.exp - nowSec() < sessionTtl(env) / 2) {
      const exp = nowSec() + sessionTtl(env);
      data.renew = { token: await signToken(env.SESSION_SECRET, 'company', exp), exp };
    }
    return ok(request, env, data);
  }
  return null;
}
