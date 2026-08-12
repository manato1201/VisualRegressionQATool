"""Content-addressed BLOB storage.

Phase 2 requires ``imagePath`` to normalize to
``blobs/{checksum[0:2]}/{checksum}.png`` and to skip re-writing the BLOB body
when the checksum already exists (dedupe on unchanged frames).
"""

from __future__ import annotations

import hashlib
from pathlib import Path

DEFAULT_BLOB_ROOT = Path(__file__).resolve().parent.parent / "data" / "blobs"


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def blob_relative_path(checksum: str, ext: str = "png") -> str:
    return f"blobs/{checksum[0:2]}/{checksum}.{ext}"


class BlobStore:
    """Checksum-keyed dedupe store. Returns whether a write actually occurred."""

    def __init__(self, root: Path | str = DEFAULT_BLOB_ROOT) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _abs_path(self, checksum: str, ext: str) -> Path:
        return self.root.parent / blob_relative_path(checksum, ext)

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

    def read(self, relative_path: str) -> bytes:
        return (self.root.parent / relative_path).read_bytes()

    def abs_path_for(self, relative_path: str) -> Path:
        return self.root.parent / relative_path

    def delete(self, relative_path: str) -> None:
        path = self.abs_path_for(relative_path)
        path.unlink(missing_ok=True)
