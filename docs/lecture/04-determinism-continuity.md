# 第 4 回 撮影の決定性と、連続フレームの異常検出

> 所要時間の目安: 3 時間 / 前提: 第 0〜3 回

## この回のゴール

- 撮影が**決定的**かを、どう**検収**するか(N 回撮って、すべて同じか)を説明できる。
- **CaptureAgent**(撮影エンジンごとの差を吸収する共通の契約)の作りを説明できる。
- アニメーションの**フレーム間の変化量**から、**突出した 1 枚**を見つける統計(**中央値と MAD**)を説明できる。
- この検査が、**判定には使われず、候補を挙げるだけ**である理由を説明できる。

## 1. なぜ決定性の検査が要るのか

第 0 回のとおり、評価をシンプルにする代わりに、**撮影を決定的に**します。でも、「固定したつもり」で、実は揺れていることがあります(アニメーション・カーソルの点滅・スクロールのなめらかさ)。

**検収**は単純です: **同じ撮影を N 回行い、画像の指紋(SHA-256)がすべて同じか**を見る。1 つでも違えば、**撮影が決定的でない**。

```python
# 引用: capture_agents/capture_agents/determinism.py::check_determinism
def check_determinism(
    agent: CaptureAgent, source: CaptureSource, runs: int = 10
) -> DeterminismReport:
    """Capture ``source`` ``runs`` times (running ``prepare`` before each) and
    hash the encoded images.

    Equal hashes prove identical pixels. A mismatch means the pixels *or* the
    PNG encoding differ -- upload both to the backend and diff them to tell
    which (the backend canonicalises encoding before comparing)."""
    if runs < 2:
        raise ValueError("runs must be at least 2 to compare anything")
    checksums = []
    for _ in range(runs):
        agent.prepare(source)
        frame = agent.capture(source)
        checksums.append(hashlib.sha256(frame.data).hexdigest())
    return DeterminismReport(runs=runs, checksums=tuple(checksums))
```

- `agent.prepare(source)` を**毎回**呼ぶ: 撮影の前に、状態(カメラ・表示・時刻)を**固定し直す**。
- 画像の**エンコード済みバイト列のハッシュ**を比べる。同じなら、**ピクセルも同じ**(証明になる)。違っても、「ピクセルが違う」か「PNG の書き方だけが違う」かは、この検査では分からない(バックエンドが、エンコードをそろえてから比べるので、**アップロードして差分を取れば**切り分けられる)。
- `runs >= 2` が必須(1 回では、比べるものがない)。

## 2. CaptureAgent: エンジンごとの違いを、契約で包む

Unity・Houdini・ブラウザなど、撮影するエンジンは違っても、**やることは同じ**:

```python
# 引用: capture_agents/capture_agents/base.py::CaptureAgent
class CaptureAgent(ABC):
    """Implemented once per engine (Houdini here; Unity in C#, same contract)."""

    engine: ClassVar[str]

    @abstractmethod
    def prepare(self, source: CaptureSource) -> None:
        """Freeze whatever needs to be deterministic before capture (camera
        pose, display flags, cook state). Corresponds to Phase 1
        (DeterminismController / JitterOverride) in the design doc."""

    @abstractmethod
    def capture(self, source: CaptureSource) -> RawFrame:
        """Grab pixels for ``source`` and return them already PNG-encoded.
        Must not destructively mutate scene/network state."""
```

- **`ABC` と `@abstractmethod`**: 「このメソッドを**必ず**実装せよ」という約束。実装しないと、インスタンスを作れない。
- 2 段階: **`prepare`**(固定する)と **`capture`**(撮る)。固定を撮影から**分ける**ことで、決定性の検査が `prepare` を毎回やり直せる。
- **サーバーは変えない**: 撮影した画像は、**既存の HTTP API**(アップロード・差分実行)に送るだけ。エンジンが増えても、サーバー側の変更は要らない。

指示に保存された**決定性の条件**(`seed`・`fixed_time_seconds`・`reduce_motion`)は、`apply_instruction_conditions` が、`CaptureSource.extra` に**まとめて**入れます(各エージェントは、ここだけ見ればよい)。すでに `extra` にある値が**優先**される(1 回だけ上書きしたいときのため)。

```python
# 実行できる
import io

import numpy as np
from PIL import Image

from capture_agents.base import CaptureAgent
from capture_agents.determinism import apply_instruction_conditions, check_determinism
from capture_agents.models import CaptureSource, RawFrame


def png(array) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format="PNG")
    return buffer.getvalue()


class FixedAgent(CaptureAgent):
    """毎回まったく同じ画像を返す(決定的な撮影)。"""

    engine = "houdini"

    def prepare(self, source):
        pass

    def capture(self, source):
        return RawFrame(data=png(np.full((4, 4, 3), 90, dtype=np.uint8)), width=4, height=4)


class DriftingAgent(CaptureAgent):
    """撮るたびに、1 ピクセルずつ変わる(固定できていない撮影)。"""

    engine = "houdini"

    def __init__(self):
        self.count = 0

    def prepare(self, source):
        pass

    def capture(self, source):
        image = np.full((4, 4, 3), 90, dtype=np.uint8)
        image[0, self.count % 4] = 255
        self.count += 1
        return RawFrame(data=png(image), width=4, height=4)


source = CaptureSource(kind="view", source_id="MainCamera", engine="houdini")
for agent in (FixedAgent(), DriftingAgent()):
    report = check_determinism(agent, source, runs=10)
    print(f"{type(agent).__name__:13} identical={report.identical}  種類={report.distinct_checksums}  違った回={report.mismatched_runs}")

merged = apply_instruction_conditions(
    CaptureSource(kind="view", source_id="MainCamera", engine="unity", extra={"seed": 99}),
    {"seed": 1, "fixed_time_seconds": 0.0, "reduce_motion": True, "jitter": 0.5},
)
print("条件の取り込み:", dict(sorted(merged.extra.items())))
```

```text
# 出力
FixedAgent    identical=True  種類=1  違った回=()
DriftingAgent identical=False  種類=4  違った回=(1, 2, 3, 5, 6, 7, 9)
条件の取り込み: {'fixed_time_seconds': 0.0, 'reduce_motion': True, 'seed': 99}
```

注目: `extra` に先にあった `seed=99` が、指示の `seed=1` に**勝つ**。`jitter` は決定性の条件の 3 つに含まれないので、取り込まれない。

## 3. 連続フレームの異常検出(continuity)

アニメーションを、**決まった時刻**で何枚も撮ったとします。**隣り合うフレーム**の変化は、ふつう**なめらか**です。ところが、1 枚だけ**突然おかしな画像**(一瞬のちらつき・テクスチャ抜け)が混じることがあります。実際に、**612 枚のうち 1 枚で 95,245 ピクセルが変わった**ことが、この検査を作ったきっかけです。

**考え方**: 隣り合う**ペアごとの変化ピクセル数**の並びを作り、**突出したペア**だけを報告する。

「突出」の基準は、**固定のピクセル数ではなく、並びそのものから**決めます(動きの大きいアニメでは、普段から変化が大きいため)。

```python
# 引用: backend/app/continuity.py::find_outliers
def find_outliers(
    pair_diffs: list[int],
    total_pixels: int,
    *,
    k: float = 6.0,
    min_jump_percent: float = 0.1,
) -> tuple[float, float, float, tuple[int, ...]]:
    """Return (median, mad, threshold, outlier_indices) for a series of
    adjacent-pair change counts. A pair is an outlier only when it exceeds
    both the statistical threshold and the absolute floor."""
    if not pair_diffs:
        return 0.0, 0.0, 0.0, ()
    med = float(median(pair_diffs))
    mad = float(median(abs(d - med) for d in pair_diffs))
    statistical = med + k * _MAD_TO_SIGMA * mad
    floor = med + total_pixels * (min_jump_percent / 100.0)
    threshold = max(statistical, floor)
    outliers = tuple(i for i, d in enumerate(pair_diffs) if d > threshold)
    return med, mad, threshold, outliers
```

- **中央値**(`med`): 並びの「普通の大きさ」。外れ値に**引っ張られにくい**(平均と違い、1 つの巨大な値で動かない)。
- **MAD**(中央絶対偏差): 各値の、中央値からの**ずれの、中央値**。ばらつきの尺度で、これも外れ値に強い。
- **`1.4826 × MAD`**: 正規分布なら**標準偏差と同じ尺度**になる換算係数。
- **しきい値 = 中央値 + k × 1.4826 × MAD**(`k = 6`)。これを超えたものが、統計的に「突出」。
- **床(フロア)**: `min_jump_percent`(既定 0.1%)。ほとんど動かない並び(MAD ≈ 0)だと、しきい値が中央値にほぼ等しくなり、**数ピクセルのノイズも「突出」**になる。床で、**全ピクセルの 0.1% 以上**の跳ねだけを候補にする。
- しきい値は、**統計と床の大きいほう**(`max`)。両方を満たしたものだけが外れ値。

```python
# 実行できる
from app.continuity import find_outliers

total_pixels = 1_000_000

smooth = [100, 120, 95, 110, 105, 98, 115, 102]
glitch = [100, 120, 95, 95_245, 105, 98, 115, 102]       # 1 つだけ巨大
scene_cut = [100, 120, 95, 110, 105, 98, 115, 102]
nearly_static = [0, 0, 0, 5, 0, 0, 0, 0]                  # ほぼ動かない中に 5 ピクセル

for label, series in [("なめらか", smooth), ("1 枚だけ異常", glitch), ("ほぼ静止+ノイズ", nearly_static)]:
    med, mad, threshold, outliers = find_outliers(series, total_pixels)
    print(f"{label:12} 中央値={med:7.1f} MAD={mad:5.1f} しきい値={threshold:9.1f} 外れ値の番号={outliers}")
```

```text
# 出力
なめらか         中央値=  103.5 MAD=  6.0 しきい値=   1103.5 外れ値の番号=()
1 枚だけ異常      中央値=  103.5 MAD=  7.0 しきい値=   1103.5 外れ値の番号=(3,)
ほぼ静止+ノイズ     中央値=    0.0 MAD=  0.0 しきい値=   1000.0 外れ値の番号=()
```

- 「なめらか」: 外れ値なし。(この例では、統計のしきい値は約 157 で、**床の 1000 のほうが大きい**ので、しきい値は床で決まっている。「統計と床の**大きいほう**」の意味。)
- 「1 枚だけ異常」: **番号 3 のペア**(フレーム 3 → 4 の間)だけが、しきい値を大きく超える。
- 「ほぼ静止+ノイズ」: 統計だけなら 5 ピクセルが「突出」するが、**床**(100 万 × 0.1% = 1000 ピクセル)で止まる。

### 実際のフレームで(`analyze_frames`)

```python
# 実行できる
import io

import numpy as np
from PIL import Image

from app.continuity import ContinuityInputError, analyze_frames


def frame(shift: int, glitch: bool = False) -> bytes:
    array = np.zeros((40, 40, 3), dtype=np.uint8)
    array[:, shift:shift + 2] = 200                       # 縦の線が、1 コマごとに右へ動く
    if glitch:
        array[:, :] = 255                                  # 全面が真っ白になる異常なフレーム
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format="PNG")
    return buffer.getvalue()


frames = [frame(i) for i in range(6)] + [frame(6, glitch=True)] + [frame(7 + i) for i in range(5)]
result = analyze_frames(frames, min_jump_percent=1.0)
print("ペア数:", len(result.pair_diffs), "/ 外れ値のペア:", result.outlier_indices)

try:
    analyze_frames(frames[:2])
except ContinuityInputError as exc:
    print("2 枚だけ:", str(exc)[:30], "…")
```

```text
# 出力
ペア数: 11 / 外れ値のペア: (5, 6)
2 枚だけ: at least 3 frames are needed:  …
```

異常なフレーム(番号 6)の**前後 2 つのペア**(5→6 と 6→7)が、外れ値になります。突出したのは「1 枚」ですが、**隣り合うペアでは 2 か所**に現れる。報告された番号から、**どのフレームか**を読み取る必要があります。

`analyze_frames` は、フレームを**1 枚ずつ**読み、**直前の 1 枚だけ**をメモリに持ちます(長いアニメーションでも、全部をメモリに載せない)。

### 判定には使わない

この検査は、**合格・不合格には関わりません**。理由:

- **意図した場面転換(カット)**も、突出して見える。バグとは言えない。
- 報告するのは「**人が見る候補**」だけ。「バグだ」とは言わない。
- 別の検査として分けることで、**既存の判定の信頼性を、巻き込まない**。

(UI の「しきい値ラボ」と同じく、デバッグ向けの機能で、本番では既定で無効。`VRQA_DEBUG` で有効にしても **admin だけ**。)

## 確認問題

1. 決定性の検収で、画像そのものでなく、ハッシュを比べるのは、なぜですか。
2. `CaptureAgent` が `prepare` と `capture` の 2 段階なのは、なぜですか。
3. しきい値に、平均でなく**中央値**を使うのは、なぜですか。
4. `min_jump_percent`(床)が無いと、何が起きますか。
5. この検査の結果を、合格・不合格の判定に使わないのは、なぜですか。

## 解答

1. ハッシュは**短く**、**同じ中身なら必ず同じ**(違えば、どこか違う)。バイト列を全部保持して比べるより、軽く、確実。
2. 固定(`prepare`)を撮影(`capture`)から分けると、決定性の検査が**毎回固定し直して**撮れる。固定が不十分なら、撮るたびに違いが出て、検出できる。
3. 平均は、**1 つの巨大な値(異常なフレーム)に引っ張られて**、しきい値が上がり、その異常を見逃す。中央値は引っ張られない。
4. ほとんど動かない並び(MAD ≈ 0)では、しきい値が中央値とほぼ同じになり、**数ピクセルのノイズ**も外れ値として報告される。
5. **意図した場面転換**も突出するため、バグと断定できない。候補を挙げるだけにして、既存の判定の信頼性を保つ。

## まとめ

- 決定性は、**N 回撮って指紋がすべて同じ**かで検収する。
- `CaptureAgent` は `prepare`(固定)+ `capture`(撮影)の**契約**。サーバーは変えずに、エンジンを足せる。
- 連続性は、ペアごとの変化数の並びから、**中央値 + k × 1.4826 × MAD**を超え、かつ**床**を超えるものを候補にする。判定には使わない。
- 次の回(最終回)は、テストと総合演習。
