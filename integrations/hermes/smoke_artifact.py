#!/usr/bin/env python3
"""Install and start the built Hermes provider artifact outside the repository."""

from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> int:
    repo = Path(__file__).resolve().parents[2]
    artifact = repo / "integrations" / "hermes" / "dist" / "partner_mem"
    if not artifact.exists():
        raise RuntimeError("Hermes artifact is missing; run build_artifact.py first")

    with tempfile.TemporaryDirectory(prefix="partner-mem-hermes-smoke-") as tmp:
        hermes_home = Path(tmp) / "hermes"
        installed = hermes_home / "plugins" / "partner_mem"
        installed.parent.mkdir(parents=True)
        shutil.copytree(artifact, installed)
        runtime = installed / "runtime"
        subprocess.run(
            ["npm", "ci", "--omit=dev"],
            cwd=runtime,
            check=True,
            env={**os.environ, "npm_config_audit": "false", "npm_config_fund": "false"},
        )

        sys.path.insert(0, str(installed.parent))
        provider_module = importlib.import_module("partner_mem")
        provider = provider_module.PartnerMemMemoryProvider()
        provider.initialize(
            "smoke-session",
            hermes_home=str(hermes_home),
            agent_identity="smoke-agent",
            agent_context="primary",
        )
        result = json.loads(
            provider.handle_tool_call(
                "partner_mem_keyword_search",
                {"query": "package smoke"},
            )
        )
        if result.get("status") != "empty":
            raise RuntimeError(f"unexpected installed Tool result: {result}")
        provider.shutdown()

        state_path = installed / "data" / "state.json"
        database_path = installed / "data" / "partner-mem.sqlite"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if state.get("version") != 1 or not state.get("harness_id"):
            raise RuntimeError("installed provider did not persist valid Harness state")
        if not database_path.exists():
            raise RuntimeError("installed provider did not create its database")

    print("Hermes artifact install/discovery/runtime smoke passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
