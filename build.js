#!/usr/bin/env node
// 組裝腳本：讀 tools/registry.json 與各工具的 tool.json，產生：
//   shell/catalog.json        外殼的櫥窗與工具列資料
//   extension/manifest.json   外掛 manifest（manifest.base.json ＋ 各工具 ext 的權限聯集）
//   extension/routes.gen.js   外掛背景的工具路由表；並把 tools/<id>/ext.js 複製成 extension/tools/<id>.js
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

const sortedUnion = (...lists) => [...new Set(lists.flat())].sort();

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
      icon: at(t.id, t.icon), thumb: at(t.id, t.thumb), entry: at(t.id, t.entry),
    })),
  }, null, 2) + '\n';

  const base = readJson(path.join(root, 'extension/core/manifest.base.json'));
  const withExt = tools.filter((t) => t.ext);
  const manifest = {
    ...base,
    permissions: sortedUnion(base.permissions || [], ...withExt.map((t) => t.ext.permissions)),
    host_permissions: sortedUnion(base.host_permissions || [], ...withExt.map((t) => t.ext.hosts)),
  };
  outputs['extension/manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';

  const v = (id) => 't_' + id.replace(/-/g, '_');
  outputs['extension/routes.gen.js'] = GEN_HEADER
    + withExt.map((t) => `import * as ${v(t.id)} from './tools/${t.id}.js';\n`).join('')
    + `export const toolOps = {${withExt.map((t) => ` '${t.id}': ${v(t.id)}`).join(',')}${withExt.length ? ' ' : ''}};\n`;
  for (const t of withExt) {
    outputs[`extension/tools/${t.id}.js`] = fs.readFileSync(path.join(toolsDir, t.id, t.ext.background), 'utf8');
  }

  const withApi = tools.filter((t) => t.api);
  outputs['server/routes.gen.js'] = GEN_HEADER
    + withApi.map((t) => `import * as ${v(t.id)} from '../tools/${t.id}/${t.api}';\n`).join('')
    + `export const toolRoutes = {${withApi.map((t) => ` '${t.id}': ${v(t.id)}`).join(',')}${withApi.length ? ' ' : ''}};\n`;

  // extension/tools/ 只能有這次產生的檔案
  const extToolsDir = path.join(root, 'extension/tools');
  const stale = fs.existsSync(extToolsDir)
    ? fs.readdirSync(extToolsDir).map((f) => `extension/tools/${f}`).filter((rel) => !(rel in outputs))
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
  }
  return { errors, outputs };
}

module.exports = { build };

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
