from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


PROTOCOL_VERSION = 1
RUNTIME_VERSION = "0.1.0"
CAPABILITIES = [
    "context.assemble.v1",
    "turn.capture.v1",
    "tools.invoke.v1",
]


def respond(request: dict, *, ok: bool, result=None, error=None) -> None:
    response = {
        "protocol_version": (
            True
            if os.environ.get("FAKE_RESPONSE_PROTOCOL_BOOL", "")
            else PROTOCOL_VERSION
        ),
        "request_id": request.get("request_id"),
        "ok": ok,
    }
    if ok:
        response["result"] = result
    else:
        response["error"] = error
    sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
    sys.stdout.flush()


for raw_line in sys.stdin:
    try:
        request = json.loads(raw_line)
    except Exception as error:
        respond({}, ok=False, error={"code": "INVALID_JSON", "message": str(error)})
        continue

    if set(request) != {"protocol_version", "request_id", "method", "params"}:
        respond(
            request,
            ok=False,
            error={"code": "INVALID_ENVELOPE", "message": "unexpected envelope keys"},
        )
        continue
    if request["protocol_version"] != PROTOCOL_VERSION:
        respond(
            request,
            ok=False,
            error={"code": "PROTOCOL_MISMATCH", "message": "unsupported protocol"},
        )
        continue

    method = request["method"]
    params = request["params"]
    if os.environ.get("FAKE_MALFORMED_METHOD", "") == method:
        sys.stdout.write(
            json.dumps(
                {
                    "protocol_version": PROTOCOL_VERSION,
                    "request_id": request["request_id"],
                    "ok": True,
                },
                separators=(",", ":"),
            )
            + "\n"
        )
        sys.stdout.flush()
        continue
    if method == "runtime.start":
        if set(params) != {"state_dir", "client"}:
            respond(
                request,
                ok=False,
                error={"code": "INVALID_PARAMS", "message": "invalid runtime.start params"},
            )
            continue
        runtime_version = RUNTIME_VERSION
        restart_marker_value = os.environ.get(
            "FAKE_RESTART_RUNTIME_VERSION_MARKER", ""
        )
        if restart_marker_value:
            restart_marker = Path(restart_marker_value)
            if restart_marker.exists():
                runtime_version = "0.2.0"
            else:
                restart_marker.parent.mkdir(parents=True, exist_ok=True)
                restart_marker.write_text(str(os.getpid()), encoding="utf-8")
        respond(
            request,
            ok=True,
            result={
                "protocol_version": PROTOCOL_VERSION,
                "runtime_version": runtime_version,
                "capabilities": CAPABILITIES,
                "tool_schema_digest": os.environ.get("FAKE_TOOL_SCHEMA_DIGEST", "digest"),
            },
        )
    elif method == "memory.capture_turn":
        if set(params) != {
            "operation_id",
            "identity",
            "user_content",
            "assistant_content",
            "observed_at",
        }:
            respond(
                request,
                ok=False,
                error={"code": "INVALID_PARAMS", "message": "invalid capture params"},
            )
            continue
        capture_delay = float(os.environ.get("FAKE_CAPTURE_DELAY_SECONDS", "0"))
        if capture_delay > 0:
            time.sleep(capture_delay)
        marker_value = os.environ.get("FAKE_FAIL_FIRST_CAPTURE_MARKER", "")
        if marker_value:
            marker = Path(marker_value)
            if not marker.exists():
                marker.parent.mkdir(parents=True, exist_ok=True)
                marker.write_text(params["operation_id"], encoding="utf-8")
                os._exit(0)
        respond(
            request,
            ok=True,
            result={"pid": os.getpid(), "operation_id": params["operation_id"]},
        )
    elif method == "memory.assemble_context":
        marker_value = os.environ.get("FAKE_FAIL_FIRST_ASSEMBLE_MARKER", "")
        if marker_value:
            marker = Path(marker_value)
            if not marker.exists():
                marker.parent.mkdir(parents=True, exist_ok=True)
                marker.write_text(str(os.getpid()), encoding="utf-8")
                os._exit(0)
        respond(request, ok=True, result={"text": "fake context", "pid": os.getpid()})
    elif method == "tools.invoke":
        respond(request, ok=True, result={"result": {"pid": os.getpid()}})
    elif method == "runtime.close":
        if params != {}:
            respond(
                request,
                ok=False,
                error={"code": "INVALID_PARAMS", "message": "invalid close params"},
            )
            continue
        respond(request, ok=True, result={})
        if not os.environ.get("FAKE_CLOSE_WAITS_FOR_EOF", ""):
            break
    else:
        respond(
            request,
            ok=False,
            error={"code": "UNKNOWN_METHOD", "message": str(method)},
        )

close_marker = os.environ.get("FAKE_NATURAL_CLOSE_MARKER", "")
if close_marker:
    Path(close_marker).write_text("closed", encoding="utf-8")
