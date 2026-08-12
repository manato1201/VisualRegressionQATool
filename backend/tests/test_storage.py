from __future__ import annotations

from app.storage import BlobStore, blob_relative_path, sha256_of


def test_put_writes_once_and_dedupes_on_second_write(blob_store: BlobStore):
    data = b"pretend-png-bytes"
    checksum1, path1, written1 = blob_store.put(data)
    checksum2, path2, written2 = blob_store.put(data)

    assert checksum1 == checksum2 == sha256_of(data)
    assert path1 == path2 == blob_relative_path(checksum1)
    assert written1 is True
    assert written2 is False, (
        "unchanged content must not be re-written to the BLOB store"
    )


def test_different_content_yields_different_paths(blob_store: BlobStore):
    _, path_a, _ = blob_store.put(b"frame-a")
    _, path_b, _ = blob_store.put(b"frame-b")
    assert path_a != path_b


def test_read_roundtrip(blob_store: BlobStore):
    data = b"roundtrip-bytes"
    _checksum, path, _written = blob_store.put(data)
    assert blob_store.read(path) == data
