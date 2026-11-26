"""基準画像の更新を、長押しで確定する(2026-11-26。HoldToConfirm)。ソースの置き場所と、ばねの値の確認。

- 基準画像(Reference)を置き換える確認ダイアログの確定ボタンは、長押し式(クリックでは確定しない)
- ばねの値は designbookmark の Hold to publish に合わせ、ToolOrchestrationHub の長押しと同じ
- 動きを減らす設定(prefers-reduced-motion)では、ばねを使わず、揺れも無し
- 長押しの部品は管理画面だけが使う(メイン画面のバンドルに入れない)
"""

from __future__ import annotations

import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"


def test_spring_values_match_the_hold_component():
    motion = (SRC / "motion.ts").read_text(encoding="utf-8")
    for line in (
        "holdMs: 1200",
        "doneMs: 1700",
        "release: [260, 14]",
        "morph: [320, 20]",
        "squash: [520, 20]",
        "shake: [700, 9]",
    ):
        assert line in motion, line
    assert "SUBSTEPS = 4" in motion and "MAX_DT = 1 / 30" in motion
    assert "prefers-reduced-motion: reduce" in motion


def test_reduced_motion_jumps_and_does_not_shake():
    motion = (SRC / "motion.ts").read_text(encoding="utf-8")
    to_body = motion.split("to(next, velocity)")[1].split("kick(velocity)")[0]
    kick_body = motion.split("kick(velocity) {")[1].split("},")[0]
    assert "reducedMotion()" in to_body and "this.set(next)" in to_body
    assert re.search(r"if \(reducedMotion\(\)\) return;", kick_body)


def test_promote_dialog_uses_hold_and_a_click_does_not_confirm():
    app = (SRC / "admin" / "AdminApp.tsx").read_text(encoding="utf-8")
    assert 'hold={{ doneLabel: "Referenceを更新しました"' in app
    hold = (SRC / "components" / "HoldToConfirm.tsx").read_text(encoding="utf-8")
    assert "onClick={(e) => e.preventDefault()}" in hold  # クリックでは実行しない
    assert 'e.key === " " || e.key === "Enter"' in hold  # キーボードでも押し続けられる
    dialog = (SRC / "components" / "ConfirmDialog.tsx").read_text(encoding="utf-8")
    assert "<HoldToConfirm" in dialog


def test_hold_is_only_used_by_the_admin_screen():
    users = sorted(
        p.relative_to(SRC).as_posix()
        for p in SRC.rglob("*.tsx")
        if 'from "./HoldToConfirm"' in p.read_text(encoding="utf-8") or 'components/HoldToConfirm"' in p.read_text(encoding="utf-8")
        and p.name != "HoldToConfirm.tsx"
    )
    assert users == [
        "components/ConfirmDialog.tsx"
    ]  # ConfirmDialog 自体が管理画面だけの部品(test_admin_split_frontend)
