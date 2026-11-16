// 臉書 Graph API 與 Apps Script 的替身：攔 globalThis.fetch，依「方法 路徑」找處理函式，並記錄每次呼叫
const GRAPH = 'https://graph.facebook.com/v27.0';

function installFetch(handlers) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const method = req.method;
    let body = null;
    const ct = req.headers.get('content-type') || '';
    if (method !== 'GET' && method !== 'DELETE') {
      if (ct.includes('multipart/form-data')) body = Object.fromEntries([...(await req.formData()).entries()]);
      else if (ct.includes('application/x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(await req.text()));
      else { const t = await req.text(); try { body = JSON.parse(t); } catch { body = t; } }
    }
    const pathKey = url.origin === new URL(GRAPH).origin ? url.pathname.replace(/^\/v[\d.]+/, '') : url.origin + url.pathname;
    const call = { method, path: pathKey, query: Object.fromEntries(url.searchParams), body };
    calls.push(call);
    const h = handlers[`${method} ${pathKey}`] || handlers[pathKey] || handlers['*'];
    if (!h) return Response.json({ error: { code: 803, message: 'no handler ' + method + ' ' + pathKey } }, { status: 404 });
    const r = await h(call);
    return r instanceof Response ? r : Response.json(r);
  };
  return { calls, restore() { globalThis.fetch = orig; } };
}

const gErr = (code, status = 400, message = 'err') => Response.json({ error: { code, message } }, { status });

// 假 Durable Object namespace：每個名稱一個實例，storage 支援 get/put/delete/setAlarm/getAlarm/deleteAlarm
function fakeStorage() {
  const map = new Map();
  let alarm = null;
  return {
    map,
    async get(k) { return map.has(k) ? structuredClone(map.get(k)) : undefined; },
    async put(k, v) { map.set(k, structuredClone(v)); },
    async delete(k) { return map.delete(k); },
    async setAlarm(t) { alarm = Number(t); },
    async getAlarm() { return alarm; },
    async deleteAlarm() { alarm = null; }
  };
}
function fakeNamespace(Cls, envRef) {
  const inst = new Map();
  const ns = {
    instances: inst,
    idFromName: (name) => ({ name, toString: () => name }),
    get(id) {
      if (!inst.has(id.name)) {
        const state = { storage: fakeStorage(), id };
        inst.set(id.name, { state, obj: new Cls(state, envRef()) });
      }
      const { obj } = inst.get(id.name);
      return { fetch: (url, init) => obj.fetch(new Request(url, init)) };
    }
  };
  return ns;
}

module.exports = { GRAPH, installFetch, gErr, fakeNamespace, fakeStorage };
