"""Environment-driven settings that must differ between a dev machine and a
real deployment."""

from __future__ import annotations

import os
from collections.abc import Mapping

DEFAULT_CORS_ORIGINS: tuple[str, ...] = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)


def cors_origins_from_env(env: Mapping[str, str] | None = None) -> list[str]:
    """Origins the browser UI may call the API from.

    ``VRQA_CORS_ORIGINS`` is a comma-separated list (e.g.
    ``https://qa.example.com,https://staging.example.com``). Unset or blank
    keeps the local dev origins. A wildcard is rejected on purpose: the image
    endpoints are read with ``crossorigin`` for pixel sampling, and "*" would
    also open them to any site; a deployment should name its UI origin.
    """
    raw = (os.environ if env is None else env).get("VRQA_CORS_ORIGINS", "")
    origins = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    if not origins:
        return list(DEFAULT_CORS_ORIGINS)
    if "*" in origins:
        raise ValueError(
            "VRQA_CORS_ORIGINS must list explicit origins, not '*' "
            "(e.g. https://qa.example.com)"
        )
    return origins
