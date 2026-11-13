// 查詢結果與送出紀錄分開保存；每種查詢／粉專各用一個 key，避免互相覆蓋。
export const CACHE_PREFIX = 'tbx.fbpost.query-cache.v1:';
const KINDS = new Set(['scheduled', 'published', 'insights']);
const METRICS = new Set(['post_media_view', 'post_total_media_view_unique', 'post_clicks', 'post_reactions_by_type_total']);
const REACTIONS = new Set(['like', 'love', 'wow', 'haha', 'sad', 'sorry', 'angry', 'anger', 'care', 'thankful', 'pride']);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' ? v : '';
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clone = (v) => v === null ? null : JSON.parse(JSON.stringify(v));
function https(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    // 查詢參數若帶有憑證，不把該 URL 放進快取。
    if ([...url.searchParams.keys()].some((k) => /^(?:access_?token|token|authorization|api_?key)$/i.test(k))) return '';
    return value;
  } catch { return ''; }
}
function item(kind, value) {
  if (!object(value) || !text(value.id)) return null;
  const common = { id: value.id, message: text(value.message), created: text(value.created), picture: https(value.picture) };
  if (kind === 'scheduled') {
    const out = { ...common, at: finite(value.at) ? value.at : null };
    if (object(value.comment)) out.comment = { status: text(value.comment.status), error: text(value.comment.error), message: text(value.comment.message) };
    if (Array.isArray(value.extras)) {
      out.extras = value.extras.filter(object).slice(0, 10).map((x) => ({
        seq: finite(x.seq) ? x.seq : 2, delay: finite(x.delay) ? x.delay : 0, status: text(x.status), error: text(x.error), message: text(x.message)
      }));
    }
    return out;
  }
  return { ...common, url: https(value.url), reactions: finite(value.reactions) ? value.reactions : 0,
    comments: finite(value.comments) ? value.comments : 0, shares: finite(value.shares) ? value.shares : 0 };
}
function normalize(kind, value) {
  if (!object(value) || !finite(value.at) || value.at < 0) return null;
  const base = { at: value.at, generation: text(value.generation) };
  if (kind !== 'insights') {
    if (!Array.isArray(value.items)) return null;
    const items = value.items.map((v) => item(kind, v));
    if (items.some((v) => !v)) return null;
    return { ...base, items, ...(kind === 'published' ? { next: typeof value.next === 'string' ? value.next : null } : {}) };
  }
  if (!object(value.data) || !object(value.data.metrics)) return null;
  const metrics = {};
  for (const [key, v] of Object.entries(value.data.metrics)) {
    if (!METRICS.has(key)) continue;
    if (finite(v)) metrics[key] = v;
    else if (key === 'post_reactions_by_type_total' && object(v)) {
      metrics[key] = Object.fromEntries(Object.entries(v).filter(([name, n]) => finite(n) && REACTIONS.has(name.toLowerCase())));
    }
  }
  return { ...base, data: { post: text(value.data.post), metrics,
    missing: Array.isArray(value.data.missing) ? value.data.missing.filter((v) => typeof v === 'string') : [] } };
}
function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}
function storageKey(kind, key) {
  return KINDS.has(kind) && typeof key === 'string' && key ? CACHE_PREFIX + kind + ':' + encodeURIComponent(key) : null;
}
export function createQueryCache(storage = defaultStorage()) {
  const memory = new Map(), dirty = new Set();
  let unavailable = !storage;
  return {
    get persistent() { return !unavailable && dirty.size === 0; },
    get(kind, key) {
      const name = storageKey(kind, key);
      if (!name) return null;
      if (dirty.has(name) || !storage) return clone(memory.get(name) || null);
      let raw;
      try { raw = storage.getItem(name); unavailable = false; }
      catch { unavailable = true; return clone(memory.get(name) || null); }
      let value = null;
      try { value = raw === null ? null : normalize(kind, JSON.parse(raw)); } catch { /* 壞 JSON 視為沒有可用快取 */ }
      if (value) memory.set(name, value); else memory.delete(name);
      return clone(value);
    },
    set(kind, key, value) {
      const name = storageKey(kind, key);
      if (!name || !object(value)) return false;
      const clean = normalize(kind, { ...value, at: finite(value.at) ? value.at : Date.now() });
      if (!clean) return false;
      memory.set(name, clean);
      try {
        if (!storage) throw new Error('Storage unavailable');
        storage.setItem(name, JSON.stringify(clean));
        unavailable = false; dirty.delete(name);
        return true;
      } catch {
        unavailable = true; dirty.add(name);
        return false;
      }
    }
  };
}
