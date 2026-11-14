# 第 1 回 ピクセル比較エンジン(PixelDiffEngine)

> 所要時間の目安: 3 時間 / 前提: 第 0 回・NumPy の配列の基本

## この回のゴール

- 厳密なピクセル比較を、**NumPy の配列演算**で書けることを説明できる。
- 3 つのつまみ(`per_pixel_tolerance`・`max_diff_pixels`・`min_diff_region_pixels`)が、**それぞれ何を吸収するのか**を説明できる。
- **連結成分**(`scipy.ndimage.label`)で、孤立したノイズを除く仕組みが分かる。
- サイズ違いを、**黙って許さず**、明示の指定がある時だけ中央を切って扱う理由を説明できる。

## 1. 比較の本体

```python
# 引用: backend/app/diff_engine.py::PixelDiffEngine._compare_images
def _compare_images(
    self,
    captured: Image.Image,
    reference: Image.Image,
    per_pixel_tolerance: int,
    max_diff_pixels: int,
    min_diff_region_pixels: int,
    allow_center_crop: bool,
) -> DiffResult:
    resolution_note: str | None = None
    if captured.size != reference.size:
        if not allow_center_crop:
            raise ImageDimensionMismatchError(
                f"captured size {captured.size} != reference size {reference.size}"
            )
        captured, reference, resolution_note = self._center_crop_to_common_size(captured, reference)

    cap_arr = np.asarray(captured, dtype=np.int16)
    ref_arr = np.asarray(reference, dtype=np.int16)

    channel_diff = np.abs(cap_arr - ref_arr)
    diff_mask = np.any(channel_diff > per_pixel_tolerance, axis=2)

    if min_diff_region_pixels > 1 and diff_mask.any():
        diff_mask = self._drop_small_regions(diff_mask, min_diff_region_pixels)

    diff_pixel_count = int(np.count_nonzero(diff_mask))
    total_pixels = diff_mask.size
    diff_percentage = (diff_pixel_count / total_pixels * 100.0) if total_pixels else 0.0
    verdict = "pass" if diff_pixel_count <= max_diff_pixels else "fail"

    diff_image = self._render_highlight(cap_arr.astype(np.uint8), diff_mask)

    return DiffResult(
        diff_pixel_count=diff_pixel_count,
        diff_percentage=diff_percentage,
        verdict=verdict,
        diff_image=diff_image,
        width=captured.width,
        height=captured.height,
        resolution_note=resolution_note,
    )
```

順に読みます。

1. **サイズが違えば**、`allow_center_crop` がない限り**エラー**(`ImageDimensionMismatchError`)。サイズが違う画像は、そもそも**比べられない**。
2. **`np.int16` に変換**してから引く: 画像は `uint8`(0〜255)で、そのまま引くと `3 - 5` が **254 に巻き戻る**(オーバーフロー)。符号つきの型で引いて、`np.abs` で絶対値にする。
3. **`np.any(channel_diff > tolerance, axis=2)`**: R・G・B の**どれか 1 つでも**許容誤差を超えたピクセルが「違う」。結果は、高さ × 幅の真偽値の配列(**差分マスク**)。
4. 小さな領域を除く(下)。
5. 違うピクセルの数を数え、`max_diff_pixels` 以下なら **pass**、超えたら **fail**。
6. 差分画像を作る(違うピクセルは**マゼンタ**、他は暗くした元画像)。

> **マゼンタ(255, 0, 255)で塗る理由**: 赤は「不合格」の色(バッジ・アラート)として使っているので、差分のピクセルを**判定の色と間違えない**ように、別の色にしている。

## 2. 3 つのつまみ

厳密な比較は、現実の画像に**厳しすぎる**ことがあります。「賢い評価」に頼らず、**3 つの単純なつまみ**で調整します。

| つまみ | 吸収するもの | しくみ |
|---|---|---|
| `per_pixel_tolerance` | 各色の**小さな濃淡のゆれ**(JPEG の再量子化など) | 差が**この値を超えたとき**だけ「違う」(その値ちょうどは、同じ) |
| `min_diff_region_pixels` | **孤立した 1 ピクセル**のノイズ | 違うピクセルが**つながった塊**が、この数に満たなければ捨てる |
| `max_diff_pixels` | **少数の違い**の許容 | 違うピクセル数が、この数**以下**なら pass |

どれも、**「ここまでは同じとみなす」という明示の線**です(知覚的な類似度ではない)。

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


engine = PixelDiffEngine()
reference = np.full((10, 10, 3), 100, dtype=np.uint8)

# 5 ピクセルが、緑チャンネルだけ +3 ずれた(圧縮ノイズのような小さなゆれ)
noisy = reference.copy()
for x in range(5):
    noisy[0, x, 1] += 3

for tolerance in (0, 2, 3):
    r = engine.compare_bytes(png(noisy), png(reference), per_pixel_tolerance=tolerance)
    print(f"許容誤差 {tolerance}: 差分 {r.diff_pixel_count:2d}px → {r.verdict}")

# 同じ 5 ピクセルでも、許容する個数(max_diff_pixels)で判定が変わる
for allowed in (4, 5):
    r = engine.compare_bytes(png(noisy), png(reference), max_diff_pixels=allowed)
    print(f"max_diff_pixels={allowed}: 差分 {r.diff_pixel_count}px → {r.verdict}")
```

```text
# 出力
許容誤差 0: 差分  5px → fail
許容誤差 2: 差分  5px → fail
許容誤差 3: 差分  0px → pass
max_diff_pixels=4: 差分 5px → fail
max_diff_pixels=5: 差分 5px → pass
```

注目: 許容誤差 **3** で差分が 0 になる。差が **3** のとき、`3 > 3` は偽(「**超えたとき**だけ違う**」)。境界の扱いが、はっきり決まっている。

## 3. 孤立したノイズを除く(連結成分)

画像の中に、**あちこちに散らばった 1 ピクセル**の違いがあるとします。圧縮のノイズかもしれません。一方、**まとまった塊**の違い(物が動いた・色が変わった)は、本物の変化です。

違いを「**つながった塊**」ごとに数え、小さな塊を捨てます。

```python
# 引用: backend/app/diff_engine.py::PixelDiffEngine._drop_small_regions
@staticmethod
def _drop_small_regions(diff_mask: np.ndarray, min_diff_region_pixels: int) -> np.ndarray:
    """Zero out connected diff blobs smaller than ``min_diff_region_pixels``.

    Still an exact per-pixel diff underneath — this only decides whether a
    cluster of already-different pixels is large enough to report,
    filtering scattered single-pixel compression noise.
    """
    labeled, num_labels = ndimage.label(diff_mask, structure=_CONNECTIVITY_8)
    if num_labels == 0:
        return diff_mask
    region_sizes = np.bincount(labeled.ravel())
    keep = region_sizes >= min_diff_region_pixels
    keep[0] = False  # background label
    return keep[labeled]
```

- `ndimage.label(mask, structure=ones((3,3)))`: つながったピクセルに、**同じ番号(ラベル)**を付ける。`structure` が 3 × 3 全部 `True` = **8 近傍**(縦横**と斜め**もつながる)。
- `np.bincount(labeled.ravel())`: 各ラベルの**ピクセル数**を一度に数える(ラベル 0 = 背景)。
- `keep[labeled]`: 「塊の大きさが閾値以上か」の表を、**画像全体に引き直す**(NumPy のファンシーインデックス)。ループなしで、全ピクセルを一度に判定できる。
- `keep[0] = False`: 背景(違わないピクセル)は、残さない。

> これは**類似度の計算ではなく**、「すでに違うと決まったピクセルが、つながっているか」を見るだけです。厳密な差分の上に乗った、**つながりの検査**。

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


engine = PixelDiffEngine()
reference = np.zeros((20, 20, 3), dtype=np.uint8)
captured = reference.copy()
captured[1, 1] = 255                 # 孤立した 1 ピクセル
captured[10:13, 10:13] = 255         # 3 x 3 = 9 ピクセルの塊(本物の変化)

for min_region in (1, 2, 9, 10):
    r = engine.compare_bytes(png(captured), png(reference), min_diff_region_pixels=min_region)
    print(f"min_diff_region_pixels={min_region:2d}: 差分 {r.diff_pixel_count:2d}px → {r.verdict}")

# 斜めにつながるのも 1 つの塊(8 近傍)
diagonal = reference.copy()
for i in range(4):
    diagonal[i, i] = 255
r = engine.compare_bytes(png(diagonal), png(reference), min_diff_region_pixels=4)
print("斜めの 4 ピクセル(min=4):", r.diff_pixel_count, "px →", r.verdict)
```

```text
# 出力
min_diff_region_pixels= 1: 差分 10px → fail
min_diff_region_pixels= 2: 差分  9px → fail
min_diff_region_pixels= 9: 差分  9px → fail
min_diff_region_pixels=10: 差分  0px → pass
斜めの 4 ピクセル(min=4): 4 px → fail
```

## 4. サイズ違いは、黙って許さない

解像度が違う画像は、**比べられません**。窓が数ピクセル縮んだだけでも、比べるなら**どちらかを切る**必要があります。これを黙ってやると、**縁の本物の変化を捨てて**いるのに、気づけません。

- 既定: **エラー**(`ImageDimensionMismatchError`)。
- `allow_center_crop=True` と**明示したときだけ**、両方を**共通の最小サイズに、中央で**切って比べる。
- そのとき、**何を切ったか**を `resolution_note` に必ず残す(監査できる)。

```python
# 実行できる
import io

import numpy as np
from PIL import Image

from app.diff_engine import ImageDimensionMismatchError, PixelDiffEngine


def png(array) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format="PNG")
    return buffer.getvalue()


engine = PixelDiffEngine()
big = np.full((12, 12, 3), 50, dtype=np.uint8)
small = np.full((10, 10, 3), 50, dtype=np.uint8)

try:
    engine.compare_bytes(png(big), png(small))
except ImageDimensionMismatchError as exc:
    print("既定:", exc)

r = engine.compare_bytes(png(big), png(small), allow_center_crop=True)
print("許可した場合:", r.verdict, f"{r.width}x{r.height}")
print("記録:", r.resolution_note)
```

```text
# 出力
既定: captured size (12, 12) != reference size (10, 10)
許可した場合: pass 10x10
記録: resolution mismatch tolerated: captured 12x12 / reference 10x10 -> center-cropped to 10x10
```

## 5. 差分画像

違うピクセルは**マゼンタ**で塗られ、残りは**元画像を 35% の明るさに落とした**もの(`BACKGROUND_DIM_FACTOR = 0.35`)です。違いが、目で見つけやすくなります。

```python
# 実行できる
import io

import numpy as np
from PIL import Image

from app.diff_engine import HIGHLIGHT_COLOR, PixelDiffEngine


def png(array) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format="PNG")
    return buffer.getvalue()


reference = np.full((4, 4, 3), 200, dtype=np.uint8)
captured = reference.copy()
captured[1, 2] = (10, 20, 30)

diff = PixelDiffEngine().compare_bytes(png(captured), png(reference)).diff_image
print("違うピクセル:", diff.getpixel((2, 1)), "= マゼンタ?", diff.getpixel((2, 1)) == HIGHLIGHT_COLOR)
print("同じピクセル:", diff.getpixel((0, 0)), "(200 の 35% = 70)")
```

```text
# 出力
違うピクセル: (255, 0, 255) = マゼンタ? True
同じピクセル: (70, 70, 70) (200 の 35% = 70)
```

## 確認問題

1. 画像を `np.int16` に変換してから引くのは、なぜですか。
2. `per_pixel_tolerance=3` で、差がちょうど 3 のピクセルは、同じ?違う?
3. 画面の隅に、離れた 1 ピクセルの違いが 100 個散らばっています。`min_diff_region_pixels=4` にすると、どうなりますか。
4. 8 近傍と 4 近傍の違いは。このツールが 8 近傍なのは、なぜ自然ですか。
5. 解像度が違うとき、既定でエラーにするのは、なぜですか。

## 解答

1. `uint8` のまま引くと、`3 - 5` が **254 に巻き戻る**(オーバーフロー)。符号つきの型で引けば、`-2` になり、絶対値が取れる。
2. **同じ**。「許容誤差を**超えたとき**だけ違う」(`>`)。
3. 100 個の孤立した点は、どれも塊の大きさが 1 で 4 に満たないので、**すべて捨てられ**、差分は 0(pass)。
4. 4 近傍は上下左右だけ、8 近傍は**斜めも**つながりとみなす。斜めの線(アンチエイリアスされた斜線の差)は、**つながった 1 つの変化**として見るほうが自然。
5. 切ると**縁の本物の変化を黙って捨てる**ことになるから。比べられない画像は、「比べられない」と伝える。許すときは、明示して、記録を残す。

## まとめ

- 比較は **int16 に直して引き、いずれかの色が許容誤差を超えたピクセル**を数えるだけ。差分マスクと数・割合が、そのまま説明になる。
- 3 つのつまみは、**明示の線**(ゆれ・孤立ノイズ・少数の違い)。知覚的な類似度は使わない。
- 連結成分は `label` + `bincount` + ファンシーインデックスで、**ループなし**。
- サイズ違いは**エラーが既定**。許すときは、明示して `resolution_note` に残す。
- 次の回は、画像と結果を**保存する**層(コンテンツアドレスの保存・DB のチェーン)。
