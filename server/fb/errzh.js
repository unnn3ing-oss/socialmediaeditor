// 臉書錯誤訊息轉中文（2026-11-23）：依錯誤碼／子碼對照；對照不到＝「臉書回應錯誤（臉書碼 N）：原文」
//   程式判斷一律看錯誤碼（isRateLimit、isTokenError…），不看文字，所以改中文不影響邏輯。原文另存 GraphError.raw。
const TOKEN_SUB = {
  458: '使用者已移除這個 App 的授權',
  459: '使用者帳號需要到臉書確認身分',
  460: '使用者改過密碼，權杖已失效',
  463: '權杖已過期',
  464: '使用者帳號未驗證',
  467: '權杖無效'
};
const CODES = {
  1: '臉書暫時發生未知錯誤，請稍後再試',
  2: '臉書服務暫時無法使用，請稍後再試',
  3: '這個 App 沒有使用這項功能的權限',
  4: 'App 呼叫太頻繁，臉書暫時限流',
  10: '權限不足，App 沒有這項權限',
  12: '臉書已停用這項功能',
  17: '使用者帳號呼叫太頻繁，臉書暫時限流',
  32: '粉專呼叫太頻繁，臉書暫時限流',
  102: '登入工作階段已失效，請到管理頁更新權杖',
  190: '權杖失效或過期，請到管理頁更新權杖',
  341: '已達臉書發文上限，請稍後再試',
  368: '被臉書判定為濫用或違反社群守則，暫時封鎖這個動作',
  324: '缺少圖片檔，或圖片格式不符',
  351: '影片檔有問題，臉書無法讀取',
  352: '影片格式不支援',
  382: '影片檔太小',
  506: '重複貼文：臉書不接受和剛才相同的內容',
  613: '呼叫太頻繁，臉書暫時限流',
  803: '找不到這個物件（可能已刪除或沒有權限）',
  6000: '影片上傳失敗',
  6001: '影片上傳失敗，請重新上傳',
  80001: '粉專流量超過上限，臉書暫時限流'
};
function zh100(subcode, raw) {
  if (/invalid cursor/i.test(raw)) return '翻頁位置失效，請重新整理後再查';
  if (subcode === 33 || /does not exist|cannot be loaded due to missing permissions/i.test(raw)) return '找不到這個物件（可能已刪除或沒有權限）';
  if (/scheduled publish time/i.test(raw)) return '排程時間不在允許範圍（至少 10 分鐘後、30 天內）';
  if (/too long|exceeds/i.test(raw)) return '內容太長';
  return '參數不正確';
}
export function zhError(code, subcode, raw) {
  raw = String(raw || '');
  const c = Number(code);
  const sub = Number(subcode) || 0;
  let zh = null;
  if (c === 190 && TOKEN_SUB[sub]) zh = TOKEN_SUB[sub] + '，請到管理頁更新權杖';
  else if (c === 100) zh = zh100(sub, raw);
  else if (c >= 200 && c <= 299) zh = '權限不足（缺少粉專發文或管理權限）';
  else if (CODES[c]) zh = CODES[c];
  const tag = c > 0 ? '（臉書碼 ' + c + (sub ? '-' + sub : '') + '）' : '';
  if (zh) return zh + tag;
  return '臉書回應錯誤' + tag + (raw ? '：' + raw : '');
}
