"""Hermes MemoryProvider adapter for Partner-Mem V1."""

from __future__ import annotations

import json
import logging
import os
import queue
import shutil
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from agent.memory_provider import MemoryProvider
except Exception:  # pragma: no cover - used by local adapter tests outside Hermes
    class MemoryProvider:  # type: ignore[no-redef]
        pass

from .runtime_client import (
    PartnerMemRuntimeClient,
    PartnerMemRuntimeError,
    bundled_runtime_entry,
    default_runtime_command,
)

logger = logging.getLogger(__name__)

HARNESS_TYPE = "hermes"
STATE_VERSION = 1
TOOL_NAMES = {
    "partner_mem_keyword_search": "keyword",
    "partner_mem_vector_search": "vector",
    "partner_mem_graph_traverse": "graph",
}


class PartnerMemMemoryProvider(MemoryProvider):
    """Hermes provider that stores final visible turns in Partner-Mem."""

    @property
    def name(self) -> str:
        return "partner_mem"

    def __init__(self) -> None:
        self._session_id = ""
        self._source_agent_id: Optional[str] = None
        self._writes_enabled = False
        self._state_path: Optional[Path] = None
        self._database_path: Optional[Path] = None
        self._harness_id: Optional[str] = None
        self._client: Optional[PartnerMemRuntimeClient] = None
        self._ready_lock = threading.Lock()
        self._queue: "queue.Queue[Optional[Dict[str, Any]]]" = queue.Queue()
        self._worker: Optional[threading.Thread] = None
        self._closed = False

    def is_available(self) -> bool:
        if shutil.which("node") is None:
            return False
        command = default_runtime_command()
        executable = command[0] if command else ""
        if os.path.sep in executable:
            return Path(executable).exists()
        if shutil.which(executable) is None:
            return False
        runtime_path = bundled_runtime_entry()
        return bool(os.environ.get("PARTNER_MEM_HERMES_RUNTIME_COMMAND")) or runtime_path.exists()

    def initialize(self, session_id: str, **kwargs: Any) -> None:
        with self._ready_lock:
            if self._client is not None:
                self._session_id = _trim(session_id)
                return

            self._session_id = _trim(session_id)
            self._source_agent_id = _optional_string(kwargs.get("agent_identity"))
            self._writes_enabled = _optional_string(kwargs.get("agent_context")) in (None, "primary")

            hermes_home = Path(_optional_string(kwargs.get("hermes_home")) or Path.home() / ".hermes")
            default_data_dir = hermes_home / "plugins" / "partner_mem" / "data"
            self._state_path = Path(
                _optional_string(kwargs.get("partner_mem_state_path"))
                or os.environ.get("PARTNER_MEM_HERMES_STATE_PATH", "")
                or default_data_dir / "state.json"
            )
            self._database_path = Path(
                _optional_string(kwargs.get("partner_mem_database_path"))
                or os.environ.get("PARTNER_MEM_HERMES_DB_PATH", "")
                or default_data_dir / "partner-mem.sqlite"
            )
            self._state_path.parent.mkdir(parents=True, exist_ok=True)
            self._database_path.parent.mkdir(parents=True, exist_ok=True)
            self._client = PartnerMemRuntimeClient(database_path=self._database_path)
            self._harness_id = self._load_or_register_harness()
            self._start_worker()

    def system_prompt_block(self) -> str:
        return ""

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        return ""

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        return None

    def sync_turn(
        self,
        user_content: str,
        assistant_content: str,
        *,
        session_id: str = "",
        messages: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        if self._closed or not self._writes_enabled:
            return
        conversation = _trim(session_id) or self._session_id
        question_text = user_content if isinstance(user_content, str) else ""
        answer_text = assistant_content if isinstance(assistant_content, str) else ""
        if not conversation or (not question_text.strip() and not answer_text.strip()):
            return
        self._start_worker()
        self._queue.put(
            {
                "conversation": conversation,
                "question_text": question_text,
                "answer_text": answer_text,
                "agent": self._source_agent_id,
            }
        )

    def on_session_switch(
        self,
        new_session_id: str,
        *,
        parent_session_id: str = "",
        reset: bool = False,
        rewound: bool = False,
        **kwargs: Any,
    ) -> None:
        self._session_id = _trim(new_session_id)

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        schemas = _load_canonical_tool_schemas()
        return [
            {
                "name": schema["name"],
                "description": schema["description"],
                "parameters": schema["inputSchema"],
            }
            for schema in schemas
        ]

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs: Any) -> str:
        if tool_name not in TOOL_NAMES:
            return json.dumps(_unavailable_envelope(tool_name, "Unknown Partner-Mem tool"))
        conversation = _trim(kwargs.get("session_id")) or self._session_id
        if not conversation:
            return json.dumps(_unavailable_envelope(tool_name, "Hermes session_id is unavailable"))
        try:
            client = self._require_client()
            result = client.request(
                "invoke_tool",
                _compact(
                    {
                        "harness_id": self._require_harness_id(),
                        "source_conversation_id": conversation,
                        "source_agent_id": self._source_agent_id,
                        "tool_name": tool_name,
                        "arguments": args if isinstance(args, dict) else {},
                    }
                ),
            )
            return json.dumps(result, ensure_ascii=False)
        except Exception as exc:
            logger.debug("Partner-Mem Hermes tool call failed: %s", exc)
            return json.dumps(_unavailable_envelope(tool_name, "Partner-Mem is unavailable"))

    def shutdown(self) -> None:
        self._closed = True
        try:
            self._queue.put_nowait(None)
        except Exception:
            pass
        worker = self._worker
        if worker is not None:
            worker.join(timeout=1.0)
        client = self._client
        self._client = None
        if client is not None:
            client.close()

    def _load_or_register_harness(self) -> str:
        assert self._state_path is not None
        assert self._database_path is not None
        if self._state_path.exists():
            data = json.loads(self._state_path.read_text(encoding="utf-8"))
            if data.get("version") != STATE_VERSION:
                raise PartnerMemRuntimeError("Partner-Mem Hermes state version is invalid")
            harness_id = _optional_string(data.get("harness_id"))
            if not harness_id:
                raise PartnerMemRuntimeError("Partner-Mem Hermes state lacks harness_id")
            if not self._database_path.exists():
                raise PartnerMemRuntimeError(
                    "Partner-Mem Hermes state exists but the database is missing"
                )
            return harness_id

        result = self._require_client().request("register_harness", {"harness_type": HARNESS_TYPE})
        harness_id = _optional_string(result.get("harness_id"))
        if not harness_id:
            raise PartnerMemRuntimeError("Partner-Mem runtime did not return harness_id")
        self._write_state_atomically({"version": STATE_VERSION, "harness_id": harness_id})
        return harness_id

    def _write_state_atomically(self, data: Dict[str, Any]) -> None:
        assert self._state_path is not None
        tmp_path = self._state_path.with_name(
            f"{self._state_path.name}.{uuid.uuid4().hex}.tmp"
        )
        tmp_path.write_text(json.dumps(data, sort_keys=True) + "\n", encoding="utf-8")
        tmp_path.replace(self._state_path)

    def _start_worker(self) -> None:
        if self._worker is not None and self._worker.is_alive():
            return
        self._worker = threading.Thread(
            target=self._worker_loop,
            name="partner-mem-hermes-writer",
            daemon=True,
        )
        self._worker.start()

    def _worker_loop(self) -> None:
        while True:
            job = self._queue.get()
            if job is None:
                return
            try:
                self._write_turn(job)
            except Exception as exc:
                logger.debug("Partner-Mem Hermes background write failed: %s", exc)

    def _write_turn(self, job: Dict[str, Any]) -> None:
        client = self._require_client()
        harness_id = self._require_harness_id()
        conversation = job["conversation"]
        question_text = job["question_text"]
        answer_text = job["answer_text"]
        agent = job.get("agent")
        if question_text.strip():
            question_result = client.request(
                "record_question",
                _compact(
                    {
                        "harness_id": harness_id,
                        "source_conversation_id": conversation,
                        "text": question_text,
                        "role": "user",
                        "source_access_agent_id": agent,
                    }
                ),
            )
            node_id = _optional_string(question_result.get("node_id"))
            if answer_text.strip() and node_id:
                client.request(
                    "record_answer",
                    _compact(
                        {
                            "harness_id": harness_id,
                            "source_conversation_id": conversation,
                            "node_id": node_id,
                            "text": answer_text,
                            "role": "assistant",
                            "source_agent_id": agent,
                            "source_access_agent_id": agent,
                        }
                    ),
                )
            return
        if answer_text.strip():
            client.request(
                "record_answer",
                _compact(
                    {
                        "harness_id": harness_id,
                        "source_conversation_id": conversation,
                        "question_was_absent": True,
                        "text": answer_text,
                        "role": "assistant",
                        "source_agent_id": agent,
                        "source_access_agent_id": agent,
                    }
                ),
            )

    def _require_client(self) -> PartnerMemRuntimeClient:
        if self._client is None:
            raise PartnerMemRuntimeError("Partner-Mem Hermes provider is not initialized")
        return self._client

    def _require_harness_id(self) -> str:
        if not self._harness_id:
            raise PartnerMemRuntimeError("Partner-Mem Hermes harness_id is unavailable")
        return self._harness_id


def register(ctx: Any) -> None:
    ctx.register_memory_provider(PartnerMemMemoryProvider())


def _load_canonical_tool_schemas() -> List[Dict[str, Any]]:
    candidates = [
        Path(__file__).resolve().parent / "tool-schemas.json",
        Path(__file__).resolve().parents[3] / "src" / "tools" / "generated" / "tool-schemas.json",
    ]
    for candidate in candidates:
        if candidate.exists():
            with candidate.open(encoding="utf-8") as handle:
                data = json.load(handle)
            if isinstance(data, list):
                return data
    raise FileNotFoundError("Partner-Mem canonical tool schema artifact was not found")


def _unavailable_envelope(tool_name: str, message: str) -> Dict[str, Any]:
    return {
        "status": "error",
        "retrieval_type": TOOL_NAMES.get(tool_name, "keyword"),
        "truncated": False,
        "evidence_items": [],
        "error_code": "partner_mem_unavailable",
    }


def _compact(value: Dict[str, Any]) -> Dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None and item != ""}


def _trim(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _optional_string(value: Any) -> Optional[str]:
    text = _trim(value)
    return text or None
