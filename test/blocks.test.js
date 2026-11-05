const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../build.js');

const ROOT = path.join(__dirname, '..');
const CORE = ['shell', 'sdk', 'ui', 'server/core', 'extension/core', 'index.html'];
const IGNORE = new Set(['shell/catalog.json']);

function snapshot(root) {
  const out = {};
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) {
      for (const n of fs.readdirSync(abs)) walk(path.posix.join(rel, n));
    } else if (!IGNORE.has(rel)) {
      out[rel] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    }
  };
  CORE.forEach(walk);
  return out;
}

test('adding and removing a tool touches no core file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tbx-blocks-'));
  fs.cpSync(ROOT, root, {
    recursive: true,
    filter: (src) => !/^(\.git|\.claude|node_modules)([\\/]|$)/.test(path.relative(ROOT, src)),
  });
  const before = snapshot(root);
  assert.ok(Object.keys(before).length > 10, '核心檔案快照不該是空的');

  const registryPath = path.join(root, 'tools/registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

  fs.cpSync(path.join(root, 'tools/_template'), path.join(root, 'tools/zz-demo'), { recursive: true });
  const toolPath = path.join(root, 'tools/zz-demo/tool.json');
  const tool = JSON.parse(fs.readFileSync(toolPath, 'utf8'));
  tool.id = 'zz-demo';
  tool.name = '示範新增';
  fs.writeFileSync(toolPath, JSON.stringify(tool, null, 2));
  fs.writeFileSync(registryPath, JSON.stringify([...registry, 'zz-demo'], null, 2));

  let res = await build(root);
  assert.deepEqual(res.errors, []);
  let catalog = JSON.parse(fs.readFileSync(path.join(root, 'shell/catalog.json'), 'utf8'));
  assert.ok(catalog.tools.some((t) => t.id === 'zz-demo'));
  assert.deepEqual(snapshot(root), before);

  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  res = await build(root);
  assert.deepEqual(res.errors, []);
  catalog = JSON.parse(fs.readFileSync(path.join(root, 'shell/catalog.json'), 'utf8'));
  assert.ok(!catalog.tools.some((t) => t.id === 'zz-demo'));
  assert.deepEqual(snapshot(root), before);
});
