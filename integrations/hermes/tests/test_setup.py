from __future__ import annotations

import json
import os
import stat
import sys
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace


INTEGRATION_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(INTEGRATION_ROOT))

agent_package = types.ModuleType("agent")
memory_provider_module = types.ModuleType("agent.memory_provider")
memory_provider_module.MemoryProvider = type("MemoryProvider", (), {})
hermes_cli_module = types.ModuleType("hermes_cli")
hermes_cli_module.__version__ = "0.18.2"
sys.modules.setdefault("agent", agent_package)
sys.modules.setdefault("agent.memory_provider", memory_provider_module)
sys.modules.setdefault("hermes_cli", hermes_cli_module)


from partner_mem.config import PartnerMemConfig
from partner_mem.setup import run_post_setup


FAKE_RUNTIME = Path(__file__).with_name("fixtures") / "fake_runtime.py"


class PartnerMemSetupContractTest(unittest.TestCase):
    @staticmethod
    def _create_toolchain(root: Path) -> tuple[str, str]:
        binary_dir = root / "node-bin"
        binary_dir.mkdir()
        node = binary_dir / "node"
        npm = binary_dir / "npm"
        for executable in (node, npm):
            executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            executable.chmod(0o755)
        return str(node), str(npm)

    def test_setup_saves_profile_config_and_activates_provider(self) -> None:
        saved_hermes_configs = []

        with TemporaryDirectory() as temporary_home:
            node_path, _ = self._create_toolchain(Path(temporary_home))
            runtime_root = Path(temporary_home) / "plugin" / "runtime"
            runtime_path = runtime_root / "dist" / "runtime" / "jsonl-server.js"
            runtime_path.parent.mkdir(parents=True)
            runtime_path.write_text("", encoding="utf-8")
            (runtime_root / "package.json").write_text("{}\n", encoding="utf-8")
            (runtime_root / "package-lock.json").write_text("{}\n", encoding="utf-8")
            hermes_config = {"memory": {}}
            run_post_setup(
                temporary_home,
                hermes_config,
                config_loader=lambda hermes_home=None: PartnerMemConfig(
                    node_path=node_path,
                    recall_limit=6,
                    runtime_path=runtime_path,
                ),
                hermes_config_saver=lambda value: saved_hermes_configs.append(
                    json.loads(json.dumps(value))
                ),
                command_runner=lambda *args, **kwargs: SimpleNamespace(
                    returncode=0,
                    stdout="v20.11.1\n",
                    stderr="",
                ),
            )

            config_path = Path(temporary_home) / "partner_mem.json"
            stored = json.loads(config_path.read_text(encoding="utf-8"))
            mode = stat.S_IMODE(config_path.stat().st_mode)

        self.assertEqual(
            stored,
            {"node_path": node_path, "recall_limit": 6},
        )
        self.assertEqual(mode, 0o600)
        self.assertEqual(
            saved_hermes_configs,
            [{"memory": {"provider": "partner_mem"}}],
        )

    def test_setup_rejects_node_older_than_version_20_before_activation(self) -> None:
        saved_hermes_configs = []

        with TemporaryDirectory() as temporary_home:
            with self.assertRaisesRegex(RuntimeError, "Node.js 20 or newer"):
                run_post_setup(
                    temporary_home,
                    {"memory": {}},
                    config_loader=lambda hermes_home=None: PartnerMemConfig(
                        node_path=sys.executable,
                        recall_limit=6,
                        runtime_path=FAKE_RUNTIME,
                    ),
                    hermes_config_saver=lambda value: saved_hermes_configs.append(value),
                    command_runner=lambda *args, **kwargs: SimpleNamespace(
                        returncode=0,
                        stdout="v19.9.0\n",
                        stderr="",
                    ),
                )

            self.assertFalse((Path(temporary_home) / "partner_mem.json").exists())
        self.assertEqual(saved_hermes_configs, [])

    def test_setup_rejects_unsupported_hermes_before_any_mutation(self) -> None:
        calls = []
        saved_hermes_configs = []

        with TemporaryDirectory() as temporary_home:
            with self.assertRaisesRegex(RuntimeError, "Hermes Agent v0.18.2"):
                run_post_setup(
                    temporary_home,
                    {"memory": {}},
                    config_loader=lambda hermes_home=None: calls.append("config"),
                    hermes_config_saver=lambda value: saved_hermes_configs.append(value),
                    command_runner=lambda *args, **kwargs: calls.append("command"),
                    host_version_loader=lambda: "0.19.0",
                )

            self.assertFalse((Path(temporary_home) / "partner_mem.json").exists())
        self.assertEqual(calls, [])
        self.assertEqual(saved_hermes_configs, [])

    def test_setup_runs_npm_ci_even_when_node_modules_already_exists(self) -> None:
        calls = []

        def run_command(args, **kwargs):
            calls.append((args, kwargs))
            if args[1:] == ["--version"]:
                return SimpleNamespace(returncode=0, stdout="v20.11.1\n", stderr="")
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        with TemporaryDirectory() as temporary_home:
            node_path, npm_path = self._create_toolchain(Path(temporary_home))
            runtime_root = Path(temporary_home) / "bundled-runtime"
            runtime_path = runtime_root / "dist" / "runtime" / "jsonl-server.js"
            runtime_path.parent.mkdir(parents=True)
            runtime_path.write_text("", encoding="utf-8")
            (runtime_root / "package.json").write_text("{}\n", encoding="utf-8")
            (runtime_root / "package-lock.json").write_text("{}\n", encoding="utf-8")
            (runtime_root / "node_modules").mkdir()

            run_post_setup(
                temporary_home,
                {"memory": {}},
                config_loader=lambda hermes_home=None: PartnerMemConfig(
                    node_path=node_path,
                    recall_limit=6,
                    runtime_path=runtime_path,
                ),
                hermes_config_saver=lambda value: None,
                command_runner=run_command,
            )

        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][0], [node_path, "--version"])
        self.assertEqual(calls[1][0], [npm_path, "ci", "--omit=dev"])
        self.assertEqual(calls[1][1]["cwd"], str(runtime_root))
        self.assertEqual(
            calls[1][1]["env"]["PATH"].split(os.pathsep)[0],
            str(Path(node_path).parent),
        )

    def test_setup_rejects_missing_runtime_package_before_activation(self) -> None:
        saved_hermes_configs = []

        with TemporaryDirectory() as temporary_home:
            runtime_root = Path(temporary_home) / "plugin" / "runtime"
            runtime_path = runtime_root / "dist" / "runtime" / "jsonl-server.js"
            runtime_path.parent.mkdir(parents=True)
            runtime_path.write_text("", encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "package.json"):
                run_post_setup(
                    temporary_home,
                    {"memory": {}},
                    config_loader=lambda hermes_home=None: PartnerMemConfig(
                        node_path=sys.executable,
                        recall_limit=6,
                        runtime_path=runtime_path,
                    ),
                    hermes_config_saver=lambda value: saved_hermes_configs.append(value),
                    command_runner=lambda *args, **kwargs: SimpleNamespace(
                        returncode=0,
                        stdout="v20.11.1\n",
                        stderr="",
                    ),
                )

            self.assertFalse((Path(temporary_home) / "partner_mem.json").exists())
        self.assertEqual(saved_hermes_configs, [])


if __name__ == "__main__":
    unittest.main()
