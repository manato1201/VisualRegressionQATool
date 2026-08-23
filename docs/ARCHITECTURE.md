# アーキテクチャ図

[README.md](../README.md) / [TECHNICAL_GUIDE.md](TECHNICAL_GUIDE.md) と合わせて参照。GitHub上ではMermaidブロックがそのまま図として描画される。

配色は役割ごとに固定している: 🟦 フロントエンド(インディゴ) / 🟩 バックエンドAPI(エメラルド) / 🟧 コアロジック(アンバー) / 🔵 ストレージ(スカイ) / 🟥 外部連携(ローズ、破線)。

## 1. システム構成

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#eef2ff', 'primaryBorderColor': '#6366f1', 'primaryTextColor': '#312e81', 'lineColor': '#94a3b8', 'fontFamily': 'Inter, sans-serif' }}}%%
flowchart LR
    subgraph Frontend["React 19 + Vite (frontend/)"]
        UI[App.tsx<br/>状態管理]
        IP[InstructionPanel]
        CP[CapturePanel<br/>+ DiffSettings]
        RH[RunHistory]
        DV[DiffViewer]
        GS[GettingStarted]
    end

    subgraph Backend["FastAPI (backend/app/)"]
        R1[instructions router]
        R2[captures router]
        R3[references router]
        R4[diffs router<br/>run / run-batch]
        R5[runs router]
        Engine[PixelDiffEngine<br/>diff_engine.py]
        Repo[repository.py]
        Queries[queries.py<br/>first-bad-commit]
        Alert[IAlertSink<br/>alert_sink.py]
    end

    DB[(SQLite<br/>db.py)]
    Blob[(Content-addressed<br/>BlobStore)]
    GH[GitHub Issues API]
    WH[Webhook endpoint]

    UI --> IP & CP & RH & DV & GS
    IP --> R1
    CP --> R2 & R3 & R4
    RH --> R5
    DV --> R2 & R3 & R4

    R2 --> Blob
    R4 --> Engine
    R4 --> Blob
    R1 & R2 & R3 & R4 --> Repo
    R5 --> Queries
    Repo --> DB
    Queries --> DB
    R4 --> Alert
    Alert -.-> GH
    Alert -.-> WH

    classDef frontend fill:#eef2ff,stroke:#6366f1,stroke-width:1.5px,color:#312e81;
    classDef router fill:#ecfdf5,stroke:#10b981,stroke-width:1.5px,color:#065f46;
    classDef core fill:#fffbeb,stroke:#f59e0b,stroke-width:1.5px,color:#78350f;
    classDef storage fill:#f0f9ff,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e;
    classDef external fill:#fff1f2,stroke:#e11d48,stroke-width:1.5px,color:#881337,stroke-dasharray: 3 3;

    class UI,IP,CP,RH,DV,GS frontend;
    class R1,R2,R3,R4,R5 router;
    class Engine,Repo,Queries,Alert core;
    class DB,Blob storage;
    class GH,WH external;

    style Frontend fill:#f5f7ff,stroke:#c7d2fe,stroke-width:1px;
    style Backend fill:#f0fdf9,stroke:#a7f3d0,stroke-width:1px;
```

## 2. データモデル(ER図)

Phase 4設計の「CaptureInstruction → CapturedImage → DiffImage → EvaluationResult」の一直線チェーンに、Phase 3の`ReferenceStore`昇格ワークフロー用テーブル(`REFERENCE_IMAGE`)とPhase 5のアラート追跡用テーブル(`ALERT_ISSUE`)を追加したもの。外部キーは全てNOT NULL(チェーンを曖昧にしない、というPhase 0のアンチパターン回避方針を反映)。

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#f0f9ff', 'primaryBorderColor': '#0284c7', 'primaryTextColor': '#0c4a6e', 'lineColor': '#94a3b8', 'fontFamily': 'Inter, sans-serif' }}}%%
erDiagram
    CAPTURE_INSTRUCTION ||--o{ CAPTURED_IMAGE : "撮影する"
    CAPTURED_IMAGE ||--o{ REFERENCE_IMAGE : "承認されると昇格"
    CAPTURE_INSTRUCTION ||--o{ REFERENCE_IMAGE : "紐づく"
    CAPTURED_IMAGE ||--o{ DIFF_IMAGE : "captured側として比較"
    REFERENCE_IMAGE ||--o{ DIFF_IMAGE : "reference側として比較"
    DIFF_IMAGE ||--|| EVALUATION_RESULT : "評価される"
    CAPTURE_INSTRUCTION ||--o{ ALERT_ISSUE : "追跡"
    EVALUATION_RESULT ||--o{ ALERT_ISSUE : "fail時に発報"

    CAPTURE_INSTRUCTION {
        text instruction_id PK
        text scene_or_level_id
        text camera_pose_json
        int frame_rate
        int seed
        real jitter
        int warmup_frames
        text created_at
    }
    CAPTURED_IMAGE {
        text captured_image_id PK
        text instruction_id FK
        text build_version
        text captured_at
        text checksum "SHA-256, dedupeキー"
        text image_path "blobs/{cs[0:2]}/{cs}.png"
        int resolution_width
        int resolution_height
        text color_space
    }
    REFERENCE_IMAGE {
        text reference_image_id PK
        text captured_image_id FK
        text instruction_id FK
        text approved_at
        text approved_by
        int is_active "instructionごとに1件のみ1"
    }
    DIFF_IMAGE {
        text diff_image_id PK
        text captured_image_id FK
        text reference_image_id FK
        text diff_image_path
        int diff_pixel_count
        real diff_percentage
        text created_at
    }
    EVALUATION_RESULT {
        text evaluation_result_id PK
        text diff_image_id FK
        text verdict "pass|fail|flaky"
        text evaluated_at
    }
    ALERT_ISSUE {
        text alert_issue_id PK
        text instruction_id FK
        text evaluation_result_id FK
        text sink_kind
        text external_ref
        text status "open|closed"
        text opened_at
        text closed_at
    }
```

## 3. 単発差分実行のシーケンス

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {
    'actorBkg': '#eef2ff', 'actorBorder': '#6366f1', 'actorTextColor': '#312e81', 'actorLineColor': '#c7d2fe',
    'signalColor': '#475569', 'signalTextColor': '#1e293b',
    'labelBoxBkgColor': '#ecfdf5', 'labelBoxBorderColor': '#10b981', 'labelTextColor': '#065f46',
    'noteBkgColor': '#fffbeb', 'noteBorderColor': '#f59e0b', 'noteTextColor': '#78350f',
    'activationBkgColor': '#f0f9ff', 'activationBorderColor': '#0284c7',
    'fontFamily': 'Inter, sans-serif'
}}}%%
sequenceDiagram
    actor User
    participant UI as React UI
    participant API as POST /api/diffs/run
    participant Engine as PixelDiffEngine
    participant Blob as BlobStore
    participant DB as SQLite
    participant Sink as IAlertSink

    User->>UI: 撮影画像カードの「差分実行」
    UI->>API: captured_image_id + diff設定(tolerance等)
    API->>DB: get_captured_image / get_active_reference_image
    API->>Blob: read(captured), read(reference)
    API->>Engine: compare_bytes(per_pixel_tolerance, max_diff_pixels, min_diff_region_pixels)
    Engine-->>API: DiffResult(diff_pixel_count, verdict, diff_image)
    API->>Blob: put(diff_image PNG)
    API->>DB: create_diff_image → create_evaluation_result
    alt verdict = fail
        API->>DB: find_open_alert_issue(instruction_id)
        alt 既存open issueあり
            API-->>API: 重複防止・何もしない
        else なし
            API->>Sink: notify_failure(ctx)
            Sink-->>API: external_ref
            API->>DB: create_alert_issue
        end
    else verdict = pass
        API->>DB: close_open_alert_issues(instruction_id)
        API->>Sink: notify_recovery(external_ref) ※closeされたissue分
    end
    API-->>UI: DiffRunResult
    UI-->>User: 実行履歴・DiffViewerを更新
```

## 4. 一括(バッチ)差分実行のシーケンス

1件の失敗が他の項目の処理を止めないことが要点。`/run`と`/run-batch`は`_execute_diff_run()`という共通ロジックを共有し、`/run-batch`側だけが`_DiffRunError`を握りつぶして結果配列に積む。

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {
    'actorBkg': '#eef2ff', 'actorBorder': '#6366f1', 'actorTextColor': '#312e81', 'actorLineColor': '#c7d2fe',
    'signalColor': '#475569', 'signalTextColor': '#1e293b',
    'labelBoxBkgColor': '#ecfdf5', 'labelBoxBorderColor': '#10b981', 'labelTextColor': '#065f46',
    'noteBkgColor': '#fffbeb', 'noteBorderColor': '#f59e0b', 'noteTextColor': '#78350f',
    'fontFamily': 'Inter, sans-serif'
}}}%%
sequenceDiagram
    actor User
    participant UI as React UI
    participant API as POST /api/diffs/run-batch
    participant Core as _execute_diff_run()

    User->>UI: 複数画像を選択→「まとめて差分実行」
    UI->>API: captured_image_ids[] + diff設定
    loop captured_image_ids の各要素
        API->>Core: 単発差分実行ロジック
        alt 成功
            Core-->>API: DiffRunResult
            API-->>API: results.push({ok: true, ...})
        else 失敗(解像度不一致・404等)
            Core-->>API: DiffRunError(status, detail)
            API-->>API: results.push({ok: false, error})
            Note over API: 例外を外に投げず次のitemへ継続
        end
    end
    API-->>UI: DiffBatchRunResponse{results[]}
    UI-->>User: "N件成功 / M件失敗"サマリーバナー
```

## 5. PixelDiffEngineの判定フロー

SSIM等の知覚的差分は採用せず、あくまで「厳密なピクセル差分＋任意の後処理フィルタ」に留める(Phase 0 / Phase 3の設計方針)。`min_diff_region_pixels`による連結成分フィルタは類似度スコアではなく、あくまで「差分ピクセルが何個繋がっているか」という幾何的な後処理であることに注意。分岐(紫)・処理(青)・エラー/Fail(赤)・Pass(緑)で色分け。

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#f0f9ff', 'primaryBorderColor': '#0284c7', 'primaryTextColor': '#0c4a6e', 'lineColor': '#94a3b8', 'fontFamily': 'Inter, sans-serif' }}}%%
flowchart TD
    A[captured / reference 画像バイト列] --> B{解像度が一致?}
    B -- No --> C[ImageDimensionMismatchError<br/>tolerance では誤魔化さない]
    B -- Yes --> D[各画素のRGBチャンネル絶対差を計算]
    D --> E{差 > per_pixel_tolerance ?}
    E -- No --> F[その画素はdiffなし]
    E -- Yes --> G[diff_maskに記録]
    F --> H
    G --> H{min_diff_region_pixels > 1 ?}
    H -- No --> I[diff_pixel_count を集計]
    H -- Yes --> J["scipy.ndimage.label で8連結ラベリング"]
    J --> K[サイズ未満の孤立した塊を除去]
    K --> I
    I --> L{diff_pixel_count <= max_diff_pixels ?}
    L -- Yes --> M[verdict = pass]
    L -- No --> N[verdict = fail]
    M & N --> O[ハイライト画像を生成して返す]

    classDef decision fill:#f5f3ff,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95;
    classDef process fill:#f0f9ff,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e;
    classDef errorNode fill:#fff1f2,stroke:#e11d48,stroke-width:1.5px,color:#881337;
    classDef passNode fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;
    classDef failNode fill:#fef2f2,stroke:#dc2626,stroke-width:2px,color:#7f1d1d;

    class B,E,H,L decision;
    class A,D,F,G,I,J,K,O process;
    class C errorNode;
    class M passNode;
    class N failNode;
```

## 6. アラートのライフサイクル(状態遷移)

`Research-Collector`の「失敗時ラベル付きIssue自動作成→復旧時自動クローズ」パターンを踏襲。openは赤(要対応)、no-open-alertは緑(健全)。

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#ecfdf5', 'primaryBorderColor': '#059669', 'primaryTextColor': '#065f46', 'lineColor': '#94a3b8', 'fontFamily': 'Inter, sans-serif' }}}%%
stateDiagram-v2
    [*] --> NoOpenAlert
    NoOpenAlert --> Open: verdict=fail かつ 既存openなし\n→ notify_failure()
    Open --> Open: verdict=fail かつ 既存openあり\n→ 重複防止、何もしない
    Open --> NoOpenAlert: verdict=pass\n→ notify_recovery() して close
    NoOpenAlert --> NoOpenAlert: verdict=pass（何もしない）

    classDef openState fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#7f1d1d;
    classDef noAlertState fill:#ecfdf5,stroke:#059669,stroke-width:1.5px,color:#065f46;

    class Open openState
    class NoOpenAlert noAlertState
```

## 7. CaptureAgent共通インターフェース(Unity/Houdini連携)

詳細は [CAPTURE_AGENT_DESIGN.md](CAPTURE_AGENT_DESIGN.md)。サーバー側API(`/api/captures` `/api/diffs/run`)は変更せず、各エンジン側に立つ薄いエージェントが同じHTTP契約を満たすことで、既存のPhase 3-5パイプラインにそのまま乗る。Unity(インディゴ)・Houdini(オレンジ)・共通バックエンド(エメラルド)で色分け。

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#eef2ff', 'primaryBorderColor': '#6366f1', 'primaryTextColor': '#312e81', 'lineColor': '#94a3b8', 'fontFamily': 'Inter, sans-serif' }}}%%
flowchart LR
    subgraph Unity["Unity (C#)"]
        UA[UnityCaptureAgent]
    end
    subgraph Houdini["Houdini (Python / hou)"]
        HA[HoudiniCaptureAgent]
    end

    UA -->|"prepare() → capture()"| UF[RawFrame]
    HA -->|"prepare() → capture()"| HF[RawFrame]

    UF --> BC1[BackendClient]
    HF --> BC2[BackendClient]

    BC1 --> API["POST /api/captures\nPOST /api/diffs/run"]
    BC2 --> API
    API --> Existing["既存バックエンド\n(変更なし)"]

    classDef unity fill:#eef2ff,stroke:#6366f1,stroke-width:1.5px,color:#312e81;
    classDef houdini fill:#fff7ed,stroke:#ea580c,stroke-width:1.5px,color:#7c2d12;
    classDef backend fill:#ecfdf5,stroke:#10b981,stroke-width:1.5px,color:#065f46;

    class UA,UF unity;
    class HA,HF houdini;
    class BC1,BC2,API,Existing backend;

    style Unity fill:#f5f7ff,stroke:#c7d2fe,stroke-width:1px;
    style Houdini fill:#fff7ed,stroke:#fed7aa,stroke-width:1px;
```
