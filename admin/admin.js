// 管理後台（admin/index.html）。
//   進入方式：首頁登入的公司憑證（localStorage，員工編號＋密碼）直接進；或在這裡輸入管理員密碼（admin 憑證只放記憶體）。
//   可見卡片依 GET /admin/me 的 cards（層級權限見 server/core/adminperm.js）；敏感卡片要輸入管理員密碼解鎖。
import { API_BASE, API_ENV } from '../shell/config.js';
import { companyKey } from '../sdk/api.js';

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
      var vis = Array.prototype.some.call($('panel-' + t).querySelectorAll('[data-card]'), function (el) { return !el.hidden; });
      $('tab-' + t).hidden = !vis;
    });
    // 進階設定：只有系統管理者看得到；沒解鎖時分類內只顯示密碼輸入
    $('tab-adv').hidden = me.role !== 'sys';
    $('unlockBar').hidden = !(me.role === 'sys' && !me.unlocked);
    $('whoTag').hidden = false;
    $('whoTag').textContent = (me.role === 'sys' ? '' : me.name + '・') + me.roleName + (me.role === 'sys' && !me.unlocked ? '（進階設定已鎖）' : '');
    // 首頁憑證進來且沒解鎖：不顯示（「回工具箱」就是離開）；解鎖過＝鎖定；管理密碼登入＝登出
    $('logout').hidden = !!frontToken && token === frontToken;
    $('logout').textContent = frontToken ? '鎖定' : '登出';
  }
  function resetLoaded() { fbLoaded = false; rdLoaded = false; staffLoaded = false; assetsLoaded = false; lvLoaded = false; sfState = null; }
  // 用目前的 token 讀身分；成功就進入管理頁
  function enter(msgEl) {
    return api('/admin/me').then(function (res) {
      if (!res.ok) {
        if (res.code === 'forbidden') { say(msgEl, '你的層級在管理頁沒有任何可用的功能。', 'err'); return false; }
        if (res.code === 'unauthorized') return false;
        say(msgEl, res.error || '讀取身分失敗。', 'err'); return false;
      }
      me = res.data; resetLoaded();
      $('login').hidden = true; $('app').hidden = false; say($('loginMsg'), '');
      applyMe(); showTab(tabFromHash());
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
    $('loginBtn').disabled = true; say($('loginMsg'), '登入中');
    api('/admin/login', { method: 'POST', body: JSON.stringify({ password: $('pw').value }) }).then(function (res) {
      if (res.ok) { token = res.data.token; $('pw').value = ''; return enter($('loginMsg')); }
      say($('loginMsg'), res.code === 'bad_password' ? '密碼不正確。' : (res.error || '登入失敗。'), 'err');
    }).catch(function () { say($('loginMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('loginBtn').disabled = false; });
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
    $('upBtn').disabled = true; say($('upMsg'), '上傳中');
    api('/admin/assets/' + encodeURIComponent(key), { method: 'PUT', headers: { 'X-Tier': $('tier').value }, body: f }).then(function (res) {
      if (res.ok) { say($('upMsg'), '已上傳「' + key + '」。', 'good'); $('file').value = ''; load(); }
      else if (res.code === 'unauthorized') expired();
      else say($('upMsg'), res.error || '上傳失敗。', 'err');
    }).catch(function () { say($('upMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('upBtn').disabled = false; });
  };

  $('cfNo').onclick = function () { pending = ''; $('confirm').hidden = true; };
  $('cfYes').onclick = function () {
    var key = pending; if (!key) return;
    $('cfYes').disabled = true;
    api('/admin/assets/' + encodeURIComponent(key), { method: 'DELETE' }).then(function (res) {
      $('confirm').hidden = true; pending = '';
      if (res.ok) { say($('listMsg'), '已刪除「' + key + '」。', 'good'); load(); }
      else if (res.code === 'unauthorized') expired();
      else say($('listMsg'), res.error || '刪除失敗。', 'err');
    }).catch(function () { say($('listMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('cfYes').disabled = false; });
  };

  $('logBtn').onclick = function () {
    $('logBtn').disabled = true; say($('logMsg'), '讀取中');
    api('/admin/logs?days=7').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      var tb = $('logRows'); tb.textContent = '';
      res.data.forEach(function (r) {
        var tr = document.createElement('tr');
        [fmtTime(r.at), r.tool, r.code, r.ver || ''].forEach(function (t, i) {
          var c = document.createElement('td'); c.textContent = t; if (i === 0) c.className = 'num'; tr.appendChild(c);
        });
        tb.appendChild(tr);
      });
      $('logWrap').hidden = !res.data.length;
      say($('logMsg'), res.data.length ? '共 ' + res.data.length + ' 筆。' : '最近 7 天沒有任何錯誤。', 'good');
    }).catch(function () { say($('logMsg'), '讀取日誌失敗。', 'err'); })
      .then(function () { $('logBtn').disabled = false; });
  };

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
  function acSet(mode, done) {
    var reason = $('acReason').value.trim();
    if (Array.from(reason).length > 100) return say($('acMsg'), '關閉原因最多 100 字。', 'err');
    $('acOpen').disabled = $('acClose').disabled = $('acReasonSave').disabled = true; say($('acMsg'), '儲存中');
    api('/admin/fb/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: mode, reason: reason }) }).then(function (res) {
      if (res.ok) { acShow(res.data); say($('acMsg'), done, 'good'); }
      else if (res.code === 'unauthorized') expired();
      else say($('acMsg'), res.error || '儲存失敗。', 'err');
    }).catch(function () { say($('acMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('acOpen').disabled = $('acClose').disabled = $('acReasonSave').disabled = false; });
  }
  $('acOpen').onclick = function () { acSet('company', '已開放'); };
  $('acClose').onclick = function () { acSet('admin', '已關閉'); };
  $('acReasonSave').onclick = function () { acSet(acMode || 'admin', '已儲存原因'); };

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
    $('appSave').disabled = true; say($('appMsg'), '向臉書驗證中');
    api('/admin/fb/app' + tpQ(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: id, secret: sec }) }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      $('appSecret').value = ''; $('appId').value = '';
      say($('appMsg'), '已驗證並儲存（App ID ' + res.data.appId + '）。之後貼剛產生的權杖會自動延長。', 'good');
      return fbLoad();
    }).catch(function (e) { say($('appMsg'), '沒有存：' + (e && e.message || '失敗'), 'err'); })
      .then(function () { $('appSave').disabled = false; });
  };
  $('appClear').onclick = function () {
    if (!window.confirm('清除管理頁存的 App 密鑰？清除後貼權杖前要先按 Extend。')) return;
    $('appClear').disabled = true;
    api('/admin/fb/app' + tpQ(), { method: 'DELETE' }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      say($('appMsg'), '已清除。', 'good');
      return fbLoad();
    }).catch(function (e) { say($('appMsg'), '失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { $('appClear').disabled = false; });
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
    $('usAsk').disabled = true; say($('usMsg'), '向臉書查詢中');
    api('/admin/fb/usage/refresh', { method: 'POST' }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      usShow(res.data);
      say($('usMsg'), '已查詢 ' + res.data.asked + ' 次' + (res.data.failed ? '，' + res.data.failed + ' 次失敗' : '') + '。', res.data.failed ? 'err' : 'good');
    }).catch(function (e) { say($('usMsg'), '查詢失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { $('usAsk').disabled = false; });
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
    $('gdPerm').disabled = true; say($('gdMsg'), '向臉書查詢權限');
    api('/admin/fb/guard?check=1').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      gdProfiles(res.data.profiles, keep);
      var ok = res.data.profiles.filter(function (p) { return p.meta; }).map(function (p) { return p.name; });
      say($('gdMsg'), ok.length ? '有 pages_manage_metadata 的組別：' + ok.join('、') : '沒有任何組別有 pages_manage_metadata。', ok.length ? 'good' : 'err');
    }).catch(function (e) { say($('gdMsg'), '查詢失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { $('gdPerm').disabled = false; });
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
    $('gdSave').disabled = true; say($('gdMsg'), '儲存中');
    api('/admin/fb/guard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      $('gdProfile').dataset.saved = res.data.profile; gdFill(res.data.rules); gdStats(res.data.stats);
      say($('gdMsg'), '已儲存。', 'good');
      if (saved !== res.data.profile) return gdPages(false);
    }).catch(function (e) { say($('gdMsg'), '儲存失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { $('gdSave').disabled = false; });
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
      b.disabled = true; say($('gdLogMsg'), hidden ? '取消隱藏中' : '隱藏中');
      api('/admin/fb/guard/log/' + it.cid + '/' + (hidden ? 'unhide' : 'hide'), { method: 'POST' }).then(function (res) {
        if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
        var open = !ex.hidden, n = gdItem(res.data);
        tr.replaceWith(n[0]); ex.replaceWith(n[1]);
        if (open) n[0].querySelector('.gd-more').click();
        say($('gdLogMsg'), hidden ? '已取消隱藏。' : '已隱藏。', 'good');
      }).catch(function (e) { b.disabled = false; say($('gdLogMsg'), '失敗：' + (e && e.message || ''), 'err'); });
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
    $('fbTokSave').disabled = true; say($('fbTokMsg'), '向臉書驗證中');
    api('/admin/fb/token' + tpQ(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: v }) }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      $('fbTok').value = '';
      var d = res.data;
      say($('fbTokMsg'), (d.extended ? '已自動延長權杖，' : '已換成新權杖，') + '並換好 ' + (d.pages || 0) + ' 個粉專權杖（永不過期）' + (d.app ? '；App：' + d.app : '') + '。', 'good');
      return fbLoad();
    }).catch(function (e) { say($('fbTokMsg'), '沒有換：' + (e && e.message || '失敗'), 'err'); })
      .then(function () { $('fbTokSave').disabled = false; });
  };
  $('fbTokClear').onclick = function () {
    if (!window.confirm('刪除管理頁存的權杖，改回使用 Secret FB_USER_TOKEN？')) return;
    $('fbTokClear').disabled = true;
    api('/admin/fb/token' + tpQ(), { method: 'DELETE' }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      say($('fbTokMsg'), '已改回 Secret。', 'good');
      return fbLoad();
    }).catch(function (e) { say($('fbTokMsg'), '失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { $('fbTokClear').disabled = false; });
  };
  $('fbRefresh').onclick = function () {
    $('fbRefresh').disabled = true; say($('fbMsg'), '重新讀取中');
    api('/admin/fb/refresh' + tpQ(), { method: 'POST' }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      var r = res.data || {};
      var m = r.renewed ? '已重新換好粉專權杖：' + r.pages + ' 個。' : r.reason === 'user_expired' ? '使用者權杖已過期，保留原本的粉專權杖（照常發文）；要加新粉專請換新權杖。' : r.reason === 'failed' ? '沒有更新：' + (r.error || '') + ' 保留原本的粉專權杖。' : '已重新讀取。';
      return fbLoad().then(function () { say($('fbMsg'), m, r.reason ? 'err' : 'good'); });
    }).catch(function (e) { say($('fbMsg'), '重新讀取失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { $('fbRefresh').disabled = false; });
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
    $('vsSave').disabled = true; say($('vsMsg'), '儲存中');
    api('/admin/fb/video-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
      if (res.ok) { vsShow(res.data); say($('vsMsg'), '已儲存', 'good'); }
      else if (res.code === 'unauthorized') expired();
      else say($('vsMsg'), res.error || '儲存失敗。', 'err');
    }).catch(function () { say($('vsMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('vsSave').disabled = false; });
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
    $('psSave').disabled = true; say($('psMsg'), '儲存中');
    api('/admin/fb/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
      if (res.ok) { psItems = res.data.map(function (p) { return { name: p.name, body: p.body }; }); psRender(); say($('psMsg'), '已儲存', 'good'); }
      else if (res.code === 'unauthorized') expired();
      else say($('psMsg'), res.error || '儲存失敗。', 'err');
    }).catch(function () { say($('psMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('psSave').disabled = false; });
  };

  $('pgSave').onclick = function () {
    pgSync();
    for (var i = 0; i < pgItems.length; i++) {
      var n = pgItems[i].short.trim().length;
      if (n < 1 || n > 20) return say($('pgMsg'), '第 ' + (i + 1) + ' 個「' + pgItems[i].name + '」的簡稱要 1～20 字。', 'err');
      if (pgItems[i].utm.length > 200 || pgItems[i].utmText.length > 200) return say($('pgMsg'), '第 ' + (i + 1) + ' 個「' + pgItems[i].name + '」的 UTM 不能超過 200 字。', 'err');
    }
    var body = { pages: pgItems.map(function (it, k) { return { id: it.id, short: it.short.trim(), utm: it.utm.trim(), utmText: it.utmText.trim(), rd: it.rd, order: k, show: it.show ? 1 : 0 }; }) };
    $('pgSave').disabled = true; say($('pgMsg'), '儲存中');
    api('/admin/fb/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
      if (res.ok) { pgItems = pgMap(res.data); pgRender(); say($('pgMsg'), '已儲存', 'good'); }
      else if (res.code === 'unauthorized') expired();
      else say($('pgMsg'), res.error || '儲存失敗。', 'err');
    }).catch(function () { say($('pgMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('pgSave').disabled = false; });
  };

  function signOut() {
    token = ''; pending = ''; me = null; frontToken = '';
    $('app').hidden = true; $('logout').hidden = true; $('whoTag').hidden = true; $('confirm').hidden = true; $('sfConfirm').hidden = true; $('login').hidden = false;
    resetLoaded(); sfPending = null; pgItems = []; psItems = [];
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
    $('unlockBtn').disabled = true; say($('unlockMsg'), '解鎖中');
    api('/admin/login', { method: 'POST', body: JSON.stringify({ password: $('unlockPw').value }) }).then(function (res) {
      if (!res.ok) return say($('unlockMsg'), res.code === 'bad_password' ? '密碼不正確。' : (res.error || '解鎖失敗。'), 'err');
      var prev = token; token = res.data.token; $('unlockPw').value = ''; say($('unlockMsg'), '');
      return enter($('unlockMsg')).then(function (ok) { if (!ok) token = prev; });
    }).catch(function () { say($('unlockMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('unlockBtn').disabled = false; });
  };

  // ---- 層級權限（/admin/levels，只有已解鎖的系統管理者）----
  var lvLoaded = false, lvData = null;
  function lvRender(levels) {
    var tb = $('lvRows'); tb.textContent = '';
    lvData.cards.forEach(function (c) {
      var tr = document.createElement('tr');
      var th = document.createElement('td'); th.textContent = c.name + (c.sensitive && !c.locked ? ' ⚠' : ''); tr.appendChild(th);
      ['mgr', 'user'].forEach(function (lv) {
        var td = document.createElement('td');
        if (c.locked) { td.textContent = '只有系統管理者'; td.className = 'lv-lock'; }
        else {
          var cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.lv = lv; cb.dataset.key = c.key;
          cb.checked = levels[lv].indexOf(c.key) >= 0;
          cb.setAttribute('aria-label', (lv === 'mgr' ? '管理者' : '普通') + '：' + c.name);
          cb.onchange = function () {
            if (cb.checked && c.sensitive && !window.confirm('「' + c.name + '」含權杖或權限設定，勾給' + (lv === 'mgr' ? '管理者' : '普通') + '後，對方不用輸入管理員密碼就能使用。確定要勾嗎？')) { cb.checked = false; return; }
            // 普通 ⊆ 管理者：普通勾了，管理者跟著勾；管理者取消，普通跟著取消
            var other = tb.querySelector('input[data-key="' + c.key + '"][data-lv="' + (lv === 'mgr' ? 'user' : 'mgr') + '"]');
            if (lv === 'user' && cb.checked) other.checked = true;
            if (lv === 'mgr' && !cb.checked) other.checked = false;
          };
          td.appendChild(cb);
        }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
  }
  function lvPick() {
    var r = { mgr: [], user: [] };
    Array.prototype.forEach.call($('lvRows').querySelectorAll('input[type=checkbox]'), function (cb) { if (cb.checked) r[cb.dataset.lv].push(cb.dataset.key); });
    return r;
  }
  function lvLoad() {
    lvLoaded = true; say($('lvMsg'), '讀取中');
    return api('/admin/levels').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      lvData = res.data; lvRender(lvData.levels); say($('lvMsg'), '');
    }).catch(function (e) { lvLoaded = false; say($('lvMsg'), '讀取失敗：' + (e && e.message || ''), 'err'); });
  }
  $('lvReset').onclick = function () { if (lvData) { lvRender(lvData.defaults); say($('lvMsg'), '已還原成預設，按「儲存」才會生效。'); } };
  $('lvSave').onclick = function () {
    $('lvSave').disabled = true; say($('lvMsg'), '儲存中');
    api('/admin/levels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lvPick()) }).then(function (res) {
      if (res.ok) { lvData = res.data; lvRender(lvData.levels); say($('lvMsg'), '已儲存，對方下一次操作就會套用。', 'good'); }
      else if (res.code === 'unauthorized') expired();
      else say($('lvMsg'), res.error || '儲存失敗。', 'err');
    }).catch(function () { say($('lvMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('lvSave').disabled = false; });
  };

  // 分類分頁：用隱藏切換，已讀進來的表格與填到一半的內容不會消失；網址 #post 等記住目前分類（舊的 #fb 等會轉到新分類）

  // ---- Rundown 連線（後端 /admin/rundown；不顯示網址與金鑰）----
  $('rdPing').onclick = function () {
    $('rdPing').disabled = true; say($('rdMsg'), '測試中');
    api('/admin/rundown/ping', { method: 'POST' }).then(function (res) {
      if (res.ok) say($('rdMsg'), '連線正常：' + (res.data.title || '') + (res.data.sheets && res.data.sheets.length ? '（分頁：' + res.data.sheets.join('、') + '）' : ''), 'good');
      else if (res.code === 'unauthorized') expired();
      else say($('rdMsg'), res.error || '測試失敗。', 'err');
    }).catch(function () { say($('rdMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('rdPing').disabled = false; });
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
  var SF_ACT = { reset: '重置密碼', add: '新增人員', publish: '立即發布', schedule: '排程', reschedule: '改時間', delete: '刪除', video_publish: '影片立即發布', video_schedule: '影片排程', video_draft: '影片存草稿', guard_mode: '留言管理模式', guard_hide: '隱藏留言', guard_unhide: '取消隱藏留言' };
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
  var LV_NAME = { sys: '系統管理者', mgr: '管理者', user: '普通' };
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
    var keep = $('sfGroup').value;
    $('sfGroup').textContent = '';
    sfState.groups.forEach(function (g) { if (g.assignable === false) return; var o = document.createElement('option'); o.value = g.id; o.textContent = g.name; $('sfGroup').appendChild(o); });
    if (keep) $('sfGroup').value = keep;
    var meSt = sfState.me || {};
    $('sfForm').hidden = meSt.canAdd === false;
    var tb = $('sfRows'); tb.textContent = '';
    sfState.staff.forEach(function (s) {
      var tr = document.createElement('tr');
      tr.appendChild(sfEl('td', '', s.id)); tr.appendChild(sfEl('td', '', s.name));
      var tl = document.createElement('td'), isSysRow = s.level === 'sys';
      if (isSysRow) tl.textContent = LV_NAME.sys;
      else if (meSt.canLevel) {
        var ls = document.createElement('select'); ls.setAttribute('aria-label', s.name + ' 的層級');
        ['user', 'mgr'].forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = LV_NAME[k]; ls.appendChild(o); });
        ls.value = s.level;
        ls.onchange = function () { ls.disabled = true; sfCall('/admin/staff/' + encodeURIComponent(s.id), 'POST', { level: ls.value }, $('sfMsg'), '已把「' + s.name + '」改成' + LV_NAME[ls.value] + '。').then(function (ok) { if (!ok) sfRender(); }); };
        tl.appendChild(ls);
      } else tl.textContent = LV_NAME[s.level] || '普通';
      tr.appendChild(tl);
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
      tr.appendChild(sfEl('td', 'num', s.lastLogin ? fmtTime(s.lastLogin) : '從未'));
      var ac = sfEl('td', 'sf-ops');
      var tgl = sfEl('button', '', s.enabled ? '停用' : '啟用'); tgl.type = 'button';
      tgl.onclick = function () { tgl.disabled = true; sfCall('/admin/staff/' + encodeURIComponent(s.id), 'POST', { enabled: !s.enabled }, $('sfMsg'), s.enabled ? '已停用「' + s.name + '」。' : '已啟用「' + s.name + '」。'); };
      var del = sfEl('button', 'danger', '移除'); del.type = 'button';
      del.onclick = function () { sfPending = s.id; $('sfCfText').textContent = s.name + '（' + s.id + '）會從名單移除，對方下一次操作就會被擋。'; $('sfConfirm').hidden = false; $('sfCfYes').focus(); };
      var rst = sfEl('button', '', '重置密碼'); rst.type = 'button';
      rst.onclick = function () {
        if (!window.confirm('重置「' + s.name + '」的密碼？\n對方所有裝置會登出，要用新的設定碼重新設密碼。')) return;
        rst.disabled = true;
        sfCall('/admin/staff/' + encodeURIComponent(s.id) + '/reset', 'POST', null, $('sfMsg'), '已重置「' + s.name + '」的密碼。').then(function (ok) { if (!ok) rst.disabled = false; });
      };
      ac.appendChild(rst); ac.appendChild(tgl); ac.appendChild(del); tr.appendChild(ac);
      // 系統管理者不能停用、移除
      if (isSysRow) { tgl.disabled = true; del.disabled = true; tgl.title = del.title = '系統管理者不能停用或移除'; }
      // 不能動的列（層級不比自己低、或是自己）：全部唯讀
      if (s.canEdit === false) Array.prototype.forEach.call(tr.querySelectorAll('select, input, button'), function (el) { if (!(meSt.canLevel && el.getAttribute('aria-label') === s.name + ' 的層級')) { el.disabled = true; el.title = '只能修改層級比你低的人'; } });
      tb.appendChild(tr);
    });
    $('sfWrap').hidden = !sfState.staff.length; $('sfEmpty').hidden = !!sfState.staff.length;
    sgRender();
  }
  function sgRow(g) {   // g：{ id, name, perms, used }；id 空白＝新增中的一組
    var row = sfEl('div', 'pg-card sg-row');
    var name = document.createElement('input'); name.type = 'text'; name.maxLength = 20; name.value = g.name; name.setAttribute('aria-label', '權限組名稱'); name.placeholder = '權限組名稱';
    row.appendChild(name);
    var boxes = sfEl('div', 'sg-perms');
    sfState.perms.forEach(function (p) {
      var l = sfEl('label', 'sg-perm'), c = document.createElement('input'); c.type = 'checkbox'; c.value = p.key; c.checked = g.perms.indexOf(p.key) >= 0;
      l.appendChild(c); l.appendChild(document.createTextNode(p.label)); boxes.appendChild(l);
    });
    row.appendChild(boxes);
    var act = sfEl('div', 'row');
    var save = sfEl('button', 'primary', '儲存'); save.type = 'button';
    save.onclick = function () {
      var nm = name.value.trim(); if (!nm) { name.focus(); return say($('sgMsg'), '請填權限組名稱。', 'err'); }
      var perms = Array.prototype.filter.call(boxes.querySelectorAll('input'), function (c) { return c.checked; }).map(function (c) { return c.value; });
      var body = { name: nm, perms: perms }; if (g.id) body.id = g.id;
      save.disabled = true; say($('sgMsg'), '儲存中');
      sfCall('/admin/staff-groups', 'POST', body, $('sgMsg'), '已儲存「' + nm + '」。').then(function (ok) { if (!ok) save.disabled = false; });
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
    $('sfAdd').disabled = true; say($('sfMsg'), '新增中');
    sfCall('/admin/staff', 'POST', body, $('sfMsg'), '已新增「' + body.name + '」。').then(function (ok) {
      if (ok) { $('sfId').value = ''; $('sfName').value = ''; $('sfContact').value = ''; $('sfId').focus(); }
      $('sfAdd').disabled = false;
    });
  };
  $('sfCfNo').onclick = function () { sfPending = null; $('sfConfirm').hidden = true; };
  $('sfCfYes').onclick = function () {
    var id = sfPending; if (!id) return;
    $('sfCfYes').disabled = true;
    sfCall('/admin/staff/' + encodeURIComponent(id), 'DELETE', null, $('sfMsg'), '已移除。').then(function () {
      $('sfConfirm').hidden = true; sfPending = null; $('sfCfYes').disabled = false;
    });
  };
  $('auBtn').onclick = function () {
    var q = 'days=' + encodeURIComponent($('auDays').value), uid = $('auUid').value.trim();
    if (uid) q += '&uid=' + encodeURIComponent(uid);
    $('auBtn').disabled = true; say($('auMsg'), '查詢中');
    api('/admin/audit?' + q).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); say($('auMsg'), res.error || '查詢失敗。', 'err'); return; }
      var tb = $('auRows'); tb.textContent = '';
      res.data.forEach(function (r) {
        var tr = document.createElement('tr');
        tr.appendChild(sfEl('td', 'num', fmtTime(r.at))); tr.appendChild(sfEl('td', '', r.uid === 'ADMIN' ? 'ADMIN（管理員密碼）' : r.uid)); tr.appendChild(sfEl('td', '', r.name || ''));
        tr.appendChild(sfEl('td', '', SF_ACT[r.action] || r.action)); tr.appendChild(sfEl('td', 'num', r.page || '')); tr.appendChild(sfEl('td', 'num', r.post || ''));
        tb.appendChild(tr);
      });
      $('auWrap').hidden = !res.data.length;
      say($('auMsg'), res.data.length ? '共 ' + res.data.length + ' 筆。' : '這段期間沒有紀錄。');
    }).catch(function () { say($('auMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('auBtn').disabled = false; });
  };

  var TABS = ['post', 'guard', 'people', 'conn', 'assets', 'rec', 'adv'];
  // 舊網址（分類改版前）轉到新分類
  var OLD_TABS = { fb: 'post', staff: 'people', rd: 'conn', logs: 'rec' };
  var assetsLoaded = false;
  function visTabs() { return TABS.filter(function (t) { return !$('tab-' + t).hidden; }); }
  function tabFromHash() { var t = location.hash.slice(1), v = visTabs(); t = OLD_TABS[t] || t; return v.indexOf(t) >= 0 ? t : v[0]; }
  function showTab(id, focus) {
    TABS.forEach(function (t) {
      var on = t === id, b = $('tab-' + t);
      b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
      $('panel-' + t).hidden = !on;
    });
    if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
    if (focus) $('tab-' + id).focus();
    // 臉書相關卡片（發文設定、留言管理、連接狀態、進階設定）共用一次讀取
    if ((id === 'post' || id === 'guard' || id === 'conn' || id === 'adv') && !fbLoaded && token) fbLoad();
    if ((id === 'people' || id === 'adv') && !staffLoaded && token && (can('staff') || can('groups'))) { staffLoaded = true; sfLoad(); }
    if (id === 'adv' && !lvLoaded && token && can('levels')) lvLoad();
    if (id === 'conn' && !rdLoaded && token && can('rundown')) rdLoad();
    if (id === 'assets' && !assetsLoaded && token && can('assets')) { assetsLoaded = true; load(); }
  }
  TABS.forEach(function (t) {
    var b = $('tab-' + t);
    b.onclick = function () { showTab(t); };
    b.onkeydown = function (e) {
      var v = visTabs(), i = v.indexOf(t);
      var d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (e.key === 'Home') d = -i; else if (e.key === 'End') d = v.length - 1 - i;
      if (d === undefined) return;
      e.preventDefault();
      showTab(v[(i + d + v.length) % v.length], true);
    };
  });
  window.addEventListener('hashchange', function () { if (me) showTab(tabFromHash()); });
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
