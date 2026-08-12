# VisualRegressionQATool 設計書
**設計指標: 再現性を最大化した上でのシンプルなピクセル差分による回帰検知**
作成日: 2026-08-11 / 想定規模: 小〜中規模(撮影指示→撮影画像→基準画像→差分画像→評価結果→DBの5段パイプライン+アラート連携)
---

## Phase 0: コンセプト・要件定義
### 目的
CEDEC講演資料に触発された新規ツール構想。自動画像比較によるビジュアル回帰QAツールで、スナップショット同士の差分比較を軸とする。核となる考え方は一つ:「差分が具体的に何を意味するかを明確にする」ために、比較対象の撮影を可能な限り決定的にしてから、評価そのものはシンプルなピクセル毎比較に留める。決定性を犠牲にして賢い評価アルゴリズムで誤魔化さない。

パイプライン全体像(固定): `撮影指示(CaptureInstruction) → 撮影画像(CapturedImage) → 基準画像(ReferenceImage) → 差分画像(DiffImage) → 評価結果(EvaluationResult) → DB`

### 要求機能
- 撮影の完全な決定性制御(フレームレート固定・RNGシード固定・ジッター0・入力共通化)
- ヘッドレス/CI実行可能な撮影バッチ
- ピクセル単位の厳密差分比較とシンプルな合否判定
- CaptureInstruction→CapturedImage→DiffImage→EvaluationResultを1本のチェーンとして追跡可能なDB
- 失敗時のアラート通知、および「いつから壊れたか」の特定(first-bad-commitクエリ)
- 差分ビューアによる目視確認導線

### 非機能要件
- 撮影ステップはヘッドレス/CI実行可能である必要がある(Unityの`-batchmode`系フラグの制約はPhase 2で具体的に検討する)
- BLOBストレージはコンテンツアドレス方式でchecksum dedupeし、「変化なし」フレームを毎回保存しない
- DBはSQLite始動→Postgres移行を前提としたスキーマ設計とする

### 再現性の制約(具体化)
| 制約 | 実現手段 | 実装モジュール |
|---|---|---|
| フレームレート固定 | 固定タイムステップでの捕捉ループ | `capture/DeterminismController` |
| RNGシード0強制 | 単一注入可能RNGサービス経由。グローバルRNG直接呼び出し禁止 | `capture/SeededRandomService` |
| ジッター0 | TAA用カメラジッターの無効化、またはフレーム0固定 | `capture/JitterOverride` |
| 入力固定 | 録画済み入力スクリプトのリプレイ | `capture/InputPlaybackDriver` |

**具体的な統合前例**: 本ワークスペースに実在するUnity6 HDRPプロジェクト`UnityHDRPBlackHole`(`C:\Users\matuu\Desktop\GameDevelopment\UnityHDRPBlackHole`、Unity 6000.0.58f2 / HDRP 17.0.4、現状は`Assets/OutdoorsScene.unity`を持つ素のHDRPシーン)を、`Time.captureFramerate`によるフレームレート固定と、シード可能RNGラッパーの実証フィールドとして想定する。HDRPはTAA・Volumetric Fog等で内部的に乱数・時間依存の描画要素を持つため、決定的撮影の検証には都合が良い。

### 前提・制約
- 対象エンジンはUnity(HDRP想定)。他エンジンへの一般化は今回のスコープ外。
- 「賢い」知覚的差分アルゴリズムは今回導入しない(Phase 3で明記)。
- 撮影対象は静止画スナップショット。動画・時系列比較は将来検討。

### アンチパターン(全フェーズ共通)
- 決定的撮影パイプラインが安定する前にSSIM/知覚的差分などの「賢い」評価に手を出さない。まず再現性、が原則
- グローバルな`UnityEngine.Random`/`System.Random`を撮影対象コードから直接呼ばせない。必ず`SeededRandomService`を経由させる
- 撮影の非決定性を「許容誤差(perPixelTolerance)」で最初から誤魔化さない。まず再現性レイヤーで原因を潰し、閾値運用は最終手段とする
- DBスキーマにNULL可の外部キーを増やしてチェーンを曖昧にしない。CaptureInstruction→CapturedImage→DiffImage→EvaluationResultの一直線を崩さない

**検証チェックリスト:**
- [ ] パイプライン5段(CaptureInstruction/CapturedImage/ReferenceImage/DiffImage/EvaluationResult)の用語・順序がユーザー原案と一致している
- [ ] 再現性4制約(フレームレート/シード/ジッター/入力)それぞれに実現手段が明記されている
- [ ] `UnityHDRPBlackHole`を統合前例として引用する記述がある
- [ ] 「まず再現性、評価は最後に賢くする」という優先順位がPhase 0とアンチパターン両方に明記されている
---

## Phase 1: 再現性制御レイヤー(最優先・全ての前提)
このレイヤーが安定しない限り、以降の全フェーズの差分は「何の差分か」を意味しない。最優先で着手する。

**実装モジュール:**
1. `capture/DeterminismController` — 固定フレームレート捕捉ループ。`Time.captureFramerate = 60`相当の設定で`Update`/物理ステップを実時間から切り離す。レンダリング1フレームごとに実行を止めて次フレームを進める仕組みのため、パーティクル・物理演算を含むシーンでも各フレームの経過時間が完全固定される点を利用する。
2. `capture/SeededRandomService` — テストモードでは`seed=0`を既定値とする単一注入可能RNGサービス。撮影対象のゲームロジックは全てこのサービス経由で乱数を取得し、`UnityEngine.Random.value`等のグローバルAPIを直接叩かない規約とする。
3. `capture/JitterOverride` — HDRP TAAのカメラジッターを撮影中は無効化、またはジッターパターンをフレーム0固定にする。`HDAdditionalCameraData`経由でTAA設定にアクセスする想定。
4. `capture/InputPlaybackDriver` — 録画済み入力スクリプトのリプレイ。Unity Input Systemの`InputEventTrace`相当の記録/再生機構を想定。

**CaptureInstruction スキーマ:**
```csharp
public struct CaptureInstruction
{
    public string InstructionId;      // 一意ID(GUID)
    public string SceneOrLevelId;     // 撮影対象シーン
    public CameraPose CameraPose;     // position/rotation/fov
    public string GameStateSetup;     // 撮影前セットアップ手順の参照ID
    public int FrameRate;             // 固定、既定60
    public int Seed;                  // 既定0
    public float Jitter;              // 既定0
    public string InputScript;        // 録画済み入力スクリプトのパス
    public int WarmupFrames;          // 撮影前に捨てるフレーム数
}
```

`WarmupFrames`は単なる「安全マージン」ではなく、**GI(グローバルイルミネーション)収束待ちのために存在する**。動的GIは反射・間接光が数フレームかけて収束するため、収束前に撮影すると同一シーン・同一設定でも過渡的な明るさの揺らぎが差分として検出されてしまう。動的GIミドルウェアの品質検証は本ツールに依存する設計とするため、GI収束特性の詳細は別文書`DynamicGIMiddleware_DESIGN.md`側で定義し、本ツールはその収束フレーム数を`WarmupFrames`として受け取るだけの立場を取る。

**検証チェックリスト:**
- [ ] 同一`CaptureInstruction`・同一ビルドで2回撮影し、フレーム進行ログ(フレーム番号と経過時間)が完全一致する
- [ ] 撮影対象コードから`SeededRandomService`を経由しない乱数呼び出しが静的解析(grep等)でゼロ件
- [ ] TAAジッター無効化時、連続2フレームのレンダリング結果がパーティクル・物理を含むシーンでも同一になる
- [ ] `InputPlaybackDriver`によるリプレイが記録時と同一フレームで同一入力イベントを発火する
---

## Phase 2: 撮影パイプライン(CapturedImage生成)
**実装モジュール:** `capture/CaptureRunner` — Phase 1の決定性レイヤーを使って実際に画像を書き出すヘッドレスバッチランナー。

**検討事項(早期スパイクとして最優先で潰す課題):**
Unityのヘッドレス実行フラグ`-batchmode -nographics`は、CI環境での定番構成だが**`-nographics`はGPU描画そのものを無効化する**。ビジュアル回帰QAはレンダリング結果そのものを撮影対象とするため、この組み合わせでは撮影が成立しない。実撮影には以下いずれかの代替が必要になり、この検証をPhase 2着手直後の最初のタスクとする:
- `-batchmode`(`-nographics`なし)+ 仮想ディスプレイ — Windows RunnerでGPUドライバがあれば描画可能な場合があるが、CI環境のGPUドライバ有無に依存する
- クラウドGPU CIランナー(GitHub Actions GPU runner等)— コスト増、既存Research-Collectorのcronパターンとは別予算枠が必要
- ローカルTask Scheduler経由の実機撮影 — Research-Collectorの`register_task.ps1`と同型のローカル無人実行だが、CI外運用になるため「PRごとに自動実行」は不可

**CapturedImage スキーマ:**
```json
{
  "capturedImageId": "uuid",
  "instructionId": "uuid (CaptureInstruction参照)",
  "buildVersion": "string (commit hash or build number)",
  "capturedAt": "ISO8601 timestamp",
  "imagePath": "string (BLOBストレージ内パス)",
  "resolution": { "width": 1920, "height": 1080 },
  "colorSpace": "sRGB | Linear",
  "checksum": "string (SHA-256)"
}
```

BLOBストレージはコンテンツアドレス方式(`checksum`をキーにdedupe)とし、`imagePath`は`blobs/{checksum[0:2]}/{checksum}.png`のような階層に正規化する。回帰の無いビルドを繰り返し撮影しても、既存checksumと一致すれば新規BLOBを書き込まず、DB側にレコードだけを追加する。

**検証チェックリスト:**
- [ ] `-batchmode`系フラグの組み合わせで実際にHDRPシーンの描画結果が得られる構成を1つ確定させている(早期スパイクの完了条件)
- [ ] 同一ビルドを2回撮影した際、`checksum`が完全一致する
- [ ] `checksum`重複時にBLOB本体を再書き込みしない(DBレコードのみ追加)ことをストレージ差分で確認
- [ ] `colorSpace`がプロジェクト設定(Linear/HDRP既定)と撮影画像で一致している
---

## Phase 3: 基準画像管理+差分評価(コア機能)
**実装モジュール:**
- `reference/ReferenceStore` — どのcommit/tagが現行の承認済み`ReferenceImage`かを管理する。意図的な見た目変更(新エフェクト追加等)があった場合、人間またはCIの承認操作を経て新しい`CapturedImage`を`ReferenceImage`へ昇格するワークフローを持つ。
- `diff/PixelDiffEngine` — 厳密なピクセル毎比較。

**採用しない技術(明記):** SSIM・perceptualdiff・ImageMagick `compare`のような知覚的/構造的類似度による評価は、今回は**将来検討事項として採用しない**。ユーザー方針「評価はシンプルに」に合わせ、まず厳密ピクセル差分のみで運用し、閾値運用の実績を積んでから知覚的差分の要否を再検討する。

**PixelDiffEngine のパラメータ:**
```python
def compare(captured_path: str, reference_path: str,
            per_pixel_tolerance: int = 0,   # 0-255のRGBチャンネル差の許容幅
            max_diff_pixels: int = 0        # 許容する差分ピクセル総数
            ) -> DiffResult:
    """厳密ピクセル比較。SSIM等の知覚的評価は行わない"""
```

**DiffImage / EvaluationResult スキーマ:**
```json
{
  "diffImage": {
    "diffImageId": "uuid",
    "capturedImageId": "uuid",
    "referenceImageId": "uuid",
    "diffImagePath": "string (ハイライト画像のBLOBパス)",
    "diffPixelCount": 0,
    "diffPercentage": 0.0
  },
  "evaluationResult": {
    "evaluationResultId": "uuid",
    "diffImageId": "uuid",
    "verdict": "pass | fail | flaky",
    "evaluatedAt": "ISO8601 timestamp"
  }
}
```

**検証チェックリスト:**
- [ ] 同一画像同士の比較で`diffPixelCount=0`・`verdict=pass`
- [ ] 意図的に改変した矩形領域のみが`diffImage`で正しくハイライトされる(領域外の誤検出ゼロ)
- [ ] `per_pixel_tolerance=0`かつ`max_diff_pixels=0`の厳格設定でPhase 1の決定性が壊れていれば`fail`になる(=再現性の回帰も検知できることの確認)
- [ ] `ReferenceStore`の昇格ワークフローで、承認前の`CapturedImage`が誤って`ReferenceImage`として参照されない
---

## Phase 4: DB永続化+履歴
**実装内容:** CaptureInstruction→CapturedImage→DiffImage→EvaluationResultを1本の追跡可能チェーンとするスキーマを構築する。この「追記専用で履歴を積み上げ、後から遡ってクエリする」設計思想は、別文書`AssetDataInsightSuite_DESIGN.md`が持つ予定の追記専用実行履歴パターンと同系であり、両ツールでスキーマ設計の考え方を揃える。

**スキーマ概略:**
```sql
CREATE TABLE capture_instruction (
    instruction_id TEXT PRIMARY KEY, scene_or_level_id TEXT NOT NULL,
    camera_pose_json TEXT NOT NULL, frame_rate INTEGER NOT NULL,
    seed INTEGER NOT NULL, jitter REAL NOT NULL, warmup_frames INTEGER NOT NULL
);
CREATE TABLE captured_image (
    captured_image_id TEXT PRIMARY KEY,
    instruction_id TEXT NOT NULL REFERENCES capture_instruction(instruction_id),
    build_version TEXT NOT NULL, captured_at TEXT NOT NULL,
    checksum TEXT NOT NULL, image_path TEXT NOT NULL
);
CREATE TABLE diff_image (
    diff_image_id TEXT PRIMARY KEY,
    captured_image_id TEXT NOT NULL REFERENCES captured_image(captured_image_id),
    reference_image_id TEXT NOT NULL,
    diff_pixel_count INTEGER NOT NULL, diff_percentage REAL NOT NULL
);
CREATE TABLE evaluation_result (
    evaluation_result_id TEXT PRIMARY KEY,
    diff_image_id TEXT NOT NULL REFERENCES diff_image(diff_image_id),
    verdict TEXT NOT NULL CHECK (verdict IN ('pass','fail','flaky')),
    evaluated_at TEXT NOT NULL
);
```

SQLiteで開始し、実行数がスケールした段階でPostgresへ移行するパス(スキーマはそのまま、SQLite→Postgresのdumpベース移行)を前提とする。

**「いつから壊れたか」クエリ:**
```sql
-- 同一instructionIdについて、build_versionのcommit順で
-- 最初にverdict='fail'となったevaluation_resultを特定する
SELECT ci.instruction_id, ei.build_version, er.evaluated_at
FROM evaluation_result er
JOIN diff_image di ON er.diff_image_id = di.diff_image_id
JOIN captured_image ei ON di.captured_image_id = ei.captured_image_id
JOIN capture_instruction ci ON ei.instruction_id = ci.instruction_id
WHERE er.verdict = 'fail'
ORDER BY ei.captured_at ASC
LIMIT 1;
```

これがitem10の「根本原因特定」の実装にあたる。ただし中身はAI推論ではなく**単純なfirst-bad-commitクエリ**であることを明記し、期待値を過大にしない。原因の特定は「どのcommitで壊れたか」までであり、「なぜ壊れたか」は差分ビューア(Phase 5)を見た人間の仕事として残す。

**検証チェックリスト:**
- [ ] 既知の回帰点(意図的にNフレーム目のcommitから見た目を壊した合成履歴)を用意し、first-bad-commitクエリが正しくそのcommitを返す
- [ ] 4テーブルの外部キー参照が全てNOT NULLで、チェーンが途切れない
- [ ] SQLiteで作成したDBをPostgresへdumpベースで移行し、同一クエリが同一結果を返す
- [ ] 同一instructionIdに対する複数build_versionの履歴が時系列で正しく並ぶ
---

## Phase 5: アラート+結果ビューア(運用)
**実装内容:** 失敗run発生時のアラートsinkは、`Research-Collector`(`C:\Users\matuu\Desktop\GameDevelopment\Research-Collector\IMPROVEMENT_PLAN.md` L19, L69-79)で既に実装・実運用されている「GitHub Actions cronの失敗時にラベル付きIssueを自動作成し、復旧時に自動クローズする」パターンを直接引用する。具体的には:

- `evaluation_result.verdict='fail'`のrunが発生した際、`visual-regression-fail`ラベルでIssueを自動作成(Research-Collectorの`auth-expired`ラベル運用と同型)
- 同一instructionIdについて再撮影して`verdict='pass'`に戻った時点で、対応するopen Issueを自動クローズ(Research-Collectorの`refresh_auth.ps1` L45-53の自動クローズ処理と同型)
- 重複Issue防止も同様に、既存open Issueをラベル検索してから新規作成するガードを踏襲する

アラートsinkはGitHub PR check/webhookで設定切り替え可能な設計とし、将来的には`ProfilingTool_DESIGN.md`や`ToolOrchestrationHub_DESIGN.md`側の通知基盤へコード変更なしに差し替えられるよう、sinkインターフェースを抽象化しておく:
```csharp
public interface IAlertSink
{
    void NotifyFailure(EvaluationResult result, DiffImage diff);
    void NotifyRecovery(string instructionId);
}
// 実装例: GitHubIssueAlertSink, WebhookAlertSink, NoopAlertSink(将来のTool Orchestration Hub連携用)
```

**差分ビューア:** サイドバイサイド表示+オーバーレイ表示の2モード。Phase 4の「最初の悪いcommit」クエリ結果をビューア上にインライン表示し、人間が「なぜ壊れたか」を判断する起点にする。

**検証チェックリスト:**
- [ ] `verdict='fail'`発生時にラベル付きIssueが自動作成される
- [ ] 同一instructionIdの再撮影で`verdict='pass'`に戻った際、対応Issueが自動クローズされる
- [ ] 同一失敗runで重複Issueが作成されない
- [ ] `IAlertSink`の実装をコード変更なし(設定切り替えのみ)で差し替えられる
- [ ] 差分ビューアがサイドバイサイド/オーバーレイ両モードで同じDiffImageを正しく表示する
- [ ] ビューア上のfirst-bad-commit表示がPhase 4のクエリ結果と一致する
---

## Final Phase: 統合検証
以下が全て満たされたら本ツールの一次リリース可能とみなす:

- [ ] 同一ビルドで同一CaptureInstructionを2回撮影し、バイト同一のPNGが生成される
- [ ] パーティクル・物理を含むシーンでも上記の再現性が成立する(Phase 1のフレーム固定が非決定的要素を吸収できている)
- [ ] checksum dedupeにより、未変更ビルドの再実行で重複BLOBが作られない
- [ ] 同一画像同士の比較で`diffPixelCount=0`、意図的な改変ピクセル領域のみが正しくハイライトされる
- [ ] 既知の回帰点を持つ合成履歴に対し、first-bad-commitクエリが正しいcommitを返す
- [ ] 失敗runでアラートが発報され、`IAlertSink`の実装をコード変更なしで切り替えられる

**相互参照:**
- `AssetDataInsightSuite_DESIGN.md` — DB設計(Phase 4)の追記専用履歴パターンが同系
- `Research-Collector\IMPROVEMENT_PLAN.md`(実在・実装済み) — アラートsink(Phase 5)の障害通知Issueパターンの直接前例
- `DynamicGIMiddleware_DESIGN.md` — 品質検証は本ツールに依存する設計とし、`WarmupFrames`(Phase 1)がその接続点
- `VLMAutoReplayTool_DESIGN.md` — HID注入層は将来`InputPlaybackDriver`(Phase 1)のバックエンド候補
- `ProfilingTool_DESIGN.md` / `ToolOrchestrationHub_DESIGN.md` — アラートsink(Phase 5)の後継差し替え先候補

**優先度注記:** 本ツールは手堅い。pixel diff・DB・CIアラートはいずれも実績のある技術であり、新規性のリスクは低い。唯一の技術リスクは対象エンジン(Unity HDRP)での真の決定性確保——フレーム・シード・ジッターの完全一致——であり、特にヘッドレスGPU描画モード(Phase 2の`-batchmode`/`-nographics`検討)は早期スパイクで潰すべき課題として明記する。それ以外のフェーズは具体的にコミットしてよい規模感である。
