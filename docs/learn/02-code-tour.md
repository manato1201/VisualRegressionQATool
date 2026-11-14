# 2. コードの読み方(どこに何があるか)

## バックエンド(`backend/app/`)

| ファイル | 行数の目安 | 役割 | 読む順 |
|---|---|---|---|
| `diff_engine.py` | 190 | **PixelDiffEngine**(比較・連結成分・中央を切る・差分画像) | ① |
| `storage.py` | 55 | コンテンツアドレスの画像置き場(`BlobStore`) | ② |
| `db.py` | 150 | SQLite のスキーマ・接続・列の追加(マイグレーション) | ③ |
| `repository.py` | 470 | テーブルごとの作成・取得・**昇格**・**削除の条件**・**flaky の書き換え**・通知の記録 | ④ |
| `queries.py` | 190 | first-bad-commit・履歴一覧・ダッシュボードの SQL | ⑤ |
| `routers/diffs.py` | 350 | 差分実行の流れ(読む→比べる→保存→判定→通知)・一括実行・プレビュー | ⑥ |
| `alert_sink.py` | 320 | `IAlertSink` と、Noop・Webhook・GitHub・トースト・複合 | ⑦ |
| `continuity.py` | 130 | フレーム連続性(中央値と MAD) | |
| `models.py` | 230 | リクエスト・レスポンスの型(Pydantic) | |
| `routers/` その他 | 30〜120 | `instructions`・`captures`・`references`・`runs`・`alerts`・`analysis`・`auth` | |
| `security.py` | 100 | Host の許可リスト・Origin の検査 | |
| `auth.py`・`routers/auth.py`・`audit.py` | 370・80・115 | API キー・役割・Cloudflare Access・ログイン・監査ログ | |
| `config.py`・`deps.py`・`main.py` | 30〜60 | CORS の設定・依存(DB・BlobStore)・アプリの組み立て | |

**読み方**: ①②③の「小さな核」から。次に ⑥ で、それらがどうつながるかを見る。

## 撮影エージェント(`capture_agents/`・`unity_capture_agent/`)

| ファイル | 役割 |
|---|---|
| `capture_agents/models.py` | `CaptureSource`・`RawFrame`(エンジンに依らないデータ) |
| `capture_agents/base.py` | `CaptureAgent`(`prepare` + `capture`)と、バックエンドへ送る `BackendClient` |
| `capture_agents/determinism.py` | 決定性の条件の取り込み・アニメ停止の CSS・**N 回撮影の検収** |
| `capture_agents/houdini_agent.py` | Houdini 向けの実装(`hou` が要る) |
| `examples/fake_agent_smoke_test.py` | 偽のエージェントで、撮影から first-bad-commit までを通す |
| `examples/ci_diff_check.py` | CI 用: PNG を渡して差分実行、fail で非ゼロ終了 |
| `unity_capture_agent/*.cs` | Unity 向け(同じ契約の C# 版) |

## フロントエンド(`frontend/src/`)

| 場所 | 役割 |
|---|---|
| `main.tsx`・`App.tsx` | 画面全体の状態管理 |
| `api.ts`・`types.ts` | API クライアントと型(バックエンドの `models.py` に対応) |
| `components/` | `DiffViewer`(差分・並べて・スライダー・点滅)・`Dashboard`(画面一覧ボード)・`CapturePanel`・`RunHistory`・`InstructionPanel`・`ToastStack` ほか |
| `diffClusters.ts`・`pixelSampler.ts` | 差分の塊の検出・ピクセルの値の取得(画面側の計算) |
| `role.ts`・`components/AuthGate.tsx` | 役割に応じた表示の出し分け・ログイン |
| `admin/`・`adminApi.ts`・`admin.html` | **別バンドル**の管理画面(昇格・削除)。差分ビューアには入っていない |
| `theme.css`・`theme.ts` | デザイントークンとテーマ切替 |

## テスト・設計書

| 場所 | 内容 |
|---|---|
| `backend/tests/` | バックエンドのテスト(約 160 件) |
| `capture_agents/tests/` | 撮影エージェントのテスト(19 件) |
| `VisualRegressionQATool_DESIGN.md` | 設計書(Phase 0〜5) |
| `VisualRegressionQATool_UI_DESIGN.md` | UI のデザインシステム |
| `IMPROVEMENT_DESIGN_2026-10.md`・`IMPROVEMENT_PLAN_2026-10.md` | 2026-10 の改善の設計と計画 |
| `docs/ARCHITECTURE.md`・`TECHNICAL_GUIDE.md`・`CAPTURE_AGENT_DESIGN.md` | 図表・技術解説・撮影エージェントの契約 |
