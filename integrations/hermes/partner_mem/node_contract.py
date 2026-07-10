"""Node.js toolchain checks shared by Hermes setup and activation."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable


MINIMUM_NODE_MAJOR = 20


def resolve_node_executable(value: str) -> str | None:
    expanded = os.path.expanduser(value)
    if os.path.dirname(expanded):
        path = Path(expanded)
        return str(path) if path.is_file() and os.access(path, os.X_OK) else None
    return shutil.which(expanded)


def require_supported_node(
    value: str,
    *,
    command_runner: Callable[..., Any] = subprocess.run,
) -> str:
    resolved = resolve_node_executable(value)
    if resolved is None:
        raise RuntimeError(f"Node.js executable not found: {value}")
    completed = command_runner(
        [resolved, "--version"],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    output = (completed.stdout or completed.stderr or "").strip()
    match = re.fullmatch(r"v?(\d+)(?:\.\d+){1,2}", output)
    if completed.returncode != 0 or match is None:
        raise RuntimeError(f"Unable to determine Node.js version: {output or 'no output'}")
    if int(match.group(1)) < MINIMUM_NODE_MAJOR:
        raise RuntimeError(
            f"Node.js {MINIMUM_NODE_MAJOR} or newer is required; found {output}"
        )
    return resolved


def node_is_supported(value: str) -> bool:
    try:
        require_supported_node(value)
    except (OSError, RuntimeError, subprocess.SubprocessError):
        return False
    return True


def resolve_sibling_npm(node_path: str) -> str | None:
    npm_name = "npm.cmd" if os.name == "nt" else "npm"
    npm_path = Path(node_path).with_name(npm_name)
    if npm_path.is_file() and os.access(npm_path, os.X_OK):
        return str(npm_path)
    return None
