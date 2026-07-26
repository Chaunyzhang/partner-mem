#!/usr/bin/env python3
"""Build a Hermes user-plugin artifact from the checked-out source tree."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


def main() -> int:
    repo = Path(__file__).resolve().parents[2]
    source = repo / "integrations" / "hermes" / "partner_mem"
    runtime_package = repo / "integrations" / "hermes" / "runtime-package"
    artifact = repo / "integrations" / "hermes" / "dist" / "partner_mem"

    if (repo / "dist").exists():
        shutil.rmtree(repo / "dist")
    tsc = repo / "node_modules" / ".bin" / "tsc"
    subprocess.run([str(tsc), "-p", "tsconfig.build.json"], cwd=repo, check=True)
    subprocess.run(["node", "scripts/copy-migrations.mjs"], cwd=repo, check=True)
    if artifact.exists():
        shutil.rmtree(artifact)
    artifact.mkdir(parents=True)
    shutil.copytree(source, artifact, dirs_exist_ok=True)
    shutil.copy2(repo / "integrations" / "hermes" / "README.md", artifact / "README.md")
    shutil.copy2(repo / "src" / "tools" / "generated" / "tool-schemas.json", artifact / "tool-schemas.json")
    subprocess.run(
        [
            "node",
            "scripts/copy-runtime-closure.mjs",
            "--output",
            "integrations/hermes/dist/partner_mem/runtime/dist",
        ],
        cwd=repo,
        check=True,
    )
    runtime_package_dir = artifact / "runtime"
    shutil.copy2(runtime_package / "package.json", runtime_package_dir / "package.json")
    shutil.copy2(runtime_package / "package-lock.json", runtime_package_dir / "package-lock.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
