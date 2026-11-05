const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const load = () => import('../shell/contract.js');
const template = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/_template/tool.json'), 'utf8'));
// ctx：預設所有檔案與資料夾都存在、repo 裡沒有任何公司素材同名檔
const ctx = (over = {}) => ({ folderExists: () => true, fileExists: () => true, repoHasFile: () => false, ...over });
const has = (errs, word) => assert.ok(errs.some((e) => e.includes(word)), `應含「${word}」：${JSON.stringify(errs)}`);

test('template tool.json is valid', async () => {
  const { validateTool } = await load();
  assert.deepEqual(validateTool(template(), ctx()), []);
});

test('bad id', async () => {
  const { validateTool } = await load();
  has(validateTool({ ...template(), id: 'Bad_ID' }, ctx()), 'id');
});

test('bad tier', async () => {
  const { validateTool } = await load();
  has(validateTool({ ...template(), tier: 'vip' }, ctx()), 'tier');
});

test('unknown requires', async () => {
  const { validateTool } = await load();
  has(validateTool({ ...template(), requires: ['wifi'] }, ctx()), 'requires');
});

test('missing entry file', async () => {
  const { validateTool } = await load();
  const errs = validateTool(template(), ctx({ fileExists: (rel) => !rel.endsWith('index.html') }));
  has(errs, 'entry');
});

test('unsupported sdk major', async () => {
  const { validateTool } = await load();
  has(validateTool({ ...template(), sdk: 2 }, ctx()), 'sdk');
});

test('empty group', async () => {
  const { validateTool } = await load();
  has(validateTool({ ...template(), group: '' }, ctx()), 'group');
});

test('bad company asset key', async () => {
  const { validateTool } = await load();
  const t = { ...template(), assets: { logo: { company: 'TVBS Logo.svg', public: 'upload' } } };
  has(validateTool(t, ctx()), 'company');
});

test('company asset present in repo is rejected', async () => {
  const { validateTool } = await load();
  const t = { ...template(), assets: { logo: { company: 'tvbs-logo.svg', public: 'upload' } } };
  const errs = validateTool(t, ctx({ repoHasFile: (name) => name === 'tvbs-logo.svg' }));
  has(errs, '公司素材不能放進 repo');
});

test('ext shape', async () => {
  const { validateTool } = await load();
  has(validateTool({ ...template(), ext: { permissions: 'cookies' } }, ctx()), 'ext');
  assert.deepEqual(validateTool({ ...template(), ext: { permissions: ['cookies'], hosts: [], background: 'ext.js' } }, ctx()), []);
});

test('registry duplicate', async () => {
  const { validateRegistry } = await load();
  has(validateRegistry(['sample', 'sample'], ctx()), '重複');
});

test('registry missing folder', async () => {
  const { validateRegistry } = await load();
  has(validateRegistry(['ghost'], ctx({ folderExists: () => false })), 'ghost');
});

test('registry must not include template', async () => {
  const { validateRegistry } = await load();
  has(validateRegistry(['_template'], ctx()), '範本');
});
