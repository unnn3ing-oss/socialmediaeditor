// 範例工具（Task 7 會改成透過 SDK，並示範工具內切換）。
const text = document.getElementById('text');
document.getElementById('clear').addEventListener('click', () => { text.value = ''; text.focus(); });
