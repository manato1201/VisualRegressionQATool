# VisualRegressionQATool

**設計指標: 再現性を最大化した上での、シンプルなピクセル差分による回帰検知**

撮影した画像と、承認済みの基準画像を、**ピクセルごと**に比べ、違いがあれば知らせる、ビジュアル回帰 QA ツールです。核となる考えは 1 つ — 「差分が具体的に何を意味するかを明確にする」ために、**撮影を可能な限り決定的にしてから、評価はシンプルなピクセル比較に留める**。SSIM などの知覚的な類似度には頼りません。

![構成図](docs/diagrams/architecture.svg)

`撮影指示 → 撮影画像 → 基準画像 → 差分画像 → 評価結果 → DB`

## 状態

| 項目 | 内容 |
|---|---|
| 担当範囲 | 設計の **Phase 3〜5**(基準と差分評価・DB 永続化・アラートと画面)。決定的な撮影(Phase 1〜2)は撮る側(`UnityHDRPBlackHole` など)の仕事で、ここには**共通の契約**(`capture_agents/`)だけがある |
| 技術 | Python 3.12・FastAPI・SQLite・Pillow・NumPy・SciPy / React 19・TypeScript・Vite |
| テスト | `cd backend && uv run pytest -q`(文書の検査を含む)・`cd capture_agents && uv run pytest -q`(19 件) |
| 認証 | 既定は**なし**(`VRQA_AUTH=off`。Host・Origin の検査だけ)。複数人なら `VRQA_AUTH=required` |
| 未検証 | **Unity(C#)エージェント**(このリポジトリ内では未検証)・実機の Houdini・Firefox / Safari での画面 |
| 既知の問題 | [トラブルと保守](docs/learn/06-troubleshooting-maintenance.md)(通知先の例外で差分実行が 500 になる等) |

## クイックスタート

```bash
# バックエンド
cd backend
uv sync --dev
uv run uvicorn app.main:app --port 8000 --reload      # http://localhost:8000/api/health

# フロントエンド(別のターミナル)
cd frontend
npm install
npm run dev                                            # http://localhost:5173
```

画面で、**指示を作る → 画像をアップロード → 基準に昇格 → 別の画像で差分実行** と進めると、一通り確認できます(手順は [旧 README の「動作確認手順」](docs/reference/setup-and-operations.md))。

## できること

- **厳密なピクセル比較**(`PixelDiffEngine`): 許容誤差・許容する差分数・最小の塊(連結成分)の **3 つのつまみ**で調整。サイズ違いは**既定でエラー**(明示すれば中央を切り、記録を残す)。
- **コンテンツアドレスの画像置き場**: 同じ中身は、何度アップロードしても 1 つ。
- **基準の昇格ワークフロー**: 承認された画像だけが基準。指示ごとに有効なのは 1 つ。
- **履歴**: 5 つのテーブルの鎖・**first-bad-commit**(最初に fail した版)・不安定(**flaky**)の判定。
- **アラート**: fail で 1 回だけ開き、pass で閉じる。通知先は差し替え可能(Noop・Webhook・GitHub Issue・画面のトースト・複合)。
- **差分ビューア**: 差分・並べて・スライダー・点滅の 4 表示、画面一覧ボード、しきい値ラボ(何も保存しない)、フレーム連続性の検査。
- **撮影エージェントの契約**(`capture_agents/`・`unity_capture_agent/`): `prepare` + `capture`。**N 回撮影して同一か**の検収つき。
- **認証・役割・監査**: `viewer` / `operator` / `admin`・API キー(ハッシュだけ保存)・監査ログ・管理画面(昇格・削除)の別バンドル化。

## ドキュメント

| 読みたいもの | 場所 |
|---|---|
| 全体の地図 | [docs/index.md](docs/index.md) |
| **基礎から学ぶ**(講義 6 回・実行できる例つき) | [docs/lecture/](docs/lecture/index.md) |
| **保守・拡張する**(全体像・コードの読み方・レシピ・テスト・トラブル・用語集) | [docs/learn/](docs/learn/index.md) |
| セットアップ・環境変数・認証・アラートの設定の**詳細**(旧 README) | [docs/reference/setup-and-operations.md](docs/reference/setup-and-operations.md) |
| 図表(構成図・ER 図・シーケンス図) | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)・[browser 版](docs/architecture.html) |
| モジュール別の技術解説 | [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md) |
| 撮影エージェントの契約 | [docs/CAPTURE_AGENT_DESIGN.md](docs/CAPTURE_AGENT_DESIGN.md) |
| 設計書・UI 設計 | [VisualRegressionQATool_DESIGN.md](VisualRegressionQATool_DESIGN.md)・[UI](VisualRegressionQATool_UI_DESIGN.md) |
| 改善の設計と計画(2026-10) | [IMPROVEMENT_DESIGN_2026-10.md](IMPROVEMENT_DESIGN_2026-10.md)・[IMPROVEMENT_PLAN_2026-10.md](IMPROVEMENT_PLAN_2026-10.md) |

## 運用の要点

- **環境変数**(主なもの): `VRQA_DB_PATH`・`VRQA_BLOB_ROOT`(同じ永続ボリュームに)・`VRQA_CORS_ORIGINS`(UI の配信元。`*` は拒否)・`VRQA_ALLOWED_HOSTS`・`VRQA_AUTH`・`VRQA_ALERT_SINK`。全部の表は [詳細](docs/reference/setup-and-operations.md)。
- **API は 1 プロセス**で動かす前提(SQLite・プロセス内ロック)。増やすなら先に DB を移す。
- **基準の昇格と撮影の削除は admin だけ**。サーバーが 403 で守る(画面の分離は、誤操作を減らす整理)。
- 秘密(Webhook の URL・GitHub のトークン・API キー)は**環境変数**で。リポジトリに書かない。

## 限界(正直に)

- 評価は**ピクセル比較だけ**。賢い比較(類似度)は、意図して使っていない。**揺れは、撮影側で潰す**前提です。
- `first-bad-commit` は**最初の失敗**で、「いまの失敗の始まり」ではありません。flaky は**過去の判定を書き換えます**。
- 通知先が落ちていると、差分実行が 500 を返すことがあります(判定は保存済み)。詳細は [既知の問題](docs/learn/06-troubleshooting-maintenance.md)。
- 画面・撮影エージェントの確認範囲は、上の「状態」の表のとおり(Unity・実機 Houdini は未検証)。
