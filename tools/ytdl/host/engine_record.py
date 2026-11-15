"""安裝紀錄：安裝檔記下它驗證過的 yt-dlp.exe（Windows，SHA-256 與大小），以及安裝的版本。
安裝檔、檢查程式（doctor）與下載助手的更新都會讀它。外掛本身由小編工具箱安裝，這裡不記外掛資料夾。"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

RECORD_NAME = "install.json"


def read_record(home: Path) -> dict:
    try:
        data = json.loads((Path(home) / RECORD_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write(home: Path, data: dict) -> None:
    Path(home).mkdir(parents=True, exist_ok=True)
    target = Path(home) / RECORD_NAME
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, target)


def write_record(home: Path, *, version: str) -> None:
    """寫入安裝的版本；其他項目（`engine`）保留。"""
    data = read_record(home)
    data["version"] = version
    _write(home, data)


def fingerprint(path: Path) -> dict:
    """檔案的位置、SHA-256 與大小：IT 要加白名單時需要。"""
    digest, size = hashlib.sha256(), 0
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
            size += len(chunk)
    return {"path": str(path), "sha256": digest.hexdigest(), "size": size}


def write_engine(home: Path, engine: dict) -> None:
    data = read_record(home)
    data["engine"] = engine
    _write(home, data)


def read_engine(home: Path) -> dict:
    """安裝檔上次驗證過的 yt-dlp.exe（{path, sha256, size, ...}）；舊紀錄沒有就回 {}。"""
    engine = read_record(home).get("engine")
    if isinstance(engine, dict) and isinstance(engine.get("sha256"), str):
        return engine
    return {}
