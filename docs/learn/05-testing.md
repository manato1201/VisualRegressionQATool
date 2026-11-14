# 5. テストの書き方と実行

## 実行

```bash
cd backend
uv sync --dev
uv run pytest -q                 # バックエンド全部(文書の検査を含む)
uv run pytest tests/test_diff_engine.py -q
uv run pytest -k "alert" -q

cd ../capture_agents
uv sync --dev
uv run pytest -q                 # 撮影エージェント(19 件)
```

フロントエンドは `cd frontend && npm run build`(型の検査を含む)。一部の画面の決めごとは、バックエンドの `tests/`(`test_admin_split_frontend.py` など)が、ソースの文字列を読んで確かめています。

## テストの置き場所と、何を確かめるか

| ファイル | 確かめるもの | 主な道具 |
|---|---|---|
| `test_diff_engine.py` | つまみ・連結成分・サイズ違い・差分画像 | NumPy の合成画像 |
| `test_storage.py`・`test_repository.py`・`test_db_migrations.py` | 重複排除・鎖・昇格・列の追加 | `tmp_path` の SQLite |
| `test_queries.py`・`test_dashboard.py` | first-bad-commit・一覧の並び | 履歴を作って問い合わせ |
| `test_alert_sink.py` | Webhook・GitHub の重複防止・複合 | `httpx.MockTransport` |
| `test_api_integration.py`・`test_diff_batch.py`・`test_diff_preview.py`・`test_delete_captured_image.py` | API を通した全体の流れ | `TestClient` |
| `test_continuity.py` | 連続性の外れ値 | 合成のフレーム |
| `test_security.py`・`test_auth.py`・`test_audit.py`・`test_debug_gate.py`・`test_config.py` | Host・Origin・役割・監査・デバッグの門・CORS | `TestClient`・環境変数 |
| `test_admin_split_frontend.py` | 差分ビューアに昇格・削除が入っていない | ソースの読み取り |
| `test_docs.py` | 文書の検査(下) | `tools/quote_code.py` |

## よく使う型

**1. 小さな合成画像**(本物のスクリーンショットは使わない): 期待値が手で数えられる大きさにする(3 × 3 の塊 = 9 ピクセル)。

**2. 性質のテスト**: 「同じ画像なら、いつも差分 0」「許容誤差を上げても、差分は**増えない**」。

**3. 外部は偽物に**: GitHub・Webhook は `httpx.MockTransport` で差し替え、**本物の通信をしない**。

**4. DB は一時ファイル**: `db.session(tmp_path / "x.sqlite3")`。

**5. 環境変数は `monkeypatch.setenv`**(`VRQA_AUTH`・`VRQA_AUDIT_LOG` など)。

**6. 異常系と「しないこと」**: 壊れた画像(400・422)・サイズ違い(422)・基準なし(404)・使用中の画像の削除(409)・viewer が昇格(403)。「flaky は、アラートを開閉しない」「`*` の CORS は拒否」。

## 新しい機能のテストを書く手順

1. **失敗するテストを先に書く**。2. 実装して通す。3. 異常系と「しないこと」。4. **API を変えたら**、フロントの `types.ts` と `npm run build` も。

## 文書の検査

`docs/` と README の中の**コード**は、実際のソースと一致している必要があります。

```bash
python tools/check_docs.py             # 検査(標準ライブラリだけ)
python tools/check_docs.py --update    # 引用の更新・実行例の出力の作り直し
python tools/check_mermaid.py          # Mermaid が描画できるか(mmdc が要る)
python tools/make_diagrams.py          # 構成図(SVG)を作り直す
```

`backend/tests/test_docs.py` は、同じ検査を pytest で行います。**実行例は、`backend/` の Python で動きます**(`tools/docs_pythonpath.txt` に `backend` と `capture_agents` を書いてあるので、`app`・`capture_agents` を import できる)。確かめること: 引用がソースと一致・実行例が 2 回動いて出力が一致・講義の標準の節・相対リンク・Mermaid の標準行。

> **実行例を書くコツ**: 出力は**決まった値だけ**に。一時フォルダのパス・ハッシュ・UUID・時刻を、そのまま `print` しない(UUID は毎回変わる)。

## 確かめていないこと(正直に)

- **Unity(C#)のエージェント**は、このリポジトリ内では**未検証**(Unity 本体が要る)。
- **実機の Houdini** での撮影は、自動テストでは確かめていない(偽の `hou` で、順序と条件の反映だけ)。
- GitHub・Webhook の**本物の通信**は、自動テストでは行っていない(`MockTransport`)。
- 実ブラウザでの画面の確認範囲は、README・設計書の記述に従う(Firefox・Safari・スマホ実機は未確認と思われる。要確認)。
- 大きな画像(数千万ピクセル)・多数の履歴での**性能は未測定**。
