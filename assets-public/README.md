# 通用素材（assets-public）

沒輸入公司密碼時使用；這裡的檔案都可以公開。**公司素材絕不能放這裡**（只放後端 R2，見規格 §5）。

## 素材代號對照
工具用 `tb.assets.get('<代號>')` 取素材；有公司憑證回公司版，沒有就回這裡的通用版。代號寫在各工具的 `tool.json`。

| 代號 | 公司版（後端代號） | 通用版 | 用在 |
|---|---|---|---|
| `sticker.smile` / `shock` / `cry` / `angry` / `kiss` / `laugh` / `meh` | `tbao-<同名>` | `stickers/<同名>.png` | 圖片套版、LINE 推播、設計 |
| `frame.ent.ribbon`、`frame.news.ribbon` | `pattern-ribbon-ent`、`pattern-ribbon-news` | 無（改畫通用框 C） | 圖片套版 |
| `frame.logo` | `pattern-logo-white` | 無 | 圖片套版 |
| `line.header` | `line-header` | 無（不加標題條） | LINE 推播 |
| `line.grid4` | `line-grid4-ent` | 無（改畫通用四格 A） | LINE 推播 |
| `logo.news`、`logo.old` | `tvbs-news-logo`、`tvbs-old-logo` | 使用者上傳 | 浮水印 |
| `font.title` | `font-whz-heavy`（woff2） | 無（用 Noto Sans TC 粗體） | 圖片套版、LINE 推播、設計 |

## 貼圖來源與授權
`stickers/*.png` 由 Google **Noto Color Emoji** 字型輸出，加白色描邊與陰影（400×400 透明底）。
字型以 SIL Open Font License 1.1 授權、Noto Emoji 圖像以 Apache License 2.0 授權，皆可商用、可修改、可公開散布。
來源：https://github.com/googlefonts/noto-emoji

| 檔名 | 表情 | 對應 T 寶 |
|---|---|---|
| smile | 🙂 | 笑臉 |
| shock | 😱 | 驚嚇 |
| cry | 😭 | 大哭 |
| angry | 😡 | 生氣 |
| kiss | 😘 | 親親 |
| laugh | 😂 | 笑哭 |
| meh | 😑 | 無言 |
