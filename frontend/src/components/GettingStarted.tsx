const STEPS = [
  {
    title: "1. 撮影指示(Capture Instruction)を作成",
    body: "左のパネルでシーンID(例: OutdoorsScene)を入力して「撮影指示を作成」。同じシーン・カメラ位置を継続比較する単位になります。",
  },
  {
    title: "2. 撮影画像(Captured Image)をアップロード",
    body: "build version(git shaやビルド番号など)と画像ファイルを指定してアップロードします。同一内容の画像はchecksumで重複排除され、BLOBは1つだけ保存されます。",
  },
  {
    title: "3. 最初の1枚をReferenceに昇格",
    body: "「見た目が正しい」と確認できた撮影画像を「Referenceに昇格」します。以降の撮影画像はこのReferenceとピクセル単位で比較されます。Reference未昇格の画像は差分比較の基準として使われません。",
  },
  {
    title: "4. 差分実行",
    body: "2枚目以降の撮影画像で「差分実行」を押すと、Referenceとの厳密なピクセル差分比較が走ります。差分ハイライト画像と評価結果(Pass/Fail)が生成されます。",
  },
  {
    title: "5. 結果を確認",
    body: "実行履歴テーブルの行をクリックするとDiff Viewerでサイドバイサイド/オーバーレイ表示を切り替えて確認できます。Failが発生すると「First Bad Commit」として最初に壊れたbuild versionが表示されます。",
  },
];

export function GettingStarted() {
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-xl)" }}>
      <div>
        <p className="eyebrow">Getting Started</p>
        <h2 style={{ fontSize: 24, marginTop: 4 }}>はじめに</h2>
        <p className="text-body-mid" style={{ marginTop: "var(--spacing-sm)" }}>
          このツールは、撮影画像を基準画像(Reference)と厳密なピクセル単位で比較し、意図しない見た目の変化(ビジュアル回帰)を検知するためのQAツールです。
          「賢い」知覚的差分は使わず、まず再現性のある撮影を前提にシンプルなピクセル比較のみで判定します。
        </p>
      </div>

      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--spacing-lg)" }}>
        {STEPS.map((step) => (
          <li key={step.title} className="card-outline" style={{ padding: "var(--spacing-lg)" }}>
            <h3 style={{ fontSize: 18, marginBottom: "var(--spacing-xs)" }}>{step.title}</h3>
            <p style={{ margin: 0 }} className="text-body-mid">
              {step.body}
            </p>
          </li>
        ))}
      </ol>

      <div className="card-outline" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-sm)" }}>
        <h3 style={{ fontSize: 18 }}>PASS / FAILの意味</h3>
        <p style={{ margin: 0 }}>
          <span className="badge-pill badge-pass" style={{ marginRight: "var(--spacing-sm)" }}>
            Pass
          </span>
          差分ピクセル数が許容範囲(<code>max_diff_pixels</code>)以内で、Referenceと見た目が一致しているとみなされた状態です。
        </p>
        <p style={{ margin: 0 }}>
          <span className="badge-pill badge-fail" style={{ marginRight: "var(--spacing-sm)" }}>
            Fail
          </span>
          差分ピクセル数が許容範囲を超えた状態です。意図しない見た目の変化(回帰)が起きた可能性があるので、Diff
          Viewerで実際の差分を確認してください。
        </p>
        <p style={{ margin: 0 }} className="text-mute">
          ※撮影画像とReference画像の解像度が異なる場合は比較自体ができず、エラーになります(サイズを揃えてください)。
        </p>
      </div>

      <div className="card-outline" style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-sm)" }}>
        <h3 style={{ fontSize: 18 }}>思ったより差分が多く出るとき</h3>
        <p style={{ margin: 0 }} className="text-body-mid">
          Unityの決定的なレンダリング撮影同士の比較なら初期設定(許容誤差0)のままで問題ありませんが、JPEG等で再圧縮された画像同士を比較すると、見た目は同じでも圧縮ノイズにより画面のほとんどが差分として検出されることがあります。
          「撮影画像」パネル内の「差分の詳細設定」で<strong>許容誤差</strong>(微小な色ズレを無視)や<strong>最小差分領域サイズ</strong>
          (孤立したノイズ画素を無視し、まとまった本物の変化だけを検出)を調整すると改善します。
        </p>
      </div>
    </section>
  );
}
