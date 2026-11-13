// 管理頁 HTML。Worker 沒有檔案系統，所以頁面放在字串裡（內嵌樣式與腳本，不依賴外部資源）。
// 注意：這個字串裡的腳本不可使用反引號或 ${ }。
export const ADMIN_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>小編工具箱 素材管理</title>
<style>
:root{--ink:#1f2a3d;--sub:#3c4a63;--mute:#5f6b82;--line:#c9d3e6;--edge:rgba(0,74,173,.12);--bg:#f4f7fd;--card:#fff;--brand:#004aad;--brand-line:#004aad;--brand-strong:#003a87;--soft:#e8f0fc;--danger:#9b1c1c;--dis-bg:#eef1f6}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(900px 500px at 8% -10%,#dce8ff,transparent 60%),radial-gradient(800px 500px at 100% 0,#e4eeff,transparent 60%),var(--bg);background-attachment:fixed;color:var(--ink);font:16px/1.6 "Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif}
.top{display:flex;align-items:center;gap:10px;background:#fff;border-bottom:1px solid var(--edge);padding:12px 28px}
.top .logo{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:7px;background:linear-gradient(135deg,#2f7bff,#004aad);color:#fff;font-weight:800;font-size:16px;line-height:1}
.top .word{font-size:18px;font-weight:700}
.top .word b{color:var(--brand);font-weight:700}
.top .sub{font-size:14px;font-weight:700;color:var(--mute);margin-left:4px}
main{max-width:860px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;font-weight:700;margin:0 0 4px}
h2{font-size:18px;font-weight:700;margin:0 0 12px}
p{margin:0 0 12px;color:var(--sub)}
code{background:var(--soft);color:var(--brand);padding:1px 7px;border-radius:7px;font-size:.9em}
.card{background:var(--card);border:1px solid var(--edge);border-radius:18px;padding:20px;margin:16px 0;box-shadow:0 24px 60px -30px rgba(0,43,102,.35)}
label{display:block;font-weight:500;margin:12px 0 4px}
input[type=text],input[type=password],input[type=number],select{width:100%;min-height:44px;padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:#fff;color:var(--ink);font:inherit}
input[type=file]{width:100%;min-height:44px;padding:8px 0;font:inherit}
button{min-height:44px;padding:0 20px;border-radius:999px;border:1px solid var(--line);background:#fff;color:var(--sub);font:inherit;font-weight:500;cursor:pointer}
button:hover:not(:disabled){border-color:var(--brand);color:var(--brand)}
button.primary{background:var(--brand);border-color:var(--brand);color:#fff;box-shadow:0 10px 24px -10px rgba(0,74,173,.7)}
button.primary:hover:not(:disabled){background:var(--brand-strong);color:#fff}
button.danger{background:#fff6f6;border-color:#f3c4c4;color:var(--danger)}
button.danger.solid{background:var(--danger);border-color:var(--danger);color:#fff}
button:active:not(:disabled){box-shadow:inset 0 2px 5px rgba(0,0,0,.28)}
button:disabled{background:var(--dis-bg);color:var(--mute);border-color:var(--edge);cursor:not-allowed;box-shadow:none}
:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
.msg{min-height:24px;margin:8px 0 0;font-weight:600}
.msg.err{color:var(--danger)}
td.err{color:var(--danger);font-weight:600}
.msg.good{color:#166534}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #e6ecf6;vertical-align:middle}
th{font-size:14px;color:var(--mute);font-weight:500}
td.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.tag{display:inline-block;padding:0 10px;border:1px solid var(--line);border-radius:999px;font-size:14px;font-weight:500;line-height:24px;color:var(--mute)}
.tag.company{border-color:transparent;background:var(--soft);color:var(--brand)}
.scroll{overflow-x:auto}
.sk{height:20px;border-radius:6px;background:linear-gradient(90deg,#e6ecf6 25%,#f1f5fb 50%,#e6ecf6 75%);background-size:200% 100%;animation:sk 1.2s linear infinite;margin:10px 0}
@keyframes sk{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.sk{animation:none}}
.confirm{border:1px solid #f3c4c4;border-radius:18px;padding:16px;margin-top:16px;background:#fff6f6}
[hidden]{display:none!important}
@media (max-width:600px){.top{padding:10px 16px}}
</style>
</head>
<body>
<header class="top"><span class="logo" aria-hidden="true">編</span><span class="word">小編<b>工具箱</b></span><span class="sub">後台</span></header>
<main>
  <h1>素材管理</h1>
  <p>小編工具箱的公開與公司素材都在這裡上傳、替換、刪除，不用改程式也不用重新部署。</p>

  <section id="login" class="card">
    <h2>管理登入</h2>
    <form id="loginForm">
      <label for="pw">管理密碼</label>
      <input id="pw" type="password" autocomplete="current-password" required>
      <div class="row"><button class="primary" type="submit" id="loginBtn">登入</button></div>
      <p class="msg" id="loginMsg" role="status"></p>
    </form>
  </section>

  <div id="app" hidden>
    <section class="card">
      <h2>上傳或替換素材</h2>
      <p>素材名稱相同就會替換掉舊的。只接受 PNG、JPEG、WebP、SVG、WOFF2，每個最大 10 MB。</p>
      <form id="upForm">
        <label for="key">素材名稱</label>
        <input id="key" type="text" placeholder="例如 logo-white.png" pattern="[a-z0-9][a-z0-9._\\-]{0,63}" autocapitalize="off" required>
        <label for="tier">等級</label>
        <select id="tier">
          <option value="company">company（公司專屬，要密碼才拿得到）</option>
          <option value="public">public（所有人都看得到）</option>
        </select>
        <label for="file">檔案</label>
        <input id="file" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,font/woff2,.woff2" required>
        <div class="row"><button class="primary" type="submit" id="upBtn">上傳</button></div>
        <p class="msg" id="upMsg" role="status"></p>
      </form>
    </section>

    <section class="card" id="listCard" aria-busy="true">
      <h2>目前的素材</h2>
      <div id="skel"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>
      <div class="scroll" id="tableWrap" hidden>
        <table>
          <thead><tr><th>名稱</th><th>等級</th><th>大小</th><th>更新時間</th><th>操作</th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
      <p id="empty" hidden>還沒有任何素材。</p>
      <p class="msg" id="listMsg" role="status"></p>
    </section>

    <section class="card">
      <h2>臉書連線</h2>
      <p>檢查後端 Secret <code>FB_TOKEN</code> 裡每組 token（用戶 token 或粉專 token）能管哪些粉專（不會顯示 token 本身）。用戶 token 請留意「資料存取到」的日期，過了要重新授權。</p>
      <div class="row"><button id="fbBtn" type="button">檢查臉書連線</button></div>
      <p class="msg" id="fbMsg" role="status"></p>
      <div class="scroll" id="fbWrap" hidden>
        <table><thead><tr><th>#</th><th>粉專</th><th>狀態</th><th>類型</th><th>到期</th><th>缺少的權限</th></tr></thead><tbody id="fbRows"></tbody></table>
      </div>
    </section>

    <section class="card">
      <h2>Rundown 連線</h2>
      <p>排程發布的「排入 Rundown」送出成功後，把「文章ID/圖文/SLUG」寫進 FB RUNDOWN 對應日期、時段；有勾選並送成功的粉專各寫一筆到對應區段：新聞＝主粉（新聞粉）、娛樂粉、少康粉、國際＋粉（擠看看、氣象沒有區段，略過）。</p>
      <p>純文字底圖選「無底色」或「臉書原生背景」時寫「/文字/」，其他都寫「/圖文/」。排程用排程時間，立即發布用送出當下的時間。照時間順序排進去：格子是空的或只有「/文字/」「/圖文/」就直接填；已有稿子就插一格往下推（不覆蓋）。</p>
      <p>Apps Script 網址與金鑰放在後端 Secrets <code>RUNDOWN_URL</code>、<code>RUNDOWN_TOKEN</code>（同 Apps Script 指令碼屬性 <code>TOKEN</code>），這裡只檢查有沒有設好，不顯示內容。</p>
      <div class="row"><button id="rdCheck" type="button">檢查設定</button><button id="rdPing" type="button">測試連線</button></div>
      <p class="msg" id="rdMsg" role="status"></p>
    </section>

    <section class="card">
      <h2>粉專對應</h2>
      <p>排程發布工具用的粉專簡稱、文章連結的 utm 參數與排序（數字小的排前面）。沒有存過的粉專會依名稱套用預設值。</p>
      <div class="row"><button id="pmLoad" type="button">讀取粉專對應</button><button id="pmSave" class="primary" type="button" hidden>儲存</button></div>
      <p class="msg" id="pmMsg" role="status"></p>
      <div class="scroll" id="pmWrap" hidden>
        <table><thead><tr><th>粉專名稱</th><th>簡稱</th><th>utm</th><th>排序</th></tr></thead><tbody id="pmRows"></tbody></table>
      </div>
    </section>

    <section class="card">
      <h2>錯誤日誌</h2>
      <p>只記錄工具名稱、錯誤代碼、版本，不含任何內容，保留 30 天。臉書發文的成功／失敗也記在這裡（工具 <code>fb</code>）。</p>
      <div class="row"><button id="logBtn" type="button">查看最近 7 天</button></div>
      <p class="msg" id="logMsg" role="status"></p>
      <div class="scroll" id="logWrap" hidden>
        <table><thead><tr><th>時間</th><th>工具</th><th>代碼</th><th>版本</th></tr></thead><tbody id="logRows"></tbody></table>
      </div>
    </section>

    <section class="confirm" id="confirm" hidden role="alertdialog" aria-labelledby="cfTitle">
      <h2 id="cfTitle">確定要刪除嗎？</h2>
      <p id="cfText"></p>
      <div class="row">
        <button class="danger solid" id="cfYes" type="button">刪除這個素材</button>
        <button id="cfNo" type="button">先不要</button>
      </div>
    </section>

    <div class="row"><button id="logout" type="button">登出</button></div>
  </div>
</main>
<script>
(function () {
  var token = '';
  var pending = '';
  var $ = function (id) { return document.getElementById(id); };

  function say(el, text, kind) { el.textContent = text || ''; el.className = 'msg' + (kind ? ' ' + kind : ''); }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, token ? { Authorization: 'Bearer ' + token } : {});
    return fetch(path, opts).then(function (r) { return r.json(); });
  }
  function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B'; }
  function fmtTime(ms) {
    var d = new Date(ms), p = function (v) { return String(v).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function expired() {
    token = '';
    $('app').hidden = true; $('login').hidden = false;
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
        rep.onclick = function () { $('key').value = a.key; $('tier').value = a.tier; $('file').focus(); say($('upMsg'), '請選擇要替換的檔案，再按「上傳」。'); window.scrollTo(0, 0); };
        var del = document.createElement('button'); del.type = 'button'; del.className = 'danger'; del.textContent = '刪除';
        del.style.marginLeft = '8px';
        del.onclick = function () { pending = a.key; $('cfText').textContent = '「' + a.key + '」會從後端移除，用到它的工具會找不到這個素材。這個動作無法復原。'; $('confirm').hidden = false; $('cfYes').focus(); };
        ac.appendChild(rep); ac.appendChild(del); tr.appendChild(ac);
        tb.appendChild(tr);
      });
      $('tableWrap').hidden = !res.data.length; $('empty').hidden = !!res.data.length;
      say($('listMsg'), '');
    }).catch(function () {
      say($('listMsg'), '讀取清單失敗，請重新整理再試一次。', 'err');
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
        $('login').hidden = true; $('app').hidden = false; say($('loginMsg'), '');
        load();
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

  $('rdCheck').onclick = function () {
    $('rdCheck').disabled = true; say($('rdMsg'), '檢查中');
    api('/admin/rundown').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      var d = res.data;
      if (d.configured) return say($('rdMsg'), 'RUNDOWN_URL、RUNDOWN_TOKEN 都已設定。可按「測試連線」確認 Apps Script 回得來。', 'good');
      var miss = [];
      if (!d.url) miss.push('RUNDOWN_URL（要是 https://script.google.com/macros/s/…/exec）');
      if (!d.token) miss.push('RUNDOWN_TOKEN（至少 12 字）');
      say($('rdMsg'), '還沒設好：' + miss.join('、') + '。設定後要重新部署後端。', 'err');
    }).catch(function (e) { say($('rdMsg'), '檢查失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { $('rdCheck').disabled = false; });
  };
  $('rdPing').onclick = function () {
    $('rdPing').disabled = true; say($('rdMsg'), '測試中');
    api('/admin/rundown/ping', { method: 'POST' }).then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); return say($('rdMsg'), res.error || '連線失敗', 'err'); }
      var d = res.data;
      say($('rdMsg'), '連線成功：' + (d.title || '試算表') + '（分頁 ' + (d.sheets || []).slice(0, 3).join('、') + '…）', 'good');
    }).catch(function (e) { say($('rdMsg'), '測試失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { $('rdPing').disabled = false; });
  };

  var pmItems = [];
  $('pmLoad').onclick = function () {
    $('pmLoad').disabled = true; say($('pmMsg'), '讀取中');
    api('/admin/fb/pagemap').then(function (res) {
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
        cell('text', it.label, '簡稱', 'pmL' + i); cell('text', it.utm, 'utm', 'pmU' + i); cell('number', it.sort, '排序', 'pmS' + i);
        tb.appendChild(tr);
      });
      $('pmWrap').hidden = !pmItems.length; $('pmSave').hidden = !pmItems.length;
      say($('pmMsg'), pmItems.length ? '' : '還沒有任何粉專（請先設定 FB_TOKEN）。', pmItems.length ? '' : 'err');
    }).catch(function (e) { say($('pmMsg'), '讀取失敗：' + (e && e.message || ''), 'err'); })
      .then(function () { $('pmLoad').disabled = false; });
  };
  $('pmSave').onclick = function () {
    var items = pmItems.map(function (it, i) {
      return { id: it.id, label: $('pmL' + i).value, utm: $('pmU' + i).value, sort: $('pmS' + i).value === '' ? NaN : Number($('pmS' + i).value) };
    });
    $('pmSave').disabled = true; say($('pmMsg'), '儲存中');
    api('/admin/fb/pagemap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: items }) }).then(function (res) {
      if (res.ok) { say($('pmMsg'), '已儲存。', 'good'); $('pmLoad').click(); }
      else if (res.code === 'unauthorized') expired();
      else say($('pmMsg'), res.error || '儲存失敗。', 'err');
    }).catch(function () { say($('pmMsg'), '連不上後端，請稍後再試。', 'err'); })
      .then(function () { $('pmSave').disabled = false; });
  };

  $('logout').onclick = function () { token = ''; $('app').hidden = true; $('login').hidden = false; say($('loginMsg'), ''); };
})();
</script>
</body>
</html>
`;
