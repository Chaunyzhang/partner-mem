"""Hermes setup hook for the standalone Partner-Mem adapter."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any, Callable, Dict

from .config import PartnerMemConfig, load_config, save_config
from .host_contract import read_hermes_version, require_supported_hermes_version
from .node_contract import require_supported_node, resolve_sibling_npm


def run_post_setup(
    hermes_home: str,
    hermes_config: Dict[str, Any],
    *,
    config_loader: Callable[..., PartnerMemConfig] = load_config,
    hermes_config_saver: Callable[[Dict[str, Any]], None] | None = None,
    command_runner: Callable[..., Any] = subprocess.run,
    host_version_loader: Callable[[], str] = read_hermes_version,
) -> None:
    """Validate/install the bundled runtime, save profile config, and activate it."""

    require_supported_hermes_version(host_version_loader())
    config = config_loader(hermes_home)
    resolved_node = require_supported_node(
        config.node_path,
        command_runner=command_runner,
    )
    if not config.runtime_path.is_file():
        raise RuntimeError(f"Partner-Mem runtime is missing: {config.runtime_path}")

    _install_runtime_dependencies(
        config.runtime_path,
        node_path=resolved_node,
        command_runner=command_runner,
    )
    save_config(
        hermes_home,
        node_path=config.node_path,
        recall_limit=config.recall_limit,
    )

    memory_config = hermes_config.get("memory")
    if not isinstance(memory_config, dict):
        memory_config = {}
        hermes_config["memory"] = memory_config
    memory_config["provider"] = "partner_mem"

    if hermes_config_saver is None:
        from hermes_cli.config import save_config as save_hermes_config

        hermes_config_saver = save_hermes_config
    hermes_config_saver(hermes_config)


def _install_runtime_dependencies(
    runtime_path: Path,
    *,
    node_path: str,
    command_runner: Callable[..., Any],
) -> None:
    runtime_root = runtime_path.parent.parent.parent
    package_json = runtime_root / "package.json"
    package_lock = runtime_root / "package-lock.json"
    if not package_json.is_file():
        raise RuntimeError(f"Partner-Mem runtime package.json is missing: {package_json}")
    if not package_lock.is_file():
        raise RuntimeError(
            f"Partner-Mem runtime package-lock.json is missing: {package_lock}"
        )

    npm = resolve_sibling_npm(node_path)
    if npm is None:
        raise RuntimeError(
            "npm must be installed beside the configured Node.js executable: "
            f"{Path(node_path).parent}"
        )
    environment = dict(os.environ)
    environment["PATH"] = os.pathsep.join(
        [str(Path(node_path).parent), environment.get("PATH", "")]
    ).rstrip(os.pathsep)
    completed = command_runner(
        [npm, "ci", "--omit=dev"],
        cwd=str(runtime_root),
        env=environment,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "npm ci failed").strip()
        raise RuntimeError(f"Partner-Mem runtime dependency install failed: {detail}")
