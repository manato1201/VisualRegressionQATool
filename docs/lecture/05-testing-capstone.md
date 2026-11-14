# 第 5 回 テストと総合演習

> 所要時間の目安: 半日 / 前提: 第 0〜4 回

## この回のゴール

- バックエンドのテストの**置き方**(何を・どう確かめるか)が分かる。
- 画像を使うテストを、**小さな合成画像**で、速く・決定的に書ける。
- 比較エンジンに、**自分で機能を足して**、効果を確かめられる(除外領域)。

## 1. 今あるテスト

```bash
cd backend
uv run pytest -q          # バックエンドの全部(文書の検査を含む)
cd ../capture_agents
uv sync --dev && uv run pytest -q
```

| ファイル | 確かめるもの |
|---|---|
| `test_diff_engine.py` | 比較エンジン(つまみ・連結成分・サイズ違い・差分画像) |
| `test_storage.py`・`test_repository.py`・`test_db_migrations.py` | 画像置き場の重複排除・DB の鎖・基準の昇格・列の追加 |
| `test_queries.py`・`test_dashboard.py` | first-bad-commit・一覧の並び |
| `test_alert_sink.py` | 通知先(Webhook・GitHub の重複防止・複合) |
| `test_api_integration.py`・`test_diff_batch.py`・`test_diff_preview.py` | API を通した全体の流れ・一括実行・プレビュー |
| `test_continuity.py` | フレーム間の異常検出 |
| `test_security.py`・`test_auth.py`・`test_audit.py`・`test_debug_gate.py` | Host・Origin・役割・監査・デバッグ機能の門 |
| `test_admin_split_frontend.py` | 差分ビューアのコードに、昇格・削除の呼び出しが入っていないこと |
| `test_docs.py` | この文書(引用・実行例・リンク・図) |

## 2. 画像を使うテストの型

- **本物のスクリーンショットを使わない**: NumPy で、**数ピクセルの合成画像**を作る(速い・小さい・**何が違うか**がコードに書いてある)。
- **期待値が、手で数えられる**大きさにする(「3 × 3 の塊 = 9」)。
- **性質を書く**: 「同じ画像なら、必ず差分 0」「許容誤差を上げれば、差分は**増えない**(単調)」。
- DB は**一時ファイル**(`tmp_path`)に。**外部の通知(GitHub・Webhook)は偽物**に(`httpx` の `MockTransport` など)。

## 3. 総合演習: 「無視する領域」を足す

**課題**: 画面の一部(時計・広告・FPS 表示)は、**毎回変わる**ので、比較から**除きたい**。長方形の**除外領域**を渡すと、そこを両方の画像で同じ色に塗りつぶしてから比べる関数 `compare_with_mask` を作ります(エンジン本体には**手を入れず**、前処理で)。

```python
# 実行できる
import io

import numpy as np
from PIL import Image

from app.diff_engine import PixelDiffEngine


def png(array) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format="PNG")
    return buffer.getvalue()


def load(data: bytes) -> np.ndarray:
    return np.array(Image.open(io.BytesIO(data)).convert("RGB"))


def compare_with_mask(captured: bytes, reference: bytes, ignore_rects, **options):
    """ignore_rects: [(x, y, 幅, 高さ), ...]。ここは、両方を同じ色(黒)に塗ってから比べる。"""
    cap, ref = load(captured), load(reference)
    for x, y, w, h in ignore_rects:
        cap[y:y + h, x:x + w] = 0
        ref[y:y + h, x:x + w] = 0
    return PixelDiffEngine().compare_bytes(png(cap), png(ref), **options)


reference = np.full((20, 20, 3), 80, dtype=np.uint8)
captured = reference.copy()
captured[0:2, 14:18] = (255, 255, 255)        # 右上の時計が、毎回変わる(2 x 4 = 8 ピクセル)
captured[10, 3] = (0, 0, 0)                    # 本物の変化が、1 ピクセル

print("除外なし      :", compare_with_mask(png(captured), png(reference), []).diff_pixel_count, "px")
print("時計を除外    :", compare_with_mask(png(captured), png(reference), [(14, 0, 4, 2)]).diff_pixel_count, "px")
print("広すぎる除外  :", compare_with_mask(png(captured), png(reference), [(0, 0, 20, 20)]).diff_pixel_count, "px ← 本物の変化も消える")
```

```text
# 出力
除外なし      : 9 px
時計を除外    : 1 px
広すぎる除外  : 0 px ← 本物の変化も消える
```

**気をつけること**(設計の議論):

- **除外は、「見ない」領域を増やす**: 広く取りすぎると、**本物の退行を見逃す**(3 つ目の例)。除外した領域は、**結果に記録**し、レビューできるようにするべき(サイズ違いの `resolution_note` と同じ考え方)。
- どこで除外を**持つ**か: 撮影指示(シーンごとの固定の除外)が自然。DB に列を足す(マイグレーション)・画面から指定・`diff_image` に**そのとき使った除外**を保存、が必要。
- 本物に入れるなら: ①エンジンに引数を足す(既定は「除外なし」= 今と同じ)②API・DB ③テスト ④**評価**(除外が、見逃しを増やしていないか)。

### 自分で拡張する課題

1. `compare_with_mask` が、範囲外の長方形(`x + w > 20`)を渡されたとき、どうなるか確かめる。黙って切られる?エラーにすべきか?
2. first-bad-commit を「**最後の pass より後の、最初の fail**」に変える SQL を書く(第 3 回の限界)。
3. 連続性の検査に、`per_pixel_tolerance` を渡して、JPEG のようなゆれのあるフレームで試す。

## 確認問題

1. 画像のテストで、本物のスクリーンショットを使わないのは、なぜですか。
2. 「許容誤差を上げても、差分は増えない」は、どんなテストですか。
3. 除外領域を広く取りすぎると、何が起きますか。
4. 除外領域の機能は、エンジン本体の変更と、前処理の追加の、どちらで作るのが安全ですか。

## 解答

1. 大きくて遅く、**何が違うか**がコードに現れず、環境で変わりやすい。合成画像なら、期待値を手で数えられる。
2. **性質**のテスト(単調性)。具体的な数ではなく、**どの設定でも成り立つ関係**を確かめるので、実装が変わっても壊れにくい。
3. その領域の**本物の退行を見逃す**。除外を使うほど、検査が**甘くなる**。
4. **前処理**(エンジンの外)が安全。既存の判定を壊さず、使うときだけ効く。本物にするなら、既定が「除外なし」の引数としてエンジンに足し、テストと評価で確かめる。

## まとめ

- テストは**小さな合成画像**で、速く・決定的に。性質を書く。外部は偽物に。
- 新しい機能は、**前処理や引数の追加**で、既定の挙動を変えずに足し、**評価**してから採用する。
- 除外のような「見ない」機能は、**見逃しを増やす**ので、記録とレビューの仕組みが要る。
- ここから先は、[学習資料](../learn/index.md)(保守・拡張の実務編)へ。
