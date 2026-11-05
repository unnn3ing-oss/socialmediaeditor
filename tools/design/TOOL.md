# 設計（design）

- **用途**：自由排版的平面設計：文字、圖片、貼圖、形狀、馬賽克；多頁、圖層、群組、剪裁遮色片、復原重做、匯出 PNG／JPG／ZIP、存取專案檔（.json）。
- **來源**：QuickPatterntool 的 `design-*.js`，邏輯照搬；只換素材與下載（`tool.js` 接 `tb.assets`、`tb.download`）。
- **資料存哪**：只在記憶體（不寫 localStorage）；工具內切換（屬性／圖層）只改 hidden，內容保留；重新整理會清除。要保存請用「存專案」。
- **素材**：
  - 貼圖 `sticker.<smile|shock|cry|angry|kiss|laugh|meh>`：沒密碼用通用貼紙，有密碼用 T 寶。
  - 字型 `font.title`：有密碼才有 WHZ-Heavy（後端 `font-whz-heavy`）；沒密碼預設 Noto Sans TC 900，選單不出現 WHZ-Heavy。
  - 仙人掌明體（`fonts/`，OFL 授權）與思源宋體（Google Fonts）為公開字型。
- **需要**：無外掛。
- **注意**：`design-core.js`、`design-fonts.js` 可在 Node 載入（單元測試 `test/design-core.test.js`）。
