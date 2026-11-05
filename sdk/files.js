// 檔案進入：點擊選檔、拖曳放入、在工具頁內 Ctrl+V 貼上。

export function matchesAccept(file, accept) {
  if (!accept) return true;
  const rules = accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  return rules.some((r) => {
    if (r.startsWith('.')) return name.endsWith(r);
    if (r.endsWith('/*')) return type.startsWith(r.slice(0, -1));
    return type === r;
  });
}

export function bind(el, { accept = '', multiple = true, max = Infinity, onFiles } = {}) {
  const deliver = (list) => {
    let files = Array.from(list).filter((f) => matchesAccept(f, accept));
    if (!multiple) files = files.slice(0, 1);
    const truncated = files.length > max;
    if (truncated) files = files.slice(0, max);
    if (files.length) onFiles(files, { truncated });
  };

  const input = document.createElement('input');
  input.type = 'file';
  input.hidden = true;
  if (accept) input.accept = accept;
  input.multiple = multiple;
  input.addEventListener('change', () => { deliver(input.files); input.value = ''; });
  el.after(input);

  const pick = () => input.click();
  el.addEventListener('click', pick);
  if (!/^(button|a|label)$/i.test(el.tagName)) {
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  }

  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('is-over'); });
  el.addEventListener('dragleave', () => el.classList.remove('is-over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('is-over');
    if (e.dataTransfer?.files?.length) deliver(e.dataTransfer.files);
  });

  const onPaste = (e) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length) deliver(files);
  };
  document.addEventListener('paste', onPaste);

  return () => { el.removeEventListener('click', pick); document.removeEventListener('paste', onPaste); input.remove(); };
}
