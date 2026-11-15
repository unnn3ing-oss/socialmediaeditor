import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # tools/ytdl


def test_host_version_is_well_formed():
    import version

    assert re.fullmatch(r"\d+\.\d+\.\d+", version.VERSION)


def test_update_source_is_this_repo_and_only_the_host_folder():
    import update_config

    assert (update_config.OWNER, update_config.REPO, update_config.BRANCH) == ("unnn3ing-oss", "socialmediaeditor", "main")
    assert update_config.PATH == "tools/ytdl/host"
    assert (ROOT.parent.parent / update_config.PATH).is_dir() and (ROOT.parent.parent / update_config.PATH / "host.py").is_file()


def test_tracking_config_matches_the_extension_side_when_it_exists():
    # 外掛端（tools/ytdl/ext）有自己的一份更新來源；它還在寫的時候不強制，寫好後兩邊必須一致
    import update_config

    ext = ROOT / "ext" / "lib" / "update-config.js"
    if not ext.is_file():
        return
    js = ext.read_text(encoding="utf-8")
    for key, value in (("owner", update_config.OWNER), ("repo", update_config.REPO), ("branch", update_config.BRANCH)):
        found = re.search(rf'{key}:\s*"([^"]+)"', js)
        assert found is None or found.group(1) == value


def test_ready_reports_host_version(tmp_path):
    import host
    import version

    assert host.Host(tmp_path, lambda message: None).ready_message()["hostVersion"] == version.VERSION
