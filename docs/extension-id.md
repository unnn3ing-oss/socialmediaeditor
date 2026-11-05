# 外掛固定 ID

`manifest.json` 有 `key`（公鑰），所以每台電腦載入的「小編工具箱」外掛 ID 都相同：

```
odajlpffjjeiliinefhimmbpdeeggckg
```

- ID 由 `key` 算出：公鑰 DER 的 SHA-256 取前 32 個 hex 字元，`0-f` 對應 `a-p`（見 `extension/core/id.js`）。
- 私鑰沒有保存。載入未封裝項目不需要私鑰；更換 `key` 會改變 ID，請不要隨意更動。
- 重新產生公鑰的指令：`openssl genrsa 2048 | openssl rsa -pubout -outform DER | base64 -w0`（只留公鑰，私鑰不落地）。

## P2 要做的事

YT 下載的本機下載助手（videodownload 的 `host/installer.py`），其 `allowed_origins` 目前只寫舊外掛的 ID。
P2 要把上面這個 ID 加進去，讓新舊兩個外掛都能使用，已安裝的人重跑一次安裝程式。
這會改到 videodownload repo，需另外請使用者確認。
