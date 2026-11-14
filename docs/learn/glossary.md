# 用語集

| 用語 | 意味 |
|---|---|
| **ビジュアル回帰** | 基準の画像と、いまの画像を機械で比べ、見た目の意図しない変化を見つけること |
| **決定的(deterministic)** | 同じ入力から、毎回まったく同じ結果になること。撮影では、時計・乱数・動きを固定して、画像が揺れないようにする |
| **CaptureInstruction** | 撮影の指示(シーン・カメラ・シード・固定する時刻) |
| **CapturedImage** | 撮れた画像 1 枚(`build_version` つき) |
| **ReferenceImage(基準画像)** | 人が「これが正しい」と**承認(昇格)**した撮影画像。指示ごとに、有効なのは 1 つ |
| **昇格(promote)** | 撮影画像を基準にすること(admin の操作) |
| **DiffImage** | 撮影画像と基準の差を表す画像。違うピクセルはマゼンタ |
| **EvaluationResult** | 判定: `pass`・`fail`・`flaky` |
| **flaky(不安定)** | 同じ版で pass と fail が混在すること。撮影が決定的でない証拠 |
| **build_version** | 撮影したビルドの版。first-bad-commit の単位 |
| **first-bad-commit** | 同じ指示の履歴で、最初に fail した版(「いつから」。「なぜ」ではない) |
| **PixelDiffEngine** | 厳密なピクセル比較(SSIM などは使わない) |
| **per_pixel_tolerance** | 各色の差が、これを**超えたとき**だけ「違う」とみなす許容誤差 |
| **max_diff_pixels** | 違うピクセル数が、これ**以下**なら pass |
| **min_diff_region_pixels** | 違うピクセルの**つながった塊**が、これに満たなければ捨てる(孤立ノイズの除去) |
| **連結成分(connected component)** | つながったピクセルの塊。`scipy.ndimage.label` で番号を付ける |
| **8 近傍** | 上下左右に加えて、斜めもつながっているとみなす |
| **中央を切る(center crop)** | 解像度が違う 2 枚を、共通の最小サイズに、中央で切る。`allow_center_crop` で明示したときだけ。`resolution_note` に記録 |
| **コンテンツアドレス** | 中身のハッシュ(SHA-256)を名前にして保存する方式。同じ中身は書かない |
| **BLOB** | 画像のバイト列(ファイル)。DB でなく、ファイルに置く |
| **dedup_hit** | アップロードした画像が、すでに保存済みだった |
| **外部キー(FK)** | 別の表の行を指す列。このツールでは、鎖の FK は `NOT NULL` |
| **マイグレーション** | 既存の DB に、後から列などを足すこと。ここでは `ALTER TABLE ... ADD COLUMN` を試すだけ |
| **IAlertSink** | 通知先の約束(`notify_failure`・`notify_recovery`)。`Protocol` |
| **external_ref** | 通知先が返す参照(Issue 番号など)。復旧のときに、同じものを閉じる |
| **alert_issue** | いま open な通知の記録。fail で 1 回だけ開き、pass で閉じる |
| **check-then-act / 競合状態** | 「調べてから行動する」間に、他が割り込むと、結果が狂うこと。ロックで一続きにする |
| **CaptureAgent** | 撮影エンジン(Unity・Houdini など)ごとの差を包む契約。`prepare` + `capture` |
| **連続性(continuity)** | 隣り合うフレームの変化量が、突出していないかの検査。判定には使わない |
| **MAD(中央絶対偏差)** | 各値の、中央値からのずれの、中央値。外れ値に強いばらつきの尺度 |
| **しきい値ラボ(preview)** | 許容誤差を動かして、判定がどう変わるかを**何も保存せず**に試す機能 |
| **viewer / operator / admin** | 見る / 撮影・差分の実行 / 昇格・削除。順位で比べる |
| **CSRF・DNS rebinding** | 別のサイトから、ブラウザ経由でローカルの API を操作・読み取りする攻撃。Origin の検査と Host の許可リストで守る |
| **fail-closed** | 設定が壊れたとき、閉じる(起動しない・拒否する) |
