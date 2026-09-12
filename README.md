# VisualRegressionQATool

**設計指標: 再現性を最大化した上でのシンプルなピクセル差分による回帰検知**

自動画像比較によるビジュアル回帰QAツール。核となる考え方は一つ ——「差分が具体的に何を意味するかを明確にする」ために、比較対象の撮影を可能な限り決定的にしてから、評価そのものはシンプルなピクセル毎比較に留める。SSIM等の知覚的差分アルゴリズムには頼らない。

パイプライン全体像: `撮影指示(CaptureInstruction) → 撮影画像(CapturedImage) → 基準画像(ReferenceImage) → 差分画像(DiffImage) → 評価結果(EvaluationResult) → DB`

詳細設計は [`VisualRegressionQATool_DESIGN.md`](VisualRegressionQATool_DESIGN.md)、UIデザインシステムは [`VisualRegressionQATool_UI_DESIGN.md`](VisualRegressionQATool_UI_DESIGN.md) を参照。アーキテクチャ図・技術解説は [`docs/`](docs/) 以下にまとめている。

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — システム構成図・ER図・シーケンス図(Mermaid)
- [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md) — モジュール別技術解説書
- [docs/architecture.html](docs/architecture.html) — 上記をまとめたブラウザ閲覧用HTML版
- [docs/CAPTURE_AGENT_DESIGN.md](docs/CAPTURE_AGENT_DESIGN.md) — Unity/Houdini等のDCCツールからバックエンドへ撮影画像を送るCaptureAgent共通インターフェース設計

## 実装スコープ

設計書はUnityでの決定的撮影(Phase 1-2)を含む5フェーズ構成だが、本リポジトリは **Phase 3〜5** (基準画像管理+差分評価・DB永続化・アラート/ビューア) を実装対象とする。Phase 1-2(`DeterminismController`等のUnity C#モジュール)は別プロジェクト`UnityHDRPBlackHole`側で扱う想定のため、このリポジトリには含まれない。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| バックエンド | Python 3.12 / FastAPI / SQLite / Pillow / NumPy / SciPy |
| フロントエンド | React 19 / TypeScript / Vite 8 |
| パッケージ管理 | `uv`(backend) / `npm`(frontend) |
| テスト | pytest(backend, 37件) |

## 機能一覧

- **撮影指示(CaptureInstruction)管理** — シーンID・フレームレート・シード等の作成/一覧
- **撮影画像アップロード** — checksum(SHA-256)ベースのコンテンツアドレスBLOBストレージで重複排除
- **ReferenceStore昇格ワークフロー** — 承認された撮影画像のみが基準画像として参照される
- **PixelDiffEngine** — 厳密ピクセル差分。`per_pixel_tolerance`(許容誤差)・`max_diff_pixels`(許容差分数)・`min_diff_region_pixels`(連結成分によるノイズ除去)の3軸で調整可能
- **単発 / 一括(バッチ)差分実行** — 複数の撮影画像をまとめて評価。1件の失敗が他に影響しない
- **first-bad-commitクエリ** — 同一instructionの履歴から最初にfailしたbuild_versionを特定
- **IAlertSink抽象化** — `NoopAlertSink` / `WebhookAlertSink` / `GitHubIssueAlertSink`(ラベル検索による重複防止・自動クローズ込み)をコード変更なしで切替可能
- **差分ビューアWeb UI** — サイドバイサイド/オーバーレイ表示、PASS/FAILの意味表示、撮影画像削除、「はじめに」ガイド
- **CaptureAgent共通インターフェース** — Unity/Houdini等から`view`(ビューポート)/`comp`(コンポジット出力)を撮影してバックエンドへ送るクライアント側契約。サーバーAPIは無変更([capture_agents/](capture_agents/) = Python/Houdini版、[unity_capture_agent/](unity_capture_agent/) = C#/Unity版)
- **CI連携サンプル** — [`.github/workflows/visual-regression-example.yml`](.github/workflows/visual-regression-example.yml) + [`capture_agents/examples/ci_diff_check.py`](capture_agents/examples/ci_diff_check.py)。ビルド成果物のPNGを渡すとfail時に非ゼロ終了しジョブを落とす

## セットアップ

### バックエンド

```bash
cd backend
uv sync --dev
uv run uvicorn app.main:app --port 8000 --reload
```

`http://localhost:8000/api/health` で起動確認。

### フロントエンド

```bash
cd frontend
npm install
npm run dev
```

`http://localhost:5173` を開く。バックエンドのCORS許可オリジンは `http://localhost:5173` に固定しているため、ポートを変える場合は `backend/app/main.py` の `CORSMiddleware` 設定も合わせて変更すること。

### テスト

```bash
cd backend
uv run pytest -q
```

## 動作確認手順

各コンポーネントを実際に動かして確認する手順。上の「セットアップ」で起動したうえで進める。

### 1. バックエンド(FastAPI)

```bash
cd backend
uv sync --dev
uv run pytest -q          # 37件全パスするはず
uv run uvicorn app.main:app --port 8000 --reload
```

ブラウザ or `curl http://localhost:8000/api/health` → `{"status":"ok"}` が返れば起動確認完了。

### 2. フロントエンド(React) — バックエンド起動後

```bash
cd frontend
npm install
npm run dev
```

`http://localhost:5173` を開き、以下の順に操作して一通り確認する:

1. 初回は「はじめに」タブが表示される→「ツール」タブへ切り替え
2. 左パネルで撮影指示(シーンID)を新規作成
3. 「撮影画像」パネルで画像をアップロード
4. その画像を「Referenceに昇格」
5. 別の画像(同一内容)をアップロードして「差分実行」→ **Pass** になることを確認
6. さらに別の画像(見た目を変えたもの)をアップロードして「差分実行」→ **Fail** になり、First Bad Commitバナーが表示されることを確認
7. 「差分の詳細設定」で許容誤差(tolerance)・最小差分領域サイズを変更して再実行し、判定が変わることを確認
8. 複数の撮影画像を選択し「選択した画像をまとめて差分実行」で一括実行を確認
9. 撮影画像の「削除」ボタン(Referenceや差分履歴に使われている画像は削除できないことも確認)

### 3. capture_agents(Unity/Houdini共通インターフェースのPython側) — バックエンド起動後

```bash
cd capture_agents
uv sync --dev
uv run pytest -q                                    # 8件全パスするはず
uv run --with pillow --with numpy python examples/fake_agent_smoke_test.py
```

Houdini本体が無くても、フェイクエージェント経由で「撮影→アップロード→pass判定→regression→fail判定→first-bad-commit特定」までを実際にコンソールで確認できる。最後にフロントエンド(`http://localhost:5173`)を開き、`CaptureAgentSmokeTest`という撮影指示ができていることを確認するとより分かりやすい。実機Houdiniがある場合は[`capture_agents/README.md`](capture_agents/README.md)のHoudini向け手順を参照。

### 4. unity_capture_agent(C#) — 要Unity(このリポジトリ内では未検証)

1. `unity_capture_agent/*.cs` を対象UnityプロジェクトのAssets配下にコピー
2. 空のGameObjectを作成し `CaptureAgentExample` をアタッチ
3. InspectorでbackendUrl(`http://localhost:8000`)・cameraName・sceneOrLevelIdを設定
4. Play中に `RunOnce()` を呼び出す(ボタン等から)
5. Consoleに `verdict = pass` または `verdict = fail` が出力されれば成功

## アラートsinkの設定

環境変数 `VRQA_ALERT_SINK` で切替(既定は `noop`)。

| 値 | 用途 |
|---|---|
| `noop` | 何もしない(既定) |
| `webhook` | `VRQA_WEBHOOK_URL` へPOST |
| `github` | `VRQA_GITHUB_OWNER` / `VRQA_GITHUB_REPO` / `VRQA_GITHUB_TOKEN` を指定し、`visual-regression-fail`ラベルでIssueを自動作成/自動クローズ |
| `webui_toast` | 差分ビューアWeb UI上にスタックトースト(積み重ね通知)としてfail/recoveryを表示。DBスキーマ追加なしのインメモリキューで、フロントエンドが `GET /api/alerts/toasts?since_id=` をポーリングして描画する(`frontend/src/components/ToastStack.tsx`)。トーストをクリックすると該当の撮影指示に直接ジャンプする |
| `composite` | 複数sinkを同時に使う。`VRQA_ALERT_SINK_KINDS`にカンマ区切りで列挙(例: `VRQA_ALERT_SINK_KINDS=webui_toast,webhook`)。各sinkが発行するexternal_refは内部で個別に記憶し、復旧(recovery)時にそれぞれ正しいrefで通知する |

## ディレクトリ構成

```
VisualRegressionQATool/
├── VisualRegressionQATool_DESIGN.md      # 設計書(Phase 0-5)
├── VisualRegressionQATool_UI_DESIGN.md   # UIデザインシステム定義
├── docs/                                  # アーキテクチャ図・技術解説書
├── backend/
│   ├── app/
│   │   ├── db.py            # SQLiteスキーマ(5テーブル、外部キーは全てNOT NULL)
│   │   ├── storage.py       # コンテンツアドレスBLOBストレージ
│   │   ├── diff_engine.py   # PixelDiffEngine
│   │   ├── repository.py    # CRUD
│   │   ├── queries.py       # first-bad-commit等の履歴クエリ
│   │   ├── alert_sink.py    # IAlertSinkと実装群
│   │   ├── routers/         # instructions/captures/references/diffs/runs/alerts
│   │   └── main.py          # FastAPIアプリ組み立て
│   └── tests/                # pytest 67件
├── frontend/
│   └── src/
│       ├── theme.css              # Zapier風デザイントークン
│       ├── api.ts                 # APIクライアント
│       ├── App.tsx                # 画面全体の状態管理
│       └── components/            # DiffViewer / CapturePanel / RunHistory 等
├── capture_agents/                # CaptureAgent共通インターフェース(Python/Houdini版)
│   └── capture_agents/
│       ├── models.py              # CaptureSource / RawFrame
│       ├── base.py                # CaptureAgent ABC + BackendClient
│       └── houdini_agent.py       # HoudiniCaptureAgent(要hou)
└── unity_capture_agent/           # CaptureAgent共通インターフェース(C#/Unity版)
    └── UnityCaptureAgent.cs
```
