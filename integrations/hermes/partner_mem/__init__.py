"""Partner-Mem Hermes MemoryProvider plugin entrypoint."""

from __future__ import annotations

from typing import Any

from .provider import PartnerMemMemoryProvider

__all__ = ["PartnerMemMemoryProvider", "register"]


def register(ctx: Any) -> None:
    """Register the standalone MemoryProvider with Hermes."""

    ctx.register_memory_provider(PartnerMemMemoryProvider())
