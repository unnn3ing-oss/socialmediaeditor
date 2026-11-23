// 留言失敗通知清單（首頁帳號彈窗 shell/company.js 與管理頁頁首 admin/header.js 共用）
//   資料：GET /staff/me/notices（只查 D1）。狀態：open＝未處理（紅）；handled＝發文者按完成或已補留言（只有看全部的人看得到，黃）
//   完成：POST /staff/me/notices/read。發文者＝自己處理完；系統管理者／notify＝結案（未處理的也直接結案）
const mk = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
export function fmtNoteTime(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
// 帳號框外觀：有未處理＝紅色光暈閃爍；只有已處理＝黃色外框（不閃）
export function paintAlert(button, items) {
  const red = items.filter((n) => n.state !== 'handled').length;
  const yellow = items.length - red;
  button.classList.toggle('acct-alert', red > 0);
  button.classList.toggle('acct-warn', red === 0 && yellow > 0);
  const old = button.querySelector('.sr-only');
  if (old) old.remove();
  if (items.length) button.append(mk('span', 'sr-only', red ? `，有 ${red} 則未處理通知` : `，有 ${yellow} 則已處理通知待確認`));
}

// openTool(kind)：kind＝'post'／'video'；toast(text)：顯示提示；onChange(items)：清單變動（給帳號框上色）
export function createNotices({ api, openTool, toast = () => {}, onChange = () => {} }) {
  const section = mk('div', 'acct-sec');
  const empty = mk('div', 'acct-empty', '目前沒有通知');
  const list = mk('ul', 'acct-notes');
  list.hidden = true;
  const scope = mk('small', 'acct-scope', '');
  const h = mk('h3', null, '通知');
  h.append(scope);
  section.append(h, empty, list);
  let items = [];
  let all = false;
  let req = 0;

  function drop(n) { items = items.filter((x) => x !== n); render(); onChange(items); }
  function render() {
    scope.textContent = all ? '（全部人的留言失敗）' : '（你發的貼文）';
    list.textContent = '';
    empty.hidden = items.length > 0;
    list.hidden = !items.length;
    for (const n of items) {
      const done = n.state === 'handled';
      const li = mk('li', 'acct-note' + (done ? ' is-handled' : ''));
      const top = mk('div', 'acct-note-top');
      top.append(mk('b', null, `${n.pageName}｜第 ${n.seq} 則留言${n.failed ? '失敗' : '重試中'}`), mk('small', null, fmtNoteTime(n.at)));
      li.append(top);
      if (n.title) { const tt = mk('div', 'acct-note-title', n.title); tt.title = n.title; li.append(tt); }
      if (n.error) { const er = mk('div', 'acct-note-err', n.error); er.title = n.error; li.append(er); }
      // 發文者處理過（只有看全部的人看得到）：誰、怎麼處理、何時
      if (done) li.append(mk('div', 'acct-note-who', `${n.hname || n.hby || '發文者'} ${n.how === 'retry' ? '已補留言' : '已完成'}・${fmtNoteTime(n.hat)}`));
      // 按鈕一列：重留言／看貼文（另開分頁）／看列表（原頁切換）／完成
      const acts = mk('div', 'acct-note-act');
      if (n.canRetry && !done) {
        const rb = mk('button', 'btn btn-secondary btn-sm', '重留言');
        rb.type = 'button';
        rb.addEventListener('click', async () => {
          rb.disabled = true;
          try {
            await api.call('/fb/comment/retry', { method: 'POST', body: { postId: n.postId, page: n.page } });
            toast('已要求重新留言，稍後會再試一次');
            if (all) load(); else drop(n);   // 看全部的人：重讀，這則會變成「已補留言」
          } catch (ex) { rb.disabled = false; toast((ex && ex.message) || '重新留言失敗'); }
        });
        acts.append(rb);
      }
      if (/^\d{1,30}(_\d{1,30})?$/.test(String(n.postId || ''))) {
        const op = mk('a', 'btn btn-secondary btn-sm', '看貼文');
        op.href = 'https://www.facebook.com/' + n.postId;
        op.target = '_blank'; op.rel = 'noopener noreferrer';
        op.setAttribute('aria-label', '看貼文（另開分頁）');
        acts.append(op);
      }
      const go = mk('button', 'btn btn-secondary btn-sm', '看列表');
      go.type = 'button';
      go.title = n.kind === 'video' ? '開影片發布' : '開排程發布的已發佈列表';
      go.setAttribute('aria-label', n.kind === 'video' ? '看列表（影片發布）' : '看列表（排程發布）');
      go.addEventListener('click', () => openTool(n.kind === 'video' ? 'video' : 'post'));
      acts.append(go);
      const rd = mk('button', 'btn btn-secondary btn-sm acct-done', '完成');
      rd.type = 'button';
      rd.title = all ? '結案：大家的通知都收掉' : '我處理好了，收掉這則通知';
      rd.addEventListener('click', async () => {
        rd.disabled = true;
        try {
          await api.call('/staff/me/notices/read', { method: 'POST', body: { postId: n.postId } });
          drop(n);
        } catch (ex) {
          if (ex && ex.code === 'not_found') { drop(n); return; }   // 別人已經結案
          rd.disabled = false; toast((ex && ex.message) || '標記完成失敗');
        }
      });
      acts.append(rd);
      li.append(acts);
      list.append(li);
    }
  }
  async function load() {
    const my = ++req;
    try {
      const d = await api.call('/staff/me/notices');
      if (my !== req) return items;
      items = (d && d.enabled && Array.isArray(d.items)) ? d.items : [];
      all = !!(d && d.all);
    } catch { return items; /* 讀不到維持原本 */ }
    render();
    onChange(items);
    return items;
  }
  function clear() { req++; items = []; render(); onChange(items); }
  render();
  return { section, load, clear, items: () => items };
}
