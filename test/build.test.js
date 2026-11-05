const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { build } = require('../build.js');

// 把 repo 複製到暫存資料夾（排除 .git、node_modules），所有測試都在副本上跑
function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbx-build-'));
  fs.cpSync(ROOT, dir, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(src) });
  return dir;
}
const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const writeJson = (root, rel, v) => fs.writeFileSync(path.join(root, rel), JSON.stringify(v, null, 2));

test('builds catalog for registry tools', async () => {
  const root = tmpRepo();
  const { errors } = await build(root);
  assert.deepEqual(errors, []);
  const cat = readJson(root, 'shell/catalog.json');
  assert.deepEqual(cat.tools.map((t) => t.id), ['sample']);
  assert.equal(cat.tools[0].entry, 'tools/sample/index.html');
  assert.equal(cat.tools[0].thumb, 'tools/sample/thumb.svg');
});

test('merges ext permissions and copies ext.js', async () => {
  const root = tmpRepo();
  const t = readJson(root, 'tools/sample/tool.json');
  t.ext = { permissions: ['cookies', 'storage'], hosts: ['https://example.com/*'], background: 'ext.js' };
  writeJson(root, 'tools/sample/tool.json', t);
  fs.writeFileSync(path.join(root, 'tools/sample/ext.js'), 'export const ops = {};\n');
  const { errors } = await build(root);
  assert.deepEqual(errors, []);
  const m = readJson(root, 'extension/manifest.json');
  assert.ok(m.permissions.includes('cookies'));
  assert.equal(m.permissions.filter((p) => p === 'storage').length, 1);
  assert.ok(m.host_permissions.includes('https://example.com/*'));
  assert.ok(fs.existsSync(path.join(root, 'extension/tools/sample.js')));
  assert.match(fs.readFileSync(path.join(root, 'extension/routes.gen.js'), 'utf8'), /'sample': t_sample/);
});

test('api module is wired into server routes', async () => {
  const root = tmpRepo();
  const t = readJson(root, 'tools/sample/tool.json');
  t.api = 'api.js';
  writeJson(root, 'tools/sample/tool.json', t);
  fs.writeFileSync(path.join(root, 'tools/sample/api.js'), 'export async function handle() {}\n');
  await build(root);
  assert.match(fs.readFileSync(path.join(root, 'server/routes.gen.js'), 'utf8'), /from '\.\.\/tools\/sample\/api\.js'/);
});

test('invalid tool writes nothing', async () => {
  const root = tmpRepo();
  for (const f of ['shell/catalog.json', 'extension/manifest.json']) fs.rmSync(path.join(root, f), { force: true });
  const t = readJson(root, 'tools/sample/tool.json');
  t.tier = 'vip';
  writeJson(root, 'tools/sample/tool.json', t);
  const { errors } = await build(root);
  assert.ok(errors.length > 0);
  assert.equal(fs.existsSync(path.join(root, 'shell/catalog.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'extension/manifest.json')), false);
});

test('check mode reports stale outputs', async () => {
  const root = tmpRepo();
  await build(root);
  assert.deepEqual((await build(root, { check: true })).errors, []);
  const t = readJson(root, 'tools/sample/tool.json');
  t.name = '改名的範例';
  writeJson(root, 'tools/sample/tool.json', t);
  const { errors } = await build(root, { check: true });
  assert.ok(errors.some((e) => e.includes('過期')), JSON.stringify(errors));
});

test('removing from registry empties catalog and removes copied ext', async () => {
  const root = tmpRepo();
  const t = readJson(root, 'tools/sample/tool.json');
  t.ext = { permissions: [], hosts: [], background: 'ext.js' };
  writeJson(root, 'tools/sample/tool.json', t);
  fs.writeFileSync(path.join(root, 'tools/sample/ext.js'), 'export const ops = {};\n');
  await build(root);
  writeJson(root, 'tools/registry.json', []);
  const { errors } = await build(root);
  assert.deepEqual(errors, []);
  assert.deepEqual(readJson(root, 'shell/catalog.json').tools, []);
  assert.equal(fs.existsSync(path.join(root, 'extension/tools/sample.js')), false);
  assert.match(fs.readFileSync(path.join(root, 'extension/routes.gen.js'), 'utf8'), /toolOps = \{\}/);
});

test('外掛版號：Chrome 用的 version 去掉開頭的 0，version_name 保留 X.YZ', async () => {
  const { chromeVersion } = require('../build.js');
  assert.equal(chromeVersion('1.00'), '1.0');
  assert.equal(chromeVersion('1.05'), '1.5');
  assert.equal(chromeVersion('1.53'), '1.53');
  assert.equal(chromeVersion('2.10'), '2.10');
  const root = tmpRepo();
  await build(root);
  const base = readJson(root, 'extension/core/manifest.base.json');
  const m = readJson(root, 'extension/manifest.json');
  assert.equal(m.version_name, base.version);
  assert.equal(m.version, chromeVersion(base.version));
  for (const part of m.version.split('.')) assert.ok(part === '0' || !part.startsWith('0'), m.version);
});
