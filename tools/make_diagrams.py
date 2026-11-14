"""docs/diagrams/ の構成図(SVG)を作る。直すときは、ここを直して `python tools/make_diagrams.py` を実行する。

  architecture.svg   全体の構成(呼ぶ側・バックエンド・保存・通知先)

部品は tools/svgkit.py。座標は手で決める。決まり: ①矢印はカードの横(か上)から出入り(カードの下には文字がある)
②縦に渡るときは、カードの間のすき間を通る ③流れの説明は、図に詰めず、本文に書く。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from svgkit import Diagram  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "docs" / "diagrams"


def architecture() -> Diagram:
    d = Diagram(1400, 990, "VisualRegressionQATool の構成",
                "撮影エージェント(Unity・Houdini)・CI・ブラウザが、HTTP でバックエンドを呼ぶ。入口で Host・Origin・API キー・役割を検査し、"
                "ルーターが、画像を保存し、PixelDiffEngine で基準画像と比べ、結果を SQLite に残す。fail では通知先へ 1 回だけ知らせ、pass で閉じる。")
    d.text(40, 44, "VisualRegressionQATool — 構成", cls="hd")
    d.text(40, 66, "青=主な流れ / 灰の破線=補助。評価はピクセル比較だけ(類似度は使わない)。撮影の決定性は、撮る側の仕事", cls="note")

    # ---- 左: 呼ぶ側 ----
    d.group(40, 100, 250, 640, "CLIENTS — 呼ぶ側", color="gray")
    unity = d.card(150, 190, "video", "Unity エージェント", "unity_capture_agent\n(C#・契約は共通)")
    hou = d.card(150, 340, "gear", "Houdini エージェント", "capture_agents (Python)\nview / comp")
    ci = d.card(150, 490, "branch", "CI スクリプト", "ci_diff_check.py\nfail で非ゼロ終了")
    web = d.card(150, 640, "browser", "差分ビューア", "React (index.html)\n/admin.html は admin だけ")

    # ---- 中央: バックエンド ----
    d.group(480, 100, 820, 640, "BACKEND — FASTAPI (backend/app/)", color="teal")
    guard = d.card(640, 190, "shield", "入口の検査", "Host・Origin・API キー\n役割・監査ログ")
    api = d.card(900, 190, "server", "routers/", "captures・references\ndiffs・runs・alerts")
    engine = d.card(640, 415, "check", "diff_engine", "PixelDiffEngine\n3 つのつまみ")
    repo = d.card(900, 415, "db", "repository + db", "SQLite 5 テーブルの鎖\n基準は有効 1 つ")
    blobs = d.card(1160, 415, "folder", "storage", "BLOB(SHA-256 の名前)\n同じ中身は書かない")
    sink = d.card(1160, 640, "cloud", "alert_sink", "IAlertSink\nfail で 1 回だけ開く")
    d.text(500, 722, "撮影画像・基準・差分は、すべて同じ置き場。判定は pass / fail / flaky(同じ版で混在)", cls="note")

    # ---- 下: 通知先 ----
    d.group(480, 790, 820, 170, "NOTIFY — 通知先(環境変数で差し替え)", color="purple")
    d.card(640, 860, "tag", "GitHub Issue", "ラベルで重複を防ぐ\n復旧で自動クローズ")
    d.card(900, 860, "cloud", "Webhook", "VRQA_WEBHOOK_URL")
    d.card(1160, 860, "browser", "画面のトースト", "GET /api/alerts/toasts")

    # ---- 矢印 ----
    d.arrow([unity.right, guard.left], "撮影画像を送る", at=0)
    d.arrow([hou.right, (540, 340), (540, 190), guard.left], "撮影画像を送る", at=0)
    d.arrow([ci.right, (540, 490), (540, 190), guard.left], "差分を実行", at=0)
    d.arrow([web.right, (540, 640), (540, 190), guard.left], "閲覧・昇格・削除", at=0)
    d.arrow([guard.right, api.left], "通ったものだけ", at=0)
    d.arrow([api.right, (1040, 190), (1040, 330), (900, 330), repo.top], "保存・検索", at=2, dy=-10)
    d.arrow([(1040, 330), (640, 330), engine.top], "比べる", at=0, dy=-10)
    d.arrow([(1040, 330), (1160, 330), blobs.top], "画像の読み書き", at=0, dy=-10)
    d.arrow([(1040, 190), (1250, 190), (1250, 640), sink.right], "fail / pass", kind="secondary", at=1, dx=0, dy=0)
    d.arrow([sink.left, (1050, 640), (1050, 790)], "通知先を差し替え", kind="secondary", at=0, dy=-10)
    return d


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "architecture.svg").write_text(architecture().svg(), encoding="utf-8")
    print("wrote", OUT / "architecture.svg")


if __name__ == "__main__":
    main()
