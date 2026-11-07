// 側邊欄（版面照網新快速排程）：頂列「網頁版」＋分頁「發文／狀態與更新」。
// 發文分頁嵌入網站的 panel.html?tool=fbpost（後端 toolbox-api）；狀態分頁的公司模式與一鍵檢測由嵌入頁用 postMessage 回報。
// 更新邏輯在 updater.js。
const SITE = 'https://unnn3ing-oss.github.io/socialmediaeditor/';
const SITE_ORIGIN = new URL(SITE).origin;
const PANEL = SITE + 'panel.html?tool=fbpost';

document.getElementById('openSite').addEventListener('click', () => { chrome.tabs.create({ url: SITE }); });
const VER = `v${self.Updater.verOf(chrome.runtime.getManifest())}`;
document.getElementById('extVer').textContent = VER;
document.getElementById('extVer2').textContent = VER;

// ---- 分頁：記住上次停在哪一頁；切換只隱藏，不重建（發文內容不會消失）----
(function () {
  const tabs = { post: [document.getElementById('tabPost'), document.getElementById('panePost')],
    info: [document.getElementById('tabInfo'), document.getElementById('paneInfo')] };
  function show(name) {
    for (const [k, [tab, pane]] of Object.entries(tabs)) {
      tab.setAttribute('aria-selected', String(k === name));
      pane.hidden = k !== name;
    }
    try { localStorage.setItem('tbx-sp-tab', name); } catch (e) { /* 存不了就算了 */ }
  }
  for (const [k, [tab]] of Object.entries(tabs)) tab.addEventListener('click', () => show(k));
  let saved = 'post';
  try { saved = localStorage.getItem('tbx-sp-tab') === 'info' ? 'info' : 'post'; } catch (e) { /* 預設發文 */ }
  show(saved);
})();

// ---- 發文分頁與嵌入頁的訊息（只接受網站來源、而且是這個 iframe）----
(function () {
  const frame = document.getElementById('app');
  const companyEl = document.getElementById('companyStatus');
  const runBtn = document.getElementById('hcRun'), sumEl = document.getElementById('hcSum'), listEl = document.getElementById('hcList');
  const ICON = { ok: '✅', warn: '⚠️', skip: '➖' };
  const TIMEOUT = 15000;
  let pending = null, seq = 0;
  const post = (msg) => { try { frame.contentWindow.postMessage({ source: 'tbx-sidepanel', ...msg }, SITE_ORIGIN); } catch (e) { /* iframe 還沒好 */ } };

  function setCompany(m) {
    if (m.unlocked) {
      const d = new Date(m.exp * 1000).toLocaleString('zh-TW', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      companyEl.textContent = `已解鎖（到 ${d}）`; companyEl.className = 'status ok';
    } else { companyEl.textContent = '尚未解鎖：在「發文」分頁輸入公司密碼'; companyEl.className = 'status warn'; }
  }
  function renderRows(items) {
    listEl.replaceChildren(...items.map((r) => {
      const li = document.createElement('li'); li.className = 'hc-row'; li.dataset.id = r.id; li.dataset.state = r.state;
      const ic = document.createElement('span'); ic.className = 'hc-ic'; ic.textContent = ICON[r.state] || '⚠️';
      const b = document.createElement('b'); b.textContent = r.label;
      const t = document.createElement('span'); t.className = 'hc-text'; t.textContent = r.text;
      li.append(ic, b, t); return li;
    }));
    const bad = items.filter((r) => r.state === 'warn').length;
    sumEl.textContent = bad ? `${bad} 項需要處理` : '全部正常';
    sumEl.className = 'hc-sum ' + (bad ? 'warn' : 'ok');
  }
  function finish(items) { pending = null; runBtn.disabled = false; renderRows(items); }

  window.addEventListener('message', (e) => {
    if (e.origin !== SITE_ORIGIN || e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || m.source !== 'tbx-panel') return;
    if (m.type === 'company') setCompany(m);
    else if (m.type === 'check' && pending && m.id === pending.id) { clearTimeout(pending.timer); finish(Array.isArray(m.items) ? m.items : []); }
  });

  runBtn.addEventListener('click', () => {
    if (pending) return;
    runBtn.disabled = true; sumEl.textContent = '檢測中…'; sumEl.className = 'hc-sum'; listEl.replaceChildren();
    const id = ++seq;
    pending = { id, timer: setTimeout(() => finish([{ id: 'panel', label: '發文頁', state: 'warn', text: '沒有回應：檢查網路，或切到「發文」分頁等它載入完再試' }]), TIMEOUT) };
    post({ type: 'check', id });
  });

  frame.addEventListener('load', () => post({ type: 'hello' }));
  frame.src = PANEL;
})();

(function () {
  const card = document.getElementById('updateCard');
  const statusEl = document.getElementById('upStatus');
  const skEl = document.getElementById('upSk');
  const checkBtn = document.getElementById('upCheckBtn');
  const applyBtn = document.getElementById('upApplyBtn');
  const folderEl = document.getElementById('upFolder');
  let latest = null, busy = false;

  // ---- 外掛內的彈窗（取代瀏覽器的 confirm／alert）----
  // modal({ title, body:[字串或節點], buttons:[{ label, value, primary }], progress:0～1 或 null })
  // 回傳按下的按鈕 value；按 Esc 回 'cancel'（進度中不能關）；換下一個畫面時前一個回 null
  const dlg = document.getElementById('upDlg');
  const dlgTitle = document.getElementById('upDlgTitle'), dlgBody = document.getElementById('upDlgBody');
  const dlgProg = document.getElementById('upDlgProg'), dlgBar = document.getElementById('upDlgBar'), dlgBtns = document.getElementById('upDlgBtns');
  let answer = null;
  const para = (text, cls) => { const p = document.createElement('p'); p.textContent = text; if (cls) p.className = cls; return p; };
  const code = (text) => { const c = document.createElement('code'); c.textContent = text; return c; };
  const list = (items) => { const ul = document.createElement('ul'); for (const t of items) { const li = document.createElement('li'); li.textContent = t; ul.append(li); } return ul; };
  function setProgress(v) { dlgProg.hidden = v == null; if (v != null) dlgBar.style.width = Math.round(Math.max(0, Math.min(1, v)) * 100) + '%'; }
  function modal({ title, body = [], buttons = [], progress = null }) {
    if (answer) answer(null);
    dlgTitle.textContent = title;
    dlgBody.replaceChildren(...body.map((x) => (typeof x === 'string' ? para(x) : x)));
    setProgress(progress);
    dlgBtns.replaceChildren();
    const p = new Promise((resolve) => { answer = (v) => { answer = null; resolve(v); }; });
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'btn ' + (b.primary ? 'btn-primary' : 'btn-secondary'); el.textContent = b.label;
      el.addEventListener('click', () => answer && answer(b.value));
      dlgBtns.append(el);
    }
    if (!dlg.open) dlg.showModal();
    (dlgBtns.querySelector('.btn-primary') || dlgBtns.querySelector('button') || dlg).focus();
    return p;
  }
  function closeModal() { if (answer) answer(null); if (dlg.open) dlg.close(); }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (!busy) { if (answer) answer('cancel'); dlg.close(); } });

  function show(msg, hasUpdate) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('has-update', !!hasUpdate);
  }
  const ver = (v) => (v ? `v${v}` : '');
  function updateHeadline(info) {
    const n = `${info.changed.length} 個檔案不同`;
    if (!info.version) return `有新版本（${n}）`;
    if (info.version === info.localVersion) return `有新版本（版本號仍是 ${ver(info.version)}，${n}）`;
    return `有新版本 ${ver(info.version)}（目前 ${ver(info.localVersion)}，${n}）`;
  }
  const fmtDate = (iso) => new Date(iso).toLocaleString('zh-TW', { hour12: false });

  // 選過資料夾就記住（之後都更新到同一個位置）；還沒選過，按更新時彈窗會先帶著選
  async function refreshFolderHint() {
    const saved = await Updater.hasSavedFolder();
    folderEl.hidden = !saved;
    applyBtn.textContent = saved ? '更新到最新版' : '選擇資料夾並更新';
  }

  // 選資料夾的說明：用安裝檔裝的在「文件」裡；不確定就看擴充功能詳細資料頁的「來源」
  function folderBody(saved) {
    const link = document.createElement('button');
    link.type = 'button'; link.className = 'up-link'; link.textContent = '開啟擴充功能詳細資料頁（看「來源」那一行）';
    link.addEventListener('click', () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));
    return [
      saved ? '之前記住的資料夾打不開（可能被移走、改名，或沒有允許存取），請重新選一次。' : '第一次更新要選這個外掛所在的資料夾，選一次就會記住，之後都更新到同一個位置。',
      '用安裝檔裝的，位置是「文件」裡的：', code('toolbox-ext'),
      'Chrome 問「要讓這個擴充功能編輯檔案嗎」時，請按允許。',
      link,
    ];
  }
  // 選資料夾；選錯會說明並讓人重選。回傳資料夾，取消回 null
  async function chooseFolder(saved) {
    let msg = null;
    for (;;) {
      const a = await modal({ title: saved ? '重新選擇外掛資料夾' : '選擇外掛資料夾（只需一次）',
        body: msg ? [para(msg, 'bad'), ...folderBody(saved)] : folderBody(saved),
        buttons: [{ label: '取消', value: 'cancel' }, { label: '選擇資料夾', value: 'pick', primary: true }] });
      if (a !== 'pick') return null;
      try { const dir = await Updater.pickFolder(); await refreshFolderHint(); return dir; } catch (err) {
        if (err && err.name === 'AbortError') return null;
        msg = err && err.name === 'SecurityError' ? '沒有取得資料夾的存取權限，請再選一次並按允許。' : Updater.zhError(err, '選擇資料夾失敗');
      }
    }
  }

  function setChecking(on) {
    card.setAttribute('aria-busy', String(on));
    skEl.hidden = !on;
    statusEl.hidden = on;
    checkBtn.disabled = on;
  }

  async function check() {
    setChecking(true);
    try {
      latest = await Updater.checkLatest();
      if (latest.hasUpdate) {
        show(`${updateHeadline(latest)}：${(latest.notes[0] && latest.notes[0].summary) || latest.message}｜${fmtDate(latest.date)}`, true);
        applyBtn.hidden = false;
        document.getElementById('infoDot').hidden = false;
        await refreshFolderHint();
        chrome.action.setBadgeText({ text: '新' }).catch(() => {});
        chrome.action.setBadgeBackgroundColor({ color: '#d92d20' }).catch(() => {});
        offerUpdate();
      } else {
        show(latest.localNewer ? `本機版本 ${ver(latest.localVersion)} 比 GitHub 上的 ${ver(latest.version)} 新，不需要更新`
          : `已是最新版本${latest.version ? ' ' + ver(latest.version) : ''}（${fmtDate(latest.date)}）`);
        applyBtn.hidden = true;
        document.getElementById('infoDot').hidden = true;
        chrome.action.setBadgeText({ text: '' }).catch(() => {});
      }
    } catch (err) {
      show(Updater.zhError(err, '檢查更新失敗'));
      applyBtn.hidden = true;
    } finally {
      setChecking(false);
    }
  }

  // 打開側邊欄查到新版：同一版只主動彈一次（按「稍後」就不再彈，卡片上的按鈕隨時能更新）
  const OFFER_KEY = 'tbx-sp-offered';
  async function offerUpdate() {
    let seen = '';
    try { seen = localStorage.getItem(OFFER_KEY) || ''; } catch (e) { /* 存不了就每次都問 */ }
    if (seen === latest.sha || dlg.open) return;
    try { localStorage.setItem(OFFER_KEY, latest.sha); } catch (e) { /* 無妨 */ }
    const notes = (latest.notes || []).flatMap((n) => [para(n.summary || '')].concat(n.items.length ? [list(n.items)] : []));
    const a = await modal({ title: updateHeadline(latest), body: notes.length ? notes : [latest.message || ''],
      buttons: [{ label: '稍後', value: 'later' }, { label: '立即更新', value: 'go', primary: true }] });
    if (a === 'go') apply(); else if (a) closeModal();
  }

  // 下載 i/n 算前半、寫入 i/n 算後半
  function progressOf(msg) {
    const m = /^(下載|寫入) (\d+)\/(\d+)/.exec(msg);
    return m ? ((m[1] === '寫入' ? +m[3] : 0) + +m[2]) / (2 * +m[3]) : null;
  }

  async function apply() {
    if (!latest || !latest.hasUpdate || busy) return;
    applyBtn.disabled = checkBtn.disabled = true;
    try {
      // 記住的資料夾直接用（權限過期時 Chrome 會在這次點擊問一次）；沒有或打不開才請人選
      let dir = await Updater.getFolder();
      if (!dir) dir = await chooseFolder(await Updater.hasSavedFolder());
      if (!dir) { closeModal(); show('已取消，沒有更新任何檔案'); return; }
      busy = true;
      modal({ title: '更新中', body: ['準備下載…', '請不要關閉側邊欄。'], progress: 0 });
      await Updater.apply(dir, latest, (msg) => {
        if (!busy) return;
        dlgBody.firstChild.textContent = msg; setProgress(progressOf(msg) ?? Number(dlgBar.style.width.replace('%', '')) / 100);
      }, async (risks) => {
        busy = false;
        const a = await modal({ title: '這次更新會增加權限', body: ['新版的 manifest.json 有以下變動：', list(risks), para('只有信任這份更新時才要繼續。', 'bad')],
          buttons: [{ label: '取消更新', value: 'cancel' }, { label: '繼續更新', value: 'go', primary: true }] });
        if (a !== 'go') return false;
        busy = true;
        modal({ title: '更新中', body: ['寫入檔案…', '請不要關閉側邊欄。'], progress: 0.5 });
        return true;
      });
      modal({ title: '更新完成', body: [`已更新到 ${ver(latest.version) || '最新版'}，馬上重新載入外掛。`], progress: 1 });
      show('更新完成，重新載入擴充功能…');
      setTimeout(() => chrome.runtime.reload(), 900);
    } catch (err) {
      busy = false;
      const cancelled = err && err.name === 'AbortError';
      const msg = cancelled ? '已取消，沒有更新任何檔案' : err && err.name === 'SecurityError' ? '沒有取得資料夾的存取權限' : `更新失敗：${Updater.zhError(err, '發生未知錯誤')}`;
      show(msg);
      applyBtn.disabled = checkBtn.disabled = false;
      if (cancelled) { closeModal(); return; }
      const a = await modal({ title: '沒有更新成功', body: [para(msg, 'bad'), '下載的檔案都驗證過才會寫入；如果是寫入途中出錯，按「重試」會再寫一次。'],
        buttons: [{ label: '關閉', value: 'close' }, { label: '重新選擇資料夾', value: 'repick' }, { label: '重試', value: 'retry', primary: true }] });
      if (a === 'retry') apply();
      else if (a === 'repick') { const d = await chooseFolder(true); if (d) apply(); else closeModal(); }
      else closeModal();
    } finally { busy = false; }
  }

  checkBtn.addEventListener('click', check);
  applyBtn.addEventListener('click', apply);
  document.getElementById('upRepick').addEventListener('click', async () => {
    const d = await chooseFolder(true);
    closeModal();
    if (d) show('已改用新選的資料夾，之後都更新到這裡');
  });
  check();   // 打開側邊欄就檢查一次
})();
