// 粉專 ID → 管理頁「粉專設定」的簡稱（錯誤日誌、操作紀錄共用）
//   讀取時才對照：資料照舊只存 ID，改簡稱舊紀錄跟著變；對不到就不加 pageName（前端顯示 ID）
import { all } from './db.js';

export async function withPageNames(env, rows) {
  if (!rows.some((r) => r.page)) return rows;
  let names = new Map();
  try { names = new Map((await all(env, 'SELECT id, short FROM fb_pages')).map((r) => [String(r.id), r.short])); } catch { /* 還沒有粉專表 */ }
  return rows.map((r) => (r.page && names.get(String(r.page)) ? { ...r, pageName: names.get(String(r.page)) } : r));
}
