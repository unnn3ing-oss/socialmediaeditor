// 刷新間隔按粉專／種類保存；只存時間，不存查詢內容或憑證。
export const COOLDOWN_MS = 5 * 60 * 1000;
export const STORAGE_PREFIX = 'tbx.fbpost.refresh-until.v1:';
const LOCK_NAME = 'tbx.fbpost.refresh-cooldown.v1';
const KINDS = new Set(['scheduled', 'published']);
const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const defaultLocks = () => { try { return globalThis.navigator?.locks || null; } catch { return null; } };

function targets(kind, ids) {
  if (!KINDS.has(kind) || !Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string' || !id || id.length > 256 || id.trim() !== id)) return [];
  return [...new Set(ids)].map((id) => STORAGE_PREFIX + kind + ':' + encodeURIComponent(id));
}

export function createRefreshCooldown({ storage = defaultStorage(), now = () => Date.now(), locks = defaultLocks() } = {}) {
  const memory = new Map(), dirty = new Set();
  let unavailable = !storage;
  const write = (key, until) => {
    memory.set(key, until);
    try {
      if (!storage) throw new Error('Storage unavailable');
      storage.setItem(key, JSON.stringify({ until }));
      dirty.delete(key); unavailable = false;
    } catch { dirty.add(key); unavailable = true; }
  };
  const read = (key, current) => {
    let until = memory.get(key) || 0;
    if (!dirty.has(key) && storage) {
      try {
        const value = JSON.parse(storage.getItem(key) || 'null');
        until = value && typeof value.until === 'number' && Number.isFinite(value.until) && value.until >= 0 ? value.until : 0;
        memory.set(key, until); unavailable = false;
      } catch { unavailable = true; }
    }
    // 系統時間倒退或資料損壞時，最多重新等五分鐘，不讓未來時間永久鎖住。
    if (until > current + COOLDOWN_MS) { until = current + COOLDOWN_MS; write(key, until); }
    return Math.max(0, until - current);
  };
  const remainingFor = (keys, current) => Math.max(0, ...keys.map((key) => read(key, current)));
  return {
    get persistent() { return !unavailable && dirty.size === 0; },
    remaining(kind, ids) { return remainingFor(targets(kind, ids), now()); },
    async start(kind, ids) {
      const keys = targets(kind, ids);
      if (!keys.length) return { ok: false, remaining: 0 };
      const claim = () => {
        const current = now(), remaining = remainingFor(keys, current);
        if (remaining > 0) return { ok: false, remaining };
        for (const key of keys) write(key, current + COOLDOWN_MS);
        return { ok: true, remaining: COOLDOWN_MS };
      };
      // 同 profile 多分頁先取得短鎖，完成時間戳讀寫就釋放，不鎖網路請求。
      // 沒有 Web Locks 的瀏覽器只能以同步本機讀寫盡力避免重複。
      if (typeof locks?.request === 'function') {
        let result;
        try { return await locks.request(LOCK_NAME, () => { result = claim(); return result; }); }
        catch { return result || claim(); }
      }
      return claim();
    }
  };
}
