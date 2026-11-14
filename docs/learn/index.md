# VisualRegressionQATool 学習資料(保守・拡張の実務編)

このフォルダは、**このツールを直す・足す人**のための資料です。基礎から順に学ぶ講義は [../lecture/index.md](../lecture/index.md)(第 0〜5 回)。以前からある図表・技術解説は [../ARCHITECTURE.md](../ARCHITECTURE.md)(Mermaid の構成図・ER 図・シーケンス図)と [../TECHNICAL_GUIDE.md](../TECHNICAL_GUIDE.md)(モジュール別の解説)にあります。

| # | 資料 | いつ読むか |
|---|---|---|
| 1 | [全体像](01-overview.md) | 何がどう動いているか・データの置き場所・環境変数 |
| 2 | [コードの読み方](02-code-tour.md) | どのファイルから読むか |
| 3 | [内側のしくみ](03-internals.md) | アップロード→差分→判定→通知の流れ・認証と管理画面の分離・フロントエンド |
| 4 | [拡張のレシピ](04-extend.md) | 通知先・撮影エージェント・API・しきい値のつまみ・画面を**足したい** |
| 5 | [テストの書き方と実行](05-testing.md) | テストを回す・足す・文書の検査 |
| 6 | [トラブルと保守](06-troubleshooting-maintenance.md) | 403・404・409・画像が出ない・既知の問題・定期の保守 |
| 7 | [基礎の補強](07-foundations.md) | NumPy・dataclass・例外・SQL の基本・設計思想・アルゴリズム・IT 用語を**補強したい** |
| – | [用語集](glossary.md) | 分からない言葉が出た |

## 最初の 15 分

1. [README](../../README.md) の手順で、バックエンド(`uv run uvicorn app.main:app --port 8000`)とフロント(`npm run dev`)を起動する。
2. [構成図](../diagrams/architecture.svg)を見ながら、[全体像](01-overview.md)の「1 回の差分実行」を読む。
3. 画面で、指示を作る → 画像をアップロード → 基準に昇格 → もう 1 枚で差分実行、を一通りやる(README の「動作確認手順」)。

## 目的別の近道

| やりたいこと | 読む場所 |
|---|---|
| 許容誤差・除外などの比較のつまみを足す | [4 拡張](04-extend.md) レシピ 1・講義[第 1 回](../lecture/01-pixel-diff-engine.md)・[第 5 回](../lecture/05-testing-capstone.md) |
| 通知先を足す(Teams・Discord など) | [4 拡張](04-extend.md) レシピ 2・講義[第 3 回](../lecture/03-history-flaky-alerts.md) |
| 新しいエンジンから撮影する(Unity・Blender など) | [4 拡張](04-extend.md) レシピ 3・[CAPTURE_AGENT_DESIGN.md](../CAPTURE_AGENT_DESIGN.md) |
| 環境変数・デプロイ・認証 | [旧 README の詳細](../reference/setup-and-operations.md) |
| 設計の経緯 | [VisualRegressionQATool_DESIGN.md](../../VisualRegressionQATool_DESIGN.md) |
