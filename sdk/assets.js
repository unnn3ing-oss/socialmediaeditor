// 素材：公司版（後端）優先，失敗退回通用版；通用版可以是檔案或使用者上傳。

export function resolveAsset(spec, { company }) {
  if (!spec) return null;
  if (company && typeof spec.company === 'string') return { source: 'company', key: spec.company };
  if (spec.public === 'upload') return { source: 'upload' };
  if (typeof spec.public === 'string' && spec.public) return { source: 'public', path: spec.public };
  return null;
}

// getSpec(key) -> spec；isCompany() -> boolean；base 是工具頁網址。皆可注入。
export function createAssets({ api, getSpec, isCompany, base = globalThis.location?.href, createObjectURL = (b) => URL.createObjectURL(b) }) {
  async function get(key, forceNoCompany = false) {
    const spec = await getSpec(key);
    const r = resolveAsset(spec, { company: forceNoCompany ? false : isCompany() });
    if (!r) return null;
    if (r.source === 'upload') return { upload: true };
    if (r.source === 'public') return { url: new URL(r.path, base).href };
    try {
      const res = await api.call(`/assets/${encodeURIComponent(r.key)}`, { raw: true });
      return { url: createObjectURL(await res.blob()) };
    } catch {
      return get(key, true);
    }
  }
  return { get: (key) => get(key) };
}
