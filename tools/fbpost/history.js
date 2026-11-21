// 送出記錄（只在這個瀏覽器）：給「再發一次」帶回文章網址、原始照片、發出時的標題、模式、框／底色。
// 存 IndexedDB（照片是 Blob），保留 7 天；用臉書貼文 ID 找。讀寫失敗（無痕、停用）一律當作沒有記錄，不影響發文。
export const KEEP_MS = 7 * 24 * 3600 * 1000;
const DB = 'tbx-fbpost', STORE = 'sends';

function openDb(idb) {
  return new Promise((resolve, reject) => {
    const rq = idb.open(DB, 1);
    rq.onupgradeneeded = () => {
      const s = rq.result.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('posts', 'posts', { multiEntry: true });
      s.createIndex('at', 'at');
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
const done = (rq) => new Promise((resolve, reject) => { rq.onsuccess = () => resolve(rq.result); rq.onerror = () => reject(rq.error); });
const txDone = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });

// 貼文 ID 比對：完整相同，或「粉專_貼文」的貼文部分相同
export const postKey = (id) => String(id || '').split('_').pop();

export function createHistory({ idb = globalThis.indexedDB, now = () => Date.now() } = {}) {
  let dbp = null;
  const db = () => (dbp = dbp || (idb ? openDb(idb) : Promise.reject(new Error('no idb'))));

  async function prune(d) {
    const tx = d.transaction(STORE, 'readwrite');
    const range = IDBKeyRange.upperBound(now() - KEEP_MS);
    const rq = tx.objectStore(STORE).index('at').openCursor(range);
    rq.onsuccess = () => { const c = rq.result; if (c) { c.delete(); c.continue(); } };
    await txDone(tx);
  }

  return {
    // rec：{ link, title, mode, frame, color, photo(Blob|null) }；posts：成功的臉書貼文 ID
    async save(rec, posts) {
      if (!posts.length) return;
      try {
        const d = await db();
        const tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ ...rec, id: `${now()}-${Math.random().toString(36).slice(2, 10)}`, posts: posts.map(postKey), at: now() });
        await txDone(tx);
        await prune(d);
      } catch { /* 存不了就算了 */ }
    },
    // 全部（7 天內）→ Map<貼文 key, 記錄>
    async index() {
      const m = new Map();
      try {
        const d = await db();
        const all = await done(d.transaction(STORE).objectStore(STORE).getAll());
        for (const r of all.sort((a, b) => a.at - b.at)) if (now() - r.at < KEEP_MS) for (const p of r.posts) m.set(p, r);
      } catch { /* 沒有記錄 */ }
      return m;
    }
  };
}
