#!/usr/bin/env node
// 組裝腳本：讀 tools/registry.json 與各工具的 tool.json，產生：
//   shell/catalog.json        外殼的櫥窗與工具列資料
//   extension/manifest.json   外掛 manifest（manifest.base.json ＋ 各工具 ext 的權限聯集）
//   extension/routes.gen.js   外掛背景的工具路由表；並把 tools/<id>/ext.js 複製成 extension/tools/<id>.js
//                             （ext.dir 時整個資料夾複製到 extension/tools/<id>/）
//   server/routes.gen.js      後端的工具路由表（掛在 /t/<id>/）
// 用法：node build.js（寫檔）／node build.js --check（只檢查產生檔是否過期）
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const GEN_HEADER = '// 由 build.js 產生，請勿手動修改\n';
const SKIP_DIRS = new Set(['.git', 'node_modules', '.wrangler']);

function listRepoBasenames(root) {
  const names = new Set();
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(ent.name)) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p); else names.add(ent.name);
    }
  };
  walk(root);
  return names;
}

// 資料夾裡所有檔案的相對路徑（以 / 分隔、排序；略過 . 開頭）
function listFiles(dir, prefix = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ent.name.startsWith('.')) continue;
    const rel = prefix + ent.name;
    if (ent.isDirectory()) out.push(...listFiles(path.join(dir, ent.name), rel + '/'));
    else out.push(rel);
  }
  return out;
}
function removeEmptyDirs(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const p = path.join(dir, ent.name);
    removeEmptyDirs(p);
    if (!fs.readdirSync(p).length) fs.rmdirSync(p);
  }
}

// 版號規則是 X.YZ（例如 1.00、1.05）；Chrome 不接受開頭是 0 的數字段，所以給 Chrome 的 version 去掉開頭的 0（1.00→1.0、1.05→1.5），
// 畫面顯示用 version_name 保留原樣。兩位小數下大小順序不變（1.09→1.9 < 1.10）。
const chromeVersion = (v) => String(v).split('.').map((n) => String(Number(n))).join('.');
const sortedUnion = (...lists) => [...new Set(lists.flat())].sort();

// 工具網址的版本號：工具資料夾＋共用的 sdk／ui 內容雜湊。內容一改網址就變，瀏覽器不會沿用舊的快取。
// Python 執行時產生的快取（git 忽略）不算內容，否則跑過下載助手後網址版本號就變了
const HASH_SKIP = /^__pycache__$|\.pyc$/;
function contentHash(root, dirs) {
  const h = require('node:crypto').createHash('sha256');
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) {
      for (const f of fs.readdirSync(abs).sort()) if (!f.startsWith('.') && !HASH_SKIP.test(f)) walk(`${rel}/${f}`);
    } else { h.update(rel + '\0'); h.update(fs.readFileSync(abs)); h.update('\0'); }
  };
  dirs.forEach(walk);
  return h.digest('hex').slice(0, 10);
}

async function build(root, { check = false, write = true } = {}) {
  const { validateTool, validateRegistry } = await import(path.join(__dirname, 'shell/contract.js'));
  const toolsDir = path.join(root, 'tools');
  const errors = [];
  const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

  let ids;
  try { ids = readJson(path.join(toolsDir, 'registry.json')); }
  catch (e) { return { errors: [`讀不到 tools/registry.json：${e.message}`], outputs: {} }; }
  errors.push(...validateRegistry(ids, { folderExists: (id) => fs.existsSync(path.join(toolsDir, id)) }));
  if (errors.length) return { errors, outputs: {} };

  const repoNames = listRepoBasenames(root);
  const tools = [];
  for (const id of ids) {
    const dir = path.join(toolsDir, id);
    let tool;
    try { tool = readJson(path.join(dir, 'tool.json')); }
    catch (e) { errors.push(`tools/${id}/tool.json 讀不到或格式錯誤：${e.message}`); continue; }
    const errs = validateTool(tool, {
      folderExists: (rel) => fs.existsSync(path.join(dir, rel)),
      fileExists: (rel) => fs.existsSync(path.join(dir, rel)),
      repoHasFile: (name) => repoNames.has(name),
    });
    if (tool.id !== id) errs.push(`id「${tool.id}」必須和資料夾名稱「${id}」相同`);
    errors.push(...errs.map((e) => `tools/${id}：${e}`));
    tools.push(tool);
  }
  if (errors.length) return { errors, outputs: {} };

  const outputs = {};
  const at = (id, f) => `tools/${id}/${f}`;
  outputs['shell/catalog.json'] = JSON.stringify({
    tools: tools.map((t) => ({
      id: t.id, name: t.name, group: t.group, desc: t.desc, tier: t.tier, requires: t.requires,
      ...(Array.isArray(t.badges) && t.badges.length ? { badges: t.badges } : {}),
      // gate：首頁依後端開放狀態顯示標籤（check＝不需登入的 API，回 { open }）；關閉或查不到時顯示 badge 並用 gate.desc
      ...(t.gate && typeof t.gate.check === 'string' && /^\/[a-z0-9/-]+$/.test(t.gate.check) && typeof t.gate.badge === 'string'
        ? { gate: { check: t.gate.check, badge: t.gate.badge, ...(typeof t.gate.desc === 'string' ? { desc: t.gate.desc } : {}) } } : {}),
      icon: at(t.id, t.icon), thumb: at(t.id, t.thumb), entry: `${at(t.id, t.entry)}?v=${contentHash(root, [`tools/${t.id}`, 'sdk', 'ui'])}`,
    })),
  }, null, 2) + '\n';

  const base = readJson(path.join(root, 'extension/core/manifest.base.json'));
  const withExt = tools.filter((t) => t.ext);
  const manifest = {
    ...base,
    version: chromeVersion(base.version),
    version_name: base.version,
    permissions: sortedUnion(base.permissions || [], ...withExt.map((t) => t.ext.permissions)),
    host_permissions: sortedUnion(base.host_permissions || [], ...withExt.map((t) => t.ext.hosts)),
  };
  outputs['extension/manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';

  const v = (id) => 't_' + id.replace(/-/g, '_');
  // ext.dir：整個資料夾複製到 extension/tools/<id>/，入口是資料夾裡的 background；沒有 dir 時只複製一個檔成 extension/tools/<id>.js
  const extEntry = (t) => (t.ext.dir ? `./tools/${t.id}/${t.ext.background.slice(t.ext.dir.length + 1)}` : `./tools/${t.id}.js`);
  outputs['extension/routes.gen.js'] = GEN_HEADER
    + withExt.map((t) => `import * as ${v(t.id)} from '${extEntry(t)}';\n`).join('')
    + `export const toolOps = {${withExt.map((t) => ` '${t.id}': ${v(t.id)}`).join(',')}${withExt.length ? ' ' : ''}};\n`;
  for (const t of withExt) {
    if (t.ext.dir) {
      const src = path.join(toolsDir, t.id, t.ext.dir);
      for (const rel of listFiles(src)) outputs[`extension/tools/${t.id}/${rel}`] = fs.readFileSync(path.join(src, rel), 'utf8');
    } else {
      outputs[`extension/tools/${t.id}.js`] = fs.readFileSync(path.join(toolsDir, t.id, t.ext.background), 'utf8');
    }
  }

  const withApi = tools.filter((t) => t.api);
  outputs['server/routes.gen.js'] = GEN_HEADER
    + withApi.map((t) => `import * as ${v(t.id)} from '../tools/${t.id}/${t.api}';\n`).join('')
    + `export const toolRoutes = {${withApi.map((t) => ` '${t.id}': ${v(t.id)}`).join(',')}${withApi.length ? ' ' : ''}};\n`;

  // extension/tools/ 只能有這次產生的檔案
  const extToolsDir = path.join(root, 'extension/tools');
  const stale = fs.existsSync(extToolsDir)
    ? listFiles(extToolsDir).map((f) => `extension/tools/${f}`).filter((rel) => !(rel in outputs))
    : [];

  if (check) {
    for (const [rel, content] of Object.entries(outputs)) {
      const p = path.join(root, rel);
      if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== content) errors.push(`${rel} 已過期，請執行 node build.js`);
    }
    for (const rel of stale) errors.push(`${rel} 已過期（工具已移除），請執行 node build.js`);
    return { errors, outputs };
  }
  if (write) {
    for (const [rel, content] of Object.entries(outputs)) {
      await fsp.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await fsp.writeFile(path.join(root, rel), content);
    }
    for (const rel of stale) await fsp.rm(path.join(root, rel), { force: true });
    if (fs.existsSync(extToolsDir)) removeEmptyDirs(extToolsDir);
  }
  return { errors, outputs };
}

module.exports = { build, chromeVersion };

if (require.main === module) {
  const check = process.argv.includes('--check');
  build(__dirname, { check }).then(({ errors, outputs }) => {
    if (errors.length) {
      console.error(errors.map((e) => '✗ ' + e).join('\n'));
      process.exit(1);
    }
    console.log(check ? '產生檔都是最新的' : `已產生 ${Object.keys(outputs).length} 個檔案`);
  }).catch((e) => { console.error(e); process.exit(1); });
}
