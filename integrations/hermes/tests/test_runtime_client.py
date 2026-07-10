from __future__ import annotations

import sys
import subprocess
import threading
import time
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


INTEGRATION_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(INTEGRATION_ROOT))

agent_package = types.ModuleType("agent")
memory_provider_module = types.ModuleType("agent.memory_provider")
memory_provider_module.MemoryProvider = type("MemoryProvider", (), {})
sys.modules.setdefault("agent", agent_package)
sys.modules.setdefault("agent.memory_provider", memory_provider_module)


from partner_mem.runtime_client import (
    JsonlRuntimeClient,
    RuntimeTransportError,
    validate_runtime_descriptor,
)


FAKE_RUNTIME = Path(__file__).with_name("fixtures") / "fake_runtime.py"


class JsonlRuntimeClientContractTest(unittest.TestCase):
    def test_runtime_descriptor_rejects_boolean_protocol_version(self) -> None:
        with self.assertRaisesRegex(RuntimeTransportError, "protocol version"):
            validate_runtime_descriptor(
                {
                    "protocol_version": True,
                    "runtime_version": "0.1.0",
                    "capabilities": [
                        "context.assemble.v1",
                        "turn.capture.v1",
                        "tools.invoke.v1",
                    ],
                    "tool_schema_digest": "schema-digest",
                }
            )

    def test_wire_response_rejects_boolean_protocol_version(self) -> None:
        client = JsonlRuntimeClient(
            node_path=sys.executable,
            runtime_path=FAKE_RUNTIME,
            environment={"FAKE_RESPONSE_PROTOCOL_BOOL": "1"},
        )

        with TemporaryDirectory() as temporary_home:
            with self.assertRaisesRegex(RuntimeTransportError, "protocol version"):
                client.start(
                    state_dir=Path(temporary_home) / "partner-mem",
                    client={"name": "partner-mem-hermes", "version": "0.1.0"},
                )
            client.close(timeout_seconds=0.25)

    def test_execute_timeout_includes_waiting_for_the_lifecycle_lock(self) -> None:
        client = JsonlRuntimeClient(
            node_path=sys.executable,
            runtime_path=FAKE_RUNTIME,
        )
        lock_entered = threading.Event()

        def hold_lifecycle_lock() -> None:
            with client._lifecycle_lock:
                lock_entered.set()
                time.sleep(0.35)

        holder = threading.Thread(target=hold_lifecycle_lock)
        holder.start()
        self.assertTrue(lock_entered.wait(timeout=1.0))

        started_at = time.monotonic()
        with self.assertRaisesRegex(RuntimeTransportError, "lifecycle lock timed out"):
            client.execute(
                "memory.assemble_context",
                {},
                timeout_seconds=0.05,
            )
        elapsed = time.monotonic() - started_at
        holder.join(timeout=1.0)

        self.assertFalse(holder.is_alive())
        self.assertLess(elapsed, 0.2)

    def test_deadline_expiring_as_lifecycle_lock_is_acquired_does_not_break_runtime(self) -> None:
        class LateLifecycleLock:
            def acquire(self, *, timeout: float) -> bool:
                time.sleep(timeout + 0.01)
                return True

            def release(self) -> None:
                return None

        client = JsonlRuntimeClient(
            node_path=sys.executable,
            runtime_path=FAKE_RUNTIME,
            environment={"FAKE_TOOL_SCHEMA_DIGEST": "schema-digest"},
        )

        with TemporaryDirectory() as temporary_home:
            client.start(
                state_dir=Path(temporary_home) / "partner-mem",
                client={"name": "partner-mem-hermes", "version": "0.1.0"},
            )
            initial = client.execute(
                "tools.invoke",
                {
                    "identity": {"agent_id": "coder", "session_id": "session-1"},
                    "tool_name": "partner_mem_status",
                    "arguments": {},
                },
                timeout_seconds=1.0,
            )
            original_lifecycle_lock = client._lifecycle_lock
            client._lifecycle_lock = LateLifecycleLock()
            try:
                with self.assertRaisesRegex(RuntimeTransportError, "deadline expired"):
                    client.execute(
                        "memory.assemble_context",
                        {},
                        timeout_seconds=0.02,
                    )
            finally:
                client._lifecycle_lock = original_lifecycle_lock

            subsequent = client.execute(
                "tools.invoke",
                {
                    "identity": {"agent_id": "coder", "session_id": "session-1"},
                    "tool_name": "partner_mem_status",
                    "arguments": {},
                },
                timeout_seconds=1.0,
            )
            client.close(timeout_seconds=1.0)

        self.assertEqual(subsequent["result"]["pid"], initial["result"]["pid"])

    def test_capture_does_not_restart_after_its_deadline_is_exhausted(self) -> None:
        spawned_processes = []

        def recording_factory(*args, **kwargs):
            process = subprocess.Popen(*args, **kwargs)
            spawned_processes.append(process)
            return process

        client = JsonlRuntimeClient(
            node_path=sys.executable,
            runtime_path=FAKE_RUNTIME,
            environment={
                "FAKE_TOOL_SCHEMA_DIGEST": "schema-digest",
                "FAKE_CAPTURE_DELAY_SECONDS": "0.2",
            },
            popen_factory=recording_factory,
        )

        with TemporaryDirectory() as temporary_home:
            client.start(
                state_dir=Path(temporary_home) / "partner-mem",
                client={"name": "partner-mem-hermes", "version": "0.1.0"},
            )
            with self.assertRaisesRegex(RuntimeTransportError, "timed out"):
                client.execute(
                    "memory.capture_turn",
                    {
                        "operation_id": "deadline-operation",
                        "identity": {"agent_id": "coder", "session_id": "session-1"},
                        "user_content": "deadline",
                        "assistant_content": "do not restart",
                        "observed_at": "2026-07-10T00:00:00.000Z",
                    },
                    timeout_seconds=0.05,
                )
            client.close(timeout_seconds=0.25)

        self.assertEqual(len(spawned_processes), 1)

    def test_killed_process_is_waited_for_reaping(self) -> None:
        class StubbornProcess:
            def __init__(self) -> None:
                self.calls = []
                self.killed = False

            def poll(self):
                return None

            def wait(self, *, timeout: float):
                self.calls.append(("wait", timeout))
                if self.killed:
                    return 0
                raise subprocess.TimeoutExpired("fake-runtime", timeout)

            def terminate(self) -> None:
                self.calls.append(("terminate", None))

            def kill(self) -> None:
                self.calls.append(("kill", None))
                self.killed = True

        process = StubbornProcess()

        JsonlRuntimeClient._terminate_process(process, timeout_seconds=0.0)

        kill_index = process.calls.index(("kill", None))
        self.assertEqual(process.calls[kill_index + 1][0], "wait")

    def test_process_pipes_use_strict_utf8(self) -> None:
        calls = []

        def recording_factory(*args, **kwargs):
            calls.append((args, kwargs))
            raise OSError("stop after recording spawn options")

        client = JsonlRuntimeClient(
            node_path=sys.executable,
            runtime_path=FAKE_RUNTIME,
            popen_factory=recording_factory,
        )

        with TemporaryDirectory() as temporary_home:
            with self.assertRaises(RuntimeTransportError):
                client.start(
                    state_dir=Path(temporary_home) / "partner-mem",
                    client={"name": "partner-mem-hermes", "version": "0.1.0"},
                )

        self.assertEqual(calls[0][1]["encoding"], "utf-8")
        self.assertEqual(calls[0][1]["errors"], "strict")

    def test_start_and_requests_reuse_one_protocol_v1_process(self) -> None:
        client = JsonlRuntimeClient(
            node_path=sys.executable,
            runtime_path=FAKE_RUNTIME,
            environment={"FAKE_TOOL_SCHEMA_DIGEST": "schema-digest"},
        )

        with TemporaryDirectory() as temporary_home:
            hello = client.start(
                state_dir=Path(temporary_home) / "partner-mem",
                client={"name": "partner-mem-hermes", "version": "0.1.0"},
            )
            first = client.execute(
                "memory.capture_turn",
                {
                    "operation_id": "operation-1",
                    "identity": {"agent_id": "coder", "session_id": "session-1"},
                    "user_content": "one",
                    "assistant_content": "first",
                    "observed_at": "2026-07-10T00:00:00.000Z",
                },
                timeout_seconds=1.0,
            )
            second = client.execute(
                "memory.capture_turn",
                {
                    "operation_id": "operation-2",
                    "identity": {"agent_id": "coder", "session_id": "session-1"},
                    "user_content": "two",
                    "assistant_content": "second",
                    "observed_at": "2026-07-10T00:00:01.000Z",
                },
                timeout_seconds=1.0,
            )
            client.close(timeout_seconds=1.0)

        self.assertEqual(hello["tool_schema_digest"], "schema-digest")
        self.assertEqual(first["pid"], second["pid"])

    def test_capture_restarts_once_and_reuses_operation_id_after_lost_response(self) -> None:
        with TemporaryDirectory() as temporary_home:
            marker = Path(temporary_home) / "capture-seen"
            client = JsonlRuntimeClient(
                node_path=sys.executable,
                runtime_path=FAKE_RUNTIME,
                environment={
                    "FAKE_TOOL_SCHEMA_DIGEST": "schema-digest",
                    "FAKE_FAIL_FIRST_CAPTURE_MARKER": str(marker),
                },
            )
            client.start(
                state_dir=Path(temporary_home) / "partner-mem",
                client={"name": "partner-mem-hermes", "version": "0.1.0"},
            )
            initial = client.execute(
                "tools.invoke",
                {
                    "identity": {"agent_id": "coder", "session_id": "session-1"},
                    "tool_name": "partner_mem_status",
                    "arguments": {},
                },
                timeout_seconds=1.0,
            )

            result = client.execute(
                "memory.capture_turn",
                {
                    "operation_id": "stable-operation",
                    "identity": {"agent_id": "coder", "session_id": "session-1"},
                    "user_content": "commit may have happened",
                    "assistant_content": "retry the same operation",
                    "observed_at": "2026-07-10T00:00:00.000Z",
                },
                timeout_seconds=1.0,
            )
            client.close(timeout_seconds=1.0)
            marker_content = marker.read_text(encoding="utf-8")

        self.assertNotEqual(result["pid"], initial["result"]["pid"])
        self.assertEqual(result["operation_id"], "stable-operation")
        self.assertEqual(marker_content, "stable-operation")

    def test_capture_restart_rejects_runtime_descriptor_drift(self) -> None:
        with TemporaryDirectory() as temporary_home:
            capture_marker = Path(temporary_home) / "capture-seen"
            restart_marker = Path(temporary_home) / "runtime-started"
            client = JsonlRuntimeClient(
                node_path=sys.executable,
                runtime_path=FAKE_RUNTIME,
                environment={
                    "FAKE_TOOL_SCHEMA_DIGEST": "schema-digest",
                    "FAKE_FAIL_FIRST_CAPTURE_MARKER": str(capture_marker),
                    "FAKE_RESTART_RUNTIME_VERSION_MARKER": str(restart_marker),
                },
            )
            client.start(
                state_dir=Path(temporary_home) / "partner-mem",
                client={"name": "partner-mem-hermes", "version": "0.1.0"},
            )

            with self.assertRaisesRegex(RuntimeTransportError, "runtime_version"):
                client.execute(
                    "memory.capture_turn",
                    {
                        "operation_id": "stable-operation",
                        "identity": {"agent_id": "coder", "session_id": "session-1"},
                        "user_content": "commit may have happened",
                        "assistant_content": "reject changed runtime",
                        "observed_at": "2026-07-10T00:00:00.000Z",
                    },
                    timeout_seconds=1.0,
                )
            client.close(timeout_seconds=1.0)

    def test_close_during_restart_prevents_retry_and_orphan_process(self) -> None:
        with TemporaryDirectory() as temporary_home:
            capture_marker = Path(temporary_home) / "capture-seen"
            client = JsonlRuntimeClient(
                node_path=sys.executable,
                runtime_path=FAKE_RUNTIME,
                environment={
                    "FAKE_TOOL_SCHEMA_DIGEST": "schema-digest",
                    "FAKE_FAIL_FIRST_CAPTURE_MARKER": str(capture_marker),
                },
            )
            client.start(
                state_dir=Path(temporary_home) / "partner-mem",
                client={"name": "partner-mem-hermes", "version": "0.1.0"},
            )

            restart_stop_entered = threading.Event()
            allow_restart_stop = threading.Event()
            original_stop_process = client._stop_process

            def controlled_stop_process(*, timeout_seconds: float) -> None:
                if threading.current_thread().name == "capture-thread":
                    restart_stop_entered.set()
                    allow_restart_stop.wait(timeout=2.0)
                original_stop_process(timeout_seconds=timeout_seconds)

            client._stop_process = controlled_stop_process
            outcome = {}

            def capture() -> None:
                try:
                    outcome["result"] = client.execute(
                        "memory.capture_turn",
                        {
                            "operation_id": "stable-operation",
                            "identity": {"agent_id": "coder", "session_id": "session-1"},
                            "user_content": "shutdown is racing",
                            "assistant_content": "do not retry after close",
                            "observed_at": "2026-07-10T00:00:00.000Z",
                        },
                        timeout_seconds=1.0,
                    )
                except Exception as error:
                    outcome["error"] = error

            capture_thread = threading.Thread(target=capture, name="capture-thread")
            close_thread = threading.Thread(
                target=lambda: client.close(timeout_seconds=1.0),
                name="close-thread",
            )
            capture_thread.start()
            self.assertTrue(restart_stop_entered.wait(timeout=2.0))
            close_thread.start()
            deadline = time.monotonic() + 2.0
            while not client._closed and time.monotonic() < deadline:
                time.sleep(0.001)
            self.assertTrue(client._closed)
            allow_restart_stop.set()
            capture_thread.join(timeout=2.0)
            close_thread.join(timeout=2.0)

            try:
                self.assertFalse(capture_thread.is_alive())
                self.assertFalse(close_thread.is_alive())
                self.assertIsInstance(outcome.get("error"), RuntimeTransportError)
                self.assertNotIn("result", outcome)
                self.assertIsNone(client._process)
            finally:
                original_stop_process(timeout_seconds=0.25)

    def test_read_failure_never_restarts_the_runtime(self) -> None:
        with TemporaryDirectory() as temporary_home:
            marker = Path(temporary_home) / "assemble-seen"
            client = JsonlRuntimeClient(
                node_path=sys.executable,
                runtime_path=FAKE_RUNTIME,
                environment={
                    "FAKE_TOOL_SCHEMA_DIGEST": "schema-digest",
                    "FAKE_FAIL_FIRST_ASSEMBLE_MARKER": str(marker),
                },
            )
            client.start(
                state_dir=Path(temporary_home) / "partner-mem",
                client={"name": "partner-mem-hermes", "version": "0.1.0"},
            )
            initial = client.execute(
                "tools.invoke",
                {
                    "identity": {"agent_id": "coder", "session_id": "session-1"},
                    "tool_name": "partner_mem_status",
                    "arguments": {},
                },
                timeout_seconds=1.0,
            )

            with self.assertRaises(RuntimeTransportError):
                client.execute(
                    "memory.assemble_context",
                    {
                        "identity": {"agent_id": "coder", "session_id": "session-1"},
                        "query": "do not restart",
                        "limit": 4,
                    },
                    timeout_seconds=1.0,
                )
            with self.assertRaises(RuntimeTransportError):
                client.execute(
                    "memory.assemble_context",
                    {
                        "identity": {"agent_id": "coder", "session_id": "session-1"},
                        "query": "still broken",
                        "limit": 4,
                    },
                    timeout_seconds=1.0,
                )
            client.close(timeout_seconds=1.0)
            failed_pid = int(marker.read_text(encoding="utf-8"))

        self.assertEqual(failed_pid, initial["result"]["pid"])

    def test_malformed_response_marks_runtime_broken(self) -> None:
        with TemporaryDirectory() as temporary_home:
            client = JsonlRuntimeClient(
                node_path=sys.executable,
                runtime_path=FAKE_RUNTIME,
                environment={
                    "FAKE_TOOL_SCHEMA_DIGEST": "schema-digest",
                    "FAKE_MALFORMED_METHOD": "memory.assemble_context",
                },
            )
            client.start(
                state_dir=Path(temporary_home) / "partner-mem",
                client={"name": "partner-mem-hermes", "version": "0.1.0"},
            )

            with self.assertRaises(RuntimeTransportError):
                client.execute(
                    "memory.assemble_context",
                    {
                        "identity": {"agent_id": "coder", "session_id": "session-1"},
                        "query": "malformed",
                        "limit": 4,
                    },
                    timeout_seconds=1.0,
                )
            with self.assertRaises(RuntimeTransportError):
                client.execute(
                    "tools.invoke",
                    {
                        "identity": {"agent_id": "coder", "session_id": "session-1"},
                        "tool_name": "partner_mem_status",
                        "arguments": {},
                    },
                    timeout_seconds=1.0,
                )
            client.close(timeout_seconds=1.0)

    def test_close_closes_stdin_after_ack_so_runtime_can_exit_naturally(self) -> None:
        with TemporaryDirectory() as temporary_home:
            marker = Path(temporary_home) / "natural-close"
            client = JsonlRuntimeClient(
                node_path=sys.executable,
                runtime_path=FAKE_RUNTIME,
                environment={
                    "FAKE_TOOL_SCHEMA_DIGEST": "schema-digest",
                    "FAKE_CLOSE_WAITS_FOR_EOF": "1",
                    "FAKE_NATURAL_CLOSE_MARKER": str(marker),
                },
            )
            client.start(
                state_dir=Path(temporary_home) / "partner-mem",
                client={"name": "partner-mem-hermes", "version": "0.1.0"},
            )

            client.close(timeout_seconds=1.0)

            self.assertEqual(marker.read_text(encoding="utf-8"), "closed")


if __name__ == "__main__":
    unittest.main()
