// 本機送出紀錄；不保存草稿、token 或圖片。七天清除只動這台瀏覽器。
export const KEY = 'tbx.fbpost.records.v1';
export const AUTO_KEY = 'tbx.fbpost.records-clean.v1';
export const CLEAN_DAYS = 7;
const DAY = 86400000;
const text = (v) => typeof v === 'string' ? v : '';
const time = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// 逐欄保存，呼叫端的 token、圖片與其他臨時資料不能跟著寫入。
function normalize(record) {
  if (!object(record) || !text(record.id) || time(record.at) === null || !Array.isArray(record.pages)) return null;
  const pages = record.pages.map((p) => {
    if (!object(p) || !text(p.page) || !['ok', 'fail', 'canceled'].includes(p.status)) return null;
    return {
      page: p.page, label: text(p.label), scheduledAt: time(p.scheduledAt),
      sentAt: time(p.sentAt) ?? record.at, status: p.status,
      postId: text(p.postId), error: text(p.error),
      ...(text(p.id) ? { id: p.id } : {}),
      ...Object.fromEntries(['title', 'caption', 'url'].filter((k) => typeof p[k] === 'string').map((k) => [k, p[k]])),
      ...(object(p.rundown) ? { rundown: { ok: p.rundown.ok === true, msg: text(p.rundown.msg) } } : {})
    };
  });
  if (pages.some((p) => !p)) return null;
  return {
    id: record.id, at: record.at, updatedAt: time(record.updatedAt) ?? record.at,
    title: text(record.title), caption: text(record.caption), url: text(record.url), pages
  };
}

export function expired(record, now = Date.now()) {
  if (!record.pages.length || !Number.isFinite(now)) return false;
  if (record.pages.some((p) => p.status === 'fail' || (p.scheduledAt !== null && p.scheduledAt * 1000 > now))) return false;
  const last = Math.max(record.at, record.updatedAt,
    ...record.pages.map((p) => Math.max(p.sentAt, p.scheduledAt === null ? 0 : p.scheduledAt * 1000)));
  return last < now - CLEAN_DAYS * DAY;
}

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function createStore(storage = defaultStorage()) {
  let records = [], automatic = true, persistent = !!storage, dirty = false;
  const removed = new Map(); // 刪除的版本快照；恢復儲存時保留其他分頁後續的更新。
  const read = () => {
    const value = JSON.parse(storage.getItem(KEY) || '[]');
    if (!Array.isArray(value)) throw new Error('Invalid records');
    const next = value.map(normalize);
    if (next.some((r) => !r)) throw new Error('Invalid record');
    return next;
  };
  const refresh = () => {
    if (!storage || dirty) return;
    try {
      records = read();
    } catch { persistent = false; dirty = true; }
  };
  refresh();
  try {
    const value = JSON.parse(storage?.getItem(AUTO_KEY) || 'null');
    automatic = !object(value) || value.auto !== false;
  } catch { automatic = true; }
  const write = () => {
    try {
      if (!storage) throw new Error('Storage unavailable');
      // 儲存失敗期間，其他分頁可能新增／修改紀錄；成功寫回前先合併。
      let current = [];
      try { current = read(); } catch { /* 壞資料或讀取受限時，仍保留本頁已知的紀錄。 */ }
      const merged = new Map(current.filter((r) => {
        const deletion = removed.get(r.id);
        if (!deletion || r.updatedAt > deletion.updatedAt) return true;
        // 清除舊紀錄不能刪掉另一分頁改成的未來排程或失敗紀錄。
        return deletion.cleanAt !== undefined && !expired(r, deletion.cleanAt);
      }).map((r) => [r.id, r]));
      for (const record of records) {
        const other = merged.get(record.id);
        if (!other || record.updatedAt >= other.updatedAt) merged.set(record.id, record);
      }
      records = [...merged.values()];
      storage.setItem(KEY, JSON.stringify(records));
      persistent = true; dirty = false; removed.clear();
      return true;
    } catch {
      persistent = false; dirty = true;
      return false;
    }
  };
  return {
    get persistent() { return persistent; },
    list() {
      refresh();
      return records.map(normalize).sort((a, b) => b.at - a.at);
    },
    save(record) {
      const clean = normalize(record);
      if (!clean) throw new TypeError('Invalid local record');
      refresh();
      removed.delete(clean.id);
      const i = records.findIndex((r) => r.id === clean.id);
      if (i < 0) records.push(clean); else records[i] = clean;
      return write();
    },
    remove(id) {
      refresh();
      const record = records.find((r) => r.id === id);
      if (record) removed.set(id, { updatedAt: record.updatedAt });
      records = records.filter((r) => r.id !== id);
      return write();
    },
    clean(now = Date.now()) {
      refresh();
      const before = records.length;
      records = records.filter((r) => {
        if (!expired(r, now)) return true;
        removed.set(r.id, { updatedAt: r.updatedAt, cleanAt: now });
        return false;
      });
      const count = before - records.length;
      if (count) write();
      return count;
    },
    autoClean() { return automatic; },
    setAutoClean(enabled) {
      automatic = !!enabled;
      try {
        if (!storage) throw new Error('Storage unavailable');
        storage.setItem(AUTO_KEY, JSON.stringify({ auto: automatic }));
        return true;
      } catch { persistent = false; return false; }
    }
  };
}
