# VisualRegressionQATool

**設計指標: 再現性を最大化した上でのシンプルなピクセル差分による回帰検知**

自動画像比較によるビジュアル回帰QAツール。核となる考え方は一つ ——「差分が具体的に何を意味するかを明確にする」ために、比較対象の撮影を可能な限り決定的にしてから、評価そのものはシンプルなピクセル毎比較に留める。SSIM等の知覚的差分アルゴリズムには頼らない。

パイプライン全体像: `撮影指示(CaptureInstruction) → 撮影画像(CapturedImage) → 基準画像(ReferenceImage) → 差分画像(DiffImage) → 評価結果(EvaluationResult) → DB`

詳細設計は [`VisualRegressionQATool_DESIGN.md`](VisualRegressionQATool_DESIGN.md)、UIデザインシステムは [`VisualRegressionQATool_UI_DESIGN.md`](VisualRegressionQATool_UI_DESIGN.md) を参照。アーキテクチャ図・技術解説は [`docs/`](docs/) 以下にまとめている。

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — システム構成図・ER図・シーケンス図(Mermaid)
- [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md) — モジュール別技術解説書
- [docs/architecture.html](docs/architecture.html) — 上記をまとめたブラウザ閲覧用HTML版

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

## アラートsinkの設定

環境変数 `VRQA_ALERT_SINK` で切替(既定は `noop`)。

| 値 | 用途 |
|---|---|
| `noop` | 何もしない(既定) |
| `webhook` | `VRQA_WEBHOOK_URL` へPOST |
| `github` | `VRQA_GITHUB_OWNER` / `VRQA_GITHUB_REPO` / `VRQA_GITHUB_TOKEN` を指定し、`visual-regression-fail`ラベルでIssueを自動作成/自動クローズ |

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
│   │   ├── routers/         # instructions/captures/references/diffs/runs
│   │   └── main.py          # FastAPIアプリ組み立て
│   └── tests/                # pytest 37件
└── frontend/
    └── src/
        ├── theme.css              # Zapier風デザイントークン
        ├── api.ts                 # APIクライアント
        ├── App.tsx                # 画面全体の状態管理
        └── components/            # DiffViewer / CapturePanel / RunHistory 等
```
