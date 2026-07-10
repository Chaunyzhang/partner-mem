"""Verified Hermes host version boundary for the standalone adapter."""

from __future__ import annotations

from typing import Any


SUPPORTED_HERMES_VERSION = "0.18.2"


def read_hermes_version() -> str:
    import hermes_cli

    return _read_string(getattr(hermes_cli, "__version__", ""))


def require_supported_hermes_version(version: str | None = None) -> str:
    actual = _read_string(version) if version is not None else read_hermes_version()
    if actual != SUPPORTED_HERMES_VERSION:
        raise RuntimeError(
            f"Partner-Mem requires Hermes Agent v{SUPPORTED_HERMES_VERSION}; "
            f"found {actual or 'unknown'}"
        )
    return actual


def _read_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""
