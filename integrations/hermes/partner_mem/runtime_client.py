"""Persistent JSONL client for the standalone Partner-Mem Node runtime."""

from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, Mapping
from uuid import uuid4


PROTOCOL_VERSION = 1
RUNTIME_VERSION = "0.1.0"
RUNTIME_CAPABILITIES = (
    "context.assemble.v1",
    "turn.capture.v1",
    "tools.invoke.v1",
)
_RUNTIME_DESCRIPTOR_FIELDS = {
    "protocol_version",
    "runtime_version",
    "capabilities",
    "tool_schema_digest",
}
DEFAULT_RUNTIME_PATH = (
    Path(__file__).resolve().parent
    / "runtime"
    / "dist"
    / "runtime"
    / "jsonl-server.js"
)
_EXECUTE_METHODS = {
    "memory.capture_turn",
    "memory.assemble_context",
    "tools.invoke",
}


class RuntimeClientError(RuntimeError):
    """Base error for the Partner-Mem runtime transport."""


class RuntimeTransportError(RuntimeClientError):
    """The child process could not complete a protocol exchange."""


class RuntimeRequestError(RuntimeClientError):
    """The runtime rejected a well-formed request."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


def validate_runtime_descriptor(
    value: Any,
    *,
    expected_tool_schema_digest: str | None = None,
    expected_descriptor: Mapping[str, Any] | None = None,
) -> Dict[str, Any]:
    if not isinstance(value, dict) or set(value) != _RUNTIME_DESCRIPTOR_FIELDS:
        raise RuntimeTransportError("Partner-Mem runtime descriptor fields mismatch")
    protocol_version = value.get("protocol_version")
    if isinstance(protocol_version, bool) or protocol_version != PROTOCOL_VERSION:
        raise RuntimeTransportError("Partner-Mem runtime protocol version mismatch")
    if value.get("runtime_version") != RUNTIME_VERSION:
        raise RuntimeTransportError("Partner-Mem runtime runtime_version mismatch")
    if value.get("capabilities") != list(RUNTIME_CAPABILITIES):
        raise RuntimeTransportError("Partner-Mem runtime capabilities mismatch")
    digest = value.get("tool_schema_digest")
    if not isinstance(digest, str) or not digest.strip():
        raise RuntimeTransportError("Partner-Mem runtime tool schema digest is invalid")
    if expected_tool_schema_digest is not None and digest != expected_tool_schema_digest:
        raise RuntimeTransportError("Partner-Mem runtime tool schema digest mismatch")

    descriptor = dict(value)
    if expected_descriptor is not None and descriptor != dict(expected_descriptor):
        raise RuntimeTransportError("Partner-Mem runtime descriptor changed after restart")
    return descriptor


class _ReaderFailure:
    def __init__(self, message: str) -> None:
        self.message = message


class JsonlRuntimeClient:
    """Own one Node child and serialize request/response exchanges over JSONL."""

    def __init__(
        self,
        *,
        node_path: str = "node",
        runtime_path: Path | str = DEFAULT_RUNTIME_PATH,
        environment: Mapping[str, str] | None = None,
        popen_factory: Callable[..., Any] = subprocess.Popen,
    ) -> None:
        self._node_path = node_path
        self._runtime_path = Path(runtime_path).expanduser()
        self._environment = dict(environment or {})
        self._popen_factory = popen_factory
        self._process: Any = None
        self._responses: queue.Queue[Any] = queue.Queue()
        self._reader_thread: threading.Thread | None = None
        self._request_lock = threading.Lock()
        self._lifecycle_lock = threading.RLock()
        self._start_params: Dict[str, Any] | None = None
        self._hello: Dict[str, Any] | None = None
        self._broken = False
        self._closed = False

    def start(self, *, state_dir: Path, client: Dict[str, Any]) -> Dict[str, Any]:
        with self._lifecycle_lock:
            return self._start_locked(state_dir=state_dir, client=client)

    def _start_locked(
        self, *, state_dir: Path, client: Dict[str, Any]
    ) -> Dict[str, Any]:
        if self._closed:
            raise RuntimeTransportError("Partner-Mem runtime client is closed")
        if self._process is not None:
            if self._hello is None:
                raise RuntimeTransportError("Partner-Mem runtime start is already in progress")
            return dict(self._hello)

        self._start_params = {
            "state_dir": str(Path(state_dir).expanduser()),
            "client": dict(client),
        }
        self._spawn()
        try:
            result = self._request(
                "runtime.start",
                self._start_params,
                deadline=time.monotonic() + 5.0,
            )
        except Exception:
            self._stop_process(timeout_seconds=0.25)
            raise
        try:
            descriptor = validate_runtime_descriptor(result)
        except RuntimeTransportError:
            self._stop_process(timeout_seconds=0.25)
            raise
        self._hello = descriptor
        return dict(descriptor)

    def execute(
        self,
        method: str,
        params: Dict[str, Any],
        *,
        timeout_seconds: float,
    ) -> Any:
        deadline = time.monotonic() + max(timeout_seconds, 0.0)
        acquired = self._lifecycle_lock.acquire(
            timeout=max(deadline - time.monotonic(), 0.0)
        )
        if not acquired:
            raise RuntimeTransportError(
                "Partner-Mem runtime lifecycle lock timed out"
            )
        try:
            return self._execute_locked(
                method,
                params,
                deadline=deadline,
            )
        finally:
            self._lifecycle_lock.release()

    def _execute_locked(
        self,
        method: str,
        params: Dict[str, Any],
        *,
        deadline: float,
    ) -> Any:
        if self._closed:
            raise RuntimeTransportError("Partner-Mem runtime client is closed")
        if method not in _EXECUTE_METHODS:
            raise ValueError(f"Unsupported Partner-Mem runtime method: {method}")
        try:
            return self._request(method, dict(params), deadline=deadline)
        except RuntimeTransportError:
            if method != "memory.capture_turn" or time.monotonic() >= deadline:
                raise

        self._restart(deadline=deadline)
        if self._closed:
            raise RuntimeTransportError("Partner-Mem runtime client is closed")
        return self._request(method, dict(params), deadline=deadline)

    def close(self, *, timeout_seconds: float = 1.0) -> None:
        if self._closed:
            return
        self._closed = True
        deadline = time.monotonic() + max(timeout_seconds, 0.0)
        acquired = self._lifecycle_lock.acquire(
            timeout=max(deadline - time.monotonic(), 0.0)
        )
        if not acquired:
            self._stop_process(timeout_seconds=0.0)
            return
        try:
            process = self._process
            if process is not None and not self._broken and process.poll() is None:
                try:
                    self._request(
                        "runtime.close",
                        {},
                        deadline=deadline,
                    )
                except Exception:
                    pass
            if process is not None and process.stdin is not None:
                try:
                    process.stdin.close()
                except Exception:
                    pass
            self._stop_process(timeout_seconds=max(deadline - time.monotonic(), 0.0))
        finally:
            self._lifecycle_lock.release()

    @property
    def runtime_path(self) -> Path:
        return self._runtime_path

    def _spawn(self) -> None:
        if not self._runtime_path.is_file():
            raise RuntimeTransportError(
                f"Partner-Mem runtime is missing: {self._runtime_path}"
            )
        environment = dict(os.environ)
        environment.update(self._environment)
        try:
            process = self._popen_factory(
                [self._node_path, str(self._runtime_path)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=None,
                text=True,
                encoding="utf-8",
                errors="strict",
                bufsize=1,
                env=environment,
            )
        except Exception as error:
            raise RuntimeTransportError(
                f"Partner-Mem runtime process could not start: {error}"
            ) from error
        if process.stdin is None or process.stdout is None:
            self._terminate_process(process, timeout_seconds=0.25)
            raise RuntimeTransportError("Partner-Mem runtime process has no stdio pipes")

        responses: queue.Queue[Any] = queue.Queue()
        self._process = process
        self._responses = responses
        self._broken = False
        reader = threading.Thread(
            target=self._read_responses,
            args=(process, responses),
            daemon=True,
            name="partner-mem-runtime-reader",
        )
        self._reader_thread = reader
        reader.start()

    @staticmethod
    def _read_responses(process: Any, responses: queue.Queue[Any]) -> None:
        try:
            for line in process.stdout:
                try:
                    response = json.loads(line)
                except Exception as error:
                    responses.put(_ReaderFailure(f"invalid runtime JSON: {error}"))
                    return
                responses.put(response)
        except Exception as error:
            responses.put(_ReaderFailure(f"runtime stdout failed: {error}"))
            return
        responses.put(_ReaderFailure("Partner-Mem runtime closed stdout"))

    def _request(
        self,
        method: str,
        params: Dict[str, Any],
        *,
        deadline: float,
    ) -> Any:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeTransportError("Partner-Mem runtime request deadline expired")
        if not self._request_lock.acquire(timeout=remaining):
            raise RuntimeTransportError("Partner-Mem runtime request lock timed out")
        try:
            if time.monotonic() >= deadline:
                raise RuntimeTransportError(
                    "Partner-Mem runtime request deadline expired"
                )
            process = self._process
            if (
                process is None
                or self._broken
                or process.poll() is not None
                or process.stdin is None
            ):
                raise RuntimeTransportError("Partner-Mem runtime is not available")

            request_id = str(uuid4())
            envelope = {
                "protocol_version": PROTOCOL_VERSION,
                "request_id": request_id,
                "method": method,
                "params": params,
            }
            if time.monotonic() >= deadline:
                raise RuntimeTransportError(
                    "Partner-Mem runtime request deadline expired"
                )
            try:
                process.stdin.write(
                    json.dumps(envelope, separators=(",", ":"), ensure_ascii=False)
                    + "\n"
                )
                process.stdin.flush()
            except Exception as error:
                self._broken = True
                raise RuntimeTransportError(
                    f"Partner-Mem runtime request write failed: {error}"
                ) from error

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self._broken = True
                raise RuntimeTransportError(
                    "Partner-Mem runtime response timed out"
                )
            try:
                response = self._responses.get(timeout=remaining)
            except queue.Empty as error:
                self._broken = True
                raise RuntimeTransportError("Partner-Mem runtime response timed out") from error

            if isinstance(response, _ReaderFailure):
                self._broken = True
                raise RuntimeTransportError(response.message)
            if not isinstance(response, dict):
                self._broken = True
                raise RuntimeTransportError("Partner-Mem runtime returned a non-object response")
            protocol_version = response.get("protocol_version")
            if isinstance(protocol_version, bool) or protocol_version != PROTOCOL_VERSION:
                self._broken = True
                raise RuntimeTransportError("Partner-Mem runtime protocol version mismatch")
            if response.get("request_id") != request_id:
                self._broken = True
                raise RuntimeTransportError("Partner-Mem runtime response request_id mismatch")
            if response.get("ok") is True:
                if set(response) != {
                    "protocol_version",
                    "request_id",
                    "ok",
                    "result",
                }:
                    self._broken = True
                    raise RuntimeTransportError(
                        "Partner-Mem runtime returned an invalid success response"
                    )
                return response["result"]
            if response.get("ok") is False:
                if set(response) != {
                    "protocol_version",
                    "request_id",
                    "ok",
                    "error",
                }:
                    self._broken = True
                    raise RuntimeTransportError(
                        "Partner-Mem runtime returned an invalid error response"
                    )
                error_value = response["error"]
                if (
                    not isinstance(error_value, dict)
                    or set(error_value) != {"code", "message", "retryable"}
                    or not isinstance(error_value.get("code"), str)
                    or not error_value["code"].strip()
                    or not isinstance(error_value.get("message"), str)
                    or not error_value["message"].strip()
                    or not isinstance(error_value.get("retryable"), bool)
                ):
                    self._broken = True
                    raise RuntimeTransportError(
                        "Partner-Mem runtime returned a malformed error object"
                    )
                raise RuntimeRequestError(error_value["code"], error_value["message"])

            self._broken = True
            raise RuntimeTransportError(
                "Partner-Mem runtime response ok field must be a boolean"
            )
        finally:
            self._request_lock.release()

    def _restart(self, *, deadline: float) -> None:
        if self._closed or self._start_params is None or self._hello is None:
            raise RuntimeTransportError("Partner-Mem runtime cannot be restarted")
        if time.monotonic() >= deadline:
            raise RuntimeTransportError("Partner-Mem runtime request deadline expired")
        expected_hello = self._hello
        self._stop_process(
            timeout_seconds=min(max(deadline - time.monotonic(), 0.0), 0.25)
        )
        if self._closed:
            raise RuntimeTransportError("Partner-Mem runtime cannot restart during close")
        if time.monotonic() >= deadline:
            raise RuntimeTransportError("Partner-Mem runtime request deadline expired")
        self._spawn()
        if self._closed:
            self._stop_process(timeout_seconds=0.0)
            raise RuntimeTransportError("Partner-Mem runtime cannot restart during close")
        try:
            hello = self._request(
                "runtime.start",
                dict(self._start_params),
                deadline=deadline,
            )
        except Exception:
            self._stop_process(timeout_seconds=0.0)
            raise
        if self._closed:
            self._stop_process(timeout_seconds=0.0)
            raise RuntimeTransportError("Partner-Mem runtime cannot restart during close")
        try:
            self._hello = validate_runtime_descriptor(
                hello,
                expected_descriptor=expected_hello,
            )
        except RuntimeTransportError:
            self._broken = True
            raise

    def _stop_process(self, *, timeout_seconds: float) -> None:
        process = self._process
        self._process = None
        self._broken = True
        if process is None:
            return
        try:
            self._terminate_process(process, timeout_seconds=timeout_seconds)
        finally:
            for stream_name in ("stdin", "stdout"):
                stream = getattr(process, stream_name, None)
                if stream is not None:
                    try:
                        stream.close()
                    except Exception:
                        pass

    @staticmethod
    def _terminate_process(process: Any, *, timeout_seconds: float) -> None:
        if process.poll() is not None:
            return
        deadline = time.monotonic() + max(timeout_seconds, 0.0)
        try:
            process.wait(timeout=max(deadline - time.monotonic(), 0.0))
            return
        except subprocess.TimeoutExpired:
            pass
        try:
            process.terminate()
            process.wait(timeout=max(deadline - time.monotonic(), 0.0))
            return
        except Exception:
            pass
        try:
            process.kill()
        except Exception:
            return
        try:
            process.wait(timeout=max(deadline - time.monotonic(), 0.0))
        except subprocess.TimeoutExpired:
            threading.Thread(
                target=JsonlRuntimeClient._reap_process,
                args=(process,),
                daemon=True,
                name="partner-mem-runtime-reaper",
            ).start()
        except Exception:
            pass

    @staticmethod
    def _reap_process(process: Any) -> None:
        try:
            process.wait()
        except Exception:
            pass
