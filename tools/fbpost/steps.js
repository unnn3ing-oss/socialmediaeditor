// 手機版（≤820px、不是外掛側邊欄）新增發文分兩步：① 編輯（底部：取消發文／下一步）② 選粉專＋RD（底部：上一步／送出貼文）
//   用 .post.step2 切換（隱藏切換，內容保留）；樣式全在 fbpost.css 的手機區段，電腦版與側邊欄不受影響
//   ② 時把送出結果 #results 搬到底部區塊（失敗時看得到各粉專結果），回 ① 再搬回原位
import { $, confirmBox, stripLead } from './util.js';

const mq = matchMedia('(max-width: 820px)');
export const stepMode = () => mq.matches && !document.documentElement.classList.contains('is-side');

const MODE = { image: '照片套圖', color: '純文字圖', text: '純文字' };
const FRAME = { news: '新聞框', entertainment: '娛樂框', generic: '套版' };

// composer、sender、dialog 由 app 第一次開新增發文時傳進來
export function createSteps({ composer, sender, dialog }) {
  const post = $('tab-new'), res = $('results'), home = res.parentElement, after = res.nextSibling;
  const title = $('postTitle');
  function summary() {
    const s = composer.snapshot();
    const parts = [MODE[s.mode] || ''];
    if (s.mode === 'image') parts.push(s.frame === 'photo' ? `圖片 ${(s.photos || []).length} 張` : FRAME[s.frame] || '');
    const t = (s.mode === 'text' ? composer.text() : s.title).replace(/\s+/g, ' ').trim();
    if (t) parts.push([...t].length > 24 ? [...t].slice(0, 24).join('') + '…' : t);
    return parts.filter(Boolean).join('・');
  }
  function set(step) {
    const two = step === 2 && stepMode();
    post.classList.toggle('step2', two);
    title.textContent = two ? '選擇發布粉專' : '新增發文';
    if (two) { $('mSum').textContent = summary(); $('postFoot').append(res); }
    else if (res.parentElement !== home) home.insertBefore(res, after && after.parentElement === home ? after : null);
    sender.updateButton();
  }
  // 有沒有輸入任何內容（網址、照片、標題、內文、留言、額外留言、警語）
  function hasContent() {
    const s = composer.snapshot();
    if (s.link || s.title.trim() || stripLead($('msg').value).trim() || s.photo || (s.photos && s.photos.length)) return true;
    if ($('lead').value.trim() || !$('warnBox').hidden) return true;
    return [...document.querySelectorAll('#extras textarea')].some((t) => t.value.trim());
  }
  $('mNext').addEventListener('click', () => { set(2); const c = document.querySelector('#pages .chip button'); if (c) c.focus({ preventScroll: true }); });
  $('mBack').addEventListener('click', () => { set(1); $('mNext').focus({ preventScroll: true }); });
  $('mCancel').addEventListener('click', async () => {
    if (hasContent() && !(await confirmBox('取消這則發文？', '網址、照片、標題、貼文內容都會清掉，回到列表。', { yes: '取消發文', no: '繼續編輯', danger: true }))) return;
    sender.clearAll(); set(1); dialog.close();
  });
  document.addEventListener('fbpost:cleared', () => set(1));   // 清空（送出完成、再發一次、幫直出）回 ①
  mq.addEventListener('change', () => set(1));                 // 轉成電腦寬度：回一頁式
  return { reset: () => set(1) };
}
