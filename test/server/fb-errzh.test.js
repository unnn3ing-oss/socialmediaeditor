const test = require('node:test');
const assert = require('node:assert');

test('臉書錯誤碼轉中文', async () => {
  const { zhError } = await import('../../server/fb/errzh.js');
  assert.strictEqual(zhError(190, 463, 'Error validating access token: Session has expired'), '權杖已過期，請到管理頁更新權杖（臉書碼 190-463）');
  assert.strictEqual(zhError(190, 0, 'x'), '權杖失效或過期，請到管理頁更新權杖（臉書碼 190）');
  assert.strictEqual(zhError(100, 0, '(#100) Invalid cursor'), '翻頁位置失效，請重新整理後再查（臉書碼 100）');
  assert.strictEqual(zhError(100, 33, 'Unsupported get request.'), '找不到這個物件（可能已刪除或沒有權限）（臉書碼 100-33）');
  assert.strictEqual(zhError(368, 1390008, 'The action attempted has been deemed abusive'), '被臉書判定為濫用或違反社群守則，暫時封鎖這個動作（臉書碼 368-1390008）');
  assert.strictEqual(zhError(200, 0, '(#200) Permissions error'), '權限不足（缺少粉專發文或管理權限）（臉書碼 200）');
  assert.strictEqual(zhError(32, 0, 'Page request limit reached'), '粉專呼叫太頻繁，臉書暫時限流（臉書碼 32）');
  assert.strictEqual(zhError(9999, 0, 'Something new'), '臉書回應錯誤（臉書碼 9999）：Something new');
});

test('graph() 丟出中文訊息並保留原文', async () => {
  const { installFetch, gErr } = require('../helpers/fake-fb.js');
  const { graph, GraphError } = await import('../../server/fb/graph.js');
  const f = installFetch({ 'GET /me': () => Response.json({ error: { code: 506, message: 'Duplicate status message' } }, { status: 400 }) });
  try {
    await assert.rejects(graph({}, 'GET', '/me', {}, 'tok'), (e) => e instanceof GraphError && e.code === 506
      && e.message === '重複貼文：臉書不接受和剛才相同的內容（臉書碼 506）' && e.raw === 'Duplicate status message');
  } finally { f.restore(); }
  void gErr;
});

test('影片處理失敗原文轉中文', async () => {
  const { stateFromStatus } = await import('../../server/fb/video.js');
  assert.deepStrictEqual(stateFromStatus({ video_status: 'error', processing_phase: { status: 'error', error: { message: 'Video too short' } } }),
    { state: 'failed', error: '臉書處理影片失敗：Video too short' });
  assert.deepStrictEqual(stateFromStatus({ video_status: 'error', processing_phase: { status: 'error', error: { code: 352, message: 'bad format' } } }),
    { state: 'failed', error: '影片格式不支援（臉書碼 352）' });
});
