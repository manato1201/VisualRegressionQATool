# VisualRegressionQATool 講義(基礎から)

ビジュアル回帰の**考え方・コード・アルゴリズム・専門用語**を、順に学ぶ講義です。各回は「**ゴール → 説明と実行できる例 → 確認問題 → 解答 → まとめ**」で、コードは実際に動かして確かめてあります(`backend/tests/test_docs.py` が、ずれと出力を検査します)。

| 回 | 題 | 学ぶこと | 目安 |
|---|---|---|---|
| [0](00-introduction.md) | ビジュアル回帰とは | 解きたい問題・**撮影を決定的に→評価はシンプルに**・パイプライン | 1 h |
| [1](01-pixel-diff-engine.md) | ピクセル比較エンジン | NumPy の差分・3 つのつまみ・**連結成分**・サイズ違い・差分画像 | 3 h |
| [2](02-storage-and-db.md) | 保存する | **コンテンツアドレス**・5 テーブルの鎖・基準の昇格・マイグレーション | 3 h |
| [3](03-history-flaky-alerts.md) | 履歴・flaky・アラート | first-bad-commit(SQL と限界)・**不安定の判定**・重複しない通知・`IAlertSink` | 4 h |
| [4](04-determinism-continuity.md) | 決定性と連続性 | N 回撮影の検収・`CaptureAgent`・**中央値と MAD** による異常フレーム検出 | 3 h |
| [5](05-testing-capstone.md) | テストと総合演習 | 画像テストの型・**除外領域を足す** | 半日 |

## 進め方

- **前提**: Python の基本。NumPy の配列(第 1 回から)・SQL の `JOIN`(第 2 回から)は、その回で必要な分を説明します。
- 例は、リポジトリのルートで動かします(`backend/` の Python 環境。`app`・`capture_agents` を import できるよう、`tools/docs_pythonpath.txt` で設定済み)。**ネットワークや本物の撮影は使いません**。
- 詰まったら [用語集](../learn/glossary.md)。講義のあとは、保守・拡張の実務へ: [学習資料](../learn/index.md)。
