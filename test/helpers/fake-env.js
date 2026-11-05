// 假的 D1／R2／KV，只給後端單元測試用（只用 Node 22 內建模組）
const fs = require('node:fs');
const path = require('node:path');

/* 記憶體假 R2：put／get／head／delete／list */
function fakeR2() {
  const store = new Map();
  const view = (e) => ({
    key: e.key, size: e.bytes.length, uploaded: e.uploaded,
    httpMetadata: e.httpMetadata, customMetadata: e.customMetadata
  });
  return {
    store,
    async put(key, value, opts = {}) {
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
      store.set(key, { key, bytes, uploaded: new Date(), httpMetadata: opts.httpMetadata || {}, customMetadata: opts.customMetadata || {} });
    },
    async get(key) {
      const e = store.get(key);
      if (!e) return null;
      return Object.assign(view(e), {
        body: new Blob([e.bytes]).stream(),
        arrayBuffer: async () => e.bytes.slice().buffer
      });
    },
    async head(key) { const e = store.get(key); return e ? view(e) : null; },
    async delete(keys) { for (const k of [].concat(keys)) store.delete(k); },
    async list({ prefix = '', limit = 1000, cursor } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? keys.indexOf(cursor) + 1 : 0;
      const slice = keys.slice(start, start + limit);
      const truncated = start + limit < keys.length;
      return { objects: slice.map((k) => view(store.get(k))), truncated, cursor: truncated ? slice[slice.length - 1] : undefined };
    }
  };
}

/* 記憶體假 KV：get／put／delete，put 可帶 expirationTtl（秒） */
function fakeKV() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      const e = store.get(key);
      if (!e) return null;
      if (e.expires && e.expires <= Date.now()) { store.delete(key); return null; }
      return type === 'json' ? JSON.parse(e.value) : e.value;
    },
    async put(key, value, opts = {}) {
      store.set(key, { value, ttl: opts.expirationTtl, expires: opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0 });
    },
    async delete(key) { store.delete(key); }
  };
}

/* 假 D1：用 node:sqlite 的記憶體資料庫，建立時執行 server/schema.sql */
function fakeD1() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '../../server/schema.sql'), 'utf8'));
  const plain = (row) => (row ? { ...row } : row);
  const stmt = (sql, args) => ({
    bind: (...a) => stmt(sql, a),
    async run() {
      const r = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
    async all() { return { results: db.prepare(sql).all(...args).map(plain), success: true }; },
    async first(col) {
      const row = plain(db.prepare(sql).get(...args));
      if (!row) return null;
      return col ? row[col] : row;
    }
  });
  return { raw: db, prepare: (sql) => stmt(sql, []) };
}

// 一組完整的測試環境
function mkEnv(extra = {}) {
  return {
    COMPANY_PASSWORD: 'company-pass-123', ADMIN_PASSWORD: 'admin-pass-456',
    SESSION_SECRET: 's'.repeat(40), ALLOWED_ORIGIN: 'https://unnn3ing-oss.github.io',
    FAIL_DELAY_MS: '0', DB: fakeD1(), FILES: fakeR2(), CACHE: fakeKV(), ...extra
  };
}

module.exports = { fakeR2, fakeKV, fakeD1, mkEnv };
