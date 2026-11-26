// 管理後台（admin/index.html）。
//   進入方式：首頁登入的公司憑證（localStorage，員工編號＋密碼）直接進；或在這裡輸入管理員密碼（admin 憑證只放記憶體）。
//   可見卡片依 GET /admin/me 的 cards（卡片由權限組決定，見 server/core/adminperm.js）；敏感卡片要輸入管理員密碼解鎖。
import { API_BASE, API_ENV } from '../shell/config.js';
import { companyKey } from '../sdk/api.js';
import { fbPostUrl } from '../shell/notices.js';

// 不讓別的網站把後台嵌進框架（GitHub Pages 不能設 x-frame-options）
if (window.top !== window.self) {
  document.documentElement.textContent = '';
  try { window.top.location = window.self.location.href; } catch (e) { /* 跨網域擋下就維持空白 */ }
  throw new Error('framed');
}

(function () {
  if (API_ENV === 'dev') document.getElementById('envTag').hidden = false;
  var token = '';
  var pending = '';
  var me = null;          // GET /admin/me：{ role, roleName, unlocked, cards, name, id? }
  var frontToken = '';    // 首頁登入的憑證（有的話）
  function can(k) { return !!me && me.cards.indexOf(k) >= 0; }
  function readFront() {
    try {
      var v = JSON.parse(localStorage.getItem(companyKey(API_ENV)));
      if (v && typeof v.token === 'string' && typeof v.exp === 'number' && v.exp * 1000 > Date.now()) return v.token;
    } catch (e) { /* 沒有 */ }
    return '';
  }
  var $ = function (id) { return document.getElementById(id); };

  function say(el, text, kind) { el.textContent = text || ''; el.className = 'msg' + (kind ? ' ' + kind : ''); }
  // 按鈕回饋（ui/fx.js 的 window.tbxFx，點擊當下才讀；沒載到就退回只鎖按鈕）
  function fxStart(btn, text) {
    if (btn._fxBack == null) btn._fxBack = btn.textContent;
    if (window.tbxFx) window.tbxFx.busy(btn, text); else btn.disabled = true;
  }
  function fxDone(btn, ok, okText) {
    var back = btn._fxBack == null ? btn.textContent : btn._fxBack; btn._fxBack = null;
    var f = window.tbxFx;
    if (!f) { btn.disabled = false; return; }
    if (ok === true) f.ok(btn, okText || '完成', back); else if (ok === false) f.fail(btn, back); else f.idle(btn, back);
  }
  // 結果看旁邊訊息的顏色（good／err），其他（例如登入過期）只恢復按鈕
  function fxEnd(btn, msgEl, okText) {
    var c = msgEl && msgEl.classList;
    fxDone(btn, c && c.contains('good') ? true : c && c.contains('err') ? false : null, okText);
  }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, token ? { Authorization: 'Bearer ' + token } : {});
    return fetch(API_BASE + path, opts).then(function (r) { return r.json(); });
  }
  function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B'; }
  function fmtTime(ms) {
    var d = new Date(ms), p = function (v) { return String(v).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  // 相對時間：剛剛／N 分鐘前／今天 HH:MM／M/D HH:MM（游標看 fmtTime 完整時間）
  function fmtShort(ms) {
    var d = new Date(ms), p = function (v) { return String(v).padStart(2, '0'); };
    return d.getFullYear() === new Date().getFullYear() ? (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) : fmtTime(ms);
  }
  function fmtAgo(ms, now) {
    now = now || Date.now();
    var m = Math.floor((now - ms) / 60000), d = new Date(ms), n = new Date(now), p = function (v) { return String(v).padStart(2, '0'); };
    if (m < 1) return '剛剛';
    if (m < 60) return m + ' 分鐘前';
    var hm = p(d.getHours()) + ':' + p(d.getMinutes());
    if (d.toDateString() === n.toDateString()) return '今天 ' + hm;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  }
  function expired() {
    // 解鎖用的管理員憑證過期：退回首頁憑證（重新鎖住），不用整個登出
    if (frontToken && token !== frontToken) { token = frontToken; enter($('loginMsg')).then(function (ok) { if (ok) say($('unlockMsg'), '解鎖已過期，需要時請再輸入一次管理員密碼。', 'err'); else expired(); }); return; }
    var front = token && token === frontToken;
    signOut();
    say($('loginMsg'), front ? '首頁的登入已過期或已停用，請回工具箱首頁重新登入，或在這裡輸入管理員密碼。' : '登入已過期，請重新登入。', 'err');
  }

  // ---- 身分與可見卡片 ----
  var SECTIONS = Array.prototype.slice.call(document.querySelectorAll('[data-card]'));
  function applyMe() {
    SECTIONS.forEach(function (el) { el.hidden = !can(el.getAttribute('data-card')); });
    TABS.forEach(function (t) {
      if (t === 'home') return;
      var vis = Array.prototype.some.call($('panel-' + t).querySelectorAll('[data-card]'), function (el) { return !el.hidden; });
      $('tab-' + t).hidden = !vis;
    });
    // 進階設定：只有系統管理者看得到；沒解鎖時分類內只顯示密碼輸入
    $('tab-adv').hidden = me.role !== 'sys';
    // 首頁儀表板：可看的項目（me.dash）有一項以上才顯示
    $('tab-home').hidden = !(me.dash && me.dash.length);
    $('olCard').hidden = !(me.role === 'sys' && can('staff'));   // 目前在線：只有系統管理者
    $('msCard').hidden = me.role !== 'sys';   // 發送通知：只有系統管理者（不用解鎖）
    $('unlockBar').hidden = !(me.role === 'sys' && !me.unlocked);
    subApply();
    $('whoTag').hidden = false;
    $('whoTag').textContent = (me.role === 'sys' ? '' : me.name + '・') + me.roleName + (me.role === 'sys' && !me.unlocked ? '（進階設定已鎖）' : '');
    // 首頁憑證進來且沒解鎖：不顯示（「回工具箱」就是離開）；解鎖過＝鎖定；管理密碼登入＝登出
    $('logout').hidden = !!frontToken && token === frontToken;
    $('logout').textContent = frontToken ? '鎖定' : '登出';
  }
  function resetLoaded() { msLoaded = false; fbLoaded = false; rdLoaded = false; staffLoaded = false; assetsLoaded = false; sfState = null; dashLoaded = false; dcLoaded = false; labLoaded = false; tvLoaded = false; }
  // 用目前的 token 讀身分；成功就進入管理頁
  function enter(msgEl) {
    return api('/admin/me').then(function (res) {
      if (!res.ok) {
        if (res.code === 'forbidden') { say(msgEl, '你的權限組在管理頁沒有任何可用的卡片。', 'err'); return false; }
        if (res.code === 'unauthorized') return false;
        say(msgEl, res.error || '讀取身分失敗。', 'err'); return false;
      }
      me = res.data; resetLoaded();
      $('login').hidden = true; $('app').hidden = false; say($('loginMsg'), '');
      applyMe(); showHash();
      return true;
    });
  }

  function load() {
    $('listCard').setAttribute('aria-busy', 'true');
    $('skel').hidden = false; $('tableWrap').hidden = true; $('empty').hidden = true;
    api('/admin/assets').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      var tb = $('rows'); tb.textContent = '';
      res.data.forEach(function (a) {
        var tr = document.createElement('tr');
        function td(text, cls) { var c = document.createElement('td'); c.textContent = text; if (cls) c.className = cls; tr.appendChild(c); return c; }
        td(a.key);
        var tc = document.createElement('td'), tag = document.createElement('span');
        tag.className = 'tag ' + a.tier; tag.textContent = a.tier === 'company' ? '公司專屬' : '公開'; tc.appendChild(tag); tr.appendChild(tc);
        td(fmtSize(a.size), 'num'); td(fmtTime(a.updated), 'num');
        var ac = document.createElement('td');
        var rep = document.createElement('button'); rep.type = 'button'; rep.textContent = '替換';
        rep.onclick = function () { $('key').value = a.key; $('tier').value = a.tier; $('file').focus(); say($('upMsg'), '請選擇要替換的檔案，再按「上傳」。'); $('upCard').scrollIntoView({ block: 'start' }); };
        var del = document.createElement('button'); del.type = 'button'; del.className = 'danger'; del.textContent = '刪除';
        del.style.marginLeft = '8px';
        del.onclick = function () { pending = a.key; $('cfText').textContent = '「' + a.key + '」會從後端移除，用到它的工具會找不到這個素材。這個動作無法復原。'; $('confirm').hidden = false; $('cfYes').focus(); };
        ac.appendChild(rep); ac.appendChild(del); tr.appendChild(ac);
        tb.appendChild(tr);
      });
      $('tableWrap').hidden = !res.data.length; $('empty').hidden = !!res.data.length;
      say($('listMsg'), '');
    }).catch(function () {
      assetsLoaded = false;   // 下次切到素材分類再讀一次
      say($('listMsg'), '讀取清單失敗，請切換分類再回來或重新整理。', 'err');
    }).then(function () {
      $('skel').hidden = true; $('listCard').setAttribute('aria-busy', 'false');
    });
  }

  $('loginForm').onsubmit = function (e) {
    e.preventDefault();
    fxStart($('loginBtn'), '登入中'); say($('loginMsg'), '登入中');
    api('/admin/login', { method: 'POST', body: JSON.stringify({ password: $('pw').value }) }).then(function (res) {
      if (res.ok) { token = res.data.token; $('pw').value = ''; return enter($('loginMsg')); }
      say($('loginMsg'), res.code === 'bad_password' ? '密碼不正確。' : (res.error || '登入失敗。'), 'err');
    }).catch(function () { say($('loginMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { fxEnd($('loginBtn'), $('loginMsg'), '已登入'); if ($('loginMsg').classList.contains('err') && window.tbxFx) window.tbxFx.shake($('pw')); });
  };

  // 選檔案自動帶素材名稱：去副檔名、小寫、不合法的字元換成 -；只在名稱空白或上次是自動帶入時才覆蓋（「替換」或手打的不動）
  var autoKey = '';
  $('file').onchange = function () {
    var f = $('file').files[0]; if (!f) return;
    var cur = $('key').value.trim();
    if (cur && cur !== autoKey) return;
    var k = f.name.replace(/[.][^.]*$/, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').replace(/-+$/, '').slice(0, 64);
    $('key').value = k; autoKey = k;
  };
  $('upForm').onsubmit = function (e) {
    e.preventDefault();
    var f = $('file').files[0], key = $('key').value.trim();
    if (!f) return say($('upMsg'), '請先選擇檔案。', 'err');
    fxStart($('upBtn'), '上傳中'); say($('upMsg'), '上傳中');
    api('/admin/assets/' + encodeURIComponent(key), { method: 'PUT', headers: { 'X-Tier': $('tier').value }, body: f }).then(function (res) {
      if (res.ok) { say($('upMsg'), '已上傳「' + key + '」。', 'good'); $('file').value = ''; load(); }
      else if (res.code === 'unauthorized') expired();
      else say($('upMsg'), res.error || '上傳失敗。', 'err');
    }).catch(function () { say($('upMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { fxEnd($('upBtn'), $('upMsg'), '已上傳'); });
  };

  $('cfNo').onclick = function () { pending = ''; $('confirm').hidden = true; };
  $('cfYes').onclick = function () {
    var key = pending; if (!key) return;
    fxStart($('cfYes'), '刪除中');
    api('/admin/assets/' + encodeURIComponent(key), { method: 'DELETE' }).then(function (res) {
      $('confirm').hidden = true; pending = '';
      if (res.ok) { say($('listMsg'), '已刪除「' + key + '」。', 'good'); load(); }
      else if (res.code === 'unauthorized') expired();
      else say($('listMsg'), res.error || '刪除失敗。', 'err');
    }).catch(function () { say($('listMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { fxDone($('cfYes'), $('listMsg').classList.contains('good') ? true : $('listMsg').classList.contains('err') ? false : null, '已刪除'); });
  };

  // ---- 分頁（操作紀錄、錯誤紀錄共用）：每頁筆數記在瀏覽器；後端多要 1 筆判斷有沒有下一頁 ----
  var PG_KEY = 'tbx.admin.pageSize';
  function pgSize() { var n = 20; try { n = Number(localStorage.getItem(PG_KEY)) || 20; } catch (e) { /* 預設 */ } return [20, 50, 100].indexOf(n) >= 0 ? n : 20; }
  Array.prototype.forEach.call(document.querySelectorAll('.pg-size'), function (sel) {
    sel.value = String(pgSize());
    sel.addEventListener('change', function () {
      try { localStorage.setItem(PG_KEY, sel.value); } catch (e) { /* 不記 */ }
      Array.prototype.forEach.call(document.querySelectorAll('.pg-size'), function (o) { o.value = sel.value; });
    });
  });
  // load(offset, limit) → Promise<rows|null>；render(rows) 畫表格；回 { go(page) }
  var msgId = { lg: 'logMsg', au: 'auMsg' };
  function pager(prefix, load, render, emptyText) {
    var st = { page: 0, more: false, busy: false };
    function go(page) {
      if (st.busy) return Promise.resolve();
      var size = pgSize();
      st.busy = true; $(prefix + 'Prev').disabled = true; $(prefix + 'Next').disabled = true;
      return load(page * size, size + 1).then(function (rows) {
        if (!rows) return;
        st.page = page; st.more = rows.length > size;
        render(rows.slice(0, size));
        $(prefix + 'Pager').hidden = !(page > 0 || st.more);
        $(prefix + 'Page').textContent = '第 ' + (page + 1) + ' 頁';
        if (!rows.length) say($(msgId[prefix]), page ? '沒有更多了。' : emptyText);
      }).then(function () {
        st.busy = false; $(prefix + 'Prev').disabled = st.page === 0; $(prefix + 'Next').disabled = !st.more;
      });
    }
    $(prefix + 'Prev').onclick = function () { if (st.page > 0) go(st.page - 1); };
    $(prefix + 'Next').onclick = function () { if (st.more) go(st.page + 1); };
    return { go: go, reload: function () { return go(st.page); } };
  }

  // ---- 錯誤紀錄（/admin/logs）：留言失敗帶粉專、貼文摘要、類型、發布時間；狀態＝與首頁留言失敗通知同一套 ----
  var LG_TOOL = { fbpost: '排程發布', fbvideo: '影片發布' };
  var LG_TYPE = { template: '套版', textimg: '字圖', text: '文字', video: '橫式影片', reels: 'Reels' };
  function lgCode(code) {
    var m = /^comment_failed(?::(\d+))?$/.exec(code || '');
    return m ? '留言失敗' + (m[1] ? '（臉書碼 ' + m[1] + '）' : '') : code;
  }
  function lgState(r) {
    var who = r.st_name || r.st_by || '', at = r.st_at ? fmtTime(r.st_at) : '';
    if (r.st === 'open') return { cls: 'is-open', text: '未處理' };
    if (r.st === 'read') return { cls: 'is-handled', text: (who || '發文者') + ' 已完成', tip: at };
    if (r.st === 'retry') return { cls: 'is-handled', text: (who || '發文者') + ' 已補留言', tip: at };
    if (r.st === 'closed') return { cls: 'is-closed', text: '已結案', tip: (who ? who + '・' : '') + at };
    return { cls: '', text: '—' };
  }
  function lgRender(rows) {
    var tb = $('logRows'); tb.textContent = '';
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.appendChild(sfEl('td', 'num', fmtTime(r.at)));
      tr.appendChild(sfEl('td', 'lg-nw', LG_TOOL[r.tool] || r.tool));
      // 留言失敗：detail 第一行＝完整說明（含哪一步），其後「臉書原文：…」；舊紀錄 detail 只有臉書原文
      var tc = sfEl('td', 'lg-code', lgCode(r.code)), det = String(r.detail || '');
      var hasDesc = det.indexOf('臉書原文：') > 0;
      if (hasDesc) tc.appendChild(sfEl('div', 'lg-desc', det.split('\n')[0]));
      tc.title = det ? (hasDesc || det.indexOf('臉書原文：') === 0 ? det : '臉書原文：' + det) : r.code;
      tr.appendChild(tc);
      // 粉專：簡稱（完整名稱），游標移上去看 ID
      var pg = r.pageName && r.page_name && r.page_name !== r.pageName ? r.pageName + '（' + r.page_name + '）' : (r.pageName || r.page_name || r.page || '');
      var tdPg = sfEl('td', r.pageName || r.page_name ? '' : 'num', pg); if (r.page) tdPg.title = '粉專 ID ' + r.page; tr.appendChild(tdPg);
      // 貼文：摘要／類型・發布時間／開啟貼文
      var tp = document.createElement('td');
      if (r.post) {
        tp.className = 'lg-post';
        if (r.title) { var tt = sfEl('div', 'lg-title', r.title); tt.title = r.title; tp.appendChild(tt); }
        var meta = [LG_TYPE[r.ptype] || '', r.pub_at ? '發布 ' + fmtTime(r.pub_at * 1000) : ''].filter(Boolean).join('・');
        if (meta) tp.appendChild(sfEl('div', 'lg-meta', meta));
        if (/^\d{1,30}(_\d{1,30})?$/.test(r.post)) {
          var a = document.createElement('a'); a.className = 'au-open'; a.href = fbPostUrl(r.post); a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.textContent = '開啟貼文 ↗'; a.title = r.post; a.setAttribute('aria-label', '開啟貼文 ' + r.post + '（另開分頁）');
          tp.appendChild(a);
        }
      } else tp.textContent = '—';
      tr.appendChild(tp);
      // 狀態＋完成（結案）
      var ts = document.createElement('td'), stv = lgState(r);
      var chip = sfEl('span', 'lg-st ' + stv.cls, stv.text); if (stv.tip) chip.title = stv.tip; ts.appendChild(chip);
      if (r.st !== 'closed') {
        var rb = sfEl('button', 'lg-read', '完成'); rb.type = 'button';
        rb.title = r.post ? '結案：首頁的留言失敗通知也一起收掉' : '標記已處理';
        rb.onclick = function () {
          fxStart(rb, '處理中');
          api('/admin/logs/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: r.id }) }).then(function (res) {
            if (!res.ok) { if (res.code === 'unauthorized') return expired(); fxDone(rb, false); say($('logMsg'), res.error || '標記失敗。', 'err'); return; }
            lgPager.reload();
          }).catch(function () { fxDone(rb, false); say($('logMsg'), '連不上後端，請稍後再試。', 'err'); });
        };
        ts.appendChild(rb);
      }
      tr.appendChild(ts);
      tb.appendChild(tr);
    });
    $('logWrap').hidden = !rows.length;
    if (rows.length) say($('logMsg'), '');
  }
  var lgPager = pager('lg', function (offset, limit) {
    var q = 'days=' + encodeURIComponent($('lgDays').value) + '&limit=' + limit + '&offset=' + offset + ($('lgSt').value ? '&st=' + encodeURIComponent($('lgSt').value) : '');
    say($('logMsg'), '讀取中');
    return api('/admin/logs?' + q).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') { expired(); return null; } say($('logMsg'), res.error || '讀取失敗。', 'err'); return null; }
      return res.data || [];
    }).catch(function () { say($('logMsg'), '讀取錯誤紀錄失敗。', 'err'); return null; });
  }, lgRender, '這段期間沒有錯誤。');
  $('logBtn').onclick = function () { fxStart($('logBtn'), '查詢中'); lgPager.go(0).then(function () { fxEnd($('logBtn'), $('logMsg')); }); };

  // ---- 臉書連線（/admin/fb/status）----
  function fmtExp(sec) {
    if (sec === null || sec === undefined) return '到期日不明';
    if (!sec) return '永不過期';
    return '到期日 ' + fmtTime(sec * 1000);
  }
  function fbStatus() {
    return api('/admin/fb/status' + tpQ()).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      var d = res.data, ul = $('fbMissing'); ul.textContent = ''; ul.hidden = true;
      var pm = $('fbPerms'); pm.textContent = ''; pm.hidden = true;
      $('fbTokClear').hidden = d.source !== 'admin';
      var dl = $('fbDetail'); dl.textContent = ''; dl.hidden = true;
      var w = $('fbWarn'); w.hidden = !d.warn; w.textContent = d.warn ? d.warn.text : ''; w.className = 'fb-warn' + (d.warn && d.warn.level === 'bad' ? ' bad' : '');
      $('fbTokHint').textContent = d.autoExtend ? '後端已設定 App 密鑰：貼 Graph API Explorer 剛產生的權杖即可，會自動延長。' : '還沒設定 App 密鑰（見下方），無法自動延長：請先到「存取權杖偵錯工具」按 Extend，再貼延長後的權杖。';
      if (!d.configured) { $('fbState').textContent = '狀態：尚未設定權杖（在下方貼上，或設定 Secret FB_USER_TOKEN）'; $('fbState').className = 'fb-state off'; return; }
      $('fbState').textContent = '狀態：' + (d.valid ? '可以發文' : '權杖失效，無法發文，請換新權杖') + '；來源：' + (d.source === 'admin' ? '管理頁' : 'Secret') + (d.app ? '；App：' + d.app : '') + '；粉專 ' + (d.pages || 0) + ' 個' + (d.valid && !d.pages ? '（token 讀不到可管理的粉專：授權時要勾選粉專，並有 pages_manage_posts）' : '');
      $('fbState').className = 'fb-state ' + (d.valid ? 'on' : 'off');
      var lines = [];
      if (d.stored) {
        lines.push('粉專權杖：' + d.stored.pages + ' 個，' + fmtExp(d.stored.expires) + (d.stored.savedAt ? '（' + fmtTime(d.stored.savedAt) + ' 換好）' : ''));
        if (d.stored.dataExpires) lines.push('資料存取期限：' + fmtTime(d.stored.dataExpires * 1000) + '（到期前請主管重新產生權杖再換一次）');
        lines.push('使用者權杖：' + (d.userValid ? fmtExp(d.expires) : '已過期（不影響發文；要加新粉專時再換新權杖）'));
      } else {
        lines.push('使用者權杖：' + fmtExp(d.expires) + '（粉專權杖每次現場換；在下方「驗證並儲存」後會改存不過期的粉專權杖）');
      }
      lines.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; dl.appendChild(li); });
      dl.hidden = !lines.length;
      (d.missing || []).forEach(function (m) { var li = document.createElement('li'); li.textContent = '缺少權限：' + m; ul.appendChild(li); });
      ul.hidden = !(d.missing && d.missing.length);
      // 權杖實際拿到的權限：工具需要的標粗；App ID 一起列，方便到 Explorer／存取權杖偵錯工具選同一個 App 對照
      var need = d.needed || [];
      function permRow(label, list) {
        if (!list) return;
        pm.appendChild(sfEl('dt', '', label));
        var dd = document.createElement('dd');
        if (!list.length) dd.textContent = '（讀不到）';
        list.forEach(function (p, i) {
          if (i) dd.appendChild(document.createTextNode('、'));
          dd.appendChild(sfEl(need.indexOf(p) >= 0 ? 'b' : 'span', '', p));
        });
        pm.appendChild(dd);
      }
      if (d.app || d.appId) { pm.appendChild(sfEl('dt', '', 'App')); pm.appendChild(sfEl('dd', '', (d.app || '') + (d.appId ? '（ID ' + d.appId + '）' : ''))); }
      if (d.userValid) permRow('使用者權杖權限', d.granted || []);
      permRow('粉專權杖權限', d.pageScopes);
      pm.hidden = !pm.children.length;
    });
  }

  // ---- 排程發布開放／關閉（/admin/fb/access）----
  // mode：company＝開放、admin＝關閉（只有管理員密碼能用）；reason＝關閉原因
  var acMode = '';
  function acShow(d) {
    acMode = d.mode;
    var open = d.mode === 'company';
    $('acState').textContent = '狀態：' + (open ? '開放' : '關閉' + (d.reason ? '（原因：' + d.reason + '）' : ''));
    $('acState').className = 'fb-state ' + (open ? 'on' : 'off');
    $('acOpen').setAttribute('aria-pressed', String(open));
    $('acClose').setAttribute('aria-pressed', String(!open));
    $('acReason').value = d.reason || '';
    $('acReasonRow').hidden = open;
  }
  function acLoad() {
    say($('acMsg'), '');
    return api('/admin/fb/access').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      acShow(res.data);
    }).catch(function (e) { say($('acMsg'), '讀取失敗：' + (e && e.message || ''), 'err'); });
  }
  function acSet(mode, done, btn) {
    var reason = $('acReason').value.trim();
    if (Array.from(reason).length > 100) return say($('acMsg'), '關閉原因最多 100 字。', 'err');
    $('acOpen').disabled = $('acClose').disabled = $('acReasonSave').disabled = true; fxStart(btn, '儲存中'); say($('acMsg'), '儲存中');
    api('/admin/fb/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: mode, reason: reason }) }).then(function (res) {
      if (res.ok) { acShow(res.data); say($('acMsg'), done, 'good'); }
      else if (res.code === 'unauthorized') expired();
      else say($('acMsg'), res.error || '儲存失敗。', 'err');
    }).catch(function () { say($('acMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('acOpen').disabled = $('acClose').disabled = $('acReasonSave').disabled = false; fxEnd(btn, $('acMsg'), done); });
  }
  $('acOpen').onclick = function () { acSet('company', '已開放', $('acOpen')); };
  $('acClose').onclick = function () { acSet('admin', '已關閉', $('acClose')); };
  $('acReasonSave').onclick = function () { acSet(acMode || 'admin', '已儲存原因', $('acReasonSave')); };

  // ---- 粉專設定（/admin/fb/pages）----
  var pgItems = [];   // 目前表格順序；每列 { id, name, short, utm, rd, show }
  var RD_OPTS = [['', '不寫入'], ['news', '主粉'], ['ent', '娛樂粉'], ['shaokang', '少康粉'], ['intl', '國際＋粉']];
  function pgMap(list) { return list.map(function (p) { return { id: p.id, name: p.name, short: p.short, utm: p.utm || '', utmText: p.utmText || '', rd: p.rd || '', show: !!p.show }; }); }
  function pgSync() {   // 把輸入框的值寫回 pgItems（換順序前先存）
    pgItems.forEach(function (it, i) {
      var r = $('pgRows').children[i]; if (!r) return;
      it.short = r.querySelector('.pg-short').value; it.utm = r.querySelector('.pg-utm').value; it.utmText = r.querySelector('.pg-utmtext').value;
      it.rd = r.querySelector('.pg-rd').value; it.show = r.querySelector('.pg-show').checked;
    });
  }
  function pgRender() {
    var box = $('pgRows'); box.textContent = '';
    pgItems.forEach(function (it, i) {
      var card = document.createElement('div'); card.className = 'pg-card';
      function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
      function field(label, node, cls) { var l = el('label', cls); l.appendChild(document.createTextNode(label)); l.appendChild(node); return l; }
      function input(cls, val, ph, max, label) {
        var inp = document.createElement('input'); inp.type = 'text'; inp.className = cls; inp.value = val || ''; inp.maxLength = max;
        if (ph) inp.placeholder = ph; inp.setAttribute('aria-label', it.name + ' ' + label); return inp;
      }
      var head = el('div', 'pg-head');
      head.appendChild(el('span', 'pg-no', String(i + 1)));
      head.appendChild(el('span', 'pg-name', it.name));
      var mv = el('div', 'mv');
      [['上移', -1], ['下移', 1]].forEach(function (m) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'pg-' + (m[1] < 0 ? 'up' : 'down'); b.textContent = m[0]; b.setAttribute('aria-label', it.name + m[0]);
        b.disabled = (i + m[1] < 0 || i + m[1] >= pgItems.length);
        b.onclick = function () { pgSync(); var x = pgItems.splice(i, 1)[0]; pgItems.splice(i + m[1], 0, x); pgRender(); };
        mv.appendChild(b);
      });
      head.appendChild(mv);
      card.appendChild(head);
      var grid = el('div', 'pg-grid');
      grid.appendChild(field('簡稱', input('pg-short', it.short, '', 20, '簡稱')));
      var sel = document.createElement('select'); sel.className = 'pg-rd'; sel.setAttribute('aria-label', it.name + ' RD 區段');
      RD_OPTS.forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op); });
      sel.value = it.rd || ''; grid.appendChild(field('RD 區段', sel));
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'pg-show'; cb.checked = !!it.show; cb.setAttribute('aria-label', it.name + ' 顯示');
      var sl = el('label', 'pg-showlbl'); sl.appendChild(cb); sl.appendChild(document.createTextNode('顯示')); grid.appendChild(sl);
      grid.appendChild(field('UTM 圖文', input('pg-utm', it.utm, '?&utm_source=facebook&utm_medium=…', 200, 'UTM 圖文'), 'pg-wide'));
      grid.appendChild(field('UTM 文字', input('pg-utmtext', it.utmText, '空白＝純文字貼文不加 UTM', 200, 'UTM 文字'), 'pg-wide'));
      card.appendChild(grid);
      box.appendChild(card);
    });
    $('pgWrap').hidden = !pgItems.length; $('pgSave').hidden = !pgItems.length;
  }
  function pgLoad() {
    say($('pgMsg'), '讀取中');
    return api('/admin/fb/pages').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      pgItems = pgMap(res.data); pgRender();
      say($('pgMsg'), pgItems.length ? '' : '還沒有任何粉專（請先設定 FB_USER_TOKEN）。', pgItems.length ? '' : 'err');
    }).catch(function (e) { say($('pgMsg'), '讀取失敗：' + (e && e.message || ''), 'err'); });
  }
  var fbLoaded = false;
  function fbLoad() {
    fbLoaded = true; say($('fbMsg'), '');
    var jobs = [];
    if (can('access')) jobs.push(acLoad());
    if (can('profiles')) jobs.push(tpLoad().then(function () { if (can('fbconn')) return fbReload(); }));
    else if (can('fbconn')) jobs.push(fbReload());
    if (can('pages')) jobs.push(pgLoad());
    if (can('presets')) jobs.push(psLoad());
    if (can('video')) jobs.push(vsLoad());
    if (can('bg')) jobs.push(bgLoad());
    if (can('webhook')) jobs.push(whLoad());
    if (can('guard')) jobs.push(gdLoad());
    if (can('usage')) jobs.push(usLoad());
    if (can('fbstate')) jobs.push(fsLoad());
    return Promise.all(jobs);
  }
  // ---- 權杖組別（/admin/fb/profiles）：命名、切換使用中；設定中的組別（tpCur）給臉書連線與 App 密鑰用 ----
  var tpCur = '', tpData = null;
  function tpQ() { return tpCur && tpData && tpCur !== tpData.active ? '?p=' + encodeURIComponent(tpCur) : ''; }
  function tpBtn(text, fn) { var b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = fn; return b; }
  function tpShow(d) {
    tpData = d;
    if (!d.list.some(function (x) { return x.id === tpCur; })) tpCur = d.active;
    var ul = $('tpList'); ul.textContent = '';
    d.list.forEach(function (x) {
      var li = document.createElement('li'); if (x.active) li.className = 'on';
      var h = document.createElement('div'); h.className = 'tp-head';
      var nm = document.createElement('span'); nm.textContent = x.name; h.appendChild(nm);
      if (x.active) { var bd = document.createElement('span'); bd.className = 'tp-badge'; bd.textContent = '使用中'; h.appendChild(bd); }
      li.appendChild(h);
      var meta = document.createElement('p'); meta.className = 'tp-meta';
      var bits = [];
      if (!x.hasToken) bits.push('還沒有權杖');
      else {
        bits.push(x.source === 'secret' ? '權杖來自 Secret FB_USER_TOKEN' : '粉專 ' + x.pages.length + ' 個' + (x.pages.length ? '（' + x.pages.join('、') + '）' : ''));
        if (x.appName || x.appId) bits.push('App：' + (x.appName || '') + (x.appId ? '（' + x.appId + '）' : ''));
        if (x.dataExpires) bits.push('資料存取期限 ' + fmtTime(x.dataExpires * 1000));
        if (x.broken) bits.push('發文時遇到權杖失效');
      }
      meta.textContent = bits.join('．'); li.appendChild(meta);
      var row = document.createElement('div'); row.className = 'row';
      if (!x.active) {
        var act = tpBtn('切換為使用中', function () { tpCall('POST', '/admin/fb/profiles/' + x.id + '/activate', null, '已切換到「' + x.name + '」。'); });
        act.disabled = !x.hasToken; if (!x.hasToken) act.title = '先在「臉書連線」驗證並儲存權杖';
        row.appendChild(act);
      }
      row.appendChild(tpBtn('設定這一組', function () { fbPick(x.id); var c = $('fbCard'); if (c.scrollIntoView) c.scrollIntoView({ block: 'start' }); }));
      row.appendChild(tpBtn('重新命名', function () {
        var n = window.prompt('新的組別名稱（最多 20 字）', x.name);
        if (n === null) return;
        tpCall('POST', '/admin/fb/profiles/' + x.id, { name: n }, '已改名。');
      }));
      if (!x.active) row.appendChild(tpBtn('刪除', function () {
        if (!window.confirm('刪除「' + x.name + '」？這一組存的權杖與 App 密鑰會一起刪除，無法復原。')) return;
        tpCall('DELETE', '/admin/fb/profiles/' + x.id, null, '已刪除。');
      }));
      li.appendChild(row); ul.appendChild(li);
    });
    $('tpAdd').disabled = d.list.length >= d.max;
    $('tpName').disabled = d.list.length >= d.max;
    tpPickFill();
  }
  function tpPickFill() {
    var s = $('tpPick'); s.textContent = '';
    (tpData ? tpData.list : []).forEach(function (x) {
      var o = document.createElement('option'); o.value = x.id; o.textContent = x.name + (x.active ? '（使用中）' : ''); s.appendChild(o);
    });
    s.value = tpCur;
  }
  function tpLoad() {
    return api('/admin/fb/profiles').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      tpShow(res.data);
    }).catch(function (e) { say($('tpMsg'), '讀取權杖組別失敗：' + (e && e.message || ''), 'err'); });
  }
  function tpCall(method, path, body, okText) {
    var opts = { method: method };
    if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    say($('tpMsg'), '處理中');
    return api(path, opts).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      if (res.data && res.data.created) tpCur = res.data.created;
      tpShow(res.data);
      return fbLoad().then(function () { say($('tpMsg'), okText, 'good'); });
    }).catch(function (e) { say($('tpMsg'), '失敗：' + (e && e.message || ''), 'err'); });
  }
  $('tpAdd').onclick = function () {
    var n = $('tpName').value.trim();
    if (!n) { say($('tpMsg'), '請填組別名稱。', 'err'); return; }
    tpCall('POST', '/admin/fb/profiles', { name: n }, '已新增，請在下方「臉書連線」設定這一組的 App 密鑰與權杖。').then(function () { $('tpName').value = ''; });
  };
  function fbPick(id) { tpCur = id; tpPickFill(); say($('fbMsg'), ''); say($('fbTokMsg'), ''); say($('appMsg'), ''); return fbReload(); }
  $('tpPick').onchange = function () { fbPick($('tpPick').value); };
  // 只重讀「臉書連線」與「App 密鑰」（切換設定中的組別用）
  function fbReload() {
    return Promise.all([fbStatus().catch(function (e) { say($('fbMsg'), '讀取連線狀態失敗：' + (e && e.message || ''), 'err'); }), appLoad()]);
  }
  // ---- App 密鑰（/admin/fb/app）：只回有沒有設定與 App ID，Secret 永不回傳 ----
  function appShow(d) {
    $('appState').textContent = d.configured
      ? '狀態：已設定；App ID ' + d.appId + '；' + (d.source === 'admin' ? (d.savedAt ? fmtTime(d.savedAt) + ' 在管理頁設定' : '在管理頁設定') : '來自 Secret FB_APP_ID／FB_APP_SECRET')
      : '狀態：未設定（貼權杖前要先到存取權杖偵錯工具按 Extend）';
    $('appState').className = 'fb-state ' + (d.configured ? 'on' : 'off');
    $('appClear').hidden = d.source !== 'admin';
  }
  function appLoad() {
    return api('/admin/fb/app' + tpQ()).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      appShow(res.data);
    }).catch(function (e) { say($('appMsg'), '讀取 App 密鑰狀態失敗：' + (e && e.message || ''), 'err'); });
  }
  $('appSave').onclick = function () {
    var id = $('appId').value.trim(), sec = $('appSecret').value.trim();
    if (!id || !sec) { say($('appMsg'), '請填 App ID 和 App Secret。', 'err'); return; }
    fxStart($('appSave'), '向臉書驗證中'); say($('appMsg'), '向臉書驗證中');
    api('/admin/fb/app' + tpQ(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: id, secret: sec }) }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      $('appSecret').value = ''; $('appId').value = '';
      say($('appMsg'), '已驗證並儲存（App ID ' + res.data.appId + '）。之後貼剛產生的權杖會自動延長。', 'good');
      return fbLoad();
    }).catch(function (e) { say($('appMsg'), '沒有存：' + (e && e.message || '失敗'), 'err'); })
      .then(function () { fxEnd($('appSave'), $('appMsg'), '已驗證'); });
  };
  $('appClear').onclick = function () {
    if (!window.confirm('清除管理頁存的 App 密鑰？清除後貼權杖前要先按 Extend。')) return;
    fxStart($('appClear'), '清除中');
    api('/admin/fb/app' + tpQ(), { method: 'DELETE' }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      say($('appMsg'), '已清除。', 'good');
      return fbLoad();
    }).catch(function (e) { say($('appMsg'), '失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { fxEnd($('appClear'), $('appMsg'), '已清除'); });
  };
  // ---- 速率限制（/admin/fb/usage）：只讀存好的用量；立即查詢才會呼叫臉書 ----
  function usAgo(ms) { var m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 1 ? '剛剛' : m < 60 ? m + ' 分鐘前' : m < 1440 ? Math.round(m / 60) + ' 小時前' : Math.round(m / 1440) + ' 天前'; }
  var US_LABEL = { CODE4: 'App 呼叫太多', CODE17: '使用者呼叫太多', CODE32: '粉專呼叫太多（使用者權杖）', CODE613: '呼叫太頻繁', CODE80001: '粉專呼叫太多（粉專權杖）' };
  function usItem(title, sub, u) {
    var li = document.createElement('li');
    var h = document.createElement('div'); h.className = 'us-head';
    var t = document.createElement('span'); t.textContent = title; h.appendChild(t);
    var s = document.createElement('small'); s.textContent = sub; h.appendChild(s);
    li.appendChild(h);
    var g = document.createElement('div'); g.className = 'us-bars';
    [['呼叫次數', u.callCount], ['CPU 時間', u.totalCputime], ['處理時間', u.totalTime]].forEach(function (x) {
      var v = Math.max(0, Number(x[1]) || 0);
      var lb = document.createElement('span'); lb.textContent = x[0];
      var bar = document.createElement('span'); bar.className = 'us-bar' + (v >= 90 ? ' bad' : v >= 75 ? ' warn' : '');
      bar.setAttribute('role', 'meter'); bar.setAttribute('aria-label', title + ' ' + x[0]); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(v));
      var fill = document.createElement('i'); fill.style.width = Math.min(v, 100) + '%'; bar.appendChild(fill);
      var pv = document.createElement('span'); pv.textContent = v + '%';
      g.appendChild(lb); g.appendChild(bar); g.appendChild(pv);
    });
    li.appendChild(g);
    if (u.regainMin > 0) { var r = document.createElement('p'); r.className = 'us-regain'; r.textContent = '已被臉書暫停，約 ' + u.regainMin + ' 分鐘後恢復'; li.appendChild(r); }
    return li;
  }
  function usShow(d) {
    var ul = $('usList'); ul.textContent = '';
    if (d.app) ul.appendChild(usItem('App（使用者權杖）', '最後更新：' + usAgo(d.app.at), d.app));
    (d.pages || []).forEach(function (p) { ul.appendChild(usItem(p.name || ('粉專 ' + p.id), '粉專．最後更新：' + usAgo(p.at), p)); });
    if (!ul.children.length) { var li = document.createElement('li'); li.textContent = '還沒有用量資料：工具呼叫臉書後會出現，或按「立即查詢」。'; ul.appendChild(li); }
    var th = $('usThrottle');
    th.hidden = !d.throttle;
    if (d.throttle) { th.textContent = '最近一次被臉書限流：' + fmtTime(d.throttle.at) + '．' + (US_LABEL['CODE' + d.throttle.code] || ('錯誤碼 ' + d.throttle.code)); th.className = 'fb-state off'; }
  }
  function usLoad() {
    return api('/admin/fb/usage').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      usShow(res.data);
    }).catch(function (e) { say($('usMsg'), '讀取用量失敗：' + (e && e.message || ''), 'err'); });
  }
  $('usReload').onclick = function () { say($('usMsg'), ''); usLoad(); };
  $('usAsk').onclick = function () {
    fxStart($('usAsk'), '向臉書查詢中'); say($('usMsg'), '向臉書查詢中');
    api('/admin/fb/usage/refresh', { method: 'POST' }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      usShow(res.data);
      say($('usMsg'), '已查詢 ' + res.data.asked + ' 次' + (res.data.failed ? '，' + res.data.failed + ' 次失敗' : '') + '。', res.data.failed ? 'err' : 'good');
    }).catch(function (e) { say($('usMsg'), '查詢失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { fxEnd($('usAsk'), $('usMsg'), '已查詢'); });
  };
  // ---- Webhook（/admin/fb/webhook）：回呼網址、驗證權杖、簽章狀態、最後收到 ----
  function whLoad() {
    return api('/admin/fb/webhook').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      var d = res.data;
      $('whUrl').textContent = d.url;
      $('whTok').textContent = d.verifyToken || '後端沒有 SESSION_SECRET，無法產生';
      $('whSign').textContent = d.signReady ? '已設定 App 密鑰，可以驗證臉書簽章' : '還沒設定 App 密鑰（見「臉書連線」），收到的通知一律拒收';
      $('whSign').className = d.signReady ? 'good' : 'err';
      $('whLast').textContent = d.last ? fmtTime(d.last.at) + '．' + (d.last.object || '未知') + (d.last.fields.length ? '／' + d.last.fields.join('、') : '') : '還沒收到';
    }).catch(function (e) { say($('whMsg'), '讀取 Webhook 狀態失敗：' + (e && e.message || ''), 'err'); });
  }
  function whCopy(id, label) {
    var t = $(id).textContent;
    if (!navigator.clipboard) { say($('whMsg'), '這個瀏覽器不能自動複製，請手動選取。', 'err'); return; }
    navigator.clipboard.writeText(t).then(function () { say($('whMsg'), '已複製' + label + '。', 'good'); }, function () { say($('whMsg'), '複製失敗，請手動選取。', 'err'); });
  }
  $('whUrlCopy').onclick = function () { whCopy('whUrl', '回呼網址'); };
  $('whTokCopy').onclick = function () { whCopy('whTok', '驗證權杖'); };
  $('whRefresh').onclick = function () { say($('whMsg'), ''); whLoad(); };
  // ---- 臉書粉專連線狀態（/admin/fb/conn，不打臉書）：使用中組別、粉專、權杖提醒 ----
  function fsLoad() {
    say($('fsMsg'), '');
    return api('/admin/fb/conn').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      var d = res.data, st = $('fsState'), ul = $('fsList');
      ul.textContent = '';
      var bad = d.broken || !d.pages.length || (d.warn && d.warn.level === 'bad');
      st.className = 'fb-state ' + (bad ? 'off' : 'on');
      st.textContent = d.error ? d.error : (bad ? '有問題：' : '正常：') + '使用中組別「' + d.profile + '」，' + d.pages.length + ' 個粉專' + (d.broken ? '，粉專權杖已失效' : '');
      d.pages.forEach(function (p) { var li = document.createElement('li'); li.textContent = p.name; li.className = d.broken ? 'bad' : ''; ul.appendChild(li); });
      if (d.warn) say($('fsMsg'), d.warn.text, d.warn.level === 'bad' ? 'err' : '');
    }).catch(function (e) { say($('fsMsg'), '讀取失敗：' + (e && e.message || ''), 'err'); });
  }
  $('fsReload').onclick = function () { fsLoad(); };
  // ---- 留言管理（/admin/fb/guard*）：模式、守門用組別、規則、粉專訂閱、紀錄 ----
  var GD_ACT = { observe: '觀察（若開啟會隱藏）', hidden: '已隱藏', failed: '隱藏失敗', manual: '手動隱藏', unhidden: '已取消隱藏' };
  var GD_RULE = { r1: '規則 1（標註名稱）', r2: '規則 2（引導詞）' };
  var gdDefaults = null, gdPageNames = {}, gdBefore = 0;
  function gdLines(id) { return $(id).value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function gdFill(r) { $('gdNames').value = r.names.join('\n'); $('gdLeads').value = r.leads.join('\n'); $('gdAllow').value = r.allow.join('\n'); $('gdR1').checked = !!r.auto.r1; $('gdR2').checked = !!r.auto.r2; }
  function gdStats(st) {
    if (!st || !st.since) { $('gdStats').textContent = '統計：還沒有處理過留言'; return; }
    $('gdStats').textContent = '自 ' + fmtTime(st.since) + ' 起：檢查 ' + st.checked + ' 則、觀察 ' + st.observe + '、隱藏 ' + st.hidden + '、失敗 ' + st.failed +
      '、用量高先略過 ' + st.skipped + '、通知沒附文字 ' + st.noText;
  }
  function gdProfiles(list, value) {
    var sel = $('gdProfile'); sel.textContent = '';
    list.forEach(function (p) {
      var o = document.createElement('option'); o.value = p.id;
      o.textContent = p.name + (p.active ? '（發文使用中）' : '') + (p.meta === true ? '．有 pages_manage_metadata' : p.meta === false ? '．缺 pages_manage_metadata' : '');
      sel.appendChild(o);
    });
    sel.value = value;
  }
  // 檢查各組別權杖有沒有 pages_manage_metadata（每組打一次 debug_token，按了才查）
  $('gdPerm').onclick = function () {
    var keep = $('gdProfile').value;
    fxStart($('gdPerm'), '向臉書查詢權限'); say($('gdMsg'), '向臉書查詢權限');
    api('/admin/fb/guard?check=1').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      gdProfiles(res.data.profiles, keep);
      var ok = res.data.profiles.filter(function (p) { return p.meta; }).map(function (p) { return p.name; });
      say($('gdMsg'), ok.length ? '有 pages_manage_metadata 的組別：' + ok.join('、') : '沒有任何組別有 pages_manage_metadata。', ok.length ? 'good' : 'err');
    }).catch(function (e) { say($('gdMsg'), '查詢失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { fxEnd($('gdPerm'), $('gdMsg'), '已查詢'); });
  };
  function gdLoad() {
    say($('gdMsg'), '讀取中');
    return api('/admin/fb/guard').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      var d = res.data; gdDefaults = d.defaults;
      $('gdMode').value = d.mode;
      gdProfiles(d.profiles, d.profile || d.suggest); $('gdProfile').dataset.saved = d.profile;
      gdFill(d.rules); gdStats(d.stats);
      say($('gdMsg'), d.profile ? '' : '還沒儲存過設定：已預選發文使用中的組別，可按「檢查權限」確認哪一組有 pages_manage_metadata，再按「儲存設定」。');
      return Promise.all([gdPages(false), gdLog(false)]);
    }).catch(function (e) { say($('gdMsg'), '讀取失敗：' + (e && e.message || ''), 'err'); });
  }
  function gdPages(check) {
    say($('gdPgMsg'), check ? '向臉書查詢訂閱狀態' : '');
    return api('/admin/fb/guard/pages' + (check ? '?check=1' : '')).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      var ul = $('gdPages'); ul.textContent = '';
      var fp = $('gdFPage'), keep = fp.value; fp.length = 1;
      gdPageNames = {};
      res.data.pages.forEach(function (p) {
        gdPageNames[p.id] = p.name;
        var o = document.createElement('option'); o.value = p.id; o.textContent = p.name; fp.appendChild(o);
        var li = document.createElement('li');
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = p.on; cb.id = 'gdPg' + p.id;
        var lb = document.createElement('label'); lb.htmlFor = cb.id; lb.className = 'gd-name'; lb.textContent = p.name;
        var sm = document.createElement('small');
        sm.textContent = p.sub === true ? '已訂閱留言通知' : p.sub === false ? '臉書端未訂閱' : p.on ? '已開啟' : '未開啟';
        cb.onchange = function () { gdToggle(p.id, cb, sm); };
        li.appendChild(cb); li.appendChild(lb); li.appendChild(sm); ul.appendChild(li);
      });
      fp.value = keep in gdPageNames ? keep : '';
      if (!res.data.pages.length) say($('gdPgMsg'), '守門用組別沒有任何粉專（先在「臉書連線」設定這一組的權杖）。', 'err');
      else if (check) say($('gdPgMsg'), '已更新訂閱狀態。', 'good');
    }).catch(function (e) { say($('gdPgMsg'), '讀取粉專失敗：' + (e && e.message || ''), 'err'); });
  }
  function gdToggle(id, cb, sm) {
    cb.disabled = true; say($('gdPgMsg'), cb.checked ? '開啟中' : '關閉中');
    api('/admin/fb/guard/pages/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: cb.checked }) }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      sm.textContent = res.data.on ? '已訂閱留言通知' : '未開啟';
      say($('gdPgMsg'), (gdPageNames[id] || id) + (res.data.on ? ' 已開啟。' : ' 已關閉。'), 'good');
    }).catch(function (e) { cb.checked = !cb.checked; say($('gdPgMsg'), '失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { cb.disabled = false; });
  }
  $('gdSave').onclick = function () {
    var mode = $('gdMode').value, prof = $('gdProfile').value, saved = $('gdProfile').dataset.saved;
    if (saved && prof !== saved && !confirm('換守門用組別後，所有粉專開關會清空，要重新打開。確定要換嗎？')) return;
    if (mode === 'hide' && !$('gdR1').checked && !$('gdR2').checked && !confirm('兩條規則都沒勾自動隱藏，等於只觀察。仍要儲存嗎？')) return;
    var body = { mode: mode, profile: prof, rules: { names: gdLines('gdNames'), leads: gdLines('gdLeads'), allow: gdLines('gdAllow'), auto: { r1: $('gdR1').checked, r2: $('gdR2').checked } } };
    fxStart($('gdSave'), '儲存中'); say($('gdMsg'), '儲存中');
    api('/admin/fb/guard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      $('gdProfile').dataset.saved = res.data.profile; gdFill(res.data.rules); gdStats(res.data.stats);
      say($('gdMsg'), '已儲存。', 'good');
      if (saved !== res.data.profile) return gdPages(false);
    }).catch(function (e) { say($('gdMsg'), '儲存失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { fxEnd($('gdSave'), $('gdMsg'), '已儲存'); });
  };
  $('gdDefault').onclick = function () {
    if (!gdDefaults) return;
    gdFill({ names: gdDefaults.names, leads: gdDefaults.leads, allow: gdLines('gdAllow'), auto: { r1: $('gdR1').checked, r2: $('gdR2').checked } });
    say($('gdMsg'), '已填入預設關鍵字，按「儲存設定」才會生效。');
  };
  $('gdCheck').onclick = function () { gdPages(true); };
  // 紀錄一列＋展開列（點內容展開全文、標註、留言者 ID、連結）
  var GD_DOT = { observe: 'y', hidden: 'g', manual: 'g', failed: 'r', unhidden: 'n' };
  function gdShort(ms) { var t = fmtTime(ms); return t.replace(/^\d{4}-/, '').replace('-', '/'); }
  function gdItem(it) {
    var tr = document.createElement('tr'); tr.className = 'gd-row';
    var td = function (cls, text) { var c = document.createElement('td'); c.className = cls; if (text != null) c.textContent = text; tr.appendChild(c); return c; };
    var a = td('c-act'); var dot = document.createElement('span'); dot.className = 'gd-dot ' + (GD_DOT[it.action] || 'n'); dot.setAttribute('aria-hidden', 'true');
    a.appendChild(dot); a.appendChild(document.createTextNode(GD_ACT[it.action] || it.action));
    td('c-time', gdShort(it.at)); td('c-page', gdPageNames[it.page] || it.page);
    td('c-rule', it.rule === 'r1' ? '規則1' : it.rule === 'r2' ? '規則2' : '');
    td('c-user', it.uname || '');
    var mc = td('c-msg'); var mb = document.createElement('button'); mb.type = 'button'; mb.className = 'gd-more';
    mb.setAttribute('aria-expanded', 'false'); mb.title = '看全文'; mb.textContent = it.msg || '（沒有文字）'; mc.appendChild(mb);
    var bc = td('c-btn');
    var ex = document.createElement('tr'); ex.className = 'gd-exp'; ex.hidden = true;
    var ec = document.createElement('td'); ec.colSpan = 7; ex.appendChild(ec);
    var full = document.createElement('p'); full.className = 'gd-full'; full.textContent = it.msg; ec.appendChild(full);
    var meta = document.createElement('p'); meta.className = 'gd-meta';
    meta.textContent = [it.tags.length ? '標註：' + it.tags.join('、') : '', GD_RULE[it.rule] || '', it.uid ? '留言者 ID ' + it.uid : '', it.edited ? '編輯過' : '', it.exempt ? '不再自動處理' : '', fmtTime(it.at)].filter(Boolean).join('．');
    ec.appendChild(meta);
    if (it.link) { var lk = document.createElement('a'); lk.href = it.link; lk.target = '_blank'; lk.rel = 'noopener noreferrer'; lk.textContent = '在臉書開啟'; ec.appendChild(lk); }
    mb.onclick = function () { ex.hidden = !ex.hidden; mb.setAttribute('aria-expanded', ex.hidden ? 'false' : 'true'); tr.classList.toggle('open', !ex.hidden); };
    var hidden = it.action === 'hidden' || it.action === 'manual';
    var b = document.createElement('button'); b.type = 'button'; b.textContent = hidden ? '取消隱藏' : '隱藏';
    b.onclick = function () {
      if (hidden && !confirm('取消隱藏後，這則留言之後再被編輯也不會自動隱藏。確定嗎？')) return;
      fxStart(b, hidden ? '取消隱藏中' : '隱藏中'); say($('gdLogMsg'), hidden ? '取消隱藏中' : '隱藏中');
      api('/admin/fb/guard/log/' + it.cid + '/' + (hidden ? 'unhide' : 'hide'), { method: 'POST' }).then(function (res) {
        if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
        var open = !ex.hidden, n = gdItem(res.data);
        tr.replaceWith(n[0]); ex.replaceWith(n[1]);
        if (open) n[0].querySelector('.gd-more').click();
        say($('gdLogMsg'), hidden ? '已取消隱藏。' : '已隱藏。', 'good');
      }).catch(function (e) { fxDone(b, false); say($('gdLogMsg'), '失敗：' + (e && e.message || ''), 'err'); });
    };
    bc.appendChild(b);
    return [tr, ex];
  }
  function gdLog(more) {
    if (!more) { gdBefore = 0; $('gdLog').textContent = ''; }
    var q = [];
    if ($('gdFAct').value) q.push('action=' + $('gdFAct').value);
    if ($('gdFPage').value) q.push('page=' + $('gdFPage').value);
    if (gdBefore) q.push('before=' + gdBefore);
    say($('gdLogMsg'), '讀取中');
    return api('/admin/fb/guard/log' + (q.length ? '?' + q.join('&') : '')).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      res.data.items.forEach(function (it) { var n = gdItem(it); $('gdLog').appendChild(n[0]); $('gdLog').appendChild(n[1]); gdBefore = it.at; });
      $('gdMore').hidden = !res.data.more;
      say($('gdLogMsg'), $('gdLog').children.length ? '' : '還沒有紀錄。');
      $('gdLog').closest('.gd-wrap').hidden = !$('gdLog').children.length;
    }).catch(function (e) { say($('gdLogMsg'), '讀取紀錄失敗：' + (e && e.message || ''), 'err'); });
  }
  $('gdLogLoad').onclick = function () { gdLog(false); };
  $('gdFAct').onchange = $('gdFPage').onchange = function () { gdLog(false); };
  $('gdMore').onclick = function () { gdLog(true); };
  $('fbTokSave').onclick = function () {
    var v = $('fbTok').value.trim();
    if (!v) { say($('fbTokMsg'), '請先貼上權杖。', 'err'); return; }
    fxStart($('fbTokSave'), '向臉書驗證中'); say($('fbTokMsg'), '向臉書驗證中');
    api('/admin/fb/token' + tpQ(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: v }) }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      $('fbTok').value = '';
      var d = res.data;
      say($('fbTokMsg'), (d.extended ? '已自動延長權杖，' : '已換成新權杖，') + '並換好 ' + (d.pages || 0) + ' 個粉專權杖（永不過期）' + (d.app ? '；App：' + d.app : '') + '。', 'good');
      return fbLoad();
    }).catch(function (e) { say($('fbTokMsg'), '沒有換：' + (e && e.message || '失敗'), 'err'); })
      .then(function () { fxEnd($('fbTokSave'), $('fbTokMsg'), '已驗證'); });
  };
  $('fbTokClear').onclick = function () {
    if (!window.confirm('刪除管理頁存的權杖，改回使用 Secret FB_USER_TOKEN？')) return;
    fxStart($('fbTokClear'), '處理中');
    api('/admin/fb/token' + tpQ(), { method: 'DELETE' }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      say($('fbTokMsg'), '已改回 Secret。', 'good');
      return fbLoad();
    }).catch(function (e) { say($('fbTokMsg'), '失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { fxEnd($('fbTokClear'), $('fbTokMsg'), '已改回'); });
  };
  $('fbRefresh').onclick = function () {
    fxStart($('fbRefresh'), '重新讀取中'); say($('fbMsg'), '重新讀取中');
    api('/admin/fb/refresh' + tpQ(), { method: 'POST' }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      var r = res.data || {};
      var m = r.renewed ? '已重新換好粉專權杖：' + r.pages + ' 個。' : r.reason === 'user_expired' ? '使用者權杖已過期，保留原本的粉專權杖（照常發文）；要加新粉專請換新權杖。' : r.reason === 'failed' ? '沒有更新：' + (r.error || '') + ' 保留原本的粉專權杖。' : '已重新讀取。';
      return fbLoad().then(function () { say($('fbMsg'), m, r.reason ? 'err' : 'good'); });
    }).catch(function (e) { say($('fbMsg'), '重新讀取失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { fxEnd($('fbRefresh'), $('fbMsg'), '已讀取'); });
  };
  // ---- 影片設定（/admin/fb/video-settings）----
  function vsLines(id) { return $(id).value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); }
  function vsShow(d) { $('vsPre').value = d.prefixes.join('\n'); $('vsSuf').value = d.suffixes.join('\n'); $('vsReels').value = d.reelsTag; $('vsTags').value = d.tags.join('\n'); }
  function vsLoad() {
    say($('vsMsg'), '讀取中');
    return api('/admin/fb/video-settings').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      vsShow(res.data); say($('vsMsg'), '');
    }).catch(function (e) { say($('vsMsg'), '讀取失敗：' + (e && e.message || ''), 'err'); });
  }
  $('vsSave').onclick = function () {
    var body = { prefixes: vsLines('vsPre'), suffixes: vsLines('vsSuf'), reelsTag: $('vsReels').value.trim(), tags: vsLines('vsTags') };
    if (body.prefixes.length > 20 || body.suffixes.length > 20 || body.tags.length > 20) return say($('vsMsg'), '前綴、後綴、hashtag 按鈕各最多 20 個。', 'err');
    fxStart($('vsSave'), '儲存中'); say($('vsMsg'), '儲存中');
    api('/admin/fb/video-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
      if (res.ok) { vsShow(res.data); say($('vsMsg'), '已儲存', 'good'); }
      else if (res.code === 'unauthorized') expired();
      else say($('vsMsg'), res.error || '儲存失敗。', 'err');
    }).catch(function () { say($('vsMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { fxEnd($('vsSave'), $('vsMsg'), '已儲存'); });
  };

  // ---- 活動留言（/admin/fb/presets）----
  var psItems = [];   // { name, body }
  var PS_MAX = 20;
  function psSync() {
    var rows = $('psRows').children;
    psItems.forEach(function (it, i) {
      var r = rows[i]; if (!r) return;
      it.name = r.querySelector('.ps-name').value; it.body = r.querySelector('.ps-body').value;
    });
  }
  function psRender() {
    var box = $('psRows'); box.textContent = '';
    psItems.forEach(function (it, i) {
      var r = document.createElement('div'); r.className = 'ps-row';
      var n = document.createElement('input'); n.type = 'text'; n.className = 'ps-name'; n.maxLength = 20; n.placeholder = '例：雙11抽獎'; n.value = it.name || '';
      n.setAttribute('aria-label', '第 ' + (i + 1) + ' 則名稱');
      var b = document.createElement('textarea'); b.className = 'ps-body'; b.rows = 3; b.maxLength = 8000; b.value = it.body || '';
      b.setAttribute('aria-label', '第 ' + (i + 1) + ' 則內容');
      var d = document.createElement('button'); d.type = 'button'; d.className = 'ps-del danger'; d.textContent = '刪除'; d.setAttribute('aria-label', '刪除第 ' + (i + 1) + ' 則');
      d.onclick = function () { psSync(); psItems.splice(i, 1); psRender(); say($('psMsg'), ''); };
      r.appendChild(n); r.appendChild(b); r.appendChild(d); box.appendChild(r);
    });
    $('psAdd').disabled = psItems.length >= PS_MAX;
  }
  function psLoad() {
    say($('psMsg'), '讀取中');
    return api('/admin/fb/presets').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      psItems = res.data.map(function (p) { return { name: p.name, body: p.body }; }); psRender();
      say($('psMsg'), psItems.length ? '' : '還沒有活動留言，按「＋ 新增一則」。');
    }).catch(function (e) { say($('psMsg'), '讀取失敗：' + (e && e.message || ''), 'err'); });
  }
  $('psAdd').onclick = function () {
    psSync(); if (psItems.length >= PS_MAX) return;
    psItems.push({ name: '', body: '' }); psRender(); say($('psMsg'), '');
    var ns = $('psRows').querySelectorAll('.ps-name'); ns[ns.length - 1].focus();
  };
  $('psSave').onclick = function () {
    psSync();
    for (var i = 0; i < psItems.length; i++) {
      var n = psItems[i].name.trim().length, b = psItems[i].body.trim().length, row = $('psRows').children[i];
      if (n < 1 || n > 20) { row.querySelector('.ps-name').focus(); return say($('psMsg'), '第 ' + (i + 1) + ' 則的名稱要 1～20 字。', 'err'); }
      if (b < 1 || b > 8000) { row.querySelector('.ps-body').focus(); return say($('psMsg'), '第 ' + (i + 1) + ' 則的內容要 1～8000 字。', 'err'); }
    }
    var body = { presets: psItems.map(function (it) { return { name: it.name.trim(), body: it.body.trim() }; }) };
    fxStart($('psSave'), '儲存中'); say($('psMsg'), '儲存中');
    api('/admin/fb/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
      if (res.ok) { psItems = res.data.map(function (p) { return { name: p.name, body: p.body }; }); psRender(); say($('psMsg'), '已儲存', 'good'); }
      else if (res.code === 'unauthorized') expired();
      else say($('psMsg'), res.error || '儲存失敗。', 'err');
    }).catch(function () { say($('psMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { fxEnd($('psSave'), $('psMsg'), '已儲存'); });
  };

  // ---- 文字背景（/admin/fb/backgrounds）：匯入擷取結果、分批下載圖樣、改名／顯示／刪除 ----
  var bgList = [], bgPend = null, bgUrls = {};
  var BG_TYPE = { solid: '純色', gradient: '漸層', image: '圖樣' };
  var BG_DIR = { BL_TR: 'to top right', TR_BL: 'to bottom left', TL_BR: 'to bottom right', BR_TL: 'to top left' };
  function bgCss(x) { return x.type === 'gradient' && x.grad ? 'linear-gradient(' + (BG_DIR[x.dir] || 'to bottom right') + ',' + x.bg + ',' + x.grad + ')' : x.bg; }
  // 圖樣網址到期（後端從臉書 CDN 網址的 oe= 解析，秒；推論為簽章到期）
  function bgExpText(exp) { var d = new Date(exp * 1000), p = function (v) { return String(v).padStart(2, '0'); }; return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function bgExpLeft(exp) { var h = (exp * 1000 - Date.now()) / 3600000; return h <= 0 ? '' : h < 24 ? '剩 ' + Math.max(1, Math.floor(h)) + ' 小時' : '剩 ' + Math.floor(h / 24) + ' 天'; }
  function bgTodo() { return bgList.filter(function (x) { return x.type === 'image' && !x.img && x.hasUrl; }).length; }
  function bgPost(path, body, method) { return api(path, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  function bgThumb(x, sw) {
    if (bgUrls[x.id]) { sw.style.backgroundImage = 'url("' + bgUrls[x.id] + '")'; return; }
    fetch(API_BASE + '/admin/fb/backgrounds/' + x.id + '/img', { headers: token ? { Authorization: 'Bearer ' + token } : {} })
      .then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (b) { if (!b) return; bgUrls[x.id] = URL.createObjectURL(b); sw.style.backgroundImage = 'url("' + bgUrls[x.id] + '")'; })
      .catch(function () {});
  }
  // 擷取腳本：按下時讀網站上的檔案再複製（腳本只有一份，改了自動跟著）
  $('bgScript').onclick = function () {
    var b = $('bgScript'); fxStart(b, '複製中');
    fetch('../docs/fb-text-backgrounds/extract-fb-backgrounds.js', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('讀不到腳本（HTTP ' + r.status + '）'); return r.text(); })
      .then(function (t) {
        if (!navigator.clipboard) throw new Error('這個瀏覽器不能自動複製');
        return navigator.clipboard.writeText(t).then(null, function () { throw new Error('複製失敗'); });
      })
      .then(function () { say($('bgMsg'), '已複製擷取腳本，到臉書的 DevTools Console 貼上執行。', 'good'); },
        function (e) { say($('bgMsg'), (e && e.message || '複製失敗') + '，請稍後再試。', 'err'); })
      .then(function () { fxEnd(b, $('bgMsg'), '已複製'); });
  };
  function bgRender() {
    var box = $('bgRows'); box.textContent = '';
    var n = { solid: 0, gradient: 0, image: 0 }, got = 0;
    bgList.forEach(function (x) {
      n[x.type]++; if (x.type === 'image' && x.img) got++;
      var tr = document.createElement('tr');
      var td0 = document.createElement('td'), sw = document.createElement('span'); sw.className = 'bg-sw'; sw.style.background = bgCss(x);
      if (x.type === 'image' && x.img) bgThumb(x, sw);
      td0.appendChild(sw);
      var td1 = document.createElement('td'), nm = document.createElement('input'); nm.type = 'text'; nm.className = 'bg-name'; nm.maxLength = 20; nm.value = x.name; nm.setAttribute('aria-label', '名稱 ' + x.name);
      nm.onkeydown = function (e) { if (e.key === 'Enter') nm.blur(); };
      nm.onchange = function () {
        var v = nm.value.trim(); if (!v) { nm.value = x.name; return say($('bgMsg'), '名稱要 1～20 字。', 'err'); }
        bgPost('/admin/fb/backgrounds/' + x.id, { name: v }).then(function (res) { if (res.ok) { bgSet(res.data); say($('bgMsg'), '已儲存「' + v + '」', 'good'); } else if (res.code === 'unauthorized') expired(); else say($('bgMsg'), res.error || '儲存失敗。', 'err'); });
      };
      td1.appendChild(nm);
      var td2 = document.createElement('td'); td2.textContent = BG_TYPE[x.type] || x.type;
      var td3 = document.createElement('td');
      if (x.type !== 'image') td3.textContent = '—';
      else if (x.img) {
        td3.textContent = '已下載'; td3.className = 'bg-ok';
        if (x.exp) { var sub = document.createElement('span'); sub.className = 'bg-sub'; sub.textContent = '原網址到期 ' + bgExpText(x.exp); td3.appendChild(sub); }
      } else {
        var left = x.exp ? x.exp * 1000 - Date.now() : null;
        if (x.hasUrl && left !== null && left <= 0) { td3.textContent = '網址已過期，請重新擷取匯入'; td3.className = 'bg-err'; }
        else {
          td3.textContent = x.err ? x.err : x.hasUrl ? '待下載' : '沒有網址（請重新擷取）';
          if (x.err) td3.className = 'bg-err';
          if (x.hasUrl && left !== null) {
            var ex = document.createElement('span'); ex.className = 'bg-sub' + (left < 86400000 ? ' bg-warn' : '');
            ex.textContent = '網址到期 ' + bgExpText(x.exp) + '（' + bgExpLeft(x.exp) + '）' + (left < 86400000 ? '，請盡快下載圖樣' : '');
            td3.appendChild(ex);
          }
        }
      }
      var td4 = document.createElement('td'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = x.show; cb.setAttribute('aria-label', '顯示 ' + x.name);
      cb.onchange = function () { bgPost('/admin/fb/backgrounds/' + x.id, { show: cb.checked }).then(function (res) { if (res.ok) bgSet(res.data); else { cb.checked = !cb.checked; if (res.code === 'unauthorized') expired(); else say($('bgMsg'), res.error || '儲存失敗。', 'err'); } }); };
      td4.appendChild(cb);
      var td4b = document.createElement('td'), rb = document.createElement('input'); rb.type = 'checkbox'; rb.checked = !!x.rnd; rb.setAttribute('aria-label', '列入隨機 ' + x.name);
      rb.onchange = function () { bgPost('/admin/fb/backgrounds/' + x.id, { rnd: rb.checked }).then(function (res) { if (res.ok) bgSet(res.data); else { rb.checked = !rb.checked; if (res.code === 'unauthorized') expired(); else say($('bgMsg'), res.error || '儲存失敗。', 'err'); } }); };
      td4b.appendChild(rb);
      var td5 = document.createElement('td'), del = document.createElement('button'); del.type = 'button'; del.className = 'danger'; del.textContent = '刪除'; del.setAttribute('aria-label', '刪除 ' + x.name);
      del.onclick = function () {
        if (!window.confirm('刪除「' + x.name + '」？排程發布就不能再選這個背景' + (x.img ? '，下載的圖片也會刪除' : '') + '。')) return;
        bgPost('/admin/fb/backgrounds/' + x.id, undefined, 'DELETE').then(function (res) { if (res.ok) { bgSet(res.data); say($('bgMsg'), '已刪除', 'good'); } else if (res.code === 'unauthorized') expired(); else say($('bgMsg'), res.error || '刪除失敗。', 'err'); });
      };
      td5.appendChild(del);
      [td0, td1, td2, td3, td4, td4b, td5].forEach(function (td) { tr.appendChild(td); });
      box.appendChild(tr);
    });
    $('bgWrap').hidden = !bgList.length;
    // 實際會被隨機挑到的：列入隨機＋顯示中（圖樣還要已下載）
    var live = bgList.filter(function (x) { return x.rnd && x.show && (x.type !== 'image' || x.img); }).length;
    $('bgRndSum').textContent = '排程發布純文字預設從 ' + live + ' 個背景隨機挑一個' + (live ? '' : '（都沒有＝預設「無」）') + '。隱藏的、圖樣還沒下載的不算。';
    $('bgSum').textContent = bgList.length
      ? '已存 ' + bgList.length + ' 個：純色 ' + n.solid + '．漸層 ' + n.gradient + '．圖樣 ' + n.image + (n.image ? '（圖已下載 ' + got + '／' + n.image + '）' : '')
      : '還沒匯入，排程發布目前用內建的純色＋漸層。';
    var todo = bgTodo();
    $('bgFetch').hidden = !todo; $('bgFetch').textContent = '下載圖樣（' + todo + ' 張）';
    // 未下載圖樣最早的網址到期時間
    var first = bgList.reduce(function (m, x) { return x.type === 'image' && !x.img && x.hasUrl && x.exp && (!m || x.exp < m) ? x.exp : m; }, null);
    var fe = $('bgExp');
    if (!todo || !first) { fe.hidden = true; fe.textContent = ''; }
    else {
      var gone = first * 1000 <= Date.now(), soon = first * 1000 - Date.now() < 86400000;
      fe.hidden = false; fe.className = 'bg-exp' + (gone ? ' bg-err' : soon ? ' bg-warn' : '');
      fe.textContent = todo + ' 張未下載，最早 ' + bgExpText(first) + (gone ? ' 已過期（請重新擷取匯入）' : ' 到期（' + bgExpLeft(first) + '）');
    }
  }
  // 列入隨機快捷鈕：data-rnd＝solid／gradient／image（全選該種類）或 none（全部取消）
  Array.prototype.forEach.call(document.querySelectorAll('#bgRnd [data-rnd]'), function (b) {
    b.onclick = function () {
      var k = b.getAttribute('data-rnd'), on = k !== 'none';
      var ids = bgList.filter(function (x) { return (on ? x.type === k : true) && !!x.rnd !== on; }).map(function (x) { return x.id; });
      if (!ids.length) return say($('bgMsg'), '沒有要改的。', 'good');
      fxStart(b, '儲存中');
      bgPost('/admin/fb/backgrounds/random', { ids: ids, rnd: on }).then(function (res) {
        if (res.ok) { bgSet(res.data); say($('bgMsg'), (on ? '已列入隨機 ' : '已取消隨機 ') + ids.length + ' 個', 'good'); }
        else if (res.code === 'unauthorized') expired(); else say($('bgMsg'), res.error || '儲存失敗。', 'err');
      }).catch(function () { say($('bgMsg'), '連不上後端，請稍後再試。', 'err'); }).then(function () { fxEnd(b, $('bgMsg'), '已儲存'); });
    };
  });
  function bgSet(d) { bgList = (d && d.list) || []; bgRender(); }
  function bgLoad() {
    say($('bgMsg'), '讀取中');
    return api('/admin/fb/backgrounds').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      bgSet(res.data); say($('bgMsg'), '');
    }).catch(function (e) { say($('bgMsg'), '讀取失敗：' + (e && e.message || ''), 'err'); });
  }
  function bgParse() {
    var t = $('bgPaste').value.trim(); if (!t) return null;
    try { var v = JSON.parse(t); return Array.isArray(v) ? { presets: v } : v; } catch (e) { return null; }
  }
  $('bgPreview').onclick = function () {
    var data = bgParse();
    if (!data || !Array.isArray(data.presets)) { $('bgPaste').focus(); return say($('bgMsg'), '貼上的內容不是擷取腳本的結果（JSON，要有 presets）。', 'err'); }
    fxStart($('bgPreview'), '比對中'); say($('bgMsg'), '比對中');
    bgPost('/admin/fb/backgrounds', { presets: data.presets, dry: true }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); return say($('bgMsg'), res.error || '比對失敗。', 'err'); }
      var d = res.data; bgPend = data.presets;
      $('bgDiffSum').textContent = '新增 ' + d.add + '．更新 ' + d.update + '．臉書已沒有 ' + d.gone.length + (d.bad ? '．格式不對略過 ' + d.bad : '') + '（更新會保留名稱、顯示與已下載的圖）'
        + (d.exp ? '。這份圖樣網址最早 ' + bgExpText(d.exp) + (d.exp * 1000 <= Date.now() ? ' 已過期，請重新擷取' : ' 到期（' + bgExpLeft(d.exp) + '），套用後請盡快下載') : '');
      var g = $('bgGone'); g.textContent = ''; g.className = 'bg-gone';
      if (d.gone.length) {
        var h = document.createElement('p'); h.textContent = '臉書已沒有的背景：勾選的會刪除，沒勾的保留。'; g.appendChild(h);
        d.gone.forEach(function (x) {
          var l = document.createElement('label'), c = document.createElement('input'); c.type = 'checkbox'; c.value = x.id;
          l.appendChild(c); l.appendChild(document.createTextNode(x.name + '（' + (BG_TYPE[x.type] || x.type) + '）')); g.appendChild(l);
        });
      }
      $('bgDiff').hidden = false; say($('bgMsg'), ''); $('bgApply').focus();
    }).catch(function () { say($('bgMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { fxEnd($('bgPreview'), $('bgMsg'), '已比對'); });
  };
  $('bgCancel').onclick = function () { bgPend = null; $('bgDiff').hidden = true; say($('bgMsg'), ''); };
  $('bgApply').onclick = function () {
    if (!bgPend) return;
    var remove = Array.prototype.map.call($('bgGone').querySelectorAll('input:checked'), function (c) { return c.value; });
    fxStart($('bgApply'), '儲存中'); say($('bgMsg'), '儲存中');
    bgPost('/admin/fb/backgrounds', { presets: bgPend, remove: remove }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); return say($('bgMsg'), res.error || '儲存失敗。', 'err'); }
      bgPend = null; $('bgDiff').hidden = true; $('bgPaste').value = ''; bgSet(res.data);
      var todo = bgTodo();
      say($('bgMsg'), '已匯入' + (todo ? '，還有 ' + todo + ' 張圖樣要下載，請按「下載圖樣」。' : ''), 'good');
    }).catch(function () { say($('bgMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { fxEnd($('bgApply'), $('bgMsg'), '已匯入'); });
  };
  // 一次 10 張，直到沒有剩下；這一輪失敗的不重試（since），下次按才重試
  $('bgFetch').onclick = function () {
    var since = Date.now(), total = bgTodo(), done = 0, failed = 0;
    fxStart($('bgFetch'), '下載中');
    function step() {
      say($('bgMsg'), '下載中：' + (done + failed) + '／' + total);
      return bgPost('/admin/fb/backgrounds/fetch', { since: since }).then(function (res) {
        if (!res.ok) { if (res.code === 'unauthorized') { expired(); return; } throw new Error(res.error || '下載失敗。'); }
        done += res.data.done; failed += res.data.failed;
        if (res.data.left > 0 && res.data.done + res.data.failed > 0) return step();
      });
    }
    step().then(function () { return bgLoad(); }).then(function () {
      say($('bgMsg'), '下載完成：成功 ' + done + ' 張' + (failed ? '、失敗 ' + failed + ' 張（原因見表格）' : ''), failed ? 'err' : 'good');
    }).catch(function (e) { say($('bgMsg'), (e && e.message) || '連不上後端，請稍後再試。', 'err'); bgLoad(); })
      .then(function () { fxEnd($('bgFetch'), $('bgMsg'), '下載完成'); });
  };

  $('pgSave').onclick = function () {
    pgSync();
    for (var i = 0; i < pgItems.length; i++) {
      var n = pgItems[i].short.trim().length;
      if (n < 1 || n > 20) return say($('pgMsg'), '第 ' + (i + 1) + ' 個「' + pgItems[i].name + '」的簡稱要 1～20 字。', 'err');
      if (pgItems[i].utm.length > 200 || pgItems[i].utmText.length > 200) return say($('pgMsg'), '第 ' + (i + 1) + ' 個「' + pgItems[i].name + '」的 UTM 不能超過 200 字。', 'err');
    }
    var body = { pages: pgItems.map(function (it, k) { return { id: it.id, short: it.short.trim(), utm: it.utm.trim(), utmText: it.utmText.trim(), rd: it.rd, order: k, show: it.show ? 1 : 0 }; }) };
    fxStart($('pgSave'), '儲存中'); say($('pgMsg'), '儲存中');
    api('/admin/fb/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
      if (res.ok) { pgItems = pgMap(res.data); pgRender(); say($('pgMsg'), '已儲存', 'good'); }
      else if (res.code === 'unauthorized') expired();
      else say($('pgMsg'), res.error || '儲存失敗。', 'err');
    }).catch(function () { say($('pgMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { fxEnd($('pgSave'), $('pgMsg'), '已儲存'); });
  };

  function signOut() {
    token = ''; pending = ''; me = null; frontToken = '';
    $('app').hidden = true; $('logout').hidden = true; $('whoTag').hidden = true; $('confirm').hidden = true; $('sfConfirm').hidden = true; $('login').hidden = false;
    resetLoaded(); sfPending = null; pgItems = []; psItems = []; bgList = []; bgPend = null;
    try { $('pw').focus(); } catch (e) {}
  }
  // 登出：首頁憑證進來的＝回首頁；解鎖過的＝鎖回去；管理密碼登入的＝登出
  $('logout').onclick = function () {
    if (frontToken && token !== frontToken) { token = frontToken; say($('unlockMsg'), ''); enter($('loginMsg')); return; }
    signOut(); say($('loginMsg'), ''); $('pw').focus();
  };
  // 解鎖進階設定：輸入管理員密碼換 admin 憑證（只放記憶體）
  $('unlockForm').onsubmit = function (e) {
    e.preventDefault();
    fxStart($('unlockBtn'), '解鎖中'); say($('unlockMsg'), '解鎖中');
    api('/admin/login', { method: 'POST', body: JSON.stringify({ password: $('unlockPw').value }) }).then(function (res) {
      if (!res.ok) return say($('unlockMsg'), res.code === 'bad_password' ? '密碼不正確。' : (res.error || '解鎖失敗。'), 'err');
      var prev = token; token = res.data.token; $('unlockPw').value = ''; say($('unlockMsg'), '');
      return enter($('unlockMsg')).then(function (ok) { if (!ok) token = prev; });
    }).catch(function () { say($('unlockMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { fxEnd($('unlockBtn'), $('unlockMsg'), '已解鎖'); });
  };

  // 分類分頁：用隱藏切換，已讀進來的表格與填到一半的內容不會消失；網址 #post 等記住目前分類（舊的 #fb 等會轉到新分類）

  // ---- Rundown 連線（後端 /admin/rundown；不顯示網址與金鑰）----
  $('rdPing').onclick = function () {
    fxStart($('rdPing'), '測試中'); say($('rdMsg'), '測試中');
    api('/admin/rundown/ping', { method: 'POST' }).then(function (res) {
      if (res.ok) say($('rdMsg'), '連線正常：' + (res.data.title || '') + (res.data.sheets && res.data.sheets.length ? '（分頁：' + res.data.sheets.join('、') + '）' : ''), 'good');
      else if (res.code === 'unauthorized') expired();
      else say($('rdMsg'), res.error || '測試失敗。', 'err');
    }).catch(function () { say($('rdMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { fxEnd($('rdPing'), $('rdMsg'), '連線正常'); });
  };

  var rdLoaded = false;
  function rdLoad() {
    rdLoaded = true;
    api('/admin/rundown').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      var RD_STATE = { missing: '狀態：尚未設定 RUNDOWN_URL／RUNDOWN_TOKEN', url: '狀態：RUNDOWN_URL 沒設定或格式不對（要是 https://script.google.com/…/exec）', token: '狀態：RUNDOWN_TOKEN 是空的' };
      $('rdState').textContent = res.data.configured ? '狀態：已設定' : (RD_STATE[res.data.state] || RD_STATE.missing);
      $('rdState').className = 'fb-state ' + (res.data.configured ? 'on' : 'off');
    }).catch(function () { say($('rdMsg'), '讀取設定狀態失敗。', 'err'); });
  }

    // ---- 授權名單／權限組／操作紀錄（後端 /admin/staff、/admin/staff-groups、/admin/audit）----
  var sfState = null, sfPending = null, staffLoaded = false;
  var SF_ACT = { reset: '重置密碼', add: '新增人員', staff_rename: '修改姓名', publish: '立即發布', schedule: '排程', reschedule: '改時間', delete: '刪除', video_publish: '影片立即發布', video_schedule: '影片排程', video_draft: '影片存草稿', guard_mode: '留言管理模式', guard_hide: '隱藏留言', guard_unhide: '取消隱藏留言', comment_retry: '重新留言', msg_send: '發送通知', msg_recall: '撤回通知' };
  function sfEl(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function sfCall(path, method, body, msgEl, done) {
    var o = { method: method };
    if (body) { o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(body); }
    return api(path, o).then(function (res) {
      if (res.ok) {
        var setup = res.data && res.data.setup; if (setup) delete res.data.setup;
        sfState = res.data; sfRender(); if (done) say(msgEl, done, 'good');
        if (setup) sfShowCode(setup);
        return true;
      }
      if (res.code === 'unauthorized') { expired(); return false; }
      say(msgEl, res.error || '操作失敗。', 'err'); return false;
    }).catch(function () { say(msgEl, '連不上後端，請稍後再試。', 'err'); return false; });
  }
  // 新增或重置後顯示設定碼（只顯示這一次）
  function sfShowCode(setup) {
    var s = (sfState && sfState.staff || []).filter(function (x) { return x.id === setup.id; })[0];
    $('sfCodeTitle').textContent = (s ? s.name + '（' + s.id + '）' : setup.id) + '的設定碼';
    $('sfCodeVal').textContent = setup.code;
    $('sfCodeCopy').textContent = '複製';
    var d = $('sfCode'); if (!d.open) d.showModal();
    $('sfCodeCopy').focus();
  }
  $('sfCodeCopy').onclick = function () {
    var v = $('sfCodeVal').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { $('sfCodeCopy').textContent = '已複製'; }, function () { $('sfCodeCopy').textContent = '請手動複製'; });
  };
  $('sfCodeOk').onclick = function () { $('sfCode').close(); };
  $('sfCode').addEventListener('close', function () { $('sfCodeVal').textContent = ''; });
  function sfPwTag(s) {
    if (s.locked) return sfEl('span', 'tag bad', '鎖定中');
    if (s.pw === 'set') return sfEl('span', 'tag company', '已設定');
    if (s.pw === 'setup') { var t = sfEl('span', 'tag warn', '等待設定'); t.title = '設定碼有效到 ' + fmtTime(s.setupExp); return t; }
    return sfEl('span', 'tag', '未設定');
  }
  function sfGroupSelect(cur, label) {
    var s = document.createElement('select'); s.setAttribute('aria-label', label);
    sfState.groups.forEach(function (g) { var o = document.createElement('option'); o.value = g.id; o.textContent = g.name; if (g.assignable === false && g.id !== cur) o.disabled = true; s.appendChild(o); });
    s.value = cur; return s;
  }
  function sfRender() {
    if (!sfState) return;
    msFill();
    var keep = $('sfGroup').value;
    $('sfGroup').textContent = '';
    sfState.groups.forEach(function (g) { if (g.assignable === false) return; var o = document.createElement('option'); o.value = g.id; o.textContent = g.name; $('sfGroup').appendChild(o); });
    if (keep) $('sfGroup').value = keep;
    var meSt = sfState.me || {};
    $('sfForm').hidden = meSt.canAdd === false;
    var tb = $('sfRows'); tb.textContent = '';
    sfState.staff.forEach(function (s) {
      var tr = document.createElement('tr');
      tr.appendChild(sfEl('td', '', s.id));
      // 姓名：只有系統管理者能改（Enter／離開欄位存，失敗還原）；其他人唯讀
      var isSysRow = !!s.sys, tn = document.createElement('td');
      if (meSt.canRename) {
        var nt = document.createElement('input'); nt.type = 'text'; nt.className = 'sf-name'; nt.maxLength = 20; nt.value = s.name; nt.setAttribute('aria-label', s.id + ' 的姓名');
        nt.onchange = function () {
          var v = nt.value.trim();
          if (!v) { nt.value = s.name; say($('sfMsg'), '姓名不能空白。', 'err'); return; }
          nt.disabled = true;
          sfCall('/admin/staff/' + encodeURIComponent(s.id), 'POST', { name: v }, $('sfMsg'), '已把「' + s.name + '」的姓名改成「' + v + '」。').then(function (ok) { if (!ok) { nt.disabled = false; nt.value = s.name; nt.focus(); } });
        };
        tn.appendChild(nt);
      } else tn.textContent = s.name;
      tr.appendChild(tn);
      var tg = document.createElement('td'), sel = sfGroupSelect(s.group, s.name + ' 的權限組');
      sel.onchange = function () { sel.disabled = true; sfCall('/admin/staff/' + encodeURIComponent(s.id), 'POST', { group: sel.value }, $('sfMsg'), '已更新「' + s.name + '」的權限組。').then(function (ok) { if (!ok) sfRender(); }); };
      tg.appendChild(sel); tr.appendChild(tg);
      // 分機／手機：改完按 Enter 或離開欄位就存（同事在直播需求單填的也會出現在這裡）
      var tc = document.createElement('td'), ct = document.createElement('input');
      ct.type = 'text'; ct.className = 'sf-contact'; ct.maxLength = 30; ct.value = s.contact || ''; ct.setAttribute('aria-label', s.name + ' 的分機／手機'); ct.placeholder = '未填';
      ct.onchange = function () { ct.disabled = true; sfCall('/admin/staff/' + encodeURIComponent(s.id), 'POST', { contact: ct.value.trim() }, $('sfMsg'), '已更新「' + s.name + '」的分機／手機。').then(function (ok) { if (!ok) { ct.disabled = false; ct.focus(); } }); };
      tc.appendChild(ct); tr.appendChild(tc);
      var st = sfEl('td'); st.appendChild(sfEl('span', 'tag' + (s.enabled ? ' company' : ''), s.enabled ? '啟用' : '停用')); tr.appendChild(st);
      var tp = sfEl('td'); tp.appendChild(sfPwTag(s)); tr.appendChild(tp);
      // 最後登入：今年只寫「月/日 時:分」（游標看完整時間），省欄寬
      var ll = sfEl('td', 'num', s.lastLogin ? fmtShort(s.lastLogin) : '從未'); if (s.lastLogin) ll.title = fmtTime(s.lastLogin); tr.appendChild(ll);
      var ls = sfEl('td', 'num', s.lastSeen ? fmtAgo(s.lastSeen) : '—'); if (s.lastSeen) ls.title = fmtTime(s.lastSeen); tr.appendChild(ls);
      var ac = sfEl('td', 'sf-ops');
      var tgl = sfEl('button', '', s.enabled ? '停用' : '啟用'); tgl.type = 'button';
      tgl.onclick = function () { fxStart(tgl, s.enabled ? '停用中' : '啟用中'); sfCall('/admin/staff/' + encodeURIComponent(s.id), 'POST', { enabled: !s.enabled }, $('sfMsg'), s.enabled ? '已停用「' + s.name + '」。' : '已啟用「' + s.name + '」。').then(function (ok) { fxDone(tgl, ok, s.enabled ? '已停用' : '已啟用'); }); };
      var del = sfEl('button', 'danger', '移除'); del.type = 'button';
      del.onclick = function () { sfPending = s.id; $('sfCfText').textContent = s.name + '（' + s.id + '）會從名單移除，對方下一次操作就會被擋。'; $('sfConfirm').hidden = false; $('sfCfYes').focus(); };
      var rst = sfEl('button', '', '重置密碼'); rst.type = 'button';
      rst.onclick = function () {
        if (!window.confirm('重置「' + s.name + '」的密碼？\n對方所有裝置會登出，要用新的設定碼重新設密碼。')) return;
        fxStart(rst, '重置中');
        sfCall('/admin/staff/' + encodeURIComponent(s.id) + '/reset', 'POST', null, $('sfMsg'), '已重置「' + s.name + '」的密碼。').then(function (ok) { fxDone(rst, ok, '已重置'); });
      };
      ac.appendChild(rst); ac.appendChild(tgl); ac.appendChild(del); tr.appendChild(ac);
      // 系統管理者不能停用、移除
      if (isSysRow) { tgl.disabled = true; del.disabled = true; tgl.title = del.title = '系統管理者不能停用或移除'; }
      // 不能動的列（權限不是你的真子集、或是自己）：全部唯讀（系統管理者仍可改姓名）
      if (s.canEdit === false) Array.prototype.forEach.call(tr.querySelectorAll('select, input, button'), function (el) { el.disabled = true; el.title = '只能修改權限比你少的人'; });
      tb.appendChild(tr);
    });
    $('sfWrap').hidden = !sfState.staff.length; $('sfEmpty').hidden = !!sfState.staff.length;
    olRender();
    sgRender();
  }
  function sgRow(g) {   // g：{ id, name, perms, used }；id 空白＝新增中的一組
    var row = sfEl('div', 'pg-card sg-row');
    var name = document.createElement('input'); name.type = 'text'; name.maxLength = 20; name.value = g.name; name.setAttribute('aria-label', '權限組名稱'); name.placeholder = '權限組名稱';
    row.appendChild(name);
    var boxes = sfEl('div', 'sg-sections');
    // 依分區顯示（排程發布／影片發布／數據報表／共用／管理頁各分類）
    var label = {}; sfState.perms.forEach(function (p) { label[p.key] = p.label; });
    (sfState.sections || []).forEach(function (sec) {
      var box = sfEl('div', 'sg-sec'); box.appendChild(sfEl('h3', 'sg-sec-h', sec.name));
      var list = sfEl('div', 'sg-perms');
      sec.keys.forEach(function (k) {
        var l = sfEl('label', 'sg-perm'), c = document.createElement('input'); c.type = 'checkbox'; c.value = k; c.checked = g.perms.indexOf(k) >= 0;
        l.appendChild(c); l.appendChild(document.createTextNode(label[k] || k)); list.appendChild(l);
      });
      box.appendChild(list); boxes.appendChild(box);
    });
    row.appendChild(boxes);
    var act = sfEl('div', 'row');
    var save = sfEl('button', 'primary', '儲存'); save.type = 'button';
    save.onclick = function () {
      var nm = name.value.trim(); if (!nm) { name.focus(); return say($('sgMsg'), '請填權限組名稱。', 'err'); }
      var perms = Array.prototype.filter.call(boxes.querySelectorAll('input'), function (c) { return c.checked; }).map(function (c) { return c.value; });
      var body = { name: nm, perms: perms }; if (g.id) body.id = g.id;
      fxStart(save, '儲存中'); say($('sgMsg'), '儲存中');
      sfCall('/admin/staff-groups', 'POST', body, $('sgMsg'), '已儲存「' + nm + '」。').then(function (ok) { fxDone(save, ok, '已儲存'); });
    };
    var del = sfEl('button', 'danger', '刪除'); del.type = 'button';
    if (!g.id) del.onclick = function () { row.remove(); };
    else if (g.used > 0) { del.disabled = true; del.title = '還有 ' + g.used + ' 人使用'; }
    else del.onclick = function () {
      if (!window.confirm('刪除權限組「' + g.name + '」？')) return;
      sfCall('/admin/staff-groups/' + encodeURIComponent(g.id), 'DELETE', null, $('sgMsg'), '已刪除「' + g.name + '」。');
    };
    act.appendChild(save); act.appendChild(del);
    if (g.id) act.appendChild(sfEl('span', 'sg-used', g.used + ' 人使用'));
    row.appendChild(act);
    return row;
  }
  function sgRender() {
    var box = $('sgRows'); box.textContent = '';
    sfState.groups.forEach(function (g) { box.appendChild(sgRow(g)); });
  }
  $('sgNew').onclick = function () {
    if (!sfState) return;
    var r = sgRow({ id: '', name: '', perms: [], used: 0 }); $('sgRows').appendChild(r); r.querySelector('input').focus();
  };

  // ---- 發送通知（只有系統管理者；後端 server/core/msgs.js）----
  var msLoaded = false, msBusy = false;
  function msStaff() { return ((sfState && sfState.staff) || []).filter(function (s) { return s.enabled; }); }
  function msFill() {
    if (!me || me.role !== 'sys') return;
    var st = msStaff(), keepOne = $('msOne').value, keepGrp = $('msGroup').value;
    var checked = {}; Array.prototype.forEach.call($('msMany').querySelectorAll('input:checked'), function (c) { checked[c.value] = 1; });
    $('msOne').textContent = ''; $('msMany').textContent = ''; $('msGroup').textContent = '';
    st.forEach(function (s) {
      var o = document.createElement('option'); o.value = s.id; o.textContent = s.name + '（' + s.id + '）'; $('msOne').appendChild(o);
      var l = sfEl('label'), c = document.createElement('input'); c.type = 'checkbox'; c.value = s.id; c.checked = !!checked[s.id];
      l.appendChild(c); l.appendChild(document.createTextNode(s.name + '（' + s.id + '）')); $('msMany').appendChild(l);
    });
    ((sfState && sfState.groups) || []).forEach(function (g) { var o = document.createElement('option'); o.value = g.id; o.textContent = g.name; $('msGroup').appendChild(o); });
    if (keepOne) $('msOne').value = keepOne;
    if (keepGrp) $('msGroup').value = keepGrp;
  }
  function msApplyMode() {
    var m = $('msMode').value;
    $('msOneBox').hidden = m !== 'one'; $('msManyBox').hidden = m !== 'many'; $('msGroupBox').hidden = m !== 'group';
    $('msConfirm').hidden = true;
  }
  // 目前選的收件人 → { body, n }（n＝預計收到的人數）
  function msPayload() {
    var m = $('msMode').value, st = msStaff(), b = { mode: m, body: $('msBody').value.trim() }, n = 0;
    if (m === 'one') { b.uids = $('msOne').value ? [$('msOne').value] : []; n = b.uids.length; }
    else if (m === 'many') { b.uids = Array.prototype.map.call($('msMany').querySelectorAll('input:checked'), function (c) { return c.value; }); n = b.uids.length; }
    else if (m === 'all') n = st.length;
    else { var gv = $('msGroup').value; b.group = /^\d+$/.test(gv) ? Number(gv) : gv; n = st.filter(function (s) { return String(s.group) === String(b.group); }).length; }
    return { body: b, n: n };
  }
  $('msMode').onchange = msApplyMode;
  $('msBody').oninput = function () { $('msCount').textContent = $('msBody').value.length + '／200 字'; $('msConfirm').hidden = true; };
  $('msSend').onclick = function () {
    var p = msPayload();
    if (!p.body.body) return say($('msMsg'), '請輸入通知內容。', 'err');
    if (!p.n) return say($('msMsg'), '沒有可收件的人，請選擇收件人。', 'err');
    say($('msMsg'), '');
    $('msCfText').textContent = '要發送給 ' + p.n + ' 人嗎？';
    $('msConfirm').hidden = false;
  };
  $('msCfNo').onclick = function () { $('msConfirm').hidden = true; };
  $('msCfYes').onclick = function () {
    if (msBusy) return;
    var p = msPayload(); msBusy = true; fxStart($('msCfYes'), '發送中');
    api('/admin/msgs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p.body) }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); say($('msMsg'), res.error || '發送失敗。', 'err'); return; }
      $('msBody').value = ''; $('msCount').textContent = '0／200 字';
      say($('msMsg'), '已發送給 ' + res.data.count + ' 人。', 'good'); return msLoad();
    }).catch(function (e) { say($('msMsg'), '發送失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { msBusy = false; fxDone($('msCfYes'), null); $('msConfirm').hidden = true; });
  };
  function msLoad() {
    return api('/admin/msgs').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      msRender(res.data.items || []);
    }).catch(function (e) { msLoaded = false; say($('msMsg'), '讀取已發送清單失敗：' + (e && e.message || ''), 'err'); });
  }
  function msRender(items) {
    var ul = $('msList'); ul.textContent = '';
    items.forEach(function (m) {
      var li = sfEl('li', 'ms-item' + (m.recalled ? ' is-recalled' : ''));
      var top = sfEl('div', 'ms-top'); top.appendChild(sfEl('span', '', fmtTime(m.at))); top.appendChild(sfEl('span', '', '收件 ' + m.count + ' 人'));
      if (m.recalled) top.appendChild(sfEl('b', '', '已撤回'));
      var body = sfEl('div', 'ms-body', m.body);
      var ops = sfEl('div', 'ms-ops');
      var tg = sfEl('button', '', '已讀 ' + m.read + '／' + m.count); tg.type = 'button'; tg.setAttribute('aria-expanded', 'false');
      var to = sfEl('ul', 'ms-to'); to.hidden = true;
      (m.to || []).forEach(function (t) { var x = sfEl('li', t.readAt ? 'is-read' : 'is-unread', t.name + (t.readAt ? '　已讀 ' + fmtShort(t.readAt) : '　未讀')); to.appendChild(x); });
      tg.onclick = function () { to.hidden = !to.hidden; tg.setAttribute('aria-expanded', String(!to.hidden)); };
      ops.appendChild(tg);
      if (!m.recalled) {
        var rc = sfEl('button', 'danger', '撤回'); rc.type = 'button';
        rc.onclick = function () {
          fxStart(rc, '撤回中');
          api('/admin/msgs/' + m.id + '/recall', { method: 'POST' }).then(function (res) {
            if (!res.ok) { if (res.code === 'unauthorized') return expired(); say($('msMsg'), res.error || '撤回失敗。', 'err'); fxDone(rc, false); return; }
            say($('msMsg'), '已撤回，收件人不會再看到這則通知。', 'good'); return msLoad();
          }).catch(function (e) { fxDone(rc, false); say($('msMsg'), '撤回失敗：' + (e && e.message || ''), 'err'); });
        };
        ops.appendChild(rc);
      }
      li.appendChild(top); li.appendChild(body); li.appendChild(ops); li.appendChild(to); ul.appendChild(li);
    });
    $('msEmpty').hidden = items.length > 0; ul.hidden = !items.length;
  }
  msApplyMode();
  // 目前在線（只有系統管理者）：名單的最後使用時間在 5 分鐘內＝在線（後端每 5 分鐘最多記一次，不另打 API）
  var ONLINE_MS = 5 * 60 * 1000;
  function olRender() {
    var now = Date.now(), on = sfState.staff.filter(function (s) { return s.enabled && s.lastSeen && now - s.lastSeen <= ONLINE_MS; })
      .sort(function (a, b) { return b.lastSeen - a.lastSeen; });
    $('olCount').textContent = on.length + ' 人';
    var ul = $('olList'); ul.textContent = '';
    on.forEach(function (s) {
      var li = sfEl('li', 'ol-item'); li.appendChild(sfEl('span', 'ol-dot')); li.appendChild(sfEl('b', '', s.name));
      var t = sfEl('small', '', fmtAgo(s.lastSeen, now)); t.title = fmtTime(s.lastSeen); li.appendChild(t); ul.appendChild(li);
    });
    $('olEmpty').hidden = on.length > 0; ul.hidden = !on.length;
    $('olAt').textContent = '更新於 ' + fmtTime(now).slice(11);
  }
  $('olRefresh').onclick = function () { fxStart($('olRefresh'), '讀取中'); sfLoad().then(function () { fxEnd($('olRefresh'), $('sfMsg')); }); };
  function sfLoad() {
    say($('sfMsg'), '讀取中');
    return api('/admin/staff').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      sfState = res.data; sfRender(); say($('sfMsg'), '');
    }).catch(function (e) { staffLoaded = false; say($('sfMsg'), '讀取失敗：' + (e && e.message || ''), 'err'); });
  }
  $('sfForm').onsubmit = function (e) {
    e.preventDefault();
    var body = { id: $('sfId').value.trim(), name: $('sfName').value.trim(), group: $('sfGroup').value, contact: $('sfContact').value.trim() };
    fxStart($('sfAdd'), '新增中'); say($('sfMsg'), '新增中');
    sfCall('/admin/staff', 'POST', body, $('sfMsg'), '已新增「' + body.name + '」。').then(function (ok) {
      if (ok) { $('sfId').value = ''; $('sfName').value = ''; $('sfContact').value = ''; $('sfId').focus(); }
      fxDone($('sfAdd'), ok, '已新增');
    });
  };
  $('sfCfNo').onclick = function () { sfPending = null; $('sfConfirm').hidden = true; };
  $('sfCfYes').onclick = function () {
    var id = sfPending; if (!id) return;
    fxStart($('sfCfYes'), '移除中');
    sfCall('/admin/staff/' + encodeURIComponent(id), 'DELETE', null, $('sfMsg'), '已移除。').then(function () {
      $('sfConfirm').hidden = true; sfPending = null; fxDone($('sfCfYes'), null);
    });
  };
  // 操作紀錄：類別（工具／後台）依動作判斷；發文類型從 detail 的 kind= 讀（舊紀錄沒有）
  var AU_TOOL = { publish: 1, schedule: 1, reschedule: 1, delete: 1, video_publish: 1, video_schedule: 1, video_draft: 1, comment_retry: 1 };
  var AU_OPEN = { publish: 1, schedule: 1, reschedule: 1, video_publish: 1, video_schedule: 1, video_draft: 1, comment_retry: 1 };   // 這些的 post 是貼文／影片 ID
  var AU_KIND = { template: '套版', textimg: '字圖', text: '文字' };
  function auKind(detail) { var m = /(?:^|\s)kind=(\w+)/.exec(detail || ''); return m && AU_KIND[m[1]] ? AU_KIND[m[1]] : ''; }
  // 類別篩選在後端（?src=），這裡只畫這一頁
  function auRender(list) {
    var tb = $('auRows'); tb.textContent = '';
    list.forEach(function (r) {
      var tr = document.createElement('tr'), tool = !!AU_TOOL[r.action];
      tr.appendChild(sfEl('td', 'num', fmtTime(r.at)));
      tr.appendChild(sfEl('td', '', r.uid === 'ADMIN' ? 'ADMIN（管理員密碼）' : r.uid)); tr.appendChild(sfEl('td', '', r.name || ''));
      var ts = document.createElement('td'); ts.appendChild(sfEl('span', 'au-src' + (tool ? '' : ' is-admin'), tool ? '工具' : '後台')); tr.appendChild(ts);
      var k = auKind(r.detail), act = SF_ACT[r.action] || r.action;
      tr.appendChild(sfEl('td', '', k ? act + '（' + k + '）' : act));
      var tdPg = sfEl('td', r.pageName ? '' : 'num', r.pageName || r.page || ''); if (r.pageName) tdPg.title = '粉專 ID ' + r.page; tr.appendChild(tdPg);   // 顯示簡稱，游標移上去看 ID
      var tp = document.createElement('td');
      if (r.post && AU_OPEN[r.action] && /^\d{1,30}(_\d{1,30})?$/.test(r.post)) {
        var a = document.createElement('a'); a.className = 'au-open'; a.href = fbPostUrl(r.post); a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = '開啟貼文 ↗'; a.title = r.post; a.setAttribute('aria-label', '開啟貼文 ' + r.post + '（另開分頁）');
        tp.appendChild(a);
      } else if (r.post) { tp.className = 'num'; tp.textContent = r.post; tp.style.color = '#5b6472'; }
      tr.appendChild(tp);
      tb.appendChild(tr);
    });
    $('auWrap').hidden = !list.length;
    if (list.length) say($('auMsg'), '');
  }
  var auPager = pager('au', function (offset, limit) {
    var q = 'days=' + encodeURIComponent($('auDays').value) + '&limit=' + limit + '&offset=' + offset, who = $('auUid').value.trim();
    if (who) q += '&q=' + encodeURIComponent(who);
    if ($('auSrc').value) q += '&src=' + encodeURIComponent($('auSrc').value);
    say($('auMsg'), '查詢中');
    return api('/admin/audit?' + q).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') { expired(); return null; } say($('auMsg'), res.error || '查詢失敗。', 'err'); return null; }
      return res.data || [];
    }).catch(function () { say($('auMsg'), '連不上後端，請稍後再試。', 'err'); return null; });
  }, auRender, '這段期間沒有紀錄。');
  $('auSrc').onchange = function () { if (!$('auWrap').hidden || $('auPager').hidden === false) auPager.go(0); };
  $('auUid').onkeydown = function (e) { if (e.key === 'Enter') $('auBtn').click(); };
  $('auBtn').onclick = function () { fxStart($('auBtn'), '查詢中'); auPager.go(0).then(function () { fxEnd($('auBtn'), $('auMsg')); }); };

  // ---- 首頁儀表板（GET /admin/dash）：進到首頁查一次；「重新整理」帶 fresh=1 ----
  var dashLoaded = false, dashSeq = 0;
  var DASH_TABS = { adv: '進階設定', rec: '使用紀錄', conn: '連接狀態', people: '人員與權限', post: '發文設定' };
  function dashLoad(fresh) {
    dashLoaded = true;
    var seq = ++dashSeq;
    $('dashNeed').setAttribute('aria-busy', 'true'); $('dashRefresh').disabled = true;
    if (!$('dashGrid').childElementCount) $('dashSkel').hidden = false;
    api('/admin/dash' + (fresh ? '?fresh=1' : '')).then(function (res) {
      if (seq !== dashSeq) return;
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error || ''); }
      dashRender(res.data); say($('dashMsg'), '');
    }).catch(function (e) {
      if (seq !== dashSeq) return;
      dashLoaded = false;
      say($('dashMsg'), '讀取失敗' + (e && e.message ? '：' + e.message : '') + '，請按「重新整理」再試一次。', 'err');
    }).then(function () {
      if (seq !== dashSeq) return;
      $('dashSkel').hidden = true; $('dashNeed').setAttribute('aria-busy', 'false'); $('dashRefresh').disabled = false;
    });
  }
  // 儀表板項目 → 該分類裡對應的功能（跳過去直接看到那張卡片）
  var DASH_SUB = { access: 'access', profile: 'profiles', fbtoken: 'fbconn', webhook: 'webhook', groups: 'groups', logs: 'logs', rundown: 'rd', usage: 'usage', online: 'online', bg: 'bg' };
  function dashGo(tab, key) { return function () { if (!$('tab-' + tab).hidden) showTab(tab, true, DASH_SUB[key]); }; }
  function dashRender(d) {
    var p = function (v) { return String(v).padStart(2, '0'); }, at = new Date(d.at);
    $('dashAt').textContent = '資料時間 ' + p(at.getHours()) + ':' + p(at.getMinutes());
    $('dashAt').title = fmtTime(d.at);
    var need = d.items.filter(function (x) { return x.level === 'bad'; }).concat(d.items.filter(function (x) { return x.level === 'warn'; }));
    var ul = $('dashList'); ul.textContent = '';
    need.forEach(function (x) {
      var li = document.createElement('li'), b = document.createElement('button'), dot = document.createElement('span'), t = document.createElement('span'), go = document.createElement('span');
      b.type = 'button'; dot.className = 'dot ' + x.level; dot.setAttribute('aria-label', x.level === 'bad' ? '壞了' : '快過期或要注意');
      t.textContent = x.name + '：' + x.text; go.className = 'go'; go.textContent = DASH_TABS[x.tab] || '';
      b.appendChild(dot); b.appendChild(t); b.appendChild(go); b.onclick = dashGo(x.tab, x.key);
      li.appendChild(b); ul.appendChild(li);
    });
    $('dashAllOk').hidden = !!need.length;
    var grid = $('dashGrid'); grid.textContent = '';
    d.items.forEach(function (x) {
      var b = document.createElement('button'), nm = document.createElement('span'), dot = document.createElement('span'), tx = document.createElement('span');
      b.type = 'button'; b.className = 'dash-tile ' + x.level; b.title = '到「' + (DASH_TABS[x.tab] || '') + '」';
      dot.className = 'dot ' + x.level; nm.className = 'nm'; nm.appendChild(dot); nm.appendChild(document.createTextNode(x.name));
      tx.className = 'tx'; tx.textContent = x.text;
      b.appendChild(nm); b.appendChild(tx); b.onclick = dashGo(x.tab, x.key);
      grid.appendChild(b);
    });
  }
  $('dashRefresh').onclick = function () { dashLoad(true); };

  // ---- 實驗功能（敏感卡片 labs）：每一項＝開關＋對象（全部人／指定員工）----
  //   lab：/admin/fb/comment-opts（第一則留言發出後再編輯一次，看發文者）；labV：/admin/fb/video-opts（影片串流上傳，看上傳的人）
  //   labP：/admin/fb/preview-opts（第一則留言移除連結預覽，看發文者；方法 A／B；排程發布勾選只限單次送出）
  //   有 <p>Method 單選（name=<p>Method）的項目，讀寫時多帶 method
  var labLoaded = false;
  function makeLab(p, path, field) {
    function who() { var r = document.querySelector('input[name=' + p + 'Who]:checked'); return r ? r.value : 'all'; }
    function sync() {
      var on = $(p + 'On').checked;
      $(p + 'WhoBox').disabled = !on;
      if ($(p + 'MethodBox')) $(p + 'MethodBox').disabled = !on;
      $(p + 'People').hidden = !(on && who() === 'some');
    }
    function render(d) {
      $(p + 'On').checked = !!d[field];
      Array.prototype.forEach.call(document.querySelectorAll('input[name=' + p + 'Who]'), function (r) { r.checked = r.value === (d.who || 'all'); });
      Array.prototype.forEach.call(document.querySelectorAll('input[name=' + p + 'Method]'), function (r) { r.checked = r.value === (d.method || 'a'); });
      var people = d.people || [], box = $(p + 'People'), picked = d.staff || [];
      box.textContent = '';
      if (!people.length) { var em = document.createElement('p'); em.className = 'hint'; em.textContent = '授權名單還沒有員工。'; box.appendChild(em); }
      people.forEach(function (x) {
        var l = document.createElement('label'); l.className = 'check';
        var c = document.createElement('input'); c.type = 'checkbox'; c.value = x.id; c.checked = picked.indexOf(x.id) >= 0;
        l.appendChild(c); l.appendChild(document.createTextNode(' ' + x.name + '（' + x.id + '）' + (x.enabled ? '' : '・已停用')));
        box.appendChild(l);
      });
      // 名單裡已經沒有的編號也保留顯示（勾著），儲存時一併送出
      picked.filter(function (id) { return !people.some(function (x) { return x.id === id; }); }).forEach(function (id) {
        var l = document.createElement('label'); l.className = 'check';
        var c = document.createElement('input'); c.type = 'checkbox'; c.value = id; c.checked = true;
        l.appendChild(c); l.appendChild(document.createTextNode(' ' + id + '・不在名單'));
        box.appendChild(l);
      });
      sync();
    }
    function load() {
      $(p + 'Save').disabled = true; say($(p + 'Msg'), '讀取中…');
      return api(path).then(function (res) {
        if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
        render(res.data); $(p + 'Save').disabled = false; say($(p + 'Msg'), '');
      }).catch(function (e) { labLoaded = false; say($(p + 'Msg'), '讀取失敗' + (e && e.message ? '：' + e.message : '') + '，請切換分類再回來。', 'err'); });
    }
    $(p + 'On').onchange = sync;
    Array.prototype.forEach.call(document.querySelectorAll('input[name=' + p + 'Who]'), function (r) { r.onchange = sync; });
    $(p + 'Save').onclick = function () {
      var w = who();
      var staff = w === 'some' ? Array.prototype.map.call($(p + 'People').querySelectorAll('input:checked'), function (c) { return c.value; }) : [];
      if ($(p + 'On').checked && w === 'some' && !staff.length) return say($(p + 'Msg'), '選「指定員工」要至少勾一位。', 'err');
      fxStart($(p + 'Save'), '儲存中'); say($(p + 'Msg'), '儲存中…');
      var body = { who: w, staff: staff }; body[field] = $(p + 'On').checked;
      var mt = document.querySelector('input[name=' + p + 'Method]:checked'); if (mt) body.method = mt.value;
      api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
        if (res.ok) { render(res.data); var d = res.data; say($(p + 'Msg'), !d[field] ? '已關閉' : d.who === 'all' ? '已啟用：全部人（約 1 分鐘內生效）' : '已啟用：指定 ' + d.staff.length + ' 位員工（約 1 分鐘內生效）', 'good'); }
        else if (res.code === 'unauthorized') expired(); else say($(p + 'Msg'), res.error || '儲存失敗。', 'err');
      }).catch(function () { say($(p + 'Msg'), '連不上後端，請稍後再試。', 'err'); }).then(function () { fxEnd($(p + 'Save'), $(p + 'Msg'), '已儲存'); });
    };
    return load;
  }
  var labLoads = [makeLab('lab', '/admin/fb/comment-opts', 'edit'), makeLab('labV', '/admin/fb/video-opts', 'stream'), makeLab('labP', '/admin/fb/preview-opts', 'on')];
  // 依序讀：權杖過期時只彈一次（第一個讀到 unauthorized 就停）
  function labLoad() { labLoaded = true; return labLoads.reduce(function (p, f) { return p.then(function () { if (labLoaded) return f(); }); }, Promise.resolve()); }
  // ---- 進階設定「未登入時隱藏的工具」（GET／POST /admin/site/vis，只有已解鎖系統管理者）；工具清單來自網站的 shell/catalog.json ----
  var tvLoaded = false;
  function tvLoad() {
    tvLoaded = true; $('tvSave').disabled = true; say($('tvMsg'), '讀取中…');
    Promise.all([api('/admin/site/vis'), fetch('../shell/catalog.json').then(function (r) { return r.json(); })]).then(function (x) {
      var res = x[0], tools = (x[1] && x[1].tools) || [];
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error || ''); }
      $('tvOn').checked = !!res.data.on;
      var box = $('tvList'); box.textContent = '';
      tools.forEach(function (t) {
        var l = document.createElement('label'), c = document.createElement('input');
        c.type = 'checkbox'; c.value = t.id; c.checked = res.data.hide.indexOf(t.id) >= 0;
        l.appendChild(c); l.appendChild(document.createTextNode(t.name + (t.group ? '（' + t.group + '）' : ''))); box.appendChild(l);
      });
      $('tvSave').disabled = false; say($('tvMsg'), '');
    }).catch(function (e) { tvLoaded = false; say($('tvMsg'), '讀取失敗' + (e && e.message ? '：' + e.message : '') + '，請切換分類再回來。', 'err'); });
  }
  $('tvSave').onclick = function () {
    var hide = Array.prototype.filter.call($('tvList').querySelectorAll('input'), function (c) { return c.checked; }).map(function (c) { return c.value; });
    fxStart($('tvSave'), '儲存中'); say($('tvMsg'), '儲存中…');
    api('/admin/site/vis', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: $('tvOn').checked, hide: hide }) }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error || ''); }
      say($('tvMsg'), '已儲存，網站約 1 分鐘內生效（重新整理）。', 'good');
    }).catch(function (e) { say($('tvMsg'), '儲存失敗' + (e && e.message ? '：' + e.message : ''), 'err'); }).then(function () { fxEnd($('tvSave'), $('tvMsg'), '已儲存'); });
  };
  // ---- 進階設定「儀表板顯示項目」（GET／POST /admin/dash/config，只有已解鎖系統管理者）----
  var dcLoaded = false;
  function dcLoad() {
    dcLoaded = true; $('dcSave').disabled = true; say($('dcMsg'), '讀取中…');
    api('/admin/dash/config').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error || ''); }
      var box = $('dcList'); box.textContent = '';
      res.data.all.forEach(function (x) {
        var l = document.createElement('label'), c = document.createElement('input');
        c.type = 'checkbox'; c.value = x.key; c.checked = res.data.items.indexOf(x.key) >= 0;
        l.appendChild(c); l.appendChild(document.createTextNode(x.name)); box.appendChild(l);
      });
      $('dcSave').disabled = false; say($('dcMsg'), '');
    }).catch(function (e) { dcLoaded = false; say($('dcMsg'), '讀取失敗' + (e && e.message ? '：' + e.message : '') + '，請切換分類再回來。', 'err'); });
  }
  $('dcSave').onclick = function () {
    var items = Array.prototype.filter.call($('dcList').querySelectorAll('input'), function (c) { return c.checked; }).map(function (c) { return c.value; });
    fxStart($('dcSave'), '儲存中'); say($('dcMsg'), '儲存中…');
    api('/admin/dash/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: items }) }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error || ''); }
      say($('dcMsg'), '已儲存，首頁重新整理後生效。', 'good'); dashLoaded = false;
    }).catch(function (e) { say($('dcMsg'), '儲存失敗' + (e && e.message ? '：' + e.message : ''), 'err'); }).then(function () { fxEnd($('dcSave'), $('dcMsg'), '已儲存'); });
  };

  var TABS = ['home', 'post', 'guard', 'people', 'conn', 'assets', 'rec', 'adv'];
  // 舊網址（分類改版前）轉到新分類
  var OLD_TABS = { fb: 'post', staff: 'people', rd: 'conn', logs: 'rec' };
  // 各分類的功能（＝右側上方分頁）：[代號, 名稱, 卡片 id]；首頁、素材設定不拆
  var SUBS = {
    post: [['pages', '粉專設定', 'pgCard'], ['presets', '活動留言', 'psCard'], ['bg', '文字背景', 'bgCard'], ['video', '影片設定', 'vsCard']],
    guard: [['set', '設定', 'gdCard'], ['log', '紀錄', 'gdLogCard']],
    people: [['online', '目前在線', 'olCard'], ['msg', '發送通知', 'msCard'], ['staff', '授權名單', 'sfCard']],
    conn: [['fb', '臉書粉專連線狀態', 'fsCard'], ['rd', 'Rundown 連線', 'rdCard'], ['usage', '速率限制', 'usCard']],
    rec: [['audit', '操作紀錄', 'auCard'], ['logs', '錯誤紀錄', 'lgCard']],
    adv: [['access', '排程發布', 'acCard'], ['dash', '儀表板顯示項目', 'dcCard'], ['toolvis', '未登入隱藏工具', 'tvCard'], ['labs', '實驗功能', 'labCard'], ['profiles', '權杖組別', 'tpCard'], ['fbconn', '臉書連線', 'fbCard'], ['webhook', 'Webhook', 'whCard'], ['groups', '權限組', 'sgCard']]
  };
  var curSub = {};   // 每個分類目前的功能
  var assetsLoaded = false;
  function visTabs() { return TABS.filter(function (t) { return !$('tab-' + t).hidden; }); }
  // 分類內看得到的功能（卡片沒被權限隱藏）
  function visSubs(t) { return (SUBS[t] || []).filter(function (s) { return !$(s[2]).hidden; }); }
  function parseHash() {
    var h = decodeURIComponent(location.hash.slice(1)).split('/'), t = OLD_TABS[h[0]] || h[0], v = visTabs();
    if (v.indexOf(t) < 0) return { tab: v[0], sub: '' };
    return { tab: t, sub: h[1] || '' };
  }
  function tabFromHash() { return parseHash().tab; }
  // 每個分類上方建一排功能分頁（隱藏切換）
  Object.keys(SUBS).forEach(function (t) {
    var bar = document.createElement('div');
    bar.className = 'sub-tabs'; bar.id = 'subs-' + t; bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', $('tab-' + t).textContent + '的功能');
    SUBS[t].forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'tab'); b.id = 'sub-' + t + '-' + s[0]; b.setAttribute('data-sub', s[0]);
      b.setAttribute('aria-controls', s[2]); b.textContent = s[1];
      b.onclick = function () { showTab(t, false, s[0]); };
      b.onkeydown = function (e) {
        var v = visSubs(t).map(function (x) { return x[0]; }), i = v.indexOf(s[0]);
        var d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (e.key === 'Home') d = -i; else if (e.key === 'End') d = v.length - 1 - i;
        if (d === undefined) return;
        e.preventDefault();
        showTab(t, false, v[(i + d + v.length) % v.length]); $('sub-' + t + '-' + v[(i + d + v.length) % v.length]).focus();
      };
      bar.appendChild(b);
    });
    var first = $(SUBS[t][0][2]);
    first.parentNode.insertBefore(bar, first);
  });
  // 權限變了（登入、解鎖）：重算每排看得到的功能
  function subApply() {
    Object.keys(SUBS).forEach(function (t) {
      var v = visSubs(t);
      SUBS[t].forEach(function (s) { $('sub-' + t + '-' + s[0]).hidden = v.indexOf(s) < 0; });
      $('subs-' + t).hidden = v.length < 2;
      markSub(t, curSub[t]);
    });
  }
  // 只顯示 t 分類的 k 功能（其他卡片加 sub-off 隱藏，內容保留）
  function markSub(t, k) {
    var v = visSubs(t);
    if (!v.some(function (s) { return s[0] === k; })) k = v.length ? v[0][0] : '';
    curSub[t] = k;
    SUBS[t].forEach(function (s) {
      var on = s[0] === k, b = $('sub-' + t + '-' + s[0]);
      b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
      $(s[2]).classList.toggle('sub-off', !on);
    });
    return k;
  }
  function showTab(id, focus, sub) {
    TABS.forEach(function (t) {
      var on = t === id, b = $('tab-' + t);
      b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
      $('panel-' + t).hidden = !on;
    });
    var k = SUBS[id] ? markSub(id, sub || curSub[id]) : '';
    var h = id + (k && visSubs(id).length > 1 ? '/' + k : '');
    if (location.hash.slice(1) !== h) history.replaceState(null, '', '#' + h);
    renderSide();
    if (focus) $('tab-' + id).focus();
    // 手機版分類列會橫向捲動：把目前分類捲進畫面
    var tb = $('tab-' + id); if (tb.scrollIntoView && window.matchMedia && window.matchMedia('(max-width:820px)').matches) tb.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // 臉書相關卡片（發文設定、留言管理、連接狀態、進階設定）共用一次讀取
    if ((id === 'post' || id === 'guard' || id === 'conn' || id === 'adv') && !fbLoaded && token) fbLoad();
    if ((id === 'people' || id === 'adv') && !staffLoaded && token && (can('staff') || can('groups'))) { staffLoaded = true; sfLoad(); }
    if (id === 'people' && me && me.role === 'sys' && !msLoaded && token) { msLoaded = true; msLoad(); }
    if (id === 'conn' && !rdLoaded && token && can('rundown')) rdLoad();
    if (id === 'assets' && !assetsLoaded && token && can('assets')) { assetsLoaded = true; load(); }
    if (id === 'home' && !dashLoaded && token && me && me.dash && me.dash.length) dashLoad(false);
    if (id === 'adv' && !dcLoaded && token && can('dashcfg')) dcLoad();
    if (id === 'adv' && !tvLoaded && token && can('toolvis')) tvLoad();
    if (id === 'adv' && !labLoaded && token && can('labs')) labLoad();
  }
  function showHash() { var h = parseHash(); showTab(h.tab, false, h.sub); }

  // ---- 電腦版：左側分類手風琴。目前分類一直展開；游標停 150ms（或鍵盤聚焦）展開其他分類，把下面往下推。
  //      游標還在左側時展開過的都不收（收合會讓下方往上縮、游標底下換人）；離開左側才收回只剩目前分類 ----
  var nav = $('tab-adv').parentNode, sideOpen = {}, sideT = 0, sideSkip = false;
  var wide = window.matchMedia ? window.matchMedia('(min-width:821px)') : { matches: true };
  Object.keys(SUBS).forEach(function (t) {
    var g = document.createElement('div');
    g.className = 'side-sub'; g.id = 'side-' + t; g.hidden = true; g.setAttribute('role', 'group'); g.setAttribute('aria-label', $('tab-' + t).textContent + '的功能');
    SUBS[t].forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = s[1]; b.setAttribute('data-sub', s[0]); b.id = 'side-' + t + '-' + s[0];
      b.onclick = function () { showTab(t, false, s[0]); };
      g.appendChild(b);
    });
    var tb = $('tab-' + t); tb.parentNode.insertBefore(g, tb.nextSibling);
  });
  function curTab() { var c = ''; TABS.forEach(function (t) { if ($('tab-' + t).getAttribute('aria-selected') === 'true') c = t; }); return c; }
  function renderSide() {
    var cur = curTab();
    Object.keys(SUBS).forEach(function (t) {
      var v = visSubs(t), g = $('side-' + t), on = wide.matches && v.length > 1 && !$('tab-' + t).hidden && (t === cur || !!sideOpen[t]);
      g.hidden = !on;
      if (t === cur) $('tab-' + t).removeAttribute('aria-expanded'); else $('tab-' + t).setAttribute('aria-expanded', on ? 'true' : 'false');
      if (v.length < 2 || !wide.matches) $('tab-' + t).removeAttribute('aria-expanded');
      SUBS[t].forEach(function (s) {
        var b = $('side-' + t + '-' + s[0]);
        b.hidden = v.indexOf(s) < 0;
        if (t === cur && curSub[t] === s[0]) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      });
    });
  }
  function sideClose() { clearTimeout(sideT); sideOpen = {}; renderSide(); }
  nav.addEventListener('mouseleave', sideClose);
  nav.addEventListener('focusout', function (e) { if (!e.relatedTarget || !nav.contains(e.relatedTarget)) sideClose(); });
  if (wide.addEventListener) wide.addEventListener('change', renderSide);
  // 子功能按鈕：上下鍵移動、Esc 收起（目前分類不收）並回到分類
  nav.addEventListener('keydown', function (e) {
    var g = e.target.parentNode; if (!g || !g.classList || !g.classList.contains('side-sub')) return;
    var t = g.id.slice(5), bs = Array.prototype.filter.call(g.querySelectorAll('button'), function (x) { return !x.hidden; }), i = bs.indexOf(e.target);
    if (e.key === 'Escape') { delete sideOpen[t]; renderSide(); sideSkip = true; $('tab-' + t).focus(); sideSkip = false; e.preventDefault(); return; }
    var d = { ArrowDown: 1, ArrowUp: -1 }[e.key]; if (d === undefined) return;
    e.preventDefault(); bs[(i + d + bs.length) % bs.length].focus();
  });

  TABS.forEach(function (t) {
    var b = $('tab-' + t);
    b.onclick = function () { showTab(t); };
    b.addEventListener('mouseenter', function () {
      clearTimeout(sideT);
      if (!SUBS[t] || sideOpen[t]) return;
      sideT = setTimeout(function () { sideOpen[t] = true; renderSide(); }, 150);
    });
    b.addEventListener('mouseleave', function () { clearTimeout(sideT); });
    // 鍵盤聚焦（不是滑鼠點）也展開
    b.addEventListener('focus', function () { if (!sideSkip && SUBS[t] && b.matches && b.matches(':focus-visible')) { sideOpen[t] = true; renderSide(); } });
    b.onkeydown = function (e) {
      if (e.key === 'Escape' && sideOpen[t]) { delete sideOpen[t]; renderSide(); e.preventDefault(); return; }
      var v = visTabs(), i = v.indexOf(t);
      var d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (e.key === 'Home') d = -i; else if (e.key === 'End') d = v.length - 1 - i;
      if (d === undefined) return;
      e.preventDefault();
      showTab(v[(i + d + v.length) % v.length], true);
    };
  });
  window.addEventListener('hashchange', function () { if (me) showHash(); });
  // 首頁已登入（員工編號）就直接進；否則顯示密碼登入
  frontToken = readFront();
  if (frontToken) {
    token = frontToken;
    $('login').hidden = true;
    enter($('loginMsg')).then(function (ok) {
      if (ok) return;
      token = ''; frontToken = ''; $('login').hidden = false;
      if (!$('loginMsg').textContent) say($('loginMsg'), '首頁的登入沒有管理頁權限或已過期，請輸入管理員密碼。', 'err');
      try { $('pw').focus(); } catch (e) {}
    }).catch(function () { token = ''; frontToken = ''; $('login').hidden = false; say($('loginMsg'), '連不上後端，請稍後再試。', 'err'); });
  } else { try { $('pw').focus(); } catch (e) {} }
})();
