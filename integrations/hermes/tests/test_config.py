from __future__ import annotations

import sys
import types
import unittest
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


INTEGRATION_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(INTEGRATION_ROOT))

agent_package = types.ModuleType("agent")
memory_provider_module = types.ModuleType("agent.memory_provider")
memory_provider_module.MemoryProvider = type("MemoryProvider", (), {})
sys.modules.setdefault("agent", agent_package)
sys.modules.setdefault("agent.memory_provider", memory_provider_module)


from partner_mem.config import load_config


class PartnerMemConfigContractTest(unittest.TestCase):
    def test_malformed_json_is_rejected_instead_of_defaulted(self) -> None:
        with TemporaryDirectory() as temporary_home:
            (Path(temporary_home) / "partner_mem.json").write_text(
                "{not-json}\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(ValueError, "valid JSON"):
                load_config(temporary_home)

    def test_non_object_config_is_rejected(self) -> None:
        with TemporaryDirectory() as temporary_home:
            (Path(temporary_home) / "partner_mem.json").write_text(
                "[]\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(ValueError, "JSON object"):
                load_config(temporary_home)

    def test_invalid_recall_limit_is_rejected(self) -> None:
        for value in (0, 51, True, 4.9, "4.9"):
            with self.subTest(value=value), TemporaryDirectory() as temporary_home:
                (Path(temporary_home) / "partner_mem.json").write_text(
                    json.dumps({"node_path": "node", "recall_limit": value}) + "\n",
                    encoding="utf-8",
                )
                with patch.dict("os.environ", {}, clear=True):
                    with self.assertRaisesRegex(ValueError, "between 1 and 50"):
                        load_config(temporary_home)

    def test_unknown_config_fields_are_rejected(self) -> None:
        with TemporaryDirectory() as temporary_home:
            (Path(temporary_home) / "partner_mem.json").write_text(
                '{"node_path":"node","recall_limt":4}\n', encoding="utf-8"
            )
            with self.assertRaisesRegex(ValueError, "unsupported fields.*recall_limt"):
                load_config(temporary_home)


if __name__ == "__main__":
    unittest.main()
