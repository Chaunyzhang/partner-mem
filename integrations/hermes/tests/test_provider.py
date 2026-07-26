from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "integrations" / "hermes"))

from partner_mem import PartnerMemMemoryProvider
from partner_mem.runtime_client import PartnerMemRuntimeClient, PartnerMemRuntimeError


class HermesPartnerMemProviderTest(unittest.TestCase):
    def tearDown(self) -> None:
        for key in [
            "PARTNER_MEM_HERMES_RUNTIME_COMMAND",
            "PARTNER_MEM_HERMES_REQUEST_TIMEOUT_MS",
        ]:
            os.environ.pop(key, None)

    def test_schema_projection_is_exact_three_canonical_tools(self) -> None:
        provider = PartnerMemMemoryProvider()
        schemas = provider.get_tool_schemas()
        canonical = json.loads((REPO / "src" / "tools" / "generated" / "tool-schemas.json").read_text())
        self.assertEqual(
            schemas,
            [
                {
                    "name": item["name"],
                    "description": item["description"],
                    "parameters": item["inputSchema"],
                }
                for item in canonical
            ],
        )

    def test_sync_turn_returns_immediately_and_writes_question_then_answer_once(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "runtime-log.jsonl"
            provider = self._initialized_provider(tmp, log_path)
            started = time.perf_counter()
            provider.sync_turn("  user question\n", "\tassistant answer  ")
            elapsed = time.perf_counter() - started
            self.assertLess(elapsed, 0.2)
            commands = self._wait_for_commands(log_path, 3)
            self.assertEqual([item["command"] for item in commands], ["register_harness", "record_question", "record_answer"])
            self.assertEqual(commands[1]["params"]["text"], "  user question\n")
            self.assertEqual(commands[2]["params"]["node_id"], "node-1")
            self.assertEqual(commands[2]["params"]["text"], "\tassistant answer  ")
            provider.shutdown()

    def test_restart_reuses_harness_state_without_second_register(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "runtime-log.jsonl"
            first = self._initialized_provider(tmp, log_path)
            first.shutdown()
            second = self._initialized_provider(tmp, log_path)
            second.shutdown()
            commands = self._wait_for_commands(log_path, 1)
            self.assertEqual([item["command"] for item in commands], ["register_harness"])
            state = json.loads((Path(tmp) / "plugins" / "partner_mem" / "data" / "state.json").read_text())
            self.assertEqual(state["harness_id"], "harness-1")

    def test_non_primary_context_does_not_write(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "runtime-log.jsonl"
            provider = self._initialized_provider(tmp, log_path, agent_context="subagent")
            provider.sync_turn("skip", "skip")
            time.sleep(0.1)
            provider.shutdown()
            commands = self._wait_for_commands(log_path, 1)
            self.assertEqual([item["command"] for item in commands], ["register_harness"])

    def test_whitespace_only_text_does_not_send_empty_core_write(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "runtime-log.jsonl"
            provider = self._initialized_provider(tmp, log_path)
            provider.sync_turn("   ", "\n\t")
            time.sleep(0.1)
            provider.shutdown()
            commands = self._wait_for_commands(log_path, 1)
            self.assertEqual([item["command"] for item in commands], ["register_harness"])

    def test_tool_call_invokes_runtime_with_source_identity_and_returns_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "runtime-log.jsonl"
            provider = self._initialized_provider(tmp, log_path)
            raw = provider.handle_tool_call("partner_mem_keyword_search", {"query": "needle"})
            result = json.loads(raw)
            self.assertEqual(result["status"], "empty")
            commands = self._wait_for_commands(log_path, 2)
            self.assertEqual(commands[1]["command"], "invoke_tool")
            self.assertEqual(commands[1]["params"]["source_conversation_id"], "session-a")
            self.assertEqual(commands[1]["params"]["source_agent_id"], "agent-a")
            self.assertNotIn("conversation_id", commands[1]["params"])
            provider.shutdown()

    def test_unavailable_tool_returns_error_envelope_without_throwing(self) -> None:
        provider = PartnerMemMemoryProvider()
        result = json.loads(provider.handle_tool_call("partner_mem_vector_search", {"query": "x"}))
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["retrieval_type"], "vector")
        self.assertEqual(result["error_code"], "partner_mem_unavailable")

    def test_hermes_user_plugin_discovery_shape_loads_register_provider(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            hermes_root = Path(tmp) / "hermes"
            plugin_dir = hermes_root / "plugins" / "partner_mem"
            plugin_dir.parent.mkdir(parents=True)
            os.symlink(REPO / "integrations" / "hermes" / "partner_mem", plugin_dir)
            spec = importlib.util.spec_from_file_location(
                "_partner_mem_discovery_test",
                plugin_dir / "__init__.py",
                submodule_search_locations=[str(plugin_dir)],
            )
            self.assertIsNotNone(spec)
            self.assertIsNotNone(spec.loader)
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)

            registered = []
            context = type(
                "DiscoveryContext",
                (),
                {"register_memory_provider": registered.append},
            )()
            module.register(context)
            self.assertEqual(len(registered), 1)
            self.assertEqual(registered[0].name, "partner_mem")
            manifest = (plugin_dir / "plugin.yaml").read_text(encoding="utf-8")
            self.assertIn("name: partner_mem", manifest)
            self.assertIn("version: 1.0.0", manifest)

    def test_invalid_state_version_fails_instead_of_registering_again(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "runtime-log.jsonl"
            data_dir = Path(tmp) / "plugins" / "partner_mem" / "data"
            data_dir.mkdir(parents=True)
            (data_dir / "state.json").write_text(json.dumps({"version": 2, "harness_id": "harness-old"}))
            (data_dir / "partner.sqlite").touch()
            fake_runtime = Path(tmp) / "fake_runtime.py"
            fake_runtime.write_text(_FAKE_RUNTIME, encoding="utf-8")
            os.environ["PARTNER_MEM_HERMES_RUNTIME_COMMAND"] = f"{sys.executable} {fake_runtime}"
            provider = PartnerMemMemoryProvider()
            with self.assertRaises(Exception):
                provider.initialize("session-a", hermes_home=tmp, agent_identity="agent-a")
            self.assertFalse(log_path.exists())

    def test_runtime_hang_times_out_without_retry_or_restart(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fake_runtime = Path(tmp) / "hang_runtime.py"
            fake_runtime.write_text(_HANG_RUNTIME, encoding="utf-8")
            os.environ["PARTNER_MEM_HERMES_RUNTIME_COMMAND"] = f"{sys.executable} {fake_runtime}"
            os.environ["PARTNER_MEM_HERMES_REQUEST_TIMEOUT_MS"] = "0.1"
            client = PartnerMemRuntimeClient(database_path=Path(tmp) / "db.sqlite")
            with self.assertRaises(PartnerMemRuntimeError):
                client.request("register_harness", {"harness_type": "hermes"})
            with self.assertRaises(PartnerMemRuntimeError):
                client.request("register_harness", {"harness_type": "hermes"})

    def _initialized_provider(self, tmp: str, log_path: Path, *, agent_context: str = "primary") -> PartnerMemMemoryProvider:
        fake_runtime = Path(tmp) / "fake_runtime.py"
        fake_runtime.write_text(_FAKE_RUNTIME, encoding="utf-8")
        os.environ["PARTNER_MEM_HERMES_RUNTIME_COMMAND"] = f"{sys.executable} {fake_runtime}"
        provider = PartnerMemMemoryProvider()
        provider.initialize(
            "session-a",
            hermes_home=tmp,
            agent_identity="agent-a",
            agent_context=agent_context,
            partner_mem_database_path=str(Path(tmp) / "plugins" / "partner_mem" / "data" / "partner.sqlite"),
        )
        return provider

    def _wait_for_commands(self, log_path: Path, expected: int) -> list[dict]:
        deadline = time.time() + 2
        while time.time() < deadline:
            if log_path.exists():
                lines = [json.loads(line) for line in log_path.read_text().splitlines() if line.strip()]
                if len(lines) >= expected:
                    return lines
            time.sleep(0.02)
        return [json.loads(line) for line in log_path.read_text().splitlines() if line.strip()] if log_path.exists() else []


_FAKE_RUNTIME = textwrap.dedent(
    r'''
    import json
    import os
    import sys
    from pathlib import Path

    Path(os.environ["PARTNER_MEM_DB_PATH"]).touch()
    log_path = Path(os.environ["PARTNER_MEM_HERMES_RUNTIME_COMMAND"].split()[-1]).with_name("runtime-log.jsonl")

    for line in sys.stdin:
        request = json.loads(line)
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"command": request["command"], "params": request["params"]}) + "\n")
        command = request["command"]
        if command == "register_harness":
            result = {"harness_id": "harness-1"}
        elif command == "record_question":
            result = {"node_id": "node-1"}
        elif command == "record_answer":
            result = {"node_id": request["params"].get("node_id", "node-answer")}
        elif command == "invoke_tool":
            result = {"status": "empty", "retrieval_type": "keyword", "truncated": False, "evidence_items": []}
        else:
            print(json.dumps({"id": request["id"], "ok": False, "error": {"code": "UNKNOWN_COMMAND", "message": command}}), flush=True)
            continue
        print(json.dumps({"id": request["id"], "ok": True, "result": result}), flush=True)
    '''
)

_HANG_RUNTIME = textwrap.dedent(
    r'''
    import time
    time.sleep(10)
    '''
)


if __name__ == "__main__":
    unittest.main()
