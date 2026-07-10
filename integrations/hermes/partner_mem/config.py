"""Profile-scoped configuration for the Hermes adapter."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict

from .runtime_client import DEFAULT_RUNTIME_PATH


_CONFIG_FIELDS = {"node_path", "recall_limit"}


@dataclass(frozen=True)
class PartnerMemConfig:
    node_path: str
    recall_limit: int
    runtime_path: Path


def get_hermes_home() -> Path:
    try:
        from hermes_constants import get_hermes_home as hermes_home

        return Path(hermes_home())
    except ImportError:
        return Path(os.environ.get("HERMES_HOME", "~/.hermes")).expanduser()


def load_config(hermes_home: str | Path | None = None) -> PartnerMemConfig:
    home = Path(hermes_home).expanduser() if hermes_home else get_hermes_home()
    values: Dict[str, Any] = {}
    config_path = home / "partner_mem.json"
    if config_path.is_file():
        try:
            loaded = json.loads(config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError(
                f"Partner-Mem config must contain valid JSON: {config_path}"
            ) from error
        if not isinstance(loaded, dict):
            raise ValueError("Partner-Mem config must contain a JSON object")
        unexpected = sorted(set(loaded) - _CONFIG_FIELDS)
        if unexpected:
            raise ValueError(
                "Partner-Mem config contains unsupported fields: "
                + ", ".join(unexpected)
            )
        values = loaded

    if "node_path" in values:
        node_path = _read_string(values["node_path"])
        if not node_path:
            raise ValueError("Partner-Mem node_path must be a non-empty string")
    else:
        node_path = _read_string(os.environ.get("PARTNER_MEM_NODE")) or "node"
    recall_source = values.get(
        "recall_limit", os.environ.get("PARTNER_MEM_RECALL_LIMIT", 4)
    )
    return PartnerMemConfig(
        node_path=node_path,
        recall_limit=_require_recall_limit(recall_source),
        runtime_path=DEFAULT_RUNTIME_PATH,
    )


def save_config(
    hermes_home: str | Path,
    *,
    node_path: str,
    recall_limit: int,
) -> Path:
    home = Path(hermes_home).expanduser()
    home.mkdir(parents=True, exist_ok=True)
    path = home / "partner_mem.json"
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(
            {
                "node_path": node_path,
                "recall_limit": _require_recall_limit(recall_limit),
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    temporary.chmod(0o600)
    temporary.replace(path)
    path.chmod(0o600)
    return path


def merge_config_update(
    current: PartnerMemConfig,
    values: Dict[str, Any],
) -> PartnerMemConfig:
    if not isinstance(values, dict):
        raise ValueError("Partner-Mem config update must be an object")
    unexpected = sorted(set(values) - _CONFIG_FIELDS)
    if unexpected:
        raise ValueError(
            "Partner-Mem config contains unsupported fields: "
            + ", ".join(unexpected)
        )

    node_path = current.node_path
    if "node_path" in values:
        node_path = _read_string(values["node_path"])
        if not node_path:
            raise ValueError("Partner-Mem node_path must be a non-empty string")
    recall_limit = (
        _require_recall_limit(values["recall_limit"])
        if "recall_limit" in values
        else current.recall_limit
    )
    return PartnerMemConfig(
        node_path=node_path,
        recall_limit=recall_limit,
        runtime_path=current.runtime_path,
    )


def _read_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _require_recall_limit(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("Partner-Mem recall_limit must be an integer between 1 and 50")
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str) and value.strip().isdecimal():
        parsed = int(value.strip())
    else:
        raise ValueError("Partner-Mem recall_limit must be an integer between 1 and 50")
    if parsed < 1 or parsed > 50:
        raise ValueError("Partner-Mem recall_limit must be an integer between 1 and 50")
    return parsed
