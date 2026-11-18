// 貼圖與馬賽克（需在 app.js 之後載入）：「圖片套版」批次模式，**每一組各自有一份**貼圖／馬賽克（預覽的是哪一組就編輯哪一組），貼圖列放在預覽右下角按鈕彈出的小視窗（#fxPop）裡。
// 貼圖、馬賽克、抽色的畫法與編輯器在 ui/compose/fx.js（和「排程發布」共用），tool.js 建好放在 window.PATTERN.fxKit。
// 因為是畫進同一張畫布，下載、複製圖片、「下載這張」「全部下載」存下來的圖都會自動包含它們。
(function () {
  if (typeof SIZE === 'undefined') return;
  const batchSlot = document.getElementById('batchFxSlot');
  const useBatch = !!(batchSlot && typeof batchFx !== 'undefined' && typeof batchCanvas !== 'undefined');
  if (!useBatch) return;
  const { drawFx, createEditor, buildRow, hintText } = window.PATTERN.fxKit;

  // ---- 批次預覽（每一組各自一份）----
  if (useBatch) {
    const store = new WeakMap();   // 批次項目 -> 它的貼圖／馬賽克清單（項目被移除就跟著被回收）
    const listOf = item => { let l = store.get(item); if (!l) store.set(item, l = []); return l; };
    const current = () => batchItems.find(it => it.id === expandedBatchItemId) || null;
    let count;
    let tiles = [];
    let setGray = () => {};
    const setDisabled = () => {
      const off = !(current() && hasBackground(current().bg));
      tiles.forEach(b => { b.disabled = off; });
      batchSlot.classList.toggle('off', off);
    };
    const batch = createEditor({
      canvas: batchCanvas,
      items: () => { const it = current(); return it ? listOf(it) : null; },
      ready: () => { const it = current(); return !!it && hasBackground(it.bg); },
      changed: () => {
        const it = current();
        if (!it) return;
        if (it.markEdited) it.markEdited();   // 改了貼圖，縮圖要跟著重畫
        previewBatchItem(it);
      },
      redraw: () => { const it = current(); if (it && listOf(it).length) previewBatchItem(it); },
      onLayout: (n, gray) => {
        if (count) count.textContent = [n ? `這一組已加 ${n} 個` : '', gray ? '抽色' : ''].filter(Boolean).join('・');
        setGray(gray);
        setDisabled();
      }
    });
    batchFx = { forItem: item => drawFx(listOf(item)), onView: () => batch.sync() };

    const head = document.createElement('div');
    head.className = 'fx-bar-head';
    const title = document.createElement('strong');
    title.textContent = '貼圖與馬賽克';
    count = document.createElement('span');
    count.className = 'fx-count';
    head.appendChild(title);
    head.appendChild(count);
    const built = buildRow(batch);
    tiles = built.tiles;
    setGray = built.setGray;
    built.row.title = hintText;   // 操作說明改成滑鼠停留提示（不放灰字）
    batchSlot.appendChild(head);
    batchSlot.appendChild(built.row);
    batch.sync();
  }
})();
