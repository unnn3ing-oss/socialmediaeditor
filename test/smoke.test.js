const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('./helpers/serve.js');

const ROOT = path.join(__dirname, '..');

test('serve returns files with mime and 404 for missing', async () => {
  const srv = await serve(ROOT);
  try {
    const ok = await fetch(srv.url + 'package.json');
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /json/);
    const miss = await fetch(srv.url + 'nope');
    assert.equal(miss.status, 404);
    const esc = await fetch(srv.url + '..%2f..%2fetc%2fpasswd');
    assert.equal(esc.status, 404);
  } finally {
    await srv.close();
  }
});
