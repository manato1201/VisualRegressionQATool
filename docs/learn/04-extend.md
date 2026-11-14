# 4. 拡張のレシピ

どれも「**データ(設定)→ 関数 → テスト**」の順で、小さく進めます。**既定の挙動を変えない**(新しい引数は、既定で「今と同じ」)のが原則です。

## レシピ 1: 比較に、新しいつまみ(引数)を足す

例: 講義[第 5 回](../lecture/05-testing-capstone.md)の「除外領域」。

1. **`diff_engine.py`**: `compare`・`compare_bytes`・`_compare_images` に引数を足す(**既定は、今の挙動**)。差分マスクを作る**前**(入力)か、**後**(マスク)のどちらで効くかを決める。
2. **`models.py`**: リクエストの型(`DiffRunRequest` など)に、**任意の項目**として足す。
3. **`routers/diffs.py`**: `_execute_diff_run`・`_compare`・一括実行・プレビューに、引数を**通す**(4 か所とも)。プレビューと本番で**同じ引数**を使うこと(「プレビューでは通ったのに」を防ぐ)。
4. **DB に残すなら**(後で「そのときの条件」を読みたいなら): `diff_image` に列を足し、`db.py` の `_COLUMN_MIGRATIONS` にも `ALTER TABLE` を足す(**`NULL` 可か `DEFAULT` つき**)。`create_diff_image`・`queries.py` の `RUNS_SQL` と `models.RunRow` も。
5. **フロント**: `types.ts`・`api.ts`・`DiffSettings.tsx`(「差分の詳細設定」)。
6. **テスト**: 既定で今と同じ結果・つまみを動かしたときの変化・不正な値(422 か 400)。**評価**: つまみが、見逃しを増やしていないか。

**判断の目安**: 知覚的な類似度(SSIM など)を足さない(設計の軸)。足すなら「**明示の線**」(ここまでは同じとみなす)として、何を吸収するかを、1 文で言えるものだけ。

## レシピ 2: 通知先を足す(Teams・Discord・メールなど)

1. `alert_sink.py` に、`IAlertSink`(`notify_failure`・`notify_recovery`)を満たすクラスを足す。

   ```python
   class DiscordAlertSink:
       def __init__(self, url: str, client: httpx.Client | None = None) -> None: ...
       def notify_failure(self, ctx: AlertFailureContext) -> str | None:
           ...   # 送って、あとで復旧を知らせるための参照(メッセージ ID など)を返す
       def notify_recovery(self, instruction_id: str, external_ref: str) -> None: ...
   ```

2. `_build_single_sink(kind)` に、`VRQA_ALERT_SINK=discord` の分岐を足す(URL などは**環境変数**)。`composite` でも使えるように、同じ関数に入れる。
3. **`notify_failure` が返す `external_ref`** を、DB の `alert_issue` に記録する(呼び出し側がやる)。**`None` を返すと記録されず、復旧の通知もできない**(`NoopAlertSink` の挙動)。
4. **失敗の隔離**: 通知の失敗が、**判定の保存を巻き込まない**ように、例外の扱いを決める(Webhook は `raise_for_status` で例外を出す。呼び出し側での扱いを確かめる)。
5. **テスト**: `httpx.MockTransport` で、送る内容・復旧・重複(`already-open`)を確かめる(`test_alert_sink.py` の形)。

> **秘密**(Webhook の URL・トークン)は環境変数で渡し、リポジトリに書かない。

## レシピ 3: 新しいエンジンから撮影する(Unity・Blender・ブラウザなど)

[CAPTURE_AGENT_DESIGN.md](../CAPTURE_AGENT_DESIGN.md) の契約に従います。**サーバーは変えません**。

1. `capture_agents/capture_agents/<engine>_agent.py` に、`CaptureAgent` のサブクラスを作る。`engine` を宣言し、`prepare`(固定する)と `capture`(撮って PNG のバイト列を返す)を実装する。
2. `models.py` の `EngineName` に、エンジン名を足す。
3. **決定性の条件**(`seed`・`fixed_time_seconds`・`reduce_motion`)は、`apply_instruction_conditions` が `source.extra` に入れる。それを読んで、エンジンに反映する(時計・乱数・動き)。ブラウザなら、`FREEZE_ANIMATIONS_CSS` を差し込む。
4. **`check_determinism(agent, source, runs=10)` で検収**する(10 回撮って、すべて同じか)。通るまで、評価に進まない。
5. `BackendClient` で、アップロード → 差分実行。認証が必須なら、`VRQA_API_KEY`(`X-API-Key`)。
6. **テスト**: 偽の `hou`(またはエンジン)を差し込み、`prepare`→`capture` の順序・条件の反映・検収を確かめる(`test_houdini_agent.py`・`test_determinism.py` の形)。

## レシピ 4: API を足す(役割を必ず宣言する)

| 操作の種類 | 役割 |
|---|---|
| 見るだけ | 指定なし(`required` では viewer 以上が自動で必要。下の注意) |
| 作る・実行する(撮影・指示・差分) | `auth.operator` |
| 基準を変える・消す・設定を変える | `auth.admin` |
| デバッグ用(本番では既定で無効) | `auth.debug`(`VRQA_DEBUG` + admin) |

`@router.post("...", dependencies=[auth.operator])` のように宣言する。**テスト**: 役割ごとの 200 / 401 / 403(`test_auth.py` の形)。`VRQA_AUTH=required` では**認証なしの 3 つ以外が、viewer 以上を要求**する。

## レシピ 5: 画面に表示を足す

1. バックエンドの `models.py` に項目を足す → `frontend/src/types.ts` を**手で**合わせる(自動生成ではない)。
2. 役割で出し分ける操作は、`role.ts` の関数を使い、**無効にして、必要な権限を表示**する(表示だけ。判断はサーバー)。
3. 昇格・削除のような **admin の操作**は、差分ビューアに入れず、`src/admin/` に足す(`test_admin_split_frontend.py` が、混ざっていないか確認する)。
4. **判定は色だけに頼らず、文字**(✓ 合格 / ✕ 不合格 / — 未検査)を添える。**差分のピクセルは、固定のマゼンタ**(バックエンドの `HIGHLIGHT_COLOR` と同期)。

## 変更の前に

- **評価をシンプルに保つ**: 「賢い」比較を足したくなったら、**撮影側で揺れを潰せないか**を先に考える(設計の軸)。
- 通知を**増やす**変更は、**重複しない**こと(open は 1 回だけ)を、テストで確かめる。
- 変更したら `cd backend && uv run pytest -q` と `python tools/check_docs.py`([5 テスト](05-testing.md))を通す。
