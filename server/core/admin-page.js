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
:root{--ink:#1c1f23;--sub:#3c4046;--mute:#6b7077;--line:#c4c7cc;--bg:#f6f7f9;--card:#fff;--brand:#1d4fb8;--brand-line:#163d8f;--danger:#b3261e;--dis-bg:#eceef0}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 "Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:18px;margin:0 0 12px}
p{margin:0 0 12px;color:var(--sub)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:16px 0}
label{display:block;font-weight:600;margin:12px 0 4px}
input[type=text],input[type=password],select{width:100%;min-height:44px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);font:inherit}
input[type=file]{width:100%;min-height:44px;padding:8px 0;font:inherit}
button{min-height:44px;padding:0 20px;border-radius:999px;border:1px solid var(--line);background:#fff;color:var(--sub);font:inherit;font-weight:600;cursor:pointer}
button.primary{background:var(--brand);border-color:var(--brand-line);color:#fff}
button.danger{border-color:var(--danger);color:var(--danger)}
button.danger.solid{background:var(--danger);color:#fff}
button:active:not(:disabled){box-shadow:inset 0 2px 5px rgba(0,0,0,.28)}
button:disabled{background:var(--dis-bg);color:var(--mute);border-color:var(--line);cursor:not-allowed}
:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
.msg{min-height:24px;margin:8px 0 0;font-weight:600}
.msg.err{color:var(--danger)}
.msg.good{color:#1a6b3a}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #e3e5e8;vertical-align:middle}
th{font-size:14px;color:var(--mute);font-weight:600}
td.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.tag{display:inline-block;padding:0 10px;border:1px solid var(--line);border-radius:999px;font-size:14px;line-height:24px}
.tag.company{border-color:var(--brand-line);color:var(--brand)}
.scroll{overflow-x:auto}
.sk{height:20px;border-radius:6px;background:linear-gradient(90deg,#e6e8eb 25%,#f1f2f4 50%,#e6e8eb 75%);background-size:200% 100%;animation:sk 1.2s linear infinite;margin:10px 0}
@keyframes sk{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.sk{animation:none}}
.confirm{border:1px solid var(--danger);border-radius:12px;padding:16px;margin-top:16px;background:#fff6f5}
[hidden]{display:none!important}
</style>
</head>
<body>
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

  $('logout').onclick = function () { token = ''; $('app').hidden = true; $('login').hidden = false; say($('loginMsg'), ''); };
})();
</script>
</body>
</html>
`;
