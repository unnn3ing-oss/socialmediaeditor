# 時間排序以距離現在為準
- 狀態：實作與測試完成，待使用者確認　- 分支：`codex/sort-distance-now`　- 最後更新：2026-11-07
- 使用者需求：「越靠近現在時間」為最近時間，相反為最遠時間；已確認「開始」。

## 已定案的決定
- 已排程的時間排序使用與現在的絕對時間差；最近由小到大，最遠由大到小。
- 缺少或無效時間一律放最後；時間差相同時以時間先後穩定排序。
- 僅重排畫面已有資料，不增加 Facebook 查詢；保留排序偏好。

## 做法
- `tools/fbpost/tool.js`：修正排序函式。
- `test/e2e/fbpost.e2e.js`：過去／未來混合與缺少時間的排序回歸。

## 下一步
- [x] 已修正排序並新增混合過去／未來、缺少／無效時間及現在基準移動測試。
- [x] 程式獨立審查符合需求；審查指出測試未等載入，已修正等待4列並重跑通過。
- [x] 推開發分支供確認，不推 main、不部署。
- [ ] 使用者說「推」後才併入 main，並同步更新 CLAUDE.md 目前進度。

## 測試
- `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cloud-setup/browsers node --test --test-name-pattern='排序|最近／最遠' test/e2e/fbpost.e2e.js`：2 項全通過。
- `node build.js`、`node build.js --check`、`git diff --check` 通過；目錄版本雜湊已更新。
