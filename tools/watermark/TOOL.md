# 浮水印（watermark）

- **用途**：一次放多張照片，疊上 Logo（四個角、可調大小／透明度／邊距），維持原圖尺寸下載。
- **來源**：舊「套版產生器」的 `watermark.js`／`watermark.css`；選檔／拖曳／貼上改用 `tb.files.bind`，下載改用 `tb.download`。
- **資料存哪**：只在記憶體；切換 Logo 來源、位置、輸出格式都不會清掉照片，只有「全部清除」或重新整理會清空。
- **公司素材**：`logo.news`、`logo.old`（後端 `tvbs-news-logo`、`tvbs-old-logo`）。**沒密碼**只顯示「上傳自己的 Logo」（點選／拖曳／貼上）；**有密碼**多出新版／舊版選項，仍可上傳自己的。Logo 檔不在 repo。
- **需要**：無外掛。
- **檔案**：`base.css`、`segmented.css`／`segmented.js`、`confirm.js` 是三個做圖工具（拼圖、尺寸、浮水印）各帶一份的共用底。
