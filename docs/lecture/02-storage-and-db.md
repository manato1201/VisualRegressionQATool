# 第 2 回 保存する: コンテンツアドレスの画像置き場と、DB のチェーン

> 所要時間の目安: 3 時間 / 前提: 第 0〜1 回・SQL の基本(`SELECT`・`JOIN`)

## この回のゴール

- **コンテンツアドレス**(中身のハッシュを名前にする)の保存が、なぜ**重複を自然に除ける**のかを説明できる。
- 5 つのテーブルが**鎖**になっていて、外部キーが**すべて `NOT NULL`** である理由を説明できる。
- 「**基準画像は、ちょうど 1 つだけ有効**」を保つしくみを説明できる。
- 古い DB に**後から列を足す**(マイグレーション)方法の割り切りを説明できる。

## 1. 画像の置き場: 中身のハッシュが名前

```python
# 引用: backend/app/storage.py::BlobStore.put
def put(self, data: bytes, ext: str = "png") -> tuple[str, str, bool]:
    """Store ``data`` if not already present.

    Returns (checksum, relative_image_path, was_newly_written).
    """
    checksum = sha256_of(data)
    abs_path = self._abs_path(checksum, ext)
    if abs_path.exists():
        return checksum, blob_relative_path(checksum, ext), False
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(data)
    return checksum, blob_relative_path(checksum, ext), True
```

- **SHA-256**(中身から計算する 64 文字の指紋)を、**ファイル名**にする。`blobs/ab/abcdef….png`(先頭 2 文字をフォルダにして、1 つのフォルダに大量のファイルが入るのを避ける)。
- **同じ中身なら、同じ名前**。2 回目に来たとき、すでにあれば、**書き込まずに** `was_newly_written=False` を返す。**変わっていないフレームを、何枚アップロードしても、ディスクは増えない**。
- 戻り値は `(checksum, 相対パス, 書いたか)`。API は、書かなかった場合を `dedup_hit` としてレスポンスに入れる。

```python
# 実行できる
import tempfile
from pathlib import Path

from app.storage import BlobStore

with tempfile.TemporaryDirectory() as tmp:
    store = BlobStore(Path(tmp) / "blobs")
    data = b"pretend this is a PNG"

    checksum, path, written = store.put(data)
    print("1 回目: 書いた?", written, "/ パスの形:", path.split("/")[0], len(path.split("/")[1]), path.endswith(".png"))

    checksum2, path2, written2 = store.put(data)
    print("2 回目: 書いた?", written2, "/ 同じ場所?", path2 == path and checksum2 == checksum)

    _, other_path, other_written = store.put(b"another image")
    print("別の中身: 書いた?", other_written, "/ 別の場所?", other_path != path)
    print("読み戻し:", store.read(path) == data)
    print("フォルダ名 = ハッシュの先頭 2 文字?", path.split("/")[1] == checksum[:2])
```

```text
# 出力
1 回目: 書いた? True / パスの形: blobs 2 True
2 回目: 書いた? False / 同じ場所? True
別の中身: 書いた? True / 別の場所? True
読み戻し: True
フォルダ名 = ハッシュの先頭 2 文字? True
```

> **差分画像も、同じ置き場**に入ります(`_execute_diff_run`)。同じ差分は、同じ名前になって、1 つにまとまる。

## 2. DB: 5 つのテーブルの鎖

```text
capture_instruction ← captured_image ← diff_image → reference_image
                           ↑                ↑
                           └────────────────┴── evaluation_result(diff_image へ)
alert_issue(instruction・evaluation_result へ)
```

| テーブル | 1 行が表すもの |
|---|---|
| `capture_instruction` | 撮影の指示(シーン・カメラ・シード・固定する時刻) |
| `captured_image` | 撮れた画像 1 枚(`build_version`・`checksum`・パス・解像度) |
| `reference_image` | **承認された**基準(`is_active` = いま有効か) |
| `diff_image` | 撮影画像と基準の差(差分の数・割合・**そのときのしきい値**) |
| `evaluation_result` | 判定(`pass` / `fail` / `flaky`) |
| `alert_issue` | 失敗の通知の記録(open / closed) |

**外部キーはすべて `NOT NULL`**(かつ `PRAGMA foreign_keys = ON` で強制)。「どの撮影画像と、どの基準を比べた結果か」が、**必ず**たどれます。`NULL` を許すと、**鎖が途切れた行**(基準のない差分など)ができて、履歴が曖昧になります。

**`diff_image` に、そのときのしきい値(`max_diff_pixels`・`per_pixel_tolerance`)を保存する**のも大事です。後でしきい値を変えても、**過去の判定が、当時の条件つきで読める**。

```python
# 実行できる
import sqlite3
import tempfile
from pathlib import Path

from app import db, models, repository

with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    with db.session(Path(tmp) / "vrqa.sqlite3") as conn:
        instruction = repository.create_capture_instruction(conn, models.CaptureInstructionCreate(scene_or_level_id="title"))
        cap = repository.create_captured_image(
            conn, instruction_id=instruction.instruction_id, build_version="v1", checksum="aa" * 32,
            image_path="blobs/aa/aa.png", width=8, height=8, color_space="sRGB",
        )
        print("外部キー(整合性の強制)が有効:", conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1)

        # 存在しない撮影画像を指す差分は、DB が拒否する
        try:
            repository.create_diff_image(
                conn, captured_image_id="no-such-id", reference_image_id="no-such-ref",
                diff_image_path="x", diff_pixel_count=0, diff_percentage=0.0,
            )
        except sqlite3.IntegrityError as exc:
            print("鎖が途切れる行は拒否:", type(exc).__name__)

        # 基準は、昇格のたびに「前の有効なものを無効にして」から新しいものを入れる
        first = repository.promote_reference_image(conn, captured_image_id=cap.captured_image_id,
                                                   instruction_id=instruction.instruction_id, approved_by="alice")
        second = repository.promote_reference_image(conn, captured_image_id=cap.captured_image_id,
                                                    instruction_id=instruction.instruction_id, approved_by="bob")
        rows = conn.execute("SELECT reference_image_id, is_active FROM reference_image ORDER BY approved_at").fetchall()
        print("基準の行数:", len(rows), "/ 有効なもの:", sum(r["is_active"] for r in rows))
        print("有効なのは最後に昇格した方?", rows[-1]["reference_image_id"] == second.reference_image_id and rows[0]["is_active"] == 0)
        print("取得される基準:", repository.get_active_reference_image(conn, instruction.instruction_id).approved_by)
```

```text
# 出力
外部キー(整合性の強制)が有効: True
鎖が途切れる行は拒否: IntegrityError
基準の行数: 2 / 有効なもの: 1
有効なのは最後に昇格した方? True
取得される基準: bob
```

### 昇格(承認)のしくみ

```python
# 引用: backend/app/repository.py::promote_reference_image
def promote_reference_image(
    conn: sqlite3.Connection,
    *,
    captured_image_id: str,
    instruction_id: str,
    approved_by: str,
) -> models.ReferenceImageOut:
    """Promote a CapturedImage to be the active ReferenceImage for its instruction.

    Deactivates any previously-active reference for the same instruction so
    exactly one active reference exists per instruction at a time.
    """
    reference_image_id = new_id()
    approved_at = _now()
    with db_write_lock:
        conn.execute(
            "UPDATE reference_image SET is_active = 0 WHERE instruction_id = ? AND is_active = 1",
            (instruction_id,),
        )
        conn.execute(
            """INSERT INTO reference_image
               (reference_image_id, captured_image_id, instruction_id, approved_at, approved_by, is_active)
               VALUES (?, ?, ?, ?, ?, 1)""",
            (reference_image_id, captured_image_id, instruction_id, approved_at, approved_by),
        )
        conn.commit()
    return get_reference_image(conn, reference_image_id)
```

- **まず**同じ指示の有効な基準を `is_active = 0` にし、**そのあと**新しい行を `is_active = 1` で入れる。**1 つの `with db_write_lock` の中**で行う(途中で、他のスレッドが割り込まない)。
- 古い基準を**消さない**(`is_active = 0` にするだけ)。**過去の差分が、どの基準と比べたか**を、あとからたどれるように。
- 昇格の前に、**承認する人**(`approved_by`)を記録する。基準を置き換える操作は、**admin だけ**に限られる(第 5 回・学習資料)。

## 3. あとから列を足す(マイグレーション)

`CREATE TABLE IF NOT EXISTS` は、**すでにあるテーブルには何もしません**。新しい版で列を足しても、古い DB には**列が増えない**。

`db.py` は、素朴な方法を取っています。**列ごとに `ALTER TABLE ... ADD COLUMN` を試し、すでにあるときのエラーは無視**する(`_COLUMN_MIGRATIONS`)。

- 利点: 単純。小さなツールには十分。
- 限界: **列の追加だけ**(型の変更・削除・データの変換はできない)。版の記録もない。**本格的な変更が要るときは、マイグレーションの仕組み(Alembic など)を入れる**。
- 追加する列は **`NULL` 可、または `DEFAULT` つき**にする(既存の行が埋められるように)。`diff_image.max_diff_pixels` は、古い行では `NULL`(「そのときの値は不明」)。

## 確認問題

1. ファイル名を中身のハッシュにすると、なぜ重複が自然に除けますか。
2. 外部キーを `NULL` 可にしない理由は。
3. 基準画像を、昇格のたびに**消さずに** `is_active = 0` にするのは、なぜですか。
4. `diff_image` に、そのときのしきい値を保存するのは、なぜですか。
5. この方式のマイグレーションでできないことを 2 つ挙げてください。

## 解答

1. 同じ中身は、同じハッシュ → 同じ名前になる。すでにあるか調べるだけで、**書かずに済む**(判定が、名前の比較だけ)。
2. `NULL` を許すと、基準のない差分などの**鎖が途切れた行**ができ、「何と何を比べた結果か」が曖昧になる。
3. **過去の差分が、どの基準と比べたか**を、あとからたどれるようにするため(履歴の保全)。
4. しきい値を変えても、**過去の判定が当時の条件つきで読める**ようにするため(「許容 N px」と一緒に表示できる)。
5. 列の**型の変更・削除**、データの変換、**版の管理**(どこまで適用したかの記録)。

## まとめ

- 画像は**中身のハッシュを名前**に保存し、同じ中身は書かない(重複排除)。
- 5 つのテーブルは**鎖**で、外部キーは `NOT NULL`。しきい値も一緒に保存し、履歴を条件つきで読めるようにする。
- 基準は**ちょうど 1 つが有効**。昇格は、無効化 → 追加を**ロックの中**で。古い基準は残す。
- マイグレーションは「列を足す」だけの割り切り。大きな変更には、専用の仕組みを。
- 次の回は、履歴の**問い合わせ**(最初に壊れた版)・**不安定(flaky)**の判定・**アラート**。
