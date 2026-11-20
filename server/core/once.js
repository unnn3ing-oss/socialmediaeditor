// 省 D1 讀寫的小工具（依 D1 綁定記在記憶體；不同執行個體各自一份，重啟就清掉）
//   ensureOnce(db, sql)：建表／建索引這類「跑過一次就好」的 SQL，同一個綁定每個執行個體只跑一次；失敗不記，下次再試
//   cached(db, key, ms, load)：讀設定快取 ms 毫秒；同時多個請求只讀一次；讀失敗不快取
//   forget(db, key)：同一執行個體存檔後清掉（其他執行個體最多慢 ms 生效）

const SETTINGS_SQL = 'CREATE TABLE IF NOT EXISTS fb_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated INTEGER NOT NULL)';

const done = new WeakMap();   // db → Set<sql>
export async function ensureOnce(db, sql) {
  if (!db) return;
  let set = done.get(db);
  if (set && set.has(sql)) return;
  await db.prepare(sql).run();
  if (!set) { set = new Set(); done.set(db, set); }
  set.add(sql);
}
export const ensureSettings = (env) => ensureOnce(env.DB, SETTINGS_SQL);

const caches = new WeakMap(); // db → Map<key, { at, p }>
export function cached(db, key, ms, load, now = Date.now()) {
  if (!db) return load();
  let m = caches.get(db);
  if (!m) { m = new Map(); caches.set(db, m); }
  const hit = m.get(key);
  if (hit && now - hit.at < ms) return hit.p;
  const p = Promise.resolve().then(load);
  const ent = { at: now, p };
  m.set(key, ent);
  p.catch(() => { if (m.get(key) === ent) m.delete(key); });
  return p;
}
export function forget(db, key) {
  const m = db && caches.get(db);
  if (m) m.delete(key);
}
