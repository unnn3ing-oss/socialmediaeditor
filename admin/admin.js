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

  $('fbBtn').onclick = function () {
    $('fbBtn').disabled = true; say($('fbMsg'), '檢查中');
    api('/admin/fb').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      var d = res.data, tb = $('fbRows'); tb.textContent = '';
      if (!d.configured) { $('fbWrap').hidden = true; return say($('fbMsg'), '還沒設定 FB_TOKEN，請照部署說明「連接臉書粉專」操作。', 'err'); }
      var bad = 0;
      d.tokens.forEach(function (t) {
        var exp = t.expiresAt === 0 ? '不會過期' : t.expiresAt ? fmtTime(t.expiresAt * 1000) : '—';
        if (t.dataAccessExpiresAt) exp += '；資料存取到 ' + fmtTime(t.dataAccessExpiresAt * 1000);
        var warn = [];
        var names = t.pages.map(function (p) {
          var n = p.name;
          if (p.usedBy) n += '（改用第 ' + p.usedBy + ' 組）';
          if (!p.canPost) { n += '（無發文權限）'; warn.push(1); }
          if (!p.canInsights) { n += '（無成效權限）'; warn.push(1); }
          return n;
        });
        var pageText = names.length ? names.join('、')
          : t.hint === 'debug_failed' ? (d.appSecret ? '讀不到授權範圍，請確認 FB_APP_ID／FB_APP_SECRET 是否正確' : '讀不到授權範圍，請設定 FB_APP_ID／FB_APP_SECRET 後再檢查')
          : t.kind === 'user' ? '沒有授權任何粉專' : '（找不到粉專）';
        if (t.skipped) { pageText += '；另有 ' + t.skipped + ' 個粉專換不到 token（可能沒有粉專角色）'; warn.push(1); }
        var kindText = t.kind === 'user' ? '用戶 token' : t.kind === 'page' ? '粉專 token' : (t.type || '—');
        var okRow = t.valid && t.pages.length && !t.missingScopes.length && !warn.length;
        if (!okRow) bad++;
        var tr = document.createElement('tr');
        [t.index, pageText, t.valid ? '有效' : '無效' + (t.error ? '：' + t.error : ''), kindText, exp, t.missingScopes.join('、') || '—']
          .forEach(function (v, i) {
            var c = document.createElement('td'); c.textContent = v;
            if ((i === 2 && !t.valid) || (i === 5 && t.missingScopes.length) || (i === 1 && (!t.pages.length || warn.length))) c.className = 'err';
            tr.appendChild(c);
          });
        tb.appendChild(tr);
      });
      $('fbWrap').hidden = false;
      var note = 'Graph ' + d.version + (d.appSecret ? '' : '；未設 FB_APP_SECRET（選填）');
      say($('fbMsg'), bad ? bad + ' 組 token 有問題。' + note : '全部正常。' + note, bad ? 'err' : 'good');
    }).catch(function (e) { say($('fbMsg'), '檢查失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { $('fbBtn').disabled = false; });
  };

  // ---- 暫停排程發布：先讀取目前狀態才能操作；停用前確認 ----
  var pzPaused = null;
  function pzShow(d) {
    pzPaused = !!d.paused;
    $('pzMax').textContent = d.reasonMax || 100;
    $('pzReason').maxLength = d.reasonMax || 100;
    $('pzState').textContent = pzPaused ? '目前狀態：已停用（' + (d.at ? fmtTime(d.at) : '時間不明') + ' 起）' : '目前狀態：使用中';
    $('pzState').className = 'pz-state ' + (pzPaused ? 'off' : 'on');
    $('pzReason').value = pzPaused ? (d.reason || '') : $('pzReason').value;
    $('pzToggle').textContent = pzPaused ? '恢復使用' : '停用排程發布';
    $('pzToggle').className = pzPaused ? 'primary' : 'danger';
    $('pzToggle').disabled = false;
    $('pzSaveReason').hidden = !pzPaused;
  }
  function pzSend(paused, okText) {
    $('pzToggle').disabled = true; $('pzSaveReason').disabled = true; say($('pzMsg'), '儲存中');
    return api('/admin/fb/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: paused, reason: $('pzReason').value }) }).then(function (res) {
      if (res.ok) { pzShow(res.data); say($('pzMsg'), okText, 'good'); }
      else if (res.code === 'unauthorized') expired();
      else say($('pzMsg'), res.error || '儲存失敗。', 'err');
    }).catch(function () { say($('pzMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { if (pzPaused !== null) $('pzToggle').disabled = false; $('pzSaveReason').disabled = false; });
  }
  $('pzLoad').onclick = function () {
    $('pzLoad').disabled = true; say($('pzMsg'), '讀取中');
    api('/admin/fb/pause').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      pzShow(res.data); say($('pzMsg'), '');
    }).catch(function (e) { say($('pzMsg'), '讀取失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { $('pzLoad').disabled = false; });
  };
  $('pzToggle').onclick = function () {
    if (pzPaused === null) return;
    if (pzPaused) { pzSend(false, '已恢復使用。'); return; }
    $('pzConfirm').hidden = false; $('pzYes').focus();
  };
  $('pzYes').onclick = function () { $('pzConfirm').hidden = true; pzSend(true, '已停用排程發布。'); };
  $('pzNo').onclick = function () { $('pzConfirm').hidden = true; $('pzToggle').focus(); };
  $('pzSaveReason').onclick = function () { pzSend(true, '已更新停用原因。'); };



  var pmItems = [];
  var PM_CODES = [['', '自動'], ['news', '新聞'], ['ent', '娛樂'], ['shaokang', '少康'], ['intl', '國際＋'], ['jkk', '擠看看（無 RD 區）'], ['weather', '氣象（無 RD 區）']];
  var PM_NAMES = { news: '新聞', ent: '娛樂', shaokang: '少康', intl: '國際＋', jkk: '擠看看', weather: '氣象' };
  var RD_OK = ['news', 'ent', 'shaokang', 'intl'];
  function pmLoad(doneMsg) {
    $('pmLoad').disabled = true; say($('pmMsg'), '讀取中');
    return api('/admin/fb/pagemap').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      pmItems = res.data.items; var tb = $('pmRows'); tb.textContent = '';
      pmItems.forEach(function (it, i) {
        var tr = document.createElement('tr');
        var n = document.createElement('td'); n.textContent = it.name + (it.saved ? '' : '（預設值）'); tr.appendChild(n);
        function cell(type, val, label, id) {
          var c = document.createElement('td'), inp = document.createElement('input');
          inp.type = type; inp.value = val; inp.id = id; inp.setAttribute('aria-label', it.name + ' ' + label);
          if (type === 'text') inp.maxLength = label === 'utm' ? 300 : 20;
          if (type === 'number') { inp.min = 0; inp.max = 999; inp.step = 1; inp.style.width = '90px'; }
          c.appendChild(inp); tr.appendChild(c);
        }
        cell('text', it.label, '簡稱', 'pmL' + i);
        // RD 區段：決定排入 Rundown 寫到哪一區；空白＝自動（依粉專名稱猜）
        var rc = document.createElement('td'), sel = document.createElement('select');
        sel.id = 'pmC' + i; sel.setAttribute('aria-label', it.name + ' RD 區段');
        PM_CODES.forEach(function (o) {
          var op = document.createElement('option'); op.value = o[0];
          op.textContent = o[0] ? o[1] : '自動（' + (PM_NAMES[it.auto] || '對不到') + '）';
          sel.appendChild(op);
        });
        sel.value = PM_NAMES[it.codeSet] ? it.codeSet : '';
        var hint = document.createElement('div'); hint.className = 'pm-hint';
        function rcHint() {
          var code = sel.value || it.auto || '';
          var ok = RD_OK.indexOf(code) >= 0;
          rc.className = ok ? '' : 'err'; hint.textContent = ok ? '' : '不會寫入 RD';
        }
        sel.onchange = rcHint; rcHint();
        rc.appendChild(sel); rc.appendChild(hint); tr.appendChild(rc);
        cell('text', it.utm, 'utm', 'pmU' + i); cell('number', it.sort, '排序', 'pmS' + i);
        tb.appendChild(tr);
      });
      $('pmWrap').hidden = !pmItems.length; $('pmSave').hidden = !pmItems.length;
      say($('pmMsg'), pmItems.length ? (doneMsg || '') : '還沒有任何粉專（請先設定 FB_TOKEN）。', pmItems.length ? (doneMsg ? 'good' : '') : 'err');
    }).catch(function (e) { say($('pmMsg'), '讀取失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { $('pmLoad').disabled = false; });
  }
  $('pmLoad').onclick = function () { pmLoad(); };
  $('pmSave').onclick = function () {
    var items = pmItems.map(function (it, i) {
      return { id: it.id, label: $('pmL' + i).value, code: $('pmC' + i).value, utm: $('pmU' + i).value, sort: $('pmS' + i).value === '' ? NaN : Number($('pmS' + i).value) };
    });
    $('pmSave').disabled = true; say($('pmMsg'), '儲存中');
    api('/admin/fb/pagemap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: items }) }).then(function (res) {
      if (res.ok) pmLoad('已儲存。');   // 重新讀取後再顯示，避免「已儲存」被讀取訊息蓋掉
      else if (res.code === 'unauthorized') expired();
      else say($('pmMsg'), res.error || '儲存失敗。', 'err');
    }).catch(function () { say($('pmMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('pmSave').disabled = false; });
  };

  function signOut() {
    token = ''; pending = '';
    $('app').hidden = true; $('logout').hidden = true; $('confirm').hidden = true; $('pzConfirm').hidden = true; pzPaused = null; $('pzToggle').disabled = true; $('pzSaveReason').hidden = true; $('pzState').textContent = '目前狀態：尚未讀取'; $('pzState').className = 'pz-state'; say($('pzMsg'), ''); $('login').hidden = false;
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
