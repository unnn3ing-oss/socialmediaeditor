// D1 小工具
export async function all(env, sql, ...args) {
  const r = await env.DB.prepare(sql).bind(...args).all();
  return r.results || [];
}
export async function first(env, sql, ...args) {
  return env.DB.prepare(sql).bind(...args).first();
}
export async function run(env, sql, ...args) {
  return env.DB.prepare(sql).bind(...args).run();
}
