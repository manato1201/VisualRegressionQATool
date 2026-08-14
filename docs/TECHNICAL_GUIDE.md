# 技術解説書

図表は [ARCHITECTURE.md](ARCHITECTURE.md)、セットアップは [README.md](../README.md) を参照。本書はモジュール単位の実装意図・アルゴリズム・API仕様・テスト戦略をまとめる。

## 1. 設計方針の要約

[`VisualRegressionQATool_DESIGN.md`](../VisualRegressionQATool_DESIGN.md) の核心は一つ:「差分が具体的に何を意味するかを明確にする」ために、

1. まず**撮影(比較対象の入力)を決定的にする**
2. 評価自体は**シンプルなピクセル毎比較に留め**、SSIM等の「賢い」知覚的アルゴリズムには最初から頼らない

という優先順位を崩さないこと。本リポジトリはこの後半(評価・DB・アラート・ビューア)を担当する。

## 2. Phase対応表

| Phase | 設計書の内容 | 本リポジトリでの実装 |
|---|---|---|
| Phase 0 | コンセプト・要件定義 | — (設計書のみ) |
| Phase 1 | 再現性制御レイヤー(Unity C#) | 未実装。`UnityHDRPBlackHole`側で扱う想定 |
| Phase 2 | 撮影パイプライン(Unity C#) | 未実装。同上 |
| Phase 3 | 基準画像管理+差分評価 | `diff_engine.py`(PixelDiffEngine) / `repository.py`の`promote_reference_image`系(ReferenceStore) |
| Phase 4 | DB永続化+履歴 | `db.py`(スキーマ) / `queries.py`(first-bad-commit) |
| Phase 5 | アラート+結果ビューア | `alert_sink.py`(IAlertSink) / `frontend/`(DiffViewer等) |

## 3. バックエンドモジュール解説

### 3.1 `db.py` — スキーマ

Phase 4のSQL(`capture_instruction` / `captured_image` / `diff_image` / `evaluation_result`)をほぼそのまま採用しつつ、2テーブルを追加している。

- **`reference_image`**: 設計書のPhase 4 SQL断片には無いが、Phase 3の「ReferenceStoreが承認済みReferenceImageを管理する」という要求を満たすために必須。追加しなかった場合、`diff_image.reference_image_id`が「承認されていないCapturedImage」を指してしまう可能性があり、Phase 0のアンチパターン(「DBスキーマにNULL可の外部キーを増やしてチェーンを曖昧にしない」)に抵触する。`is_active`フラグでinstructionごとに常に1件だけをアクティブなReferenceとする。
- **`alert_issue`**: Phase 5のアラート重複防止・自動クローズを実装するには「このinstructionに対して現在openなアラートがあるか」をDBで追跡する必要があるため追加。

全ての外部キーは`NOT NULL`(SQLite `PRAGMA foreign_keys = ON`で強制)。

### 3.2 `storage.py` — コンテンツアドレスBLOBストレージ

Phase 2の要求「`checksum`をキーにdedupeし、`imagePath`は`blobs/{checksum[0:2]}/{checksum}.png`に正規化」をそのまま実装。

- `BlobStore.put(data)` はSHA-256を計算し、同一checksumのファイルが既に存在すれば書き込みをスキップして`written=False`を返す。API層(`captures.py`)はこれを`dedup_hit`としてレスポンスに含める。
- `BlobStore.delete(path)` は撮影画像削除機能(§3.3)のために追加。他の`captured_image`行が同じchecksumを参照していないことを確認してから物理削除する(`repository.delete_captured_image`側でカウントしてから呼ぶ)。

### 3.3 `repository.py` — CRUD + 履歴保護

チェーンの整合性を壊す操作を防ぐガードが中心。

- `promote_reference_image`: 新規昇格時に同一instructionの既存アクティブReferenceを`is_active=0`にしてから新規行を挿入。「1 instruction = 常に1つのアクティブReference」を保証する。
- `delete_captured_image`: 撮影画像の削除機能。**「Referenceに昇格済み」または「差分評価履歴(`diff_image`)に含まれる」画像は削除できない**(`CapturedImageInUseError`)。これはPhase 0のアンチパターン「チェーンを曖昧にしない」を削除機能にも適用した結果で、テスト・アップロードミスのクリーンアップと、監査可能な履歴の保持を両立させている。削除後は該当checksumを参照する行が0件になった場合のみBLOB本体も削除する。

### 3.4 `diff_engine.py` — PixelDiffEngine

Phase 3のシグネチャ(`per_pixel_tolerance` / `max_diff_pixels`)に加え、実運用で見つかった課題に対応する`min_diff_region_pixels`を追加している(詳細は§6)。

```python
def compare_bytes(
    self,
    captured_bytes: bytes,
    reference_bytes: bytes,
    per_pixel_tolerance: int = 0,
    max_diff_pixels: int = 0,
    min_diff_region_pixels: int = 1,
) -> DiffResult: ...
```

処理の流れ:

1. 解像度が一致しない場合は`ImageDimensionMismatchError`を送出する(§6で述べる通り、これは`per_pixel_tolerance`で誤魔化してよい種類の問題ではない)。
2. `captured`・`reference`のRGB各チャンネルの絶対差を計算し、`per_pixel_tolerance`を超える画素を`diff_mask`としてマークする。
3. `min_diff_region_pixels > 1`の場合、`scipy.ndimage.label`で8連結の連結成分ラベリングを行い、画素数が閾値未満の塊を`diff_mask`から除去する。**これはSSIMのような類似度スコアではなく、あくまで「厳密な画素差分マスクに対する幾何的な後処理」**であり、Phase 3の「知覚的差分は採用しない」という方針とは矛盾しない。
4. `diff_pixel_count <= max_diff_pixels`ならverdict `pass`、そうでなければ`fail`。
5. ハイライト画像は、撮影画像を暗く(35%輝度)した背景の上に、diff画素だけを赤(`255,0,0`)で重ねて生成する。

### 3.5 `queries.py` — 履歴クエリ

`first_bad_commit`は設計書のSQLをほぼそのまま実装した、単純な`ORDER BY captured_at ASC LIMIT 1`クエリである。**AI推論ではなく単純なSQL**であることは設計書の意図通りで、「なぜ壊れたか」の判断は人間がDiff Viewerを見て行う。

### 3.6 `alert_sink.py` — IAlertSink抽象化

```python
class IAlertSink(Protocol):
    def notify_failure(self, ctx: AlertFailureContext) -> str | None: ...
    def notify_recovery(self, instruction_id: str, external_ref: str) -> None: ...
```

3つの実装:

| 実装 | 用途 |
|---|---|
| `NoopAlertSink` | 既定値。将来のTool Orchestration Hub連携までのプレースホルダ |
| `WebhookAlertSink` | 任意のURLへJSON POST |
| `GitHubIssueAlertSink` | `visual-regression-fail`ラベルでIssue自動作成・自動クローズ |

`GitHubIssueAlertSink`の重複防止は、Issue本文に埋め込んだ`<!-- vrqa-instruction-id: {id} -->`マーカーを、Issue作成前にラベル検索(`GET /issues?labels=...&state=open`)して照合する方式(Research-Collectorの`auth-expired`ラベル運用と同型)。DB側の`alert_issue`テーブルによる高速な重複チェックと、GitHub側のラベル検索による二重のガードになっている。

実装切替は環境変数`VRQA_ALERT_SINK`のみで行い(`build_alert_sink_from_env`)、コード変更は不要。

### 3.7 `routers/diffs.py` — 単発/バッチ実行の共通化

単発差分実行(`POST /api/diffs/run`)とバッチ差分実行(`POST /api/diffs/run-batch`)は、`_execute_diff_run()`という共通関数を使う。差分は例外処理のみ:

- 単発実行: `_DiffRunError`を`HTTPException`に変換してそのまま送出する。
- バッチ実行: `_DiffRunError`を捕捉し、その1件だけを`{ok: false, error: ...}`として結果配列に積み、ループを継続する。

これにより「多数の撮影画像を一度に評価したいが、1件の解像度不一致等で全体が失敗してほしくない」という運用要求(§7)を満たしている。

## 4. API仕様

| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/instructions` | CaptureInstruction作成 |
| GET | `/api/instructions` | 一覧 |
| GET | `/api/instructions/{id}` | 取得 |
| POST | `/api/captures` | 撮影画像アップロード(multipart) |
| GET | `/api/captures?instruction_id=` | 一覧 |
| GET | `/api/captures/{id}` | 取得 |
| GET | `/api/captures/{id}/image` | 画像バイナリ取得 |
| DELETE | `/api/captures/{id}` | 削除(履歴保護あり、§3.3) |
| POST | `/api/references/promote` | CapturedImage→ReferenceImage昇格 |
| GET | `/api/references/active/{instruction_id}` | アクティブReference取得 |
| GET | `/api/references/{id}` | Reference取得 |
| POST | `/api/diffs/run` | 単発差分実行+評価+アラート |
| POST | `/api/diffs/run-batch` | 一括差分実行(§3.7) |
| GET | `/api/diffs/{id}` | DiffImageレコード取得 |
| GET | `/api/diffs/{id}/image` | 差分ハイライト画像取得 |
| GET | `/api/runs?instruction_id=` | 実行履歴一覧(JOIN済みビュー) |
| GET | `/api/runs/first-bad-commit/{instruction_id}` | first-bad-commitクエリ |

## 5. フロントエンド構成

- `App.tsx`: 全画面状態(選択中instruction・撮影画像一覧・実行履歴・diff設定・banner等)を集中管理する唯一のstateホルダー。子コンポーネントはpropsで受け取ったcallbackを呼ぶだけの設計。
- `DiffSettings.tsx`: `per_pixel_tolerance` / `max_diff_pixels` / `min_diff_region_pixels`を調整するUI。既定値は設計書通り全て0(または1)で、変更しない限り従来の厳密比較のまま動く。
- `DiffViewer.tsx`: サイドバイサイド(Captured/Reference/Diff Highlightを横並び)とオーバーレイ(Referenceの上にDiff Highlightを可変不透明度で重ねる)の2モード。`reference_image_id`から実際の画像URLを解決するため、`GET /api/references/{id}`を都度呼び出す。
- `CapturePanel.tsx`: アップロードフォーム・DiffSettings・**複数選択チェックボックス+一括実行ボタン**・各カードの昇格/差分実行/削除ボタンをまとめたメインパネル。
- `GettingStarted.tsx`: 初回ユーザー向けの使い方ガイド。撮影指示が0件のときは自動的にこのタブが表示される。
- `theme.css`: `VisualRegressionQATool_UI_DESIGN.md`のZapier風デザイントークン(色・タイポグラフィ・角丸12px・スペーシング)をCSS変数として定義。

## 6. なぜ`per_pixel_tolerance=0`のままでは実運用に耐えないケースがあるか

PixelDiffEngineは「同一パイプラインからの決定的な出力同士」の比較を前提にしている(Unityの固定フレームレート撮影など)。一方、**独立して再エンコードされた画像同士**(JPEG再圧縮、異なるツールでの保存など)を比較すると、見た目が同一でも量子化ノイズによりほぼ全画素が微小に(数レベル程度)ズレる。この場合、`per_pixel_tolerance=0`では画面のほぼ全域がdiff扱いになる。

これはPixelDiffEngineのバグではなく、「決定性を犠牲にして賢い評価アルゴリズムで誤魔化さない」という設計方針上の当然の帰結だが、実運用(このツールを使ってPNG/JPEG画像を手元でテストする場合)ではUIから調整できる必要があったため、フロントエンドに「差分の詳細設定」パネルを追加した:

- **許容誤差(`per_pixel_tolerance`)を上げる** — チャンネルごとの微小なズレを許容する。
- **最小差分領域サイズ(`min_diff_region_pixels`)を上げる** — 散らばった孤立ノイズ画素を無視し、まとまった本物の変化(「間違い探し」の正解箇所のような局所的な塊)だけを検出する。

実測: 97.46%(114,319画素)の誤検出が出ていたJPEG画像ペアに対し、`min_diff_region_pixels`を適用したテストケースでは、ノイズ由来の孤立diffがすべて除去され、意図的に作った矩形リグレッション(150画素)のみが残ることを確認している(`backend/tests/test_diff_engine.py::test_min_diff_region_pixels_drops_scattered_noise_but_keeps_real_regression`)。

Unity側の決定的レンダリング出力(Phase 1-2、可逆圧縮PNG)を主軸にする限りこの調整はほぼ不要になる想定。

## 7. 一括差分実行を追加した理由

当初は撮影画像1枚ごとに「差分実行」ボタンを押す設計だった。撮影画像の件数が多い(CIで大量のbuild versionを一度に評価したい)状況では非効率かつ、UI操作が線形にスケールしない問題があった。`POST /api/diffs/run-batch`は複数の`captured_image_id`をまとめて受け取り、内部では単発実行と同じロジック(`_execute_diff_run`)をループで呼び出す。1件が解像度不一致などで失敗しても、その1件だけを`{ok: false, error}`として記録し、残りの処理は続行する(§3.7)。

## 8. テスト戦略

`backend/tests/`配下、pytest 37件。

| ファイル | 検証内容 |
|---|---|
| `test_diff_engine.py` | 同一画像=diff0、矩形改変の正確なハイライト、厳格設定での単画素検知、tolerance吸収、連結成分ノイズフィルタ、解像度不一致時の例外 |
| `test_storage.py` | checksum dedupe(同一内容は1回だけ書き込み)、別内容は別パス |
| `test_repository.py` | チェーンのround-trip、未承認CapturedImageがReferenceとして参照されないこと、外部キー制約、verdict CHECK制約 |
| `test_queries.py` | first-bad-commitが正しいbuild_versionを返すこと、履歴の時系列順序 |
| `test_alert_sink.py` | GitHub Issue作成/重複防止/復旧クローズ、Webhook送信、Noop、インターフェース互換性 |
| `test_delete_captured_image.py` | 未参照画像の削除+blob解放、共有checksumでのblob温存、Reference/diff履歴がある画像の削除拒否 |
| `test_api_integration.py` | FastAPI TestClientによるE2E(アップロード→昇格→pass→regression→fail→first-bad-commit)、削除API |
| `test_diff_batch.py` | バッチ実行の全件成功、1件失敗時の他アイテムへの非影響、空リスト、存在しないID |

## 9. 既知の制限・今後の課題

- `verdict = 'flaky'`はDBスキーマ上サポートされているが、単発の決定的比較からは自動生成されない(複数回実行して結果が安定しないことを検知する仕組みは未実装)。
- SQLite→Postgres移行(設計書の想定)は未実施。スキーマはSQL標準に近い形で書いているため大きな障害はない想定。
- Unity側Phase 1-2(`DeterminismController` / `SeededRandomService` / `JitterOverride` / `InputPlaybackDriver` / `CaptureRunner`)は本リポジトリの対象外。
- `GitHubIssueAlertSink`はGitHub REST APIをそのまま呼び出す実装で、レート制限・リトライは未考慮。
