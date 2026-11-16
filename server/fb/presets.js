// 活動留言：管理頁存好的留言內容（名稱＋內容），發文時第 2、3 則留言可以選來帶入。整份取代。
export const MAX_PRESETS = 20, MAX_NAME = 20, MAX_BODY = 8000;

export async function listPresets(env) {
  const { results } = await env.DB.prepare('SELECT name, body FROM fb_presets ORDER BY ord').all();
  return (results || []).map((r) => ({ name: r.name, body: r.body }));
}

// 不合法回 null
export function validPresets(body) {
  const list = body && body.presets;
  if (!Array.isArray(list) || list.length > MAX_PRESETS) return null;
  const out = [];
  for (const p of list) {
    const name = p && typeof p.name === 'string' ? p.name.trim() : '';
    const text = p && typeof p.body === 'string' ? p.body.trim() : '';
    const n = [...name].length, b = [...text].length;
    if (n < 1 || n > MAX_NAME || b < 1 || b > MAX_BODY) return null;
    out.push({ name, body: text });
  }
  return out;
}

// 整份取代（同一個 batch，失敗整批還原）
export async function savePresets(env, list) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM fb_presets'),
    ...list.map((p, i) => env.DB.prepare('INSERT INTO fb_presets (ord, name, body, updated) VALUES (?, ?, ?, ?)').bind(i, p.name, p.body, now))
  ]);
}
