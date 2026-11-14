# 第 3 回 履歴・不安定(flaky)・アラート

> 所要時間の目安: 4 時間 / 前提: 第 0〜2 回・SQL の `JOIN`・`GROUP BY` の基本

## この回のゴール

- 「**最初に fail した版**」(first-bad-commit)を求める SQL を、**読んで説明**できる。その**限界**も言える。
- **flaky**(不安定)という判定が、**なぜ必要か**を説明できる。
- アラートが、**fail で 1 回だけ開き、pass で閉じる**(重複しない)しくみを説明できる。
- **差し替え可能な通知先**(`IAlertSink`)の作りを説明できる。

## 1. 最初に壊れた版(first-bad-commit)

「いつから壊れたのか」を知りたい。同じ撮影指示の履歴から、**最初に fail した `build_version`** を答えます。

```python
# 抜粋ファイル: backend/app/queries.py
SELECT ci.instruction_id AS instruction_id,
       cap.build_version AS build_version,
       er.evaluated_at AS evaluated_at
FROM evaluation_result er
JOIN diff_image di ON er.diff_image_id = di.diff_image_id
JOIN captured_image cap ON di.captured_image_id = cap.captured_image_id
JOIN capture_instruction ci ON cap.instruction_id = ci.instruction_id
WHERE er.verdict = 'fail' AND ci.instruction_id = ?
ORDER BY cap.captured_at ASC
LIMIT 1;
```

- `evaluation_result → diff_image → captured_image → capture_instruction` と、**鎖を `JOIN` でたどる**(第 2 回の鎖)。
- `verdict = 'fail'` だけを、**撮影の古い順**に並べ、**先頭の 1 件**。
- **ただの SQL**で、推論ではない。答えるのは「**いつ**初めて fail したか」で、「**なぜ**」ではない。

**限界**: 「**最初に fail した**」であって、「**いまの失敗が始まった**」版ではありません。いったん直ったあと(pass)、**また壊れても**、答えは**最初の失敗**のままです。次の例で確かめます。

```python
# 実行できる
import tempfile
from pathlib import Path

from app import db, models, queries, repository


def record(conn, instruction_id, reference_id, build, verdict):
    cap = repository.create_captured_image(
        conn, instruction_id=instruction_id, build_version=build, checksum=build * 8,
        image_path=f"blobs/{build}.png", width=4, height=4, color_space="sRGB",
    )
    diff = repository.create_diff_image(
        conn, captured_image_id=cap.captured_image_id, reference_image_id=reference_id,
        diff_image_path="d.png", diff_pixel_count=0 if verdict == "pass" else 9, diff_percentage=0.0,
    )
    return cap, diff, repository.create_evaluation_result(conn, diff_image_id=diff.diff_image_id, verdict=verdict)


with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    with db.session(Path(tmp) / "vrqa.sqlite3") as conn:
        ins = repository.create_capture_instruction(conn, models.CaptureInstructionCreate(scene_or_level_id="title"))
        base = repository.create_captured_image(conn, instruction_id=ins.instruction_id, build_version="base", checksum="b" * 64,
                                                image_path="blobs/b.png", width=4, height=4, color_space="sRGB")
        ref = repository.promote_reference_image(conn, captured_image_id=base.captured_image_id,
                                                 instruction_id=ins.instruction_id, approved_by="alice")

        for build, verdict in [("v1", "pass"), ("v2", "fail"), ("v3", "pass"), ("v4", "fail")]:
            record(conn, ins.instruction_id, ref.reference_image_id, build, verdict)

        print("最初に fail した版:", queries.first_bad_commit(conn, ins.instruction_id).build_version)
        print("いまの最新の判定  :", queries.latest_verdict_for_instruction(conn, ins.instruction_id))
        print("履歴(新しい順)    :", [(r.build_version, r.verdict) for r in queries.list_runs(conn, ins.instruction_id)])
```

```text
# 出力
最初に fail した版: v2
いまの最新の判定  : fail
履歴(新しい順)    : [('v4', 'fail'), ('v3', 'pass'), ('v2', 'fail'), ('v1', 'pass')]
```

v2 で fail → v3 で直って pass → v4 で**また** fail。それでも答えは **v2**(最初の失敗)です。「いまの失敗が始まったのは v4」を知りたいなら、「**最後の pass より後の、最初の fail**」を求める SQL に変える必要があります(拡張の課題)。

## 2. 不安定(flaky)

同じビルド(`build_version`)・同じ撮影指示で、**ある時は pass、ある時は fail** になることがあります。これは、「**本物の退行**」でも「**本当に問題なし**」でもなく、**撮影が決定的でない**(揺れている)ことの証拠です。

矛盾した 2 つの判定を並べず、**flaky**に書き換えます。

```python
# 引用: backend/app/repository.py::reconcile_flaky_verdicts
def reconcile_flaky_verdicts(conn: sqlite3.Connection, *, instruction_id: str, build_version: str) -> list[str]:
    """If the same (instruction, build_version) has both a `pass` and a
    `fail` among its evaluation history, the underlying capture is
    non-deterministic rather than genuinely regressed or genuinely fine --
    re-labels every non-flaky evaluation for that build as `flaky` instead
    of leaving a misleading, contradictory pass/fail split.

    Returns the evaluation_result_ids that were just flipped to flaky (empty
    if nothing needed reconciling).
    """
    with db_write_lock:
        rows = conn.execute(
            """
            SELECT er.evaluation_result_id AS id, er.verdict AS verdict
            FROM evaluation_result er
            JOIN diff_image di ON er.diff_image_id = di.diff_image_id
            JOIN captured_image cap ON di.captured_image_id = cap.captured_image_id
            WHERE cap.instruction_id = ? AND cap.build_version = ?
            """,
            (instruction_id, build_version),
        ).fetchall()

        verdicts = {row["verdict"] for row in rows}
        if not {"pass", "fail"} <= verdicts:
            return []

        to_flip = [row["id"] for row in rows if row["verdict"] in ("pass", "fail")]
        for evaluation_result_id in to_flip:
            conn.execute(
                "UPDATE evaluation_result SET verdict = 'flaky' WHERE evaluation_result_id = ?",
                (evaluation_result_id,),
            )
        conn.commit()
        return to_flip
```

- 同じ(指示, 版)の判定を集める。`pass` **と** `fail` の両方があれば、全部を `flaky` に。
- **評価のたびに**呼ばれる(`_execute_diff_run`)。後から来た結果で、前の結果も書き換わる。
- **flaky は、アラートを開きも閉じもしない**(次の節)。揺れているものを、退行とも正常とも、扱わない。

## 3. アラート: 1 回だけ開き、直ったら閉じる

fail のたびに通知すると、同じ失敗で**通知が連発**します。そこで、**`alert_issue`**(いま open な通知の記録)で、状態を持ちます。

```python
# 引用: backend/app/routers/diffs.py::_handle_alerting
def _handle_alerting(
    conn: sqlite3.Connection,
    alert_sink: IAlertSink,
    *,
    instruction_id: str,
    captured: models.CapturedImageOut,
    evaluation_result: models.EvaluationResultOut,
    diff_image: models.DiffImageOut,
) -> dict | None:
    # verdict == "flaky" deliberately triggers neither branch below: a
    # non-deterministic capture is not evidence of a real regression (don't
    # open an alert) nor evidence it's actually fine (don't auto-close one
    # either) -- see repository.reconcile_flaky_verdicts.
    if evaluation_result.verdict == "fail":
        # find-open-issue-then-create is a check-then-act sequence; without
        # the lock, two concurrent failing runs for the same instruction
        # could both see "no open issue" and both create one.
        with repository.db_write_lock:
            existing = repository.find_open_alert_issue(conn, instruction_id)
            if existing is not None:
                return {
                    "action": "already-open",
                    "external_ref": existing["external_ref"],
                }

            instruction = repository.get_capture_instruction(conn, instruction_id)
            ctx = AlertFailureContext(
                instruction_id=instruction_id,
                scene_or_level_id=instruction.scene_or_level_id if instruction else "",
                build_version=captured.build_version,
                evaluation_result_id=evaluation_result.evaluation_result_id,
                verdict=evaluation_result.verdict,
                diff_pixel_count=diff_image.diff_pixel_count,
                diff_percentage=diff_image.diff_percentage,
                diff_image_url=f"/api/diffs/{diff_image.diff_image_id}/image",
            )
            external_ref = alert_sink.notify_failure(ctx)
            if external_ref is None:
                return None
            repository.create_alert_issue(
                conn,
                instruction_id=instruction_id,
                evaluation_result_id=evaluation_result.evaluation_result_id,
                sink_kind=type(alert_sink).__name__,
                external_ref=external_ref,
            )
            return {"action": "opened", "external_ref": external_ref}

    if evaluation_result.verdict == "pass":
        # Same race shape as the fail branch above: read-open-rows-then-close
        # must not interleave with another concurrent pass/fail evaluation
        # for the same instruction, or a recovery could be reported twice.
        with repository.db_write_lock:
            closed_rows = repository.close_open_alert_issues(conn, instruction_id)
            for row in closed_rows:
                alert_sink.notify_recovery(instruction_id, row["external_ref"])
            if closed_rows:
                return {
                    "action": "recovered",
                    "closed": [r["external_ref"] for r in closed_rows],
                }

    return None
```

| 判定 | open な通知が… | 起きること |
|---|---|---|
| **fail** | ない | 通知先に送り、`alert_issue` を **open** で記録(`"opened"`) |
| **fail** | すでにある | **何もしない**(`"already-open"`) |
| **pass** | ある | 通知先に「復旧」を送り、**closed** に(`"recovered"`) |
| **flaky** | — | **開きも閉じもしない** |

**`with repository.db_write_lock`** が大事です。「open な通知を探す → なければ作る」は、**調べてから行動する**(check-then-act)手順で、**同時に 2 つの fail** が来ると、両方が「ない」と見て、**2 件作ってしまう**(競合状態)。ロックで、この 2 手を一続きにしています。

```python
# 実行できる
import tempfile
from pathlib import Path

from app import db, models, repository
from app.alert_sink import AlertFailureContext
from app.routers.diffs import _handle_alerting


class RecordingSink:
    """通知を、画面に出さずに覚えておく偽の通知先(IAlertSink の形を満たす)。"""

    def __init__(self):
        self.events = []

    def notify_failure(self, ctx: AlertFailureContext):
        self.events.append(("failure", ctx.build_version))
        return f"ISSUE-{len(self.events)}"

    def notify_recovery(self, instruction_id, external_ref):
        self.events.append(("recovery", external_ref))


with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    with db.session(Path(tmp) / "vrqa.sqlite3") as conn:
        ins = repository.create_capture_instruction(conn, models.CaptureInstructionCreate(scene_or_level_id="title"))
        base = repository.create_captured_image(conn, instruction_id=ins.instruction_id, build_version="base", checksum="b" * 64,
                                                image_path="blobs/b.png", width=4, height=4, color_space="sRGB")
        ref = repository.promote_reference_image(conn, captured_image_id=base.captured_image_id,
                                                 instruction_id=ins.instruction_id, approved_by="alice")
        sink = RecordingSink()

        def run(build, verdict):
            cap = repository.create_captured_image(conn, instruction_id=ins.instruction_id, build_version=build, checksum=build * 8,
                                                   image_path=f"{build}.png", width=4, height=4, color_space="sRGB")
            diff = repository.create_diff_image(conn, captured_image_id=cap.captured_image_id, reference_image_id=ref.reference_image_id,
                                                diff_image_path="d.png", diff_pixel_count=5, diff_percentage=1.0)
            result = repository.create_evaluation_result(conn, diff_image_id=diff.diff_image_id, verdict=verdict)
            return _handle_alerting(conn, sink, instruction_id=ins.instruction_id, captured=cap, evaluation_result=result, diff_image=diff)

        for build, verdict in [("v1", "fail"), ("v2", "fail"), ("v3", "flaky"), ("v4", "pass"), ("v5", "pass")]:
            print(f"{build} {verdict:5} →", run(build, verdict))
        print("通知先に届いたもの:", sink.events)
```

```text
# 出力
v1 fail  → {'action': 'opened', 'external_ref': 'ISSUE-1'}
v2 fail  → {'action': 'already-open', 'external_ref': 'ISSUE-1'}
v3 flaky → None
v4 pass  → {'action': 'recovered', 'closed': ['ISSUE-1']}
v5 pass  → None
通知先に届いたもの: [('failure', 'v1'), ('recovery', 'ISSUE-1')]
```

v1 の fail で通知が **1 回だけ**開き、v2 の fail は何もしない。flaky は無視。v4 の pass で**復旧**を送り、v5 の pass は閉じるものがないので何もしない。

## 4. 差し替えられる通知先(`IAlertSink`)

通知先は、`IAlertSink`(**`Protocol`**)を満たすクラスです。2 つのメソッドだけ:

```python
# 抜粋ファイル: backend/app/alert_sink.py
class IAlertSink(Protocol):
    def notify_failure(self, ctx: AlertFailureContext) -> str | None:
    def notify_recovery(self, instruction_id: str, external_ref: str) -> None:
```

| 実装 | 動き |
|---|---|
| `NoopAlertSink` | 何もしない(既定) |
| `WebhookAlertSink` | 指定の URL へ POST |
| `GitHubIssueAlertSink` | `visual-regression-fail` ラベルの Issue を作り、復旧で自動クローズ。**ラベル検索で重複を防ぐ** |
| `WebUiToastAlertSink` | 画面にトースト(メモリ内のキュー。画面がポーリングで読む) |
| `CompositeAlertSink` | 複数を同時に。それぞれの `external_ref` を覚え、復旧時にそれぞれ正しい参照で通知 |

**環境変数 `VRQA_ALERT_SINK` で切り替える**(コードは変えない)。**`notify_failure` が返す `external_ref`**(Issue 番号など)を DB に記録し、**復旧のときに同じものを閉じる**。

## 確認問題

1. first-bad-commit が、「いまの失敗が始まった版」を返さないのは、どんな場合ですか。
2. flaky とは何ですか。なぜ pass と fail の両方を残さず、書き換えるのですか。
3. flaky の判定は、アラートを開く?閉じる?
4. 「open な通知を探してから作る」手順に、ロックが要るのは、なぜですか。
5. 通知先を、`Protocol` にして、環境変数で切り替えられるようにした利点は。

## 解答

1. 一度 fail して直り、**また fail した**場合(最初の失敗の版が返る)。「最後の pass より後の最初の fail」を求める必要がある。
2. 同じ版で pass と fail が混在する = **撮影が決定的でない**(揺れる)こと。矛盾した判定を並べると誤解を招くので、**どちらでもない「flaky」**に統一する。
3. **どちらもしない**。退行とも正常とも言えないので、通知を開閉しない。
4. 調べてから作る間に、**別の fail が割り込む**と、両方が「ない」と見て**2 件作る**(競合状態)。ロックで、2 手を一続きにする。
5. GitHub・Webhook・画面など、**通知先を足したり替えたりしても、評価のコードは変わらない**(疎結合)。環境ごとに設定だけで切り替えられる。

## まとめ

- first-bad-commit は、`JOIN` の鎖をたどる**ただの SQL**。ただし「**最初の失敗**」で、「いまの失敗の始まり」ではない。
- **flaky** = 同じ版で pass と fail が混在 = 撮影の揺れの証拠。矛盾を並べず、アラートも動かさない。
- アラートは **fail で 1 回だけ open、pass で close**。**ロック**で、同時に来た fail の重複を防ぐ。
- 通知先は `IAlertSink`(`Protocol`)で差し替え可能。
- 次の回は、撮影の側(決定性の検査)と、**連続したフレームの異常**の検出。
