from __future__ import annotations

import pytest

from app.config import DEFAULT_CORS_ORIGINS, cors_origins_from_env


def test_defaults_to_the_local_dev_origins_when_unset_or_blank():
    assert cors_origins_from_env({}) == list(DEFAULT_CORS_ORIGINS)
    assert cors_origins_from_env({"VRQA_CORS_ORIGINS": "  ,  "}) == list(
        DEFAULT_CORS_ORIGINS
    )


def test_reads_a_comma_separated_list_and_trims_whitespace_and_trailing_slashes():
    env = {"VRQA_CORS_ORIGINS": " https://qa.example.com/ ,https://staging.example.com"}
    assert (
        cors_origins_from_env(env)
        == [
            "https://qa.example.com",  # a trailing slash would never match the browser's Origin
            "https://staging.example.com",
        ]
    )


def test_a_wildcard_is_refused():
    with pytest.raises(ValueError, match="explicit origins"):
        cors_origins_from_env({"VRQA_CORS_ORIGINS": "https://a.example.com,*"})
