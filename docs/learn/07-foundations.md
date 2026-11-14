# 7. 基礎の補強(言語・設計思想・アルゴリズム・用語)

講義と学習資料の**前提になっている知識**を、ここで補います。「Python・NumPy・SQL の基本」を、**このツールのコードで実際に使われている形**で、動かして確かめます。

## 1. 言語の基礎: VRQA で使う Python

### 1.1 NumPy の配列: 画像は「数の表」

画像は、**縦 × 横 × 3(赤・緑・青)の数の表**です。NumPy は、表全体を**ループなしで一度に**計算します(ベクトル化)。1 画素ずつ Python のループで回すより、**桁違いに速い**。

```python
# 実行できる
import numpy as np

a = np.array([[[10, 20, 30], [200, 200, 200]]], dtype=np.uint8)    # 1 × 2 画素の画像
b = np.array([[[10, 25, 30], [200, 200, 200]]], dtype=np.uint8)
print("形(縦, 横, 色):", a.shape)

wrong = np.abs(a - b)                                  # uint8 のまま引くと、負の数が 250 などに「回り込む」
right = np.abs(a.astype(np.int16) - b.astype(np.int16))
print("uint8 のまま:", wrong.tolist())
print("int16 にして:", right.tolist())
```

```text
# 出力
形(縦, 横, 色): (1, 2, 3)
uint8 のまま: [[[0, 251, 0], [0, 0, 0]]]
int16 にして: [[[0, 5, 0], [0, 0, 0]]]
```

- **`uint8`(0〜255)のまま引き算すると、負の数が回り込んで、正しい差にならない**。だから `diff_engine.py` は、`dtype=np.int16` に**変換してから**引く。**型の範囲を意識する**ことが、画像処理の基本。

### 1.2 比較と集計: マスクと `any`

「差があるか」を、**真偽の表(マスク)**にして、数えます。`np.any(..., axis=2)` は、**3 つの色のどれか 1 つでも**条件を満たすか。

```python
# 実行できる
import numpy as np

cap = np.array([[[10, 20, 30], [200, 200, 200], [0, 0, 0]]], dtype=np.int16)
ref = np.array([[[10, 22, 30], [200, 200, 200], [9, 0, 0]]], dtype=np.int16)

diff = np.abs(cap - ref)
for tolerance in (0, 2, 10):
    mask = np.any(diff > tolerance, axis=2)            # 色のどれかが、許容を超えたら「違う画素」
    count = int(np.count_nonzero(mask))
    percent = count / mask.size * 100
    print(f"許容 {tolerance:2d}: 違う画素 {count} / {mask.size}  ({percent:.1f}%)", mask.tolist())
```

```text
# 出力
許容  0: 違う画素 2 / 3  (66.7%) [[True, False, True]]
許容  2: 違う画素 1 / 3  (33.3%) [[False, False, True]]
許容 10: 違う画素 0 / 3  (0.0%) [[False, False, False]]
```

- **許容(`per_pixel_tolerance`)を上げると、小さな差が見逃される**(圧縮のノイズは無視できるが、本物の小さな回帰も隠れる)。**厳密に(0)比べるか、許すか**は、設計の判断(→ 2)。

### 1.3 `@dataclass`・例外・型ヒント

`DiffResult` は、**結果を持つだけ**のクラス(`@dataclass`)。`ImageDimensionMismatchError(ValueError)` は、**自分で作る例外**で、「解像度が違う」という**意味のある失敗**を、呼び出し側が区別できる。型ヒント(`str | None`)は、「文字列か、無いこと」。

```python
# 実行できる
from dataclasses import dataclass


@dataclass
class Result:
    count: int
    verdict: str                  # "pass" | "fail"
    note: str | None = None       # 無いかもしれない値


class SizeMismatchError(ValueError):
    """比べられない(大きさが違う)。許容で隠してはいけない失敗。"""


def compare(size_a, size_b, count, max_diff=0):
    if size_a != size_b:
        raise SizeMismatchError(f"{size_a} != {size_b}")      # 黙って進めず、止める
    return Result(count, "pass" if count <= max_diff else "fail")


print(compare((4, 4), (4, 4), 0))
print(compare((4, 4), (4, 4), 3))
try:
    compare((4, 4), (8, 8), 0)
except SizeMismatchError as error:
    print("比べられない:", error)
```

```text
# 出力
Result(count=0, verdict='pass', note=None)
Result(count=3, verdict='fail', note=None)
比べられない: (4, 4) != (8, 8)
```

### 1.4 SQL の基本(`sqlite3`)

SQL は、**表(テーブル)に、条件で問い合わせる言語**。Python の標準ライブラリ `sqlite3` で、**ファイル 1 つの DB** を扱える。**値は `?` で渡す**(文字列を連結して SQL を作らない。SQL インジェクションを防ぐ)。

```python
# 実行できる
import sqlite3

conn = sqlite3.connect(":memory:")                      # メモリ上の DB(例用)
conn.row_factory = sqlite3.Row                          # 列を名前で読める
conn.execute("CREATE TABLE runs (id INTEGER PRIMARY KEY, build TEXT, verdict TEXT)")
conn.executemany("INSERT INTO runs (build, verdict) VALUES (?, ?)", [("b1", "pass"), ("b1", "fail"), ("b2", "pass"), ("b2", "pass")])

rows = conn.execute("SELECT build, COUNT(*) AS n, SUM(verdict = 'fail') AS fails FROM runs GROUP BY build ORDER BY build").fetchall()
for row in rows:
    print(row["build"], "実行", row["n"], "失敗", row["fails"])

user_input = "b1' OR '1'='1"                            # 悪意のある入力
print("? で渡すと、ただの文字列:", conn.execute("SELECT COUNT(*) FROM runs WHERE build = ?", (user_input,)).fetchone()[0])
```

```text
# 出力
b1 実行 2 失敗 1
b2 実行 2 失敗 0
? で渡すと、ただの文字列: 0
```

## 2. 設計思想

| 原則 | 意味 | VRQA のどこに出るか | 破るとどうなるか |
|---|---|---|---|
| **厳密に比べる(知覚的な評価をしない)** | 画素の差を**数えるだけ**。「だいたい同じに見える」は判断しない | `PixelDiffEngine`(SSIM などは使わない) | 人の感覚に寄せた曖昧さで、本物の回帰が隠れる |
| **比べられないものは、比べない** | 解像度が違えば**例外**にする(許容で隠さない) | `ImageDimensionMismatchError`・`allow_center_crop` を**明示したときだけ**切り抜く | 不一致が、黙って「合格」になる |
| **許容は引数で明示する** | しきい値を、暗黙の既定に隠さない | `per_pixel_tolerance`・`max_diff_pixels`・`min_diff_region_pixels` | 「なぜ合格か」が説明できない |
| **内容で保存する(コンテンツアドレス)** | 内容のハッシュ(SHA-256)で名前を付け、**同じ内容は 1 つ** | `storage.py` | 同じ画像が増え続ける・壊れても気づかない |
| **鍵は、ハッシュだけを保存** | 元の鍵を残さない | `auth.py`・`test_only_the_hash_is_stored` | DB が漏れると、鍵がそのまま漏れる |
| **決定性** | 同じ条件で撮れば、同じ画素 | 撮影の決定性・連続性(第 4 回) | 差の原因が、本物の変更か揺れか分からない |
| **flaky を別に扱う** | 同じ版で結果が割れたら、「不安定」と判定する | `reconcile_flaky_verdicts` | 失敗が、本当の回帰か揺れか区別できない |

## 3. 関数・アルゴリズム

| 名前 | 場所 | 何をする | 計算量・注意 |
|---|---|---|---|
| **画素差のマスク** | `diff_engine.py` | `abs(撮影 − 基準) > 許容` を、色のどれかで判定 | O(画素数)。ベクトル化 |
| **小さな領域の除去** | `_drop_small_regions` | **連結成分**(つながった違い画素のまとまり)に分け、`min_diff_region_pixels` 未満を捨てる | O(画素数)。8 近傍(斜めもつながる) |
| **中央の切り抜き** | `_center_crop_to_common_size` | 2 枚の共通の大きさに、**中央**を合わせて切る | O(画素数)。切った事実を `resolution_note` に残す |
| **SHA-256** | `storage.py`・`auth.py` | 任意の長さのデータを、固定長の**一方向**の値にする | O(データ長)。衝突は事実上ない |
| **flaky の調停** | `repository.py` | 同じ build の判定が割れたら、「不安定」にそろえる | 件数に比例 |

```python
# 実行できる
import numpy as np
from scipy import ndimage

mask = np.array(
    [
        [1, 1, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 0],
        [0, 0, 0, 1, 1, 0],
        [0, 0, 0, 1, 1, 0],
    ],
    dtype=bool,
)
eight = np.ones((3, 3), dtype=bool)                      # 8 近傍(斜めもつながる)
labels, count = ndimage.label(mask, structure=eight)
sizes = ndimage.sum(mask, labels, index=range(1, count + 1))
print("まとまりの数:", count, " それぞれの大きさ:", [int(s) for s in sizes])

min_region = 3
keep = np.isin(labels, [i + 1 for i, s in enumerate(sizes) if s >= min_region])
print("大きさ 3 未満を捨てる:", int(np.count_nonzero(keep)), "画素が残る")
```

```text
# 出力
まとまりの数: 3  それぞれの大きさ: [3, 1, 4]
大きさ 3 未満を捨てる: 7 画素が残る
```

- **1 画素だけの違い(ノイズ)を、回帰として報告しない**ための工夫。`min_diff_region_pixels` を上げるほど静かになるが、**本物の小さな回帰も隠れる**。

## 4. IT・エンタメの用語の補強

| 用語 | 意味 | VRQA での出番 |
|---|---|---|
| **ビジュアル回帰テスト** | 画面の**見た目**が変わっていないかを、画像の比較で確かめる | 全体 |
| **基準画像(ベースライン / リファレンス)** | 正しいと決めた画像 | 比較の相手 |
| **ピクセル / RGB** | 画素 / 赤・緑・青の 3 つの値(各 0〜255) | `diff_engine.py` |
| **ゲームの「フレーム」/ レンダリング** | 1 コマの絵 / 3D を画像にすること | 撮影対象 |
| **決定性(deterministic)** | 同じ入力で、同じ結果 | 撮影の決定性 |
| **フレームレート非依存・乱数のシード** | 時間の進みや乱数が結果を揺らさないようにする工夫 | 揺れ(flaky)の原因を減らす |
| **flaky** | 同じ条件でも、成功と失敗が混ざる | 判定の調停 |
| **二分探索による原因の特定(bisect)** | 「どの変更で壊れたか」を、半分ずつ絞る | 最初に壊れた版(first-bad-commit) |
| **CI(継続的インテグレーション)** | 変更のたびに、自動でテストを回す | 連携先 |
| **FastAPI / REST API** | Python の Web フレームワーク / URL と HTTP で操作を呼ぶ形 | `routers/` |
| **コンテンツアドレス** | 内容のハッシュを名前にする保存 | `storage.py` |
| **SQL インジェクション** | 入力が SQL として実行されてしまう攻撃 | `?` で値を渡す |

## 確認問題

1. `uint8` の画像を、そのまま引き算してはいけないのは、なぜですか。
2. 解像度が違う 2 枚を、**例外にする**のは、なぜですか。
3. `min_diff_region_pixels` を上げると、何が良くなり、何が悪くなりますか。
4. SQL に値を渡すとき、`?` を使うのは、なぜですか。

## 解答

1. `uint8` は 0〜255 しか持てず、負の数が回り込んで、正しい差にならないから(`int16` に変換してから引く)。
2. 比べられないものを、許容で隠して「合格」にしないため。比べたいときは `allow_center_crop` を明示する。
3. 1 画素のようなノイズを回帰として報告しなくなるが、本物の小さな回帰も隠れる。
4. 入力が SQL の一部として実行される攻撃(SQL インジェクション)を防ぐため。値は、SQL とは別に渡される。
