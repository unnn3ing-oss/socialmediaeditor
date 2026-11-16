// 管理後台（admin/index.html）。token 只放在記憶體，重新整理就要重新登入。
import { API_BASE } from '../shell/config.js';

// 不讓別的網站把後台嵌進框架（GitHub Pages 不能設 x-frame-options）
if (window.top !== window.self) {
  document.documentElement.textContent = '';
  try { window.top.location = window.self.location.href; } catch (e) { /* 跨網域擋下就維持空白 */ }
  throw new Error('framed');
}

(function () {
  var token = '';
  var pending = '';
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
    signOut();
    say($('loginMsg'), '登入已過期，請重新登入。', 'err');
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
      if (res.ok) {
        token = res.data.token; $('pw').value = '';
        $('login').hidden = true; $('app').hidden = false; $('logout').hidden = false; say($('loginMsg'), '');
        assetsLoaded = false; showTab(tabFromHash());
      } else say($('loginMsg'), res.code === 'bad_password' ? '密碼不正確。' : (res.error || '登入失敗。'), 'err');
    }).catch(function () { say($('loginMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('loginBtn').disabled = false; });
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
    return api('/admin/fb/status').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      var d = res.data, ul = $('fbMissing'); ul.textContent = ''; ul.hidden = true;
      if (!d.configured) { $('fbState').textContent = '狀態：後端尚未設定 FB_USER_TOKEN'; $('fbState').className = 'fb-state off'; return; }
      $('fbState').textContent = '狀態：' + (d.valid ? '連線正常' : 'token 無效，請重新授權') + '；' + fmtExp(d.expires) + '；粉專 ' + (d.pages || 0) + ' 個' + (d.valid && !d.pages ? '（token 讀不到可管理的粉專：授權時要勾選粉專，並有 pages_manage_posts）' : '');
      $('fbState').className = 'fb-state ' + (d.valid ? 'on' : 'off');
      (d.missing || []).forEach(function (m) { var li = document.createElement('li'); li.textContent = '缺少權限：' + m; ul.appendChild(li); });
      ul.hidden = !(d.missing && d.missing.length);
    });
  }

  // ---- 粉專設定（/admin/fb/pages）----
  var pgItems = [];   // 目前表格順序；每列 { id, name, short, utm, rd, show }
  var RD_OPTS = [['', '不寫入'], ['news', '主粉'], ['ent', '娛樂粉'], ['shaokang', '少康粉'], ['intl', '國際＋粉']];
  function pgMap(list) { return list.map(function (p) { return { id: p.id, name: p.name, short: p.short, utm: p.utm || '', rd: p.rd || '', show: !!p.show }; }); }
  function pgSync() {   // 把輸入框的值寫回 pgItems（換順序前先存）
    pgItems.forEach(function (it, i) {
      var r = $('pgRows').children[i]; if (!r) return;
      it.short = r.querySelector('.pg-short').value; it.utm = r.querySelector('.pg-utm').value;
      it.rd = r.querySelector('.pg-rd').value; it.show = r.querySelector('.pg-show').checked;
    });
  }
  function pgRender() {
    var tb = $('pgRows'); tb.textContent = '';
    pgItems.forEach(function (it, i) {
      var tr = document.createElement('tr');
      function td(node) { var c = document.createElement('td'); c.appendChild(node); tr.appendChild(c); return c; }
      function input(cls, val, ph, max, label) {
        var inp = document.createElement('input'); inp.type = 'text'; inp.className = cls; inp.value = val || ''; inp.maxLength = max;
        if (ph) inp.placeholder = ph; inp.setAttribute('aria-label', it.name + ' ' + label); return inp;
      }
      td(document.createTextNode(String(i + 1))).className = 'num';
      td(document.createTextNode(it.name));
      td(input('pg-short', it.short, '', 20, '簡稱'));
      td(input('pg-utm', it.utm, '?&utm_source=facebook&utm_medium=…', 200, 'UTM'));
      var sel = document.createElement('select'); sel.className = 'pg-rd'; sel.setAttribute('aria-label', it.name + ' RD 區段');
      RD_OPTS.forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op); });
      sel.value = it.rd || ''; td(sel);
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'pg-show'; cb.checked = !!it.show; cb.setAttribute('aria-label', it.name + ' 顯示'); td(cb);
      var mv = document.createElement('div'); mv.className = 'mv';
      [['上移', -1], ['下移', 1]].forEach(function (m) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'pg-' + (m[1] < 0 ? 'up' : 'down'); b.textContent = m[0]; b.setAttribute('aria-label', it.name + m[0]);
        b.disabled = (i + m[1] < 0 || i + m[1] >= pgItems.length);
        b.onclick = function () { pgSync(); var x = pgItems.splice(i, 1)[0]; pgItems.splice(i + m[1], 0, x); pgRender(); };
        mv.appendChild(b);
      });
      td(mv);
      tb.appendChild(tr);
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
    return Promise.all([fbStatus().catch(function (e) { say($('fbMsg'), '讀取連線狀態失敗：' + (e && e.message || ''), 'err'); }), pgLoad(), psLoad()]);
  }
  $('fbRefresh').onclick = function () {
    $('fbRefresh').disabled = true; say($('fbMsg'), '重新讀取中');
    api('/admin/fb/refresh', { method: 'POST' }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      return fbLoad().then(function () { say($('fbMsg'), '已重新讀取。', 'good'); });
    }).catch(function (e) { say($('fbMsg'), '重新讀取失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { $('fbRefresh').disabled = false; });
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
      if (n < 1 || n > 20) return say($('pgMsg'), '第 ' + (i + 1) + ' 列「' + pgItems[i].name + '」的簡稱要 1～20 字。', 'err');
      if (pgItems[i].utm.length > 200) return say($('pgMsg'), '第 ' + (i + 1) + ' 列的 UTM 不能超過 200 字。', 'err');
    }
    var body = { pages: pgItems.map(function (it, k) { return { id: it.id, short: it.short.trim(), utm: it.utm.trim(), rd: it.rd, order: k, show: it.show ? 1 : 0 }; }) };
    $('pgSave').disabled = true; say($('pgMsg'), '儲存中');
    api('/admin/fb/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
      if (res.ok) { pgItems = pgMap(res.data); pgRender(); say($('pgMsg'), '已儲存', 'good'); }
      else if (res.code === 'unauthorized') expired();
      else say($('pgMsg'), res.error || '儲存失敗。', 'err');
    }).catch(function () { say($('pgMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('pgSave').disabled = false; });
  };

  function signOut() {
    token = ''; pending = '';
    $('app').hidden = true; $('logout').hidden = true; $('confirm').hidden = true; $('login').hidden = false;
    fbLoaded = false; rdLoaded = false; pgItems = []; psItems = [];
  }
  $('logout').onclick = function () { signOut(); say($('loginMsg'), ''); $('pw').focus(); };

  // 分類分頁：用隱藏切換，已讀進來的表格與填到一半的內容不會消失；網址 #fb 等記住目前分類

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

  var TABS = ['fb', 'rd', 'assets', 'logs'];
  var assetsLoaded = false;
  function tabFromHash() { var t = location.hash.slice(1); return TABS.indexOf(t) >= 0 ? t : TABS[0]; }
  function showTab(id, focus) {
    TABS.forEach(function (t) {
      var on = t === id, b = $('tab-' + t);
      b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
      $('panel-' + t).hidden = !on;
    });
    if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
    if (focus) $('tab-' + id).focus();
    if (id === 'fb' && !fbLoaded && token) fbLoad();
    if (id === 'rd' && !rdLoaded && token) rdLoad();
    if (id === 'assets' && !assetsLoaded && token) { assetsLoaded = true; load(); }
  }
  TABS.forEach(function (t, i) {
    var b = $('tab-' + t);
    b.onclick = function () { showTab(t); };
    b.onkeydown = function (e) {
      var d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (e.key === 'Home') d = -i; else if (e.key === 'End') d = TABS.length - 1 - i;
      if (d === undefined) return;
      e.preventDefault();
      showTab(TABS[(i + d + TABS.length) % TABS.length], true);
    };
  });
  window.addEventListener('hashchange', function () { if (token) showTab(tabFromHash()); });
})();
