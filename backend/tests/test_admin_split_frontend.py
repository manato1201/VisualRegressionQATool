"""管理操作の分離(QL6): 基準画像の更新(昇格)と撮影画像の削除は、メイン画面(index.html)ではなく、別エントリー(admin.html)にある。

- メイン画面のソースに、昇格・削除の API 呼び出しも、操作の部品も無い(管理者でも、そこからは押せない)
- 管理画面のソースだけが、それを持つ(adminApi.ts は admin/ からだけ読まれる)
- 権限の判断は常にサーバー側(promote・delete は admin 以外 403。tests/test_auth.py で確認済み)。ここはコードの置き場所の確認
"""
from __future__ import annotations

from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
SRC = FRONTEND / "src"
ADMIN_MARKERS = ("references/promote", "promoteReference", "deleteCapturedImage", '"DELETE"', "PromoteSummary", "ConfirmDialog")


def main_sources() -> dict[Path, str]:
    """メイン画面のバンドルに入るソース(admin/・adminApi.ts・管理画面だけが使う部品を除く)。"""
    skip = {SRC / "adminApi.ts", SRC / "components" / "PromoteSummary.tsx", SRC / "components" / "ConfirmDialog.tsx"}
    return {
        p: p.read_text(encoding="utf-8")
        for p in SRC.rglob("*.ts*")
        if "admin" not in p.relative_to(SRC).parts[:1] and p not in skip
    }


def test_the_main_app_carries_no_admin_operations():
    sources = main_sources()
    assert SRC / "App.tsx" in sources and SRC / "api.ts" in sources  # 検査の対象が空でないこと
    for path, body in sources.items():
        for marker in ADMIN_MARKERS:
            assert marker not in body, f"{path.relative_to(FRONTEND)} に管理操作の目印 {marker!r} が残っている"


def test_the_admin_entry_carries_them():
    api = (SRC / "adminApi.ts").read_text(encoding="utf-8")
    app = (SRC / "admin" / "AdminApp.tsx").read_text(encoding="utf-8")
    assert "/api/references/promote" in api and 'method: "DELETE"' in api
    assert "adminApi.promoteReference" in app and "adminApi.deleteCapturedImage" in app
    assert 'can("admin")' in app  # admin 以外には、操作を出さない(サーバーも 403)


def test_only_the_admin_entry_imports_the_admin_api():
    importers = [p.relative_to(SRC).as_posix() for p in SRC.rglob("*.ts*") if "adminApi" in p.read_text(encoding="utf-8") and p.name != "adminApi.ts"]
    assert importers == ["admin/AdminApp.tsx"]


def test_the_build_has_a_separate_admin_entry():
    html = (FRONTEND / "admin.html").read_text(encoding="utf-8")
    assert "/src/admin/main.tsx" in html and "/src/main.tsx" not in html
    config = (FRONTEND / "vite.config.ts").read_text(encoding="utf-8")
    assert "admin.html" in config and "index.html" in config


def test_the_main_app_links_to_the_admin_page_only_for_admins():
    panel = (SRC / "components" / "CapturePanel.tsx").read_text(encoding="utf-8")
    assert '/admin.html' in panel and 'can("admin")' in panel
