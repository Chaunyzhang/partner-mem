from __future__ import annotations

import sys
import threading
import types
import unittest
import hashlib
import json
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest.mock import patch


INTEGRATION_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(INTEGRATION_ROOT))


agent_package = types.ModuleType("agent")
memory_provider_module = types.ModuleType("agent.memory_provider")


class MemoryProvider:
    pass


memory_provider_module.MemoryProvider = MemoryProvider
hermes_cli_module = types.ModuleType("hermes_cli")
hermes_cli_module.__version__ = "0.18.2"
sys.modules.setdefault("agent", agent_package)
sys.modules.setdefault("agent.memory_provider", memory_provider_module)
sys.modules.setdefault("hermes_cli", hermes_cli_module)


from partner_mem.provider import PartnerMemMemoryProvider
from partner_mem.config import PartnerMemConfig
import partner_mem


class PartnerMemProviderContractTest(unittest.TestCase):
    @staticmethod
    def _schema_digest() -> str:
        schemas = PartnerMemMemoryProvider(
            client_factory=lambda: None
        ).get_tool_schemas()
        return hashlib.sha256(
            json.dumps(
                schemas,
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
            ).encode("utf-8")
        ).hexdigest()

    @staticmethod
    def _runtime_hello(**overrides) -> dict:
        hello = {
            "protocol_version": 1,
            "runtime_version": "0.1.0",
            "capabilities": [
                "context.assemble.v1",
                "turn.capture.v1",
                "tools.invoke.v1",
            ],
            "tool_schema_digest": PartnerMemProviderContractTest._schema_digest(),
        }
        hello.update(overrides)
        return hello

    def test_tool_schemas_are_available_before_initialize_without_starting_runtime(self) -> None:
        def unexpected_client_factory(*args, **kwargs):
            raise AssertionError("schema discovery must not create the runtime client")

        provider = PartnerMemMemoryProvider(client_factory=unexpected_client_factory)

        schemas = provider.get_tool_schemas()

        self.assertEqual(
            [schema["name"] for schema in schemas],
            [
                "partner_mem_search",
                "partner_mem_recall",
                "partner_mem_timeline",
                "partner_mem_status",
            ],
        )
        self.assertNotIn("agent_id", schemas[0]["parameters"]["properties"])
        self.assertNotIn("session_id", schemas[0]["parameters"]["properties"])

    def test_plugin_entrypoint_registers_the_standalone_provider(self) -> None:
        class Collector:
            def __init__(self) -> None:
                self.provider = None

            def register_memory_provider(self, provider) -> None:
                self.provider = provider

        collector = Collector()

        partner_mem.register(collector)

        self.assertIsInstance(collector.provider, PartnerMemMemoryProvider)

    def test_save_config_rejects_unknown_fields(self) -> None:
        provider = PartnerMemMemoryProvider(client_factory=lambda: None)

        with TemporaryDirectory() as temporary_home:
            with self.assertRaisesRegex(ValueError, "unsupported fields.*recall_limt"):
                provider.save_config(
                    {"recall_limt": 4},
                    temporary_home,
                )
            self.assertFalse((Path(temporary_home) / "partner_mem.json").exists())

    def test_save_config_rejects_explicit_invalid_node_path(self) -> None:
        provider = PartnerMemMemoryProvider(client_factory=lambda: None)

        for value in ("", 7, None):
            with self.subTest(value=value), TemporaryDirectory() as temporary_home:
                with self.assertRaisesRegex(ValueError, "node_path.*non-empty string"):
                    provider.save_config(
                        {"node_path": value},
                        temporary_home,
                    )
                self.assertFalse((Path(temporary_home) / "partner_mem.json").exists())

    def test_availability_checks_bundled_runtime_without_starting_it(self) -> None:
        def unexpected_client_factory():
            raise AssertionError("availability checks must not start the runtime")

        with TemporaryDirectory() as temporary_home:
            runtime_root = Path(temporary_home) / "runtime"
            runtime_path = runtime_root / "dist" / "runtime" / "jsonl-server.js"
            dependency_manifest = (
                runtime_root
                / "node_modules"
                / "@photostructure"
                / "sqlite"
                / "package.json"
            )
            runtime_path.parent.mkdir(parents=True)
            runtime_path.write_text("", encoding="utf-8")
            dependency_manifest.parent.mkdir(parents=True)
            dependency_manifest.write_text('{"version":"1.2.1"}\n', encoding="utf-8")
            provider = PartnerMemMemoryProvider(
                client_factory=unexpected_client_factory,
                config_loader=lambda hermes_home=None: PartnerMemConfig(
                    node_path=sys.executable,
                    recall_limit=4,
                    runtime_path=runtime_path,
                ),
            )

            with patch("partner_mem.provider.node_is_supported", return_value=True):
                self.assertTrue(provider.is_available())
                dependency_manifest.unlink()
                self.assertFalse(provider.is_available())
            dependency_manifest.write_text('{"version":"1.2.1"}\n', encoding="utf-8")
            with patch("partner_mem.provider.node_is_supported", return_value=False):
                self.assertFalse(provider.is_available())

    def test_unsupported_hermes_version_never_starts_runtime(self) -> None:
        starts = []
        provider = PartnerMemMemoryProvider(
            client_factory=lambda: starts.append("started")
        )

        with patch(
            "partner_mem.provider._read_hermes_version", return_value="0.19.0"
        ):
            self.assertFalse(provider.is_available())
            with TemporaryDirectory() as temporary_home:
                with self.assertRaisesRegex(RuntimeError, "Hermes Agent v0.18.2"):
                    provider.initialize(
                        "session-1",
                        hermes_home=temporary_home,
                        agent_identity="coder",
                        agent_context="primary",
                    )

        self.assertEqual(starts, [])

    def test_handshake_mismatch_closes_runtime_and_fails_closed(self) -> None:
        class MismatchedClient:
            def __init__(self) -> None:
                self.close_timeouts = []

            def start(self, *, state_dir: Path, client: dict) -> dict:
                return PartnerMemProviderContractTest._runtime_hello(
                    tool_schema_digest="wrong-digest"
                )

            def close(self, *, timeout_seconds: float) -> None:
                self.close_timeouts.append(timeout_seconds)

        runtime = MismatchedClient()
        provider = PartnerMemMemoryProvider(client_factory=lambda: runtime)

        with TemporaryDirectory() as temporary_home:
            with self.assertRaisesRegex(RuntimeError, "schema digest"):
                provider.initialize(
                    "session-1",
                    hermes_home=temporary_home,
                    agent_identity="coder",
                    agent_context="primary",
                )

        self.assertEqual(runtime.close_timeouts, [1.0])
        self.assertEqual(provider.prefetch("must not run"), "")

    def test_handshake_rejects_runtime_descriptor_drift(self) -> None:
        cases = [
            ("runtime_version", "0.2.0", "runtime_version"),
            (
                "capabilities",
                ["context.assemble.v1", "turn.capture.v1"],
                "capabilities",
            ),
            ("unexpected", True, "descriptor fields"),
        ]

        for field, value, message in cases:
            with self.subTest(field=field):
                class MismatchedClient:
                    def __init__(self) -> None:
                        self.close_timeouts = []

                    def start(self, *, state_dir: Path, client: dict) -> dict:
                        return PartnerMemProviderContractTest._runtime_hello(
                            **{field: value}
                        )

                    def close(self, *, timeout_seconds: float) -> None:
                        self.close_timeouts.append(timeout_seconds)

                runtime = MismatchedClient()
                provider = PartnerMemMemoryProvider(client_factory=lambda: runtime)

                with TemporaryDirectory() as temporary_home:
                    with self.assertRaisesRegex(RuntimeError, message):
                        provider.initialize(
                            "session-1",
                            hermes_home=temporary_home,
                            agent_identity="coder",
                            agent_context="primary",
                        )

                self.assertEqual(runtime.close_timeouts, [1.0])

    def test_initialize_starts_runtime_once_with_profile_state_and_verified_schema(self) -> None:
        class RecordingClient:
            def __init__(self) -> None:
                self.starts = []

            def start(self, *, state_dir: Path, client: dict) -> dict:
                self.starts.append({"state_dir": state_dir, "client": client})
                return PartnerMemProviderContractTest._runtime_hello()

        runtime = RecordingClient()
        provider = PartnerMemMemoryProvider(client_factory=lambda: runtime)

        with TemporaryDirectory() as temporary_home:
            provider.initialize(
                "session-1",
                hermes_home=temporary_home,
                agent_identity="coder",
                agent_context="primary",
            )

            self.assertEqual(
                runtime.starts,
                [
                    {
                        "state_dir": Path(temporary_home) / "partner-mem",
                        "client": {
                            "name": "partner-mem-hermes",
                            "version": "0.1.0",
                            "host": "hermes",
                            "host_version": "0.18.2",
                        },
                    }
                ],
            )

    def test_initialize_rejects_missing_agent_context_before_starting_runtime(self) -> None:
        starts = []
        provider = PartnerMemMemoryProvider(
            client_factory=lambda: starts.append("started")
        )

        with TemporaryDirectory() as temporary_home:
            with self.assertRaisesRegex(ValueError, "agent_context"):
                provider.initialize(
                    "session-1",
                    hermes_home=temporary_home,
                    agent_identity="coder",
                )

        self.assertEqual(starts, [])

    def test_repeated_initialize_is_rejected_without_starting_a_second_child(self) -> None:
        class RecordingClient:
            def __init__(self) -> None:
                self.starts = 0

            def start(self, *, state_dir: Path, client: dict) -> dict:
                self.starts += 1
                return PartnerMemProviderContractTest._runtime_hello()

        runtime = RecordingClient()
        factories = []

        def create_client():
            factories.append("created")
            return runtime

        provider = PartnerMemMemoryProvider(client_factory=create_client)
        with TemporaryDirectory() as temporary_home:
            provider.initialize(
                "session-1",
                hermes_home=temporary_home,
                agent_identity="coder",
                agent_context="primary",
            )
            with self.assertRaisesRegex(RuntimeError, "already initialized"):
                provider.initialize(
                    "session-2",
                    hermes_home=temporary_home,
                    agent_identity="coder",
                    agent_context="primary",
                )

        self.assertEqual(factories, ["created"])
        self.assertEqual(runtime.starts, 1)

    def test_shutdown_during_initialize_cannot_publish_an_orphan_runtime(self) -> None:
        class BlockingStartClient:
            def __init__(self) -> None:
                self.started = threading.Event()
                self.release = threading.Event()
                self.close_timeouts = []

            def start(self, *, state_dir: Path, client: dict) -> dict:
                self.started.set()
                self.release.wait(timeout=2.0)
                return PartnerMemProviderContractTest._runtime_hello()

            def close(self, *, timeout_seconds: float) -> None:
                self.close_timeouts.append(timeout_seconds)

        runtime = BlockingStartClient()
        provider = PartnerMemMemoryProvider(client_factory=lambda: runtime)
        outcome = {}

        with TemporaryDirectory() as temporary_home:
            def initialize() -> None:
                try:
                    provider.initialize(
                        "session-1",
                        hermes_home=temporary_home,
                        agent_identity="coder",
                        agent_context="primary",
                    )
                    outcome["initialize"] = "returned"
                except Exception as error:
                    outcome["initialize"] = error

            initialize_thread = threading.Thread(target=initialize)
            shutdown_thread = threading.Thread(target=provider.shutdown)
            initialize_thread.start()
            self.assertTrue(runtime.started.wait(timeout=2.0))
            shutdown_thread.start()
            runtime.release.set()
            initialize_thread.join(timeout=2.0)
            shutdown_thread.join(timeout=2.0)

        self.assertFalse(initialize_thread.is_alive())
        self.assertFalse(shutdown_thread.is_alive())
        self.assertEqual(runtime.close_timeouts, [1.0])
        self.assertEqual(provider.system_prompt_block(), "")
        self.assertEqual(provider.prefetch("must stay closed"), "")

    def test_primary_sync_captures_one_turn_with_trusted_identity(self) -> None:
        class RecordingClient:
            def __init__(self) -> None:
                self.executions = []

            def start(self, *, state_dir: Path, client: dict) -> dict:
                return PartnerMemProviderContractTest._runtime_hello()

            def execute(self, method: str, params: dict, *, timeout_seconds: float) -> dict:
                self.executions.append(
                    {
                        "method": method,
                        "params": params,
                        "timeout_seconds": timeout_seconds,
                    }
                )
                return {"raw_node_ids": ["raw-1", "raw-2"]}

        runtime = RecordingClient()
        provider = PartnerMemMemoryProvider(client_factory=lambda: runtime)

        with TemporaryDirectory() as temporary_home:
            provider.initialize(
                "session-1",
                hermes_home=temporary_home,
                agent_identity="coder",
                agent_context="primary",
            )
            provider.sync_turn(
                "Remember the adapter boundary.",
                "Partner-Mem runtime owns storage.",
                session_id="session-1",
            )

        self.assertEqual(len(runtime.executions), 1)
        execution = runtime.executions[0]
        self.assertEqual(execution["method"], "memory.capture_turn")
        self.assertEqual(
            {
                key: execution["params"][key]
                for key in ("identity", "user_content", "assistant_content")
            },
            {
                "identity": {
                    "host": "hermes",
                    "agent_id": "coder",
                    "session_id": "session-1",
                    "agent_context": "primary",
                },
                "user_content": "Remember the adapter boundary.",
                "assistant_content": "Partner-Mem runtime owns storage.",
            },
        )
        self.assertEqual(
            set(execution["params"]),
            {
                "operation_id",
                "identity",
                "user_content",
                "assistant_content",
                "observed_at",
            },
        )
        self.assertTrue(execution["params"]["operation_id"])
        self.assertTrue(execution["params"]["observed_at"].endswith("Z"))

    def test_non_primary_context_never_captures_turns(self) -> None:
        class RecordingClient:
            def __init__(self) -> None:
                self.executions = []

            def start(self, *, state_dir: Path, client: dict) -> dict:
                return PartnerMemProviderContractTest._runtime_hello()

            def execute(self, method: str, params: dict, *, timeout_seconds: float) -> dict:
                self.executions.append((method, params, timeout_seconds))
                return {}

        runtime = RecordingClient()
        provider = PartnerMemMemoryProvider(client_factory=lambda: runtime)

        with TemporaryDirectory() as temporary_home:
            provider.initialize(
                "subagent-session",
                hermes_home=temporary_home,
                agent_identity="coder",
                agent_context="subagent",
            )
            provider.sync_turn("delegated prompt", "delegated result")

        self.assertEqual(runtime.executions, [])

    def test_prefetch_assembles_context_for_trusted_identity(self) -> None:
        class RecallClient:
            def __init__(self) -> None:
                self.executions = []

            def start(self, *, state_dir: Path, client: dict) -> dict:
                return PartnerMemProviderContractTest._runtime_hello()

            def execute(self, method: str, params: dict, *, timeout_seconds: float) -> dict:
                self.executions.append(
                    {
                        "method": method,
                        "params": params,
                        "timeout_seconds": timeout_seconds,
                    }
                )
                return {"text": "## Partner-Mem verified raw evidence\n- user: adapter seam"}

        runtime = RecallClient()
        provider = PartnerMemMemoryProvider(client_factory=lambda: runtime)

        with TemporaryDirectory() as temporary_home:
            provider.initialize(
                "current-session",
                hermes_home=temporary_home,
                agent_identity="coder",
                agent_context="primary",
            )
            result = provider.prefetch("adapter seam", session_id="next-session")

        self.assertEqual(
            result,
            "## Partner-Mem verified raw evidence\n- user: adapter seam",
        )
        self.assertEqual(
            runtime.executions,
            [
                {
                    "method": "memory.assemble_context",
                    "params": {
                        "identity": {
                            "host": "hermes",
                            "agent_id": "coder",
                            "session_id": "next-session",
                            "agent_context": "primary",
                        },
                        "query": "adapter seam",
                        "limit": 4,
                    },
                    "timeout_seconds": 0.1,
                }
            ],
        )

    def test_tool_call_rejects_caller_supplied_identity(self) -> None:
        class RecordingClient:
            def __init__(self) -> None:
                self.executions = []

            def start(self, *, state_dir: Path, client: dict) -> dict:
                return PartnerMemProviderContractTest._runtime_hello()

            def execute(self, method: str, params: dict, *, timeout_seconds: float) -> dict:
                self.executions.append((method, params, timeout_seconds))
                return {"unexpected": True}

        runtime = RecordingClient()
        provider = PartnerMemMemoryProvider(client_factory=lambda: runtime)

        with TemporaryDirectory() as temporary_home:
            provider.initialize(
                "trusted-session",
                hermes_home=temporary_home,
                agent_identity="coder",
                agent_context="primary",
            )
            result = provider.handle_tool_call(
                "partner_mem_recall",
                {
                    "query": "identity",
                    "limit": 2,
                    "agent_id": "forged-agent",
                    "session_id": "forged-session",
                },
            )

        self.assertIn("identity", json.loads(result)["error"].lower())
        self.assertEqual(runtime.executions, [])

    def test_tool_call_invokes_runtime_with_trusted_identity(self) -> None:
        class ToolClient:
            def __init__(self) -> None:
                self.executions = []

            def start(self, *, state_dir: Path, client: dict) -> dict:
                return PartnerMemProviderContractTest._runtime_hello()

            def execute(self, method: str, params: dict, *, timeout_seconds: float) -> dict:
                self.executions.append(
                    {
                        "method": method,
                        "params": params,
                        "timeout_seconds": timeout_seconds,
                    }
                )
                return {
                    "result": {"result_class": "evidence", "evidence_items": []}
                }

        runtime = ToolClient()
        provider = PartnerMemMemoryProvider(client_factory=lambda: runtime)

        with TemporaryDirectory() as temporary_home:
            provider.initialize(
                "trusted-session",
                hermes_home=temporary_home,
                agent_identity="coder",
                agent_context="primary",
            )
            result = provider.handle_tool_call(
                "partner_mem_recall",
                {"query": "identity", "limit": 2},
                session_id="tool-session",
            )

        self.assertEqual(
            json.loads(result),
            {"result_class": "evidence", "evidence_items": []},
        )
        self.assertEqual(
            runtime.executions,
            [
                {
                    "method": "tools.invoke",
                    "params": {
                        "identity": {
                            "host": "hermes",
                            "agent_id": "coder",
                            "session_id": "tool-session",
                            "agent_context": "primary",
                        },
                        "tool_name": "partner_mem_recall",
                        "arguments": {"query": "identity", "limit": 2},
                    },
                    "timeout_seconds": 15.0,
                }
            ],
        )

    def test_session_switch_discards_prefetch_cache_and_rebinds_identity(self) -> None:
        class RecallClient:
            def __init__(self) -> None:
                self.executions = []

            def start(self, *, state_dir: Path, client: dict) -> dict:
                return PartnerMemProviderContractTest._runtime_hello()

            def execute(self, method: str, params: dict, *, timeout_seconds: float) -> dict:
                self.executions.append(
                    {
                        "method": method,
                        "params": params,
                        "timeout_seconds": timeout_seconds,
                    }
                )
                return {"text": f"context-{len(self.executions)}"}

        runtime = RecallClient()
        provider = PartnerMemMemoryProvider(client_factory=lambda: runtime)

        with TemporaryDirectory() as temporary_home:
            provider.initialize(
                "old-session",
                hermes_home=temporary_home,
                agent_identity="coder",
                agent_context="primary",
            )
            provider.queue_prefetch("completed-turn query", session_id="old-session")
            self.assertEqual(
                provider.prefetch("next-turn query", session_id="old-session"),
                "context-1",
            )

            provider.on_session_switch(
                "new-session",
                parent_session_id="old-session",
                reset=True,
            )
            self.assertEqual(provider.prefetch("new-session query"), "context-2")

        self.assertEqual(len(runtime.executions), 2)
        self.assertEqual(
            runtime.executions[1]["params"]["identity"],
            {
                "host": "hermes",
                "agent_id": "coder",
                "session_id": "new-session",
                "agent_context": "primary",
            },
        )

    def test_session_switch_discards_background_prefetch_that_finishes_late(self) -> None:
        class BlockingRecallClient:
            def __init__(self) -> None:
                self.started = threading.Event()
                self.release = threading.Event()
                self.executions = []

            def start(self, *, state_dir: Path, client: dict) -> dict:
                return PartnerMemProviderContractTest._runtime_hello()

            def execute(self, method: str, params: dict, *, timeout_seconds: float) -> dict:
                self.executions.append(params["query"])
                if params["query"] == "old query":
                    self.started.set()
                    self.release.wait(timeout=2.0)
                    return {"text": "old context"}
                return {"text": "new context"}

        runtime = BlockingRecallClient()
        provider = PartnerMemMemoryProvider(client_factory=lambda: runtime)

        with TemporaryDirectory() as temporary_home:
            provider.initialize(
                "old-session",
                hermes_home=temporary_home,
                agent_identity="coder",
                agent_context="primary",
            )
            worker = threading.Thread(
                target=lambda: provider.queue_prefetch(
                    "old query", session_id="old-session"
                )
            )
            worker.start()
            self.assertTrue(runtime.started.wait(timeout=2.0))
            provider.on_session_switch("new-session")
            runtime.release.set()
            worker.join(timeout=2.0)

            self.assertFalse(worker.is_alive())
            self.assertEqual(provider.prefetch("new query"), "new context")

        self.assertEqual(runtime.executions, ["old query", "new query"])

    def test_shutdown_requests_bounded_runtime_close_once(self) -> None:
        class ClosingClient:
            def __init__(self) -> None:
                self.close_timeouts = []

            def start(self, *, state_dir: Path, client: dict) -> dict:
                return PartnerMemProviderContractTest._runtime_hello()

            def close(self, *, timeout_seconds: float) -> None:
                self.close_timeouts.append(timeout_seconds)

        runtime = ClosingClient()
        provider = PartnerMemMemoryProvider(client_factory=lambda: runtime)

        with TemporaryDirectory() as temporary_home:
            provider.initialize(
                "session-1",
                hermes_home=temporary_home,
                agent_identity="coder",
                agent_context="primary",
            )
            provider.shutdown()
            provider.shutdown()

        self.assertEqual(runtime.close_timeouts, [1.0])


if __name__ == "__main__":
    unittest.main()
