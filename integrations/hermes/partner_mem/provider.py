"""Hermes MemoryProvider adapter for the Partner-Mem runtime."""

from __future__ import annotations

import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List
from uuid import uuid4

from agent.memory_provider import MemoryProvider

from .config import (
    PartnerMemConfig,
    load_config,
    merge_config_update,
    save_config as save_profile_config,
)
from .host_contract import (
    SUPPORTED_HERMES_VERSION,
    read_hermes_version as _read_hermes_version,
    require_supported_hermes_version,
)
from .node_contract import node_is_supported
from .runtime_client import JsonlRuntimeClient, validate_runtime_descriptor

try:
    from tools.registry import tool_error
except ImportError:  # pragma: no cover - unit tests do not load Hermes tools.
    def tool_error(message: str) -> str:
        return json.dumps({"error": message})


_SCHEMA_PATH = Path(__file__).with_name("generated") / "tool-schemas.json"
_AGENT_CONTEXTS = {"primary", "subagent", "cron", "flush"}
_SQLITE_PACKAGE_VERSION = "1.2.1"
_CLIENT_DESCRIPTOR = {
    "name": "partner-mem-hermes",
    "version": "0.1.0",
    "host": "hermes",
}


class PartnerMemMemoryProvider(MemoryProvider):
    """Translate Hermes memory lifecycle calls into Partner-Mem runtime calls."""

    def __init__(
        self,
        *,
        client_factory: Callable[..., Any] | None = None,
        config_loader: Callable[..., PartnerMemConfig] = load_config,
    ) -> None:
        self._client_factory = client_factory
        self._config_loader = config_loader
        self._client: Any = None
        self._ready = False
        self._session_id = ""
        self._agent_id = ""
        self._agent_context = ""
        self._recall_limit = 4
        self._state_lock = threading.Lock()
        self._lifecycle_lock = threading.RLock()
        self._closed = False
        self._cache_generation = 0
        self._prefetch_generations: Dict[str, int] = {}
        self._prefetch_cache: Dict[str, str] = {}

    @property
    def name(self) -> str:
        return "partner_mem"

    def is_available(self) -> bool:
        try:
            config = self._config_loader(None)
            hermes_version = _read_hermes_version()
        except Exception:
            return False
        return (
            hermes_version == SUPPORTED_HERMES_VERSION
            and node_is_supported(config.node_path)
            and config.runtime_path.is_file()
            and _runtime_dependency_is_installed(config.runtime_path)
        )

    def initialize(self, session_id: str, **kwargs: Any) -> None:
        with self._lifecycle_lock:
            self._initialize_locked(session_id, **kwargs)

    def _initialize_locked(self, session_id: str, **kwargs: Any) -> None:
        if self._closed:
            raise RuntimeError("Partner-Mem runtime provider is closed")
        if self._client is not None or self._ready:
            raise RuntimeError("Partner-Mem runtime is already initialized")
        agent_id = _read_string(kwargs.get("agent_identity"))
        agent_context = _read_string(kwargs.get("agent_context"))
        hermes_home = _read_string(kwargs.get("hermes_home"))
        if not agent_id:
            raise ValueError("Partner-Mem requires Hermes agent_identity")
        if not session_id.strip():
            raise ValueError("Partner-Mem requires a Hermes session_id")
        if not hermes_home:
            raise ValueError("Partner-Mem requires hermes_home")
        if agent_context not in _AGENT_CONTEXTS:
            raise ValueError(
                "Partner-Mem requires agent_context to be primary, subagent, cron, or flush"
            )
        hermes_version = require_supported_hermes_version(_read_hermes_version())

        config = self._config_loader(hermes_home)
        self._recall_limit = config.recall_limit
        client = (
            self._client_factory()
            if self._client_factory is not None
            else JsonlRuntimeClient(
                node_path=config.node_path,
                runtime_path=config.runtime_path,
            )
        )
        state_dir = Path(hermes_home).expanduser() / "partner-mem"
        try:
            hello = client.start(
                state_dir=state_dir,
                client={**_CLIENT_DESCRIPTOR, "host_version": hermes_version},
            )
            expected_digest = _schema_digest(self.get_tool_schemas())
            validate_runtime_descriptor(
                hello,
                expected_tool_schema_digest=expected_digest,
            )
        except Exception:
            try:
                client.close(timeout_seconds=1.0)
            except Exception:
                pass
            raise

        with self._state_lock:
            self._client = client
            self._session_id = session_id.strip()
            self._agent_id = agent_id
            self._agent_context = agent_context
            self._ready = True

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        """Return build-generated schemas without starting the runtime."""

        loaded = json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))
        if not isinstance(loaded, list):
            raise ValueError("Partner-Mem tool schema artifact must contain a list")
        return loaded

    def system_prompt_block(self) -> str:
        if not self._ready:
            return ""
        return (
            "# Partner-Mem Memory\n"
            "Active. Use partner_mem_recall for verified original evidence and "
            "partner_mem_search only for candidate navigation."
        )

    def get_config_schema(self) -> List[Dict[str, Any]]:
        return [
            {
                "key": "node_path",
                "description": "Node.js executable used by the bundled Partner-Mem runtime",
                "default": "node",
                "env_var": "PARTNER_MEM_NODE",
            },
            {
                "key": "recall_limit",
                "description": "Maximum verified evidence items injected during prefetch",
                "default": "4",
                "env_var": "PARTNER_MEM_RECALL_LIMIT",
            },
        ]

    def save_config(self, values: Dict[str, Any], hermes_home: str) -> None:
        current = self._config_loader(hermes_home)
        updated = merge_config_update(current, values)
        save_profile_config(
            hermes_home,
            node_path=updated.node_path,
            recall_limit=updated.recall_limit,
        )

    def post_setup(self, hermes_home: str, config: Dict[str, Any]) -> None:
        from .setup import run_post_setup

        run_post_setup(hermes_home, config)

    def sync_turn(
        self,
        user_content: str,
        assistant_content: str,
        *,
        session_id: str = "",
        messages: List[Dict[str, Any]] | None = None,
    ) -> None:
        del messages
        with self._state_lock:
            if not self._ready or self._client is None:
                raise RuntimeError("Partner-Mem runtime is not ready")
            if self._agent_context != "primary":
                return
            client = self._client
            effective_session_id = _read_string(session_id) or self._session_id
            identity = self._identity(effective_session_id)
        client.execute(
            "memory.capture_turn",
            {
                "operation_id": str(uuid4()),
                "identity": identity,
                "user_content": user_content,
                "assistant_content": assistant_content,
                "observed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            },
            timeout_seconds=15.0,
        )

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        clean_query = query.strip()
        if not clean_query:
            return ""

        with self._state_lock:
            if not self._ready or self._client is None:
                return ""
            client = self._client
            effective_session_id = _read_string(session_id) or self._session_id
            recall_limit = self._recall_limit
            identity = self._identity(effective_session_id)
            cached = self._prefetch_cache.pop(effective_session_id, None)
            self._prefetch_generations[effective_session_id] = (
                self._prefetch_generations.get(effective_session_id, 0) + 1
            )
        if cached is not None:
            return cached
        try:
            result = client.execute(
                "memory.assemble_context",
                {
                    "identity": identity,
                    "query": clean_query,
                    "limit": recall_limit,
                },
                timeout_seconds=0.1,
            )
        except Exception:
            return ""
        if not isinstance(result, dict):
            return ""
        text = result.get("text")
        return text if isinstance(text, str) else ""

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        clean_query = query.strip()
        if not clean_query:
            return

        with self._state_lock:
            if not self._ready or self._client is None:
                return
            client = self._client
            generation = self._cache_generation
            effective_session_id = _read_string(session_id) or self._session_id
            prefetch_generation = self._prefetch_generations.get(effective_session_id, 0) + 1
            self._prefetch_generations[effective_session_id] = prefetch_generation
            recall_limit = self._recall_limit
            identity = self._identity(effective_session_id)
        try:
            result = client.execute(
                "memory.assemble_context",
                {
                    "identity": identity,
                    "query": clean_query,
                    "limit": recall_limit,
                },
                timeout_seconds=5.0,
            )
        except Exception:
            return
        if isinstance(result, dict) and isinstance(result.get("text"), str):
            with self._state_lock:
                if (
                    self._ready
                    and self._client is client
                    and self._cache_generation == generation
                    and self._prefetch_generations.get(effective_session_id)
                    == prefetch_generation
                ):
                    self._prefetch_cache[effective_session_id] = result["text"]

    def _identity(self, session_id: str) -> Dict[str, str]:
        return {
            "host": "hermes",
            "agent_id": self._agent_id,
            "session_id": session_id,
            "agent_context": self._agent_context,
        }

    def on_session_switch(self, new_session_id: str, **kwargs: Any) -> None:
        del kwargs
        clean_session_id = new_session_id.strip()
        if not clean_session_id:
            return
        with self._state_lock:
            self._session_id = clean_session_id
            self._cache_generation += 1
            self._prefetch_cache.clear()
            self._prefetch_generations.clear()

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs: Any) -> str:
        reserved_identity_fields = {"agent_id", "session_id", "identity"}
        if reserved_identity_fields.intersection(args):
            return tool_error("Partner-Mem tool arguments must not contain identity fields")
        with self._state_lock:
            if not self._ready or self._client is None:
                return tool_error("Partner-Mem runtime is not ready")
            client = self._client
            effective_session_id = (
                _read_string(kwargs.get("session_id")) or self._session_id
            )
            identity = self._identity(effective_session_id)
        try:
            result = client.execute(
                "tools.invoke",
                {
                    "identity": identity,
                    "tool_name": tool_name,
                    "arguments": dict(args),
                },
                timeout_seconds=15.0,
            )
        except Exception as error:
            return tool_error(str(error))
        if not isinstance(result, dict) or "result" not in result:
            return tool_error("Partner-Mem runtime returned an invalid tool result")
        return json.dumps(result["result"])

    def shutdown(self) -> None:
        with self._lifecycle_lock:
            with self._state_lock:
                self._closed = True
                client = self._client
                self._client = None
                self._ready = False
                self._cache_generation += 1
                self._prefetch_cache.clear()
                self._prefetch_generations.clear()
            if client is None:
                return
            try:
                client.close(timeout_seconds=1.0)
            except Exception:
                return

def _schema_digest(schemas: List[Dict[str, Any]]) -> str:
    canonical = json.dumps(
        schemas,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _read_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _runtime_dependency_is_installed(runtime_path: Path) -> bool:
    manifest = (
        runtime_path.parent.parent.parent
        / "node_modules"
        / "@photostructure"
        / "sqlite"
        / "package.json"
    )
    try:
        loaded = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return isinstance(loaded, dict) and loaded.get("version") == _SQLITE_PACKAGE_VERSION
