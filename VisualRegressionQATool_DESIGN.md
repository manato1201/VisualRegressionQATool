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

---

## Phase 6: 差分ビューアUI強化(2026-09-09追記)

**背景**: X上の@ozwxy氏の実演(GPT-6 Astraによる高品質UIコンポーネント生成デモ)を受け、ユーザーがUI/アニメーション面の強化を明示的に要望。既存Phase5の差分ビューアを、以下5種のコンポーネントで強化する。新規データモデルは追加せず、Phase3の`DiffImage`/`EvaluationResult`、Phase4の履歴チェーン、Phase5の差分ビューアをそのまま参照データとして利用する。

### 1. フォーカスリング(Focus Ring)
差分ビューア上で`diffPixelCount`が集中する領域にホバー/選択した際、リング状ハイライトで囲む。対象座標は`diffImage.diffImagePath`の画像をクライアント側で画素クラスタ集計して求め、新規APIは追加しない。
```css
.diff-focus-ring {
  outline: 3px solid var(--diff-accent, #ff5252);
  outline-offset: 2px;
  border-radius: 6px;
  animation: focus-ring-pulse 1.2s ease-in-out infinite;
}
@keyframes focus-ring-pulse {
  0%, 100% { outline-color: rgba(255,82,82,0.9); }
  50% { outline-color: rgba(255,82,82,0.4); }
}
```

### 2. ドットチャート(Dot Chart)
Phase4の履歴チェーンを時系列ドットチャート化する。1コミット(`captured_image.build_version`)=1ドット、色は`evaluation_result.verdict`(pass=緑/fail=赤/flaky=黄)。Phase4のfirst-bad-commitクエリの結果行はチャート上でリング付きドットとして強調し、劣化開始点を一目で把握できるようにする。
```ts
type DotDatum = { buildVersion: string; evaluatedAt: string; verdict: 'pass'|'fail'|'flaky'; isFirstBad: boolean };
// evaluation_result を evaluated_at ASC でクエリした結果をそのままマッピングする
const dots: DotDatum[] = results.map(r => ({
  buildVersion: r.build_version, evaluatedAt: r.evaluated_at,
  verdict: r.verdict, isFirstBad: r.evaluation_result_id === firstBadCommitResultId,
}));
```

### 3. スプリットフラップ(Split-flap)
`diffPixelCount`/`diffPercentage`が新しい`EvaluationResult`到着で更新される際、旧値→新値へフリップ演出する。`rotateX`によるカード反転を桁単位で適用する古典的split-flap実装を用いる。
```css
.flap-digit { perspective: 200px; }
.flap-digit .card {
  transform-style: preserve-3d;
  transition: transform 0.35s ease-in;
}
.flap-digit.flipping .card { transform: rotateX(-180deg); }
```

### 4. スタックトースト(Stack Toast)
Phase5の`IAlertSink`をWeb UI側でも実装し(`WebUiToastAlertSink`)、`NotifyFailure`/`NotifyRecovery`を積み重なるトースト通知として表示する。既存インターフェースは無改変で、実装を1つ追加するのみ。
```csharp
public class WebUiToastAlertSink : IAlertSink
{
    public void NotifyFailure(EvaluationResult result, DiffImage diff)
        => ToastQueue.Push(new Toast(Severity.Error, $"{diff.DiffImageId} verdict=fail ({diff.DiffPixelCount}px)"));
    public void NotifyRecovery(string instructionId)
        => ToastQueue.Push(new Toast(Severity.Success, $"{instructionId} recovered"));
}
```

### 5. セグメントレール(Segment Rail)
Phase5の差分ビューアの表示モード切替を横並びセグメントコントロールに置き換える。既存の「サイドバイサイド/オーバーレイ」2モードに、本フェーズの「ドットチャート履歴」を第3モードとして並置する。
```html
<div class="segment-rail" role="tablist" aria-label="diff view mode">
  <button role="tab" aria-selected="true" data-mode="side-by-side">サイドバイサイド</button>
  <button role="tab" aria-selected="false" data-mode="overlay">オーバーレイ</button>
  <button role="tab" aria-selected="false" data-mode="dot-history">ドットチャート履歴</button>
</div>
```

**検証チェックリスト:**
- [ ] フォーカスリングが`diffPixelCount`集中領域のホバー/選択時のみ表示され、他領域では非表示のままである
- [ ] ドットチャート上でfirst-bad-commitクエリの結果行が他のドットと視覚的に区別できる(リング等)
- [ ] `diffPixelCount`/`diffPercentage`の値更新時にsplit-flapアニメーションが旧値→新値へ正しく遷移する
- [ ] `WebUiToastAlertSink`が`IAlertSink`を実装し、既存の`GitHubIssueAlertSink`等と設定切り替えのみで共存できる
- [ ] セグメントレールの3モード切替が、それぞれ対応するビューア表示(サイドバイサイド/オーバーレイ/ドットチャート履歴)に正しく切り替わる
- [ ] 本フェーズで新規テーブル・新規スキーマフィールドが追加されていない(Phase3/4の既存スキーマのみを参照している)

---

## Phase 7: アニメーションの決定性と結果表示の規約(2026-10追記)

出典: [IMPROVEMENT_PLAN_2026-10.md](IMPROVEMENT_PLAN_2026-10.md)(Q1・Q2・Q6、U1〜U5)/ [IMPROVEMENT_DESIGN_2026-10.md](IMPROVEMENT_DESIGN_2026-10.md)。**設計の核(撮影を決定的にしてから、評価はピクセル毎の比較に留める)は変えない。** 判定アルゴリズムには一切手を入れず、撮影側の決定性と、結果を誤読させない表示だけを足す。

### 7.1 アニメーションの決定性(Q1)
アニメーションする画面は、時刻と動きを固定しないと同じ画面でも撮影のたびに差分が出る。撮影指示(`capture_instruction`)に2項目を持たせ、撮影エージェントがそれに従う。

| 項目 | 意味 | 既定 |
|---|---|---|
| `fixed_time_seconds` | アニメーションの時計をこの秒数に固定して撮る。`NULL`は固定しない | `NULL` |
| `reduce_motion` | 対象UIに`prefers-reduced-motion: reduce`を効かせる(カメラシェイク・粒子・ループTweenを止める) | `true` |

- 乱数(粒子・ノイズ)は既存の`seed`で固定する(Phase 1の方針どおり)。
- Python側: `capture_agents.determinism.apply_instruction_conditions`が指示の値を`CaptureSource.extra`へ写し、`HoudiniCaptureAgent.prepare`が`fixed_time_seconds`を`hou.setTime`で適用する(`frame`との同時指定は曖昧なので拒否)。ブラウザ撮影用に`FREEZE_ANIMATIONS_CSS`(animation/transitionの除去)も提供する。Unity側は`Prepare()`のコメントに適用方針を記載(プロジェクト依存のため実装は各自)。
- 決定性の検収は`capture_agents.determinism.check_determinism(agent, source, runs=10)`。同じソースをN回撮影してハッシュを比べ、**N回とも一致して初めて決定的**とみなす。不一致は何回目かを返す。
- スキーマ追加は既存の列追加パターン(`_COLUMN_MIGRATIONS`)に従い、既存DBは自動で移行される。

### 7.2 結果表示の決めごと(U3・U4)
| 項目 | 決め |
|---|---|
| 判定 | 合格=緑+「✓ 合格」/不合格=赤+「✕ 不合格」/不安定=橙+「△ 不安定」/未検査=灰+「— 未検査」。色を消しても区別できる |
| 差分率 | 半角・等幅・小数点以下2桁。0より大きく0.01%未満は「<0.01%」(失敗判定の横に「0.00%」と出さない)。許容値を併記(例: `許容 0.50% (10,368 px)`) |
| 差分の色 | 差分ピクセルは固定のマゼンタ`(255,0,255)`。UIの不合格の赤と混同させない。旧結果(赤`(255,0,0)`)もビューアは認識する |
| 数字の演出 | フリップ数字は「件数の変化」を伝えるダッシュボードの集計だけ。比較する数値には使わない |
| 撮影条件 | 解像度・時刻固定・シード・モーション低減を、結果ごとに固定表示する |

判定に使った許容値(`max_diff_pixels`/`per_pixel_tolerance`)は`diff_image`に保存する(旧データは`NULL`で「記録なし」と表示)。

### 7.3 画面
- **Diff Viewer**: 表示モード[差分/並べて/スライダー/点滅]、背景[白/黒/市松]、ズーム[フィット/100%]、右に結果と撮影条件、下に履歴タイムライン。点滅は片道800ms(1周1.6s=0.625Hz、1Hz未満)で、停止でき、OSが動きの削減を求める場合は停止状態で始まる。拡大表示時は最近傍補間にして1pxの差分をぼかさない。
- **画面一覧ボード**(ダッシュボード): 全撮影指示をカードで並べ、判定で枠の色と文言を変える。**未検査の画面は灰色の破線カード**で漏れを目立たせる。列数は幅から決め、可能なら最終段に余りが出ない数にする。
- **テーマ**: ライト/ダークの切替(OS設定を初期値にし、選択は保存)。

### 7.4 実装中に見つかった不具合(参考)
- 全リクエストが1本のSQLite接続をスレッド間で共有しており、同時リクエスト(ボードのサムネイル)で`InterfaceError`→HTTP 500になっていた。リクエストごとの接続に変更。
- 画像エンドポイントに`Vary: Origin`が無く、通常の`<img>`で取得した応答がブラウザキャッシュ経由でCORS付き`<img>`(ピクセル採取用)に使い回され、画像が壊れていた。
- スプリットフラップの内側要素が全体用の`.card`クラスと衝突して桁が肥大し、フリップのセレクタも一致せず演出が動いていなかった。

### 7.5 対象外にしたもの
Q3(差分の仕分け補助モデル。精度未検証で、合否には使わない前提のため見送り)、Q4(シェーダ金画像のヘッドレス撮影)、Q5(Houdini→エンジン往復検証。TransferKitのPhase 3と共通のため別途)。

### 7.6 UIパーツと動きの規則(2026-10-11追補)
- **パーツ**: セグメントコントロール・レンジスライダーは7.3で実装済み。**チップ+検索+ページネーション**(実行履歴を判定で絞り込み、build versionで検索、10件ずつ表示。選択中の結果が別ページなら自動でそのページへ)、**モーダル**(基準画像を*置き換える*昇格の確認。初回の昇格は確認なし)、**エンプティステート**(撮影指示なし・撮影画像なし・未検査・絞り込み0件で、次にやることを案内)。
- **モーダル**: ネイティブ`<dialog>`の`showModal()`(フォーカストラップ・背面の無効化・Esc・フォーカス復帰が標準で効く)。初期フォーカスは「キャンセル」で、Enterの誤操作で確定しない。現在の基準画像と新しい基準画像を並べ、「これまでの判定結果と履歴は変わらない」「元に戻すには以前の画像を再度昇格する」を明記する。開閉アニメーションは付けない。
- **動きの規則**: ①1画面で使う動きは2種類まで(ツール画面=トースト+フォーカスリング、ただし点滅モードではリングは出ない/ダッシュボード=フリップ+トースト)、②すべて`prefers-reduced-motion`で止める(CSSで一括)、③通常は静かに(確認ダイアログ・エンプティステートは動かさない)、④撮影の決定性が要る画面では動きを使わない(撮影対象の画面はQ1の固定時刻・動き低減で止める)。

### 7.7 しきい値ラボ(2026-10-15追補 T1)
結果詳細の「しきい値ラボ」で許容誤差・許容ピクセル数・最小領域サイズ・中央クロップを動かすと、**その設定で判定されていたらどうなるか**を表示する。`POST /api/diffs/preview`が実際の差分実行と同じ読み込み・比較(`_load_pair`/`_compare`)を使い、**何も保存しない**(`diff_image`・`evaluation_result`・`alert_issue`・BLOBのいずれも書かない)。保存済みの判定は変わらず、反映するには「差分の詳細設定」を変えて差分実行する。初期値は保存時の設定なので、動かさなければ「保存済みと同じ」。`flaky`は履歴で決まるラベルのためプレビューでは出ず、保存済みが`flaky`のときはその旨を表示する。

### 7.8 Diff Viewerの比較ラボ化(2026-10-15追補 T3・T6・T8)
- **T3**: 履歴のコマ送り(「◀ 前の結果 / 次の結果 ▶」と現在位置)、2枚を半透明で重ねる**オニオンスキン(重ね)**。点滅は1Hz未満を維持。
- **T6 キー割り当て**: `C`=表示モード切替(Shiftで逆順)、`B`=背景切替、`←` `→`=古い/新しい結果、`/`=履歴の検索へ。既存のキー処理はトーストのEnter/Spaceだけで衝突しない。**入力欄・スライダー・選択ボックス、修飾キー併用、IME変換中、モーダルが開いている間は反応しない**(`shortcuts.ts`で一元化)。
- **T8 基準 / 今回 / 差分**: 「個別」モードで、効果なし(基準)→効果あり(今回)→比較(差分)の順に1枚ずつ切り替える。並べて表示(Captured・Reference・Diff)とは別に、1枚を大きく見るための切替。

### 7.9 フレーム連続性の検査(2026-10-22追補 X11)
アニメーションの全フレームを撮影し、**隣り合うフレームとの変化画素数が急に跳ねる箇所**を探す(動画の1フレームだけが9万画素変わる、のような異常の発見が目的)。`POST /api/analysis/continuity`(`captured_image_ids`を再生順で渡す)。
- しきい値は固定値ではなくシーケンス自身から決める: `中央値 + k × 1.4826 × MAD`(既定k=6)と、フレーム面積の`min_jump_percent`(既定0.1%)の大きい方。ほぼ静止した列で数画素のノイズを拾わないための下限。
- **外れ値だけを報告**する(各ペアの変化量も`pair_diffs`で返す)。異常フレームは「そこへ入る側」と「そこから出る側」の2ペアが出る。
- 判定アルゴリズムには触れず、何も保存しない。外れ値は**候補**であり、意図したシーン切り替えも跳ねるため、不合格の判定には使わない。3フレーム未満・解像度の不一致は422で位置を示す。
- `BackendClient.check_continuity(ids, k=..., min_jump_percent=...)`で呼べる。しきい値(k・下限)は実データで決める前提の初期値。

### 7.10 決定性の試験題材(2026-10-23追補 Y2)
「時刻だけで絵が決まる」題材を、撮影の決定性と連続性を確かめる試験に使う。外部の見本は取得できなかった(ギャラリーが空・実物未確認)ため、**自作の純関数の題材**を`backend/tests/test_continuity.py`に置いた(フレーム番号だけが画素を決める、2px/フレームで動くブロック)。同じ時刻を2回撮ると同一バイト列になる(コンテンツアドレス保存で重複排除される)、滑らかな動きには外れ値が出ない、1フレームだけ全面が変わる異常は前後2ペアで検出される、をテストで確かめている。外部の見本が入手できたら、同じ手順(同時刻の再撮影→同一、隣接フレーム差に跳びなし)で題材だけを差し替えられる。

**検証チェックリスト:**
- [ ] アニメ要素を含む画面を同じ条件で10回撮影すると、すべて同一になる(`check_determinism`)
- [ ] 色を消しても、合格・不合格・未検査が区別できる
- [ ] 表示される差分率・許容値が、バックエンドの評価結果と一致する
- [ ] 点滅モードが1Hz未満で、停止できる
- [ ] 未検査の画面がボードに必ず出る(撮影指示一覧との突き合わせ)
- [ ] ダークテーマでも、差分のマゼンタが背景と区別できる
- [ ] しきい値ラボを動かしても、保存済みの判定・履歴・アラートが変わらない
- [ ] キー操作が、入力欄・スライダー・モーダル表示中に誤動作しない
- [ ] 基準画像を置き換える昇格だけが確認を挟み、キャンセル/Esc/背景クリックでは基準が変わらない
- [ ] 異常フレームを1枚混ぜた連番で、その前後のペアだけが外れ値として出る
