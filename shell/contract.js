// 工具規格卡（tool.json）與工具清單（registry.json）的檢查。
// Node（build.js）與瀏覽器共用：不碰 fs，檔案是否存在一律透過 ctx 詢問。
// ctx = { folderExists(rel), fileExists(rel), repoHasFile(basename) }，rel 皆相對於 tools/<id>/ 或 tools/。

export const TOOL_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
export const ASSET_KEY_RE = /^[a-z0-9][a-z0-9._-]*$/;
export const REQUIRES = ['extension', 'login:tvbs', 'helper'];
export const TIERS = ['public', 'company'];
export const SDK_MAJOR = 1;

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isStrArr = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function validateTool(tool, ctx) {
  const errs = [];
  if (!tool || typeof tool !== 'object') return ['tool.json 不是物件'];
  const id = tool.id;
  if (!(typeof id === 'string' && TOOL_ID_RE.test(id))) errs.push(`id「${id}」格式不對：小寫英文開頭，只能有小寫英文、數字、-`);
  if (!isStr(tool.name)) errs.push('name 不能空白');
  if (!isStr(tool.group)) errs.push('group 不能空白');
  if (!isStr(tool.desc)) errs.push('desc 不能空白');
  if (!TIERS.includes(tool.tier)) errs.push(`tier 只能是 ${TIERS.join('／')}`);
  if (!isStrArr(tool.requires) || tool.requires.some((r) => !REQUIRES.includes(r))) {
    errs.push(`requires 只能包含 ${REQUIRES.join('、')}`);
  }
  for (const f of ['entry', 'icon', 'thumb']) {
    if (!isStr(tool[f])) errs.push(`${f} 不能空白`);
    else if (!ctx.fileExists(tool[f])) errs.push(`${f} 指定的檔案「${tool[f]}」不存在`);
  }
  if (tool.sdk !== SDK_MAJOR) errs.push(`sdk 必須是 ${SDK_MAJOR}`);

  if (tool.ext !== null) {
    const e = tool.ext;
    if (!e || typeof e !== 'object' || !isStrArr(e.permissions) || !isStrArr(e.hosts) || !isStr(e.background)) {
      errs.push('ext 必須是 null 或 { permissions: [], hosts: [], background: "ext.js" }');
    } else if (!ctx.fileExists(e.background)) {
      errs.push(`ext.background 指定的檔案「${e.background}」不存在`);
    }
  }
  if (tool.api !== null) {
    if (!isStr(tool.api)) errs.push('api 必須是 null 或檔名（例如 "api.js"）');
    else if (!ctx.fileExists(tool.api)) errs.push(`api 指定的檔案「${tool.api}」不存在`);
  }

  const assets = tool.assets;
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) {
    errs.push('assets 必須是物件');
  } else {
    for (const [key, spec] of Object.entries(assets)) {
      if (!spec || typeof spec !== 'object') { errs.push(`assets.${key} 必須是物件`); continue; }
      if ('company' in spec) {
        if (!(typeof spec.company === 'string' && ASSET_KEY_RE.test(spec.company))) {
          errs.push(`assets.${key}.company 只能寫後端素材代號（小寫英數與 . _ -）`);
        } else if (ctx.repoHasFile(spec.company)) {
          errs.push(`assets.${key}.company「${spec.company}」：公司素材不能放進 repo，請改放後端`);
        }
      }
      const pub = spec.public;
      if (!(pub === null || pub === 'upload' || isStr(pub))) errs.push(`assets.${key}.public 必須是檔案路徑、"upload" 或 null`);
      else if (isStr(pub) && pub !== 'upload' && !ctx.fileExists(pub)) errs.push(`assets.${key}.public 指定的檔案「${pub}」不存在`);
    }
  }
  return errs;
}

export function validateRegistry(ids, ctx) {
  if (!Array.isArray(ids)) return ['registry.json 必須是工具 id 的陣列'];
  const errs = [];
  const seen = new Set();
  for (const id of ids) {
    if (id === '_template') { errs.push('registry 不能放範本 _template'); continue; }
    if (seen.has(id)) errs.push(`工具「${id}」在 registry 重複`);
    seen.add(id);
    if (!ctx.folderExists(id)) errs.push(`registry 裡的「${id}」找不到 tools/${id}/ 資料夾`);
  }
  return errs;
}
