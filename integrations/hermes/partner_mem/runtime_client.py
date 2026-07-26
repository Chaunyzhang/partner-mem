"""Partner-Mem JSONL runtime client for the Hermes memory provider."""

from __future__ import annotations

import json
import logging
import os
import queue
import shlex
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class PartnerMemRuntimeError(RuntimeError):
    """Raised when the Partner-Mem child runtime cannot complete one request."""


class PartnerMemRuntimeClient:
    """Persistent single-child JSONL client.

    The client serializes writes with one lock and sends each request exactly
    once. It never restarts the child and never retries a failed request.
    """

    def __init__(self, *, database_path: Path, runtime_command: Optional[List[str]] = None):
        self._database_path = database_path
        self._command = runtime_command or default_runtime_command()
        self._lock = threading.Lock()
        self._closed = False
        self._process: Optional[subprocess.Popen[str]] = None
        self._stdout_lines: "queue.Queue[Optional[str]]" = queue.Queue()
        self._reader: Optional[threading.Thread] = None
        self._request_timeout_s = _request_timeout_s()

    @property
    def command(self) -> List[str]:
        return list(self._command)

    def request(self, command: str, params: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            if self._closed:
                raise PartnerMemRuntimeError("Partner-Mem runtime client is closed")
            process = self._ensure_process()
            request_id = uuid.uuid4().hex
            payload = {"id": request_id, "command": command, "params": params}
            try:
                assert process.stdin is not None
                assert process.stdout is not None
                process.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
                process.stdin.flush()
                line = self._stdout_lines.get(timeout=self._request_timeout_s)
                if line is None:
                    self._closed = True
                    self._terminate_process()
                    raise PartnerMemRuntimeError("Partner-Mem runtime exited before responding")
            except queue.Empty as exc:
                self._closed = True
                self._terminate_process()
                raise PartnerMemRuntimeError("Partner-Mem runtime request timed out") from exc
            except PartnerMemRuntimeError:
                raise
            except Exception as exc:  # pragma: no cover - depends on broken pipes
                self._closed = True
                self._terminate_process()
                raise PartnerMemRuntimeError(f"Partner-Mem runtime transport failed: {exc}") from exc
            try:
                response = json.loads(line)
            except json.JSONDecodeError as exc:
                self._closed = True
                self._terminate_process()
                raise PartnerMemRuntimeError("Partner-Mem runtime emitted invalid JSON") from exc
            if response.get("id") != request_id:
                self._closed = True
                self._terminate_process()
                raise PartnerMemRuntimeError("Partner-Mem runtime response id did not match request")
            if response.get("ok") is not True:
                error = response.get("error") if isinstance(response.get("error"), dict) else {}
                message = error.get("message") if isinstance(error.get("message"), str) else "request failed"
                raise PartnerMemRuntimeError(message)
            result = response.get("result")
            if not isinstance(result, dict):
                self._closed = True
                self._terminate_process()
                raise PartnerMemRuntimeError("Partner-Mem runtime returned a non-object result")
            return result

    def close(self) -> None:
        with self._lock:
            self._closed = True
        self._terminate_process()

    def _terminate_process(self) -> None:
        process = self._process
        self._process = None
        self._reader = None
        if process is None:
            return
        try:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=1.0)
        except Exception:
            try:
                process.kill()
            except Exception:
                pass
        try:
            if process.stdin is not None:
                process.stdin.close()
        except Exception:
            pass
        try:
            if process.stdout is not None:
                process.stdout.close()
        except Exception:
            pass
        try:
            if process.stderr is not None:
                process.stderr.close()
        except Exception:
            pass

    def _ensure_process(self) -> subprocess.Popen[str]:
        if self._process is not None:
            if self._process.poll() is None:
                return self._process
            self._closed = True
            raise PartnerMemRuntimeError("Partner-Mem runtime child already exited")

        self._database_path.parent.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["PARTNER_MEM_DB_PATH"] = str(self._database_path)
        try:
            self._process = subprocess.Popen(
                self._command + [str(self._database_path)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env,
            )
        except Exception as exc:
            self._closed = True
            raise PartnerMemRuntimeError(f"Failed to start Partner-Mem runtime: {exc}") from exc
        self._reader = threading.Thread(
            target=self._read_stdout,
            args=(self._process,),
            name="partner-mem-runtime-reader",
            daemon=True,
        )
        self._reader.start()
        return self._process

    def _read_stdout(self, process: subprocess.Popen[str]) -> None:
        try:
            assert process.stdout is not None
            for line in process.stdout:
                self._stdout_lines.put(line)
        finally:
            self._stdout_lines.put(None)


def default_runtime_command() -> List[str]:
    configured = os.environ.get("PARTNER_MEM_HERMES_RUNTIME_COMMAND", "").strip()
    if configured:
        return shlex.split(configured)
    runtime_path = bundled_runtime_entry()
    return ["node", str(runtime_path)]


def bundled_runtime_entry() -> Path:
    provider_dir = Path(__file__).resolve().parent
    closure_entry = provider_dir / "runtime" / "dist" / "runtime" / "cli.js"
    if closure_entry.exists():
        return closure_entry
    return provider_dir / "runtime" / "cli.js"


def _request_timeout_s() -> float:
    raw = os.environ.get("PARTNER_MEM_HERMES_REQUEST_TIMEOUT_MS", "").strip()
    if not raw:
        return 8.0
    try:
        value = float(raw)
    except ValueError:
        return 8.0
    return value if value > 0 else 8.0
