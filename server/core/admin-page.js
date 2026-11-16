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
.fb-state{font-weight:600}.fb-state.on{color:#166534}.fb-state.off{color:var(--danger)}
.fb-missing{margin:8px 0 0;padding-left:20px;color:var(--danger);font-weight:600}
#pgRows select{min-width:120px}#pgRows .pg-short{min-width:110px}#pgRows .pg-utm{min-width:260px}
#pgRows input[type=checkbox]{width:22px;height:22px;min-height:0}
textarea{width:100%;min-height:72px;padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:#fff;color:var(--ink);font:inherit;resize:vertical}
.ps-row{display:grid;grid-template-columns:minmax(0,200px) minmax(0,1fr) auto;gap:8px;align-items:start;padding:10px 0;border-bottom:1px solid #e6ecf6}
@media (max-width:760px){.ps-row{grid-template-columns:minmax(0,1fr)}}
.mv{display:flex;gap:6px;white-space:nowrap}
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

    <section class="card" id="fbCard">
      <h2>臉書連線</h2>
      <p>後端用 Secret <code>FB_USER_TOKEN</code>（用戶 token）取得各粉專的發文權限。這裡看連線狀態、到期日與缺少的權限（不會顯示 token 本身）。</p>
      <p class="fb-state" id="fbState">狀態：尚未讀取</p>
      <ul class="fb-missing" id="fbMissing" hidden></ul>
      <div class="row"><button id="fbRefresh" type="button">重新讀取粉專</button></div>
      <p class="msg" id="fbMsg" role="status"></p>
    </section>

    <section class="card" id="pgCard">
      <h2>粉專設定</h2>
      <p>簡稱只影響網頁上的顯示；UTM 只影響留言裡的文章連結；RD 區段決定排入 Rundown 寫到哪一區（選「不寫入」就不寫）。順序依表格由上到下，用「上移」「下移」調整，按「儲存」才會生效。</p>
      <p class="msg" id="pgMsg" role="status"></p>
      <div class="scroll" id="pgWrap" hidden>
        <table id="pgTable"><thead><tr><th>序號</th><th>臉書名稱</th><th>簡稱</th><th>UTM</th><th>RD 區段</th><th>顯示</th><th>順序</th></tr></thead><tbody id="pgRows"></tbody></table>
      </div>
      <div class="row"><button id="pgSave" class="primary" type="button" hidden>儲存</button></div>
    </section>

<section class="card" id="psCard">
<h2>活動留言</h2>
<p>發文時第 2、3 則留言可以選這裡的內容帶入（例如活動宣傳），帶入後還能再改。最多 20 則。</p>
<p class="msg" id="psMsg" role="status"></p>
<div id="psRows"></div>
<div class="row"><button id="psAdd" type="button">＋ 新增一則</button><button id="psSave" class="primary" type="button">儲存</button></div>
</section>

    <section class="card" id="rdCard">
      <h2>Rundown 連線</h2>
      <p>Apps Script 網址與金鑰放在後端 Secrets（<code>RUNDOWN_URL</code>、<code>RUNDOWN_TOKEN</code>）。這裡只檢查有沒有設定與連不連得上，不顯示網址與金鑰。</p>
      <p class="fb-state" id="rdState">狀態：尚未讀取</p>
      <div class="row"><button id="rdPing" type="button">測試連線</button></div>
      <p class="msg" id="rdMsg" role="status"></p>
    </section>

    <section class="card">
      <h2>錯誤日誌</h2>
      <p>只記錄工具名稱、錯誤代碼、版本，不含任何內容，保留 30 天。</p>
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
        load(); fbLoad(); rdLoad();
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
      $('fbState').textContent = '狀態：' + (d.valid ? '連線正常' : 'token 無效，請重新授權') + '；' + fmtExp(d.expires) + '；粉專 ' + (d.pages || 0) + ' 個';
      $('fbState').className = 'fb-state ' + (d.valid ? 'on' : 'off');
      (d.missing || []).forEach(function (m) { var li = document.createElement('li'); li.textContent = '缺少權限：' + m; ul.appendChild(li); });
      ul.hidden = !(d.missing && d.missing.length);
    });
  }

  // ---- 粉專設定（/admin/fb/pages）----
  var pgItems = [];
  var RD_OPTS = [['', '不寫入'], ['news', '主粉'], ['ent', '娛樂粉'], ['shaokang', '少康粉'], ['intl', '國際＋粉']];
  function pgMap(list) { return list.map(function (p) { return { id: p.id, name: p.name, short: p.short, utm: p.utm || '', rd: p.rd || '', show: !!p.show }; }); }
  function pgSync() {
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
  function fbLoad() {
    say($('fbMsg'), '');
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

  function rdLoad() {
    api('/admin/rundown').then(function (res) {
      if (!res.ok) { if (res.code === 'unauthorized') return expired(); throw new Error(res.error); }
      $('rdState').textContent = res.data.configured ? '狀態：已設定' : '狀態：尚未設定 RUNDOWN_URL／RUNDOWN_TOKEN';
      $('rdState').className = 'fb-state ' + (res.data.configured ? 'on' : 'off');
    }).catch(function () { say($('rdMsg'), '讀取設定狀態失敗。', 'err'); });
  }

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

  $('logout').onclick = function () { token = ''; $('app').hidden = true; $('login').hidden = false; say($('loginMsg'), ''); };
})();
</script>
</body>
</html>
`;
