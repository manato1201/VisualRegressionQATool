# 6. トラブルと保守

## 症状 → 原因 → 直し方

| 症状 | 原因 | 直し方 |
|---|---|---|
| ブラウザで **403**「このHostでは…」 | `localhost`・`127.0.0.1` 以外の名前で API を開いている | `VRQA_ALLOWED_HOSTS` に、その名前を足す |
| 画面からの操作が **403**(Origin) | UI の配信元が `VRQA_CORS_ORIGINS` に無い | UI の URL を `VRQA_CORS_ORIGINS` に入れる(`*` は拒否される) |
| UI から API を呼べない(CORS のエラー) | 同上。UI を別ホストで配信している | `VRQA_CORS_ORIGINS` に UI の origin を指定。`VITE_API_BASE` もビルド時に |
| **401** | キー無し・間違い | `X-API-Key` を付ける。ブラウザならログイン |
| **403**(役割) | 役割が足りない(昇格・削除は admin) | 役割を上げる。昇格・削除は `admin.html` から |
| 差分実行が **404** 「no reference image」 | その指示に、有効な基準が無い | 撮影画像を「基準に昇格」する(admin) |
| 差分実行が **422** | 解像度が違う / 壊れた画像 | 撮影条件をそろえる。意図して許すなら `allow_center_crop`(記録が残る) |
| 差分が**毎回ゼロにならない**(同じはずなのに) | 撮影が決定的でない(アニメ・時計・乱数) | 決定性を検収する(`check_determinism`)。時計・動きを固定。許容誤差は最後の手段 |
| 結果が **flaky** | 同じ版で pass と fail が混在 | 撮影の揺れを疑う。flaky は通知を開閉しない |
| 画像が表示されない | `blob missing`(404)・`Vary: Origin` のキャッシュの取り違え | BLOB のフォルダ(`VRQA_BLOB_ROOT`)が DB と同じボリュームか確認 |
| 撮影画像の削除が **409** | 基準に昇格済み・差分履歴に含まれる | 仕様(鎖を切らない)。基準を新しいものに替えても、履歴は残る |
| 起動しない(`VRQA_AUTH=required`) | ユーザーが 1 人もいない | `uv run python -m app.auth add --name <名前> --role admin` |
| しきい値ラボ・連続性が **404** | 本番(`required`)で `VRQA_DEBUG` が無効 | 必要なときだけ `VRQA_DEBUG=1`(admin だけが使える) |
| 通知が来ない | `VRQA_ALERT_SINK` が `noop` のまま・URL 未設定 | `VRQA_ALERT_SINK` と、`VRQA_WEBHOOK_URL`・GitHub の設定を確認 |

## 既知の問題(コードは変えていない。直すときの手がかり)

文書を作るときに、コードを読んで・動かして見つけたものです。

### 1. 通知先が例外を出すと、差分実行が 500 になる(一括実行は全体が止まる)

`_handle_alerting` は、`alert_sink.notify_failure` の例外を**捕まえません**。Webhook・GitHub の送信は `raise_for_status()` で例外を出すので、通知先が落ちていたり、トークンが無効だったりすると、**判定は DB に保存済みなのに、API は 500** を返します。しかも `alert_issue` は記録されないので、次の fail でまた通知を試みます。`run-batch` では、`_DiffRunError` だけを件ごとに捕まえているため、**通知の例外で、残りの件の実行も止まります**(「1 件の失敗が他に影響しない」は、通知の失敗には当てはまらない)。

```python
# 実行できる
import tempfile
from pathlib import Path

from app import db, models, repository
from app.routers.diffs import _handle_alerting


class BrokenSink:
    """通知先が落ちている(Webhook が 500 を返す、など)。"""

    def notify_failure(self, ctx):
        raise RuntimeError("通知先に届かない")

    def notify_recovery(self, instruction_id, external_ref):
        pass


with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    with db.session(Path(tmp) / "vrqa.sqlite3") as conn:
        ins = repository.create_capture_instruction(conn, models.CaptureInstructionCreate(scene_or_level_id="title"))
        base = repository.create_captured_image(conn, instruction_id=ins.instruction_id, build_version="base", checksum="b" * 64,
                                                image_path="b.png", width=4, height=4, color_space="sRGB")
        ref = repository.promote_reference_image(conn, captured_image_id=base.captured_image_id,
                                                 instruction_id=ins.instruction_id, approved_by="alice")
        cap = repository.create_captured_image(conn, instruction_id=ins.instruction_id, build_version="v1", checksum="c" * 64,
                                               image_path="c.png", width=4, height=4, color_space="sRGB")
        diff = repository.create_diff_image(conn, captured_image_id=cap.captured_image_id, reference_image_id=ref.reference_image_id,
                                            diff_image_path="d.png", diff_pixel_count=5, diff_percentage=1.0)
        result = repository.create_evaluation_result(conn, diff_image_id=diff.diff_image_id, verdict="fail")

        try:
            _handle_alerting(conn, BrokenSink(), instruction_id=ins.instruction_id, captured=cap, evaluation_result=result, diff_image=diff)
        except RuntimeError as exc:
            print("通知の例外が、そのまま外へ出る:", exc)
        print("判定は保存済み:", repository.get_evaluation_result(conn, result.evaluation_result_id).verdict)
        print("通知の記録(alert_issue)は無い:", repository.find_open_alert_issue(conn, ins.instruction_id) is None)
```

```text
# 出力
通知の例外が、そのまま外へ出る: 通知先に届かない
判定は保存済み: fail
通知の記録(alert_issue)は無い: True
```

**直す案**: `notify_failure`・`notify_recovery` の呼び出しを `try/except` で囲み、**失敗は記録して、判定の結果は返す**。通知の失敗を、レスポンスの `alert` に `{"action": "failed", ...}` として含める。

### 2. `CompositeAlertSink` は、最初の通知先が例外を出すと、残りへ通知しない

`notify_failure` が、子の通知先を**順に**呼ぶ内包表記で、1 つが例外を出すと、後ろの子には届きません。**直す案**: 子ごとに `try/except`。また、子の参照(`_child_refs`)は**メモリだけ**なので、**再起動の前に開いたアラートの復旧は、子の通知先に届きません**(コード内のコメントにも、同じ制限が書かれている)。

### 3. `first-bad-commit` は「最初の失敗」(いまの失敗の始まりではない)

一度 fail して直り、また fail しても、答えは**最初の失敗の版**(講義[第 3 回](../lecture/03-history-flaky-alerts.md))。「最後の pass より後の最初の fail」の SQL に変える案。

### 4. flaky は、過去の判定を書き換える

同じ版で pass と fail が混在すると、**元の判定を `flaky` で上書き**します。後から、元の pass・fail は読めません(履歴を作り直したいときの注意)。

### 5. 基準を指定するとき、同じ指示のものか確かめていない

`reference_image_id` を指定した差分実行では、**別の指示の基準**も使えます(`_load_pair`)。意図した柔軟さか、取り違えの防止が要るかは、未確認。

### 6. アップロードのサイズ上限が、コードの上では見当たらない

ファイル全体をメモリに読みます。巨大な画像で、メモリを使い切りうる。前段のリバースプロキシで制限する想定かもしれない(要確認)。

### 7. その他の制約(設計上の割り切り)

- **API は 1 プロセス**で動かす前提(接続はリクエストごと・書き込みの直列化はプロセス内ロック)。複数プロセス・複数台にするなら、先に SQLite を別の DB へ。
- **マイグレーション**は「列を足す」だけ(版の管理なし)。大きな変更には専用の仕組みを。
- トースト(`webui_toast`)は**メモリのキュー**。再起動で消える。
- **認証は既定でなし**。インターネットに公開するなら、`VRQA_AUTH=required` と、前段のアクセス制限を。
- `unity_capture_agent`(C#)は、このリポジトリ内では**未検証**。

## 定期の保守

| いつ | 何を |
|---|---|
| 毎回の変更 | `cd backend && uv run pytest -q`・`cd frontend && npm run build`・`python tools/check_docs.py` |
| 月 1 回 | 依存の更新(`uv lock --upgrade`・`npm update`)→ テスト。`pyjwt`・`fastapi`・`pillow`・`vite` に注意 |
| 月 1 回 | `VRQA_BLOB_ROOT` と DB の**大きさ**を確認。BLOB は**削除しないと増え続ける**(基準・履歴にある画像は消せない) |
| 月 1 回 | `audit.jsonl` の大きさ(5 MB で `.1` に退避するが、`.1` は 1 世代だけ) |
| 四半期 | ユーザー(`python -m app.auth list`)の見直し |
| 基準を替えたとき | 古い基準は残る(`is_active = 0`)。**何を基準に承認したか**を、レビューで確認する |
| 関数を直したとき | `python tools/check_docs.py --update` で、文書の引用・出力を作り直し、**説明が合っているか**を読む |
