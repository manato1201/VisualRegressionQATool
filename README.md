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
| テスト | pytest(backend 97件 + capture_agents 19件) |

## 機能一覧

- **撮影指示(CaptureInstruction)管理** — シーンID・フレームレート・シード等の作成/一覧
- **撮影画像アップロード** — checksum(SHA-256)ベースのコンテンツアドレスBLOBストレージで重複排除
- **ReferenceStore昇格ワークフロー** — 承認された撮影画像のみが基準画像として参照される
- **PixelDiffEngine** — 厳密ピクセル差分。`per_pixel_tolerance`(許容誤差)・`max_diff_pixels`(許容差分数)・`min_diff_region_pixels`(連結成分によるノイズ除去)の3軸で調整可能
- **単発 / 一括(バッチ)差分実行** — 複数の撮影画像をまとめて評価。1件の失敗が他に影響しない
- **first-bad-commitクエリ** — 同一instructionの履歴から最初にfailしたbuild_versionを特定
- **IAlertSink抽象化** — `NoopAlertSink` / `WebhookAlertSink` / `GitHubIssueAlertSink`(ラベル検索による重複防止・自動クローズ込み)をコード変更なしで切替可能
- **差分ビューアWeb UI** — 差分/並べて/スライダー/点滅の4表示、背景(白/黒/市松)・ズーム切替、結果と撮影条件(解像度・時刻固定・シード)の固定表示、履歴タイムライン、撮影画像削除、「はじめに」ガイド。判定は色だけに頼らず「✓ 合格 / ✕ 不合格 / — 未検査」、差分ピクセルは固定のマゼンタ。ライト/ダークテーマ切替
- **しきい値ラボ / 比較ラボ** — 許容誤差を動かして「その設定なら判定がどう変わるか」をプレビュー(**何も保存しない**)。オニオンスキン、結果のコマ送り、キー操作(`C`表示 / `B`背景 / `←` `→`前後 / `/`検索)、基準画像を置き換える昇格の確認ダイアログ、実行履歴の絞り込み・検索・ページ送り
- **フレーム連続性の検査** — `POST /api/analysis/continuity`。アニメーションの隣り合うフレームの変化量が急に跳ねる箇所だけを報告(判定には使わない)
- **画面一覧ボード** — ダッシュボードに全撮影指示をカードで並べ、差分率で色分け。未検査の画面は灰色の破線カードで検査漏れを可視化
- **アニメーションの決定性** — 撮影指示に`fixed_time_seconds`(時計の固定)・`reduce_motion`を持たせ、`capture_agents.determinism.check_determinism`で「N回撮影して全て同一」を検収([設計書 Phase 7](VisualRegressionQATool_DESIGN.md))
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
uv run pytest -q          # 97件全パスするはず
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
uv run pytest -q                                    # 19件全パスするはず
uv run --with pillow --with numpy python examples/fake_agent_smoke_test.py
```

Houdini本体が無くても、フェイクエージェント経由で「撮影→アップロード→pass判定→regression→fail判定→first-bad-commit特定」までを実際にコンソールで確認できる。最後にフロントエンド(`http://localhost:5173`)を開き、`CaptureAgentSmokeTest`という撮影指示ができていることを確認するとより分かりやすい。実機Houdiniがある場合は[`capture_agents/README.md`](capture_agents/README.md)のHoudini向け手順を参照。

### 4. unity_capture_agent(C#) — 要Unity(このリポジトリ内では未検証)

1. `unity_capture_agent/*.cs` を対象UnityプロジェクトのAssets配下にコピー
2. 空のGameObjectを作成し `CaptureAgentExample` をアタッチ
3. InspectorでbackendUrl(`http://localhost:8000`)・cameraName・sceneOrLevelIdを設定
4. Play中に `RunOnce()` を呼び出す(ボタン等から)
5. Consoleに `verdict = pass` または `verdict = fail` が出力されれば成功

## 環境変数(デプロイ時の設定)

| 変数 | 既定 | 用途 |
|---|---|---|
| `VRQA_DB_PATH` | `backend/data/vrqa.sqlite3` | SQLiteファイルの場所 |
| `VRQA_BLOB_ROOT` | `backend/data/blobs` | 画像BLOBの置き場(DBと同じ永続ボリュームに置くこと) |
| `VRQA_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | UIの配信元オリジン(カンマ区切り)。**別ホストでUIを配信するなら必ず指定**。ここに無いオリジンからはブラウザがAPIを呼べない。`*`は拒否される(画像をcrossoriginで読むため、全許可にしない) |
| `VRQA_ALLOWED_HOSTS` | (ループバックのみ) | APIを開くホスト名(カンマ区切り。ポートは無視)。**localhost / 127.0.0.1 以外のホスト名でAPIを公開するなら必ず指定**。DNS rebinding対策のHost検査で、無いホストは403。変更操作(POST等)は、Originが同一オリジンか `VRQA_CORS_ORIGINS` の中にあるときだけ通る。**認証ではない**(`app/security.py`) |
| `VRQA_AUTH` | `off` | `required` で認証を必須にする(下の「認証と役割」)。`required` でユーザーが 1 人もいなければ**起動しない**。 |
| `VRQA_AUTH_FILE` | `backend/data/auth_users.json` | ユーザーと役割の保存先(キーは**ハッシュだけ**)。Git に入れない。 |
| `VRQA_CF_ACCESS_TEAM_DOMAIN` / `VRQA_CF_ACCESS_AUD` | (無効) | 両方を設定すると、Cloudflare Access の JWT でも認証できる(メールで登録ユーザーに対応づける)。 |
| `VRQA_AUDIT_LOG` | `backend/data/audit.jsonl` | 監査ログの保存先(下の「認証と役割」)。5 MB で `.1` に退避。 |
| `VRQA_DEBUG` | (無効) | **開発者・デバッグ向けの機能**(しきい値ラボ `POST /api/diffs/preview`・フレーム連続性の検査 `POST /api/analysis/continuity`)を、**本番(`VRQA_AUTH=required`)で有効にする**(`1`)。既定は**無効**(ログインしている人には 404)で、有効にしても **admin だけ**。`off`(ローカルの単独利用)では従来どおり使える。UI のしきい値ラボは別チャンクで、使えない人には読み込まれない。 |
| `VRQA_API_KEY` | (なし) | キャプチャエージェント(Python / Unity)が `X-API-Key` に付けるキー。 |
| `VITE_API_BASE`(フロントのビルド時) | `http://localhost:8000` | UIが呼ぶAPIのURL |
| `VRQA_ALERT_SINK` | `noop` | 下記「アラートsinkの設定」 |

### 本番相当で動かす手順

デプロイ先の設定(Dockerfile等)はこのリポジトリに含めていない。どこに置く場合も次の形になる。

```bash
# 1. API: 永続ディスクにDBとBLOBを置いて起動(UIの配信元オリジンを必ず指定)
cd backend
uv sync
VRQA_DB_PATH=/data/vrqa.sqlite3 VRQA_BLOB_ROOT=/data/blobs \
VRQA_CORS_ORIGINS=https://qa.example.com \
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

# 2. UI: APIのURLをビルド時に埋め込み、dist/ を任意の静的ホスティングに置く
cd frontend
npm ci
VITE_API_BASE=https://api.example.com npm run build   # -> frontend/dist
```

- APIは1プロセスで動かす前提(接続はリクエストごと・書き込みの直列化はプロセス内ロック)。複数プロセス/複数台に増やすなら、先にSQLiteを別のDBへ移すこと。
- `/data` はコンテナ再作成で消えない場所にする(DBとBLOBは同じボリューム)。
- `/api/health` が疎通確認用。
- 認証は付いていない。インターネットに公開する場合は、前段のリバースプロキシ等でアクセス制限を掛けること。

## 認証と役割

既定は**認証なし**(`VRQA_AUTH=off`。Host / Origin のガードだけが効く)。複数人で使うときは `VRQA_AUTH=required` にする。

| 役割 | できること |
|---|---|
| `viewer` | 見る(ダッシュボード・差分・画像) |
| `operator` | viewer + 撮影のアップロード・指示の作成・差分の実行 |
| `admin` | operator + **Reference(基準画像)への昇格**・撮影の削除 |

```bash
cd backend
uv run python -m app.auth add --name alice --role admin     # API キーは 1 度だけ表示される
uv run python -m app.auth add --name bob --role viewer --email bob@example.com --no-key   # Cloudflare Access だけで使う人
uv run python -m app.auth list
uv run python -m app.auth remove --name alice               # そのキーはすぐ使えなくなる
VRQA_AUTH=required uv run uvicorn app.main:app
```

- **API クライアント**(Unity・CI・curl): `X-API-Key: <キー>`(または `Authorization: Bearer <キー>`)を付ける。エージェントは環境変数 `VRQA_API_KEY`。
- **ブラウザ UI**: 最初にログイン画面が出る。API キーを入れると HttpOnly・SameSite=Strict のクッキーになる(画像の `<img>` はヘッダーを付けられないため)。UI を別オリジンで開くなら、`VRQA_CORS_ORIGINS` にその origin を入れる(資格情報つきの CORS は、明示した origin にだけ許可される)。
- **Cloudflare Access**: `VRQA_CF_ACCESS_TEAM_DOMAIN`・`VRQA_CF_ACCESS_AUD` を設定すると、`Cf-Access-Jwt-Assertion` の JWT を検証する(RS256 だけ・署名/発行者/宛先/期限を必須)。**ユーザーは自動作成しない**: 上の `--email` で登録していない人は 403。
- 権限の判断は**常にサーバー側**(UI の表示ではない)。足りなければ 403 と、必要な役割が画面に出る。
- 認証なし(`/api/health`・`/api/auth/me`・`/api/auth/login`)以外の全 API が、`required` では viewer 以上を要求する。
- **画面の出し分け**: 役割に足りない操作(アップロード・差分実行・撮影指示の作成=operator)は、ボタンが無効になり、必要な権限が表示される。**表示だけで、権限の判断は常にサーバー**。
- **管理画面の分離(2026-11-11)**: 基準画像への昇格と撮影画像の削除(admin)は、差分ビューア(`index.html`)ではなく、**別エントリー・別バンドルの `admin.html`**(`src/admin/`・`src/adminApi.ts`)に移した。差分ビューアのコードには、昇格・削除の API 呼び出しも操作の部品も入っていない(`backend/tests/test_admin_split_frontend.py` で確認)。admin 以外が `/admin.html` を開くと案内だけが出る。**UI は静的配信なので、バンドルの配布を絞るのではなく、昇格・削除の API をサーバーが admin に限る(403)ことで守っている**。
- **監査ログ**(`VRQA_AUDIT_LOG`・JSON Lines): **変更系(POST・PUT・PATCH・DELETE)**と、**拒否(401・403)**、ログイン・ログアウトを、時刻・名前・役割・方式・メソッド・パス・結果・IP で残す。**本文・API キー・クッキー・クエリ文字列は記録しない**。読み取りと `/api/health` は記録しない。admin だけ `GET /api/auth/audit?limit=100`(新しい順)で読める。認証が `off` でも、変更は匿名として記録される。

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
│   └── tests/                # pytest 97件
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
