// 防 AI／搜尋收錄（2026-11-26）：網站每一頁（完整 HTML 文件）都要有 robots meta
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'test', 'docs', 'extension', 'test-results']);
function pages(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) pages(path.join(dir, e.name), out); }
    else if (e.name.endsWith('.html')) out.push(path.join(dir, e.name));
  }
  return out;
}

test('每一頁都有 noindex, nofollow, noai, noimageai', () => {
  const list = pages(ROOT).filter((f) => /<!doctype html/i.test(fs.readFileSync(f, 'utf8')));
  assert.ok(list.length >= 15, '找得到網站頁面');
  for (const f of list) {
    assert.match(fs.readFileSync(f, 'utf8'), /<meta name="robots" content="noindex, nofollow, noai, noimageai">/, path.relative(ROOT, f));
  }
});
