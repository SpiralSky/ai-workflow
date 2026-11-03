"""Offline launcher identity and fail-closed controls; no installers or actors."""
import copy
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from aiw_sidecar import offline_check as offline


class OfflineCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node = shutil.which("node")
        if not cls.node:
            raise RuntimeError("Explicit installed Node required; never skip")
        cls.runtime = offline.inspect_runtime(cls.node)

    def test_exact_engine_argv_without_any_subprocess_or_network(self):
        env = {"AIW_OFFLINE_CHECKS": "1", "AIW_CHECK_RUNTIME": json.dumps(self.runtime)}
        with patch.dict(os.environ, env), patch.object(subprocess, "run", side_effect=AssertionError("unexpected child")), patch.object(socket, "socket", side_effect=AssertionError("unexpected network")):
            self.assertEqual(offline.pyright_argv("bad.py"), [self.node, self.runtime["pyright"]["entry"], "--outputjson", "bad.py"])

    def test_source_bundle_node_and_version_mismatches_fail_closed(self):
        paths = [("sources", "check.py", "sha256"), ("sources", "offline_check.py", "sha256"),
                 ("pyright", "bundle", "sha256"), ("node", "sha256"), ("pyright", "version")]
        for keys in paths:
            with self.subTest(keys=keys):
                binding = copy.deepcopy(self.runtime)
                target = binding
                for key in keys[:-1]:
                    target = target[key]
                target[keys[-1]] = "changed"
                with patch.object(subprocess, "run", side_effect=AssertionError("unexpected child")), self.assertRaisesRegex(ValueError, "binding changed"):
                    offline.validate_runtime(binding)

    def test_missing_node_and_invalid_bindings_do_not_start_children(self):
        with patch.object(subprocess, "run", side_effect=AssertionError("unexpected child")):
            with self.assertRaises(FileNotFoundError):
                offline.inspect_runtime("/missing-native-check-node")
            for value in (None, {}, {"mode": offline.MODE}):
                with self.assertRaisesRegex(ValueError, "invalid binding"):
                    offline.validate_runtime(value)

    def test_native_marker_and_binding_cannot_silently_fall_back(self):
        for env in ({"AIW_OFFLINE_CHECKS": "0"}, {"AIW_OFFLINE_CHECKS": "1"}, {"AIW_OFFLINE_CHECKS": "1", "AIW_CHECK_RUNTIME": "bad-json"}):
            with patch.dict(os.environ, env, clear=True), self.assertRaises(ValueError):
                offline.pyright_argv("bad.py")

    def test_missing_bundle_chunk_and_wrong_installed_version_fail_before_spawn(self):
        with tempfile.TemporaryDirectory(prefix="offline-package-control-") as directory:
            venv = Path(directory); package = venv / "pyright"; bundle = package / "dist"
            bundle.mkdir(parents=True)
            (bundle / "package.json").write_text(json.dumps({"version": offline.PYRIGHT_VERSION}))
            distribution = SimpleNamespace(version=offline.PYRIGHT_VERSION, locate_file=lambda name: package)
            with patch.object(sys, "prefix", str(venv)), patch.object(offline.importlib.metadata, "distribution", return_value=distribution), patch.object(subprocess, "run", side_effect=AssertionError("unexpected child")):
                with self.assertRaises(FileNotFoundError):
                    offline.inspect_runtime(self.node)
                (bundle / "package.json").write_text('{"version":"0.0.0"}')
                with self.assertRaisesRegex(ValueError, "version mismatch"):
                    offline.inspect_runtime(self.node)

    def test_json_parses_captured_bounded_bytes_without_reopening(self):
        with patch.object(Path, "read_text", side_effect=AssertionError("unbounded reopen")):
            self.assertEqual(offline._runtime_lock()["node"]["version"], "v24.22.1")
        with tempfile.TemporaryDirectory(prefix="offline-json-control-") as directory:
            file = Path(directory) / "package.json"; file.write_bytes(b'{"long":"contents"}')
            with self.assertRaisesRegex(ValueError, "unsupported file"):
                offline._json_file(file, 4)

    def test_special_files_hardlinks_and_excessive_depth_are_bounded(self):
        with tempfile.TemporaryDirectory(prefix="offline-bounds-control-") as directory:
            root = Path(directory)
            fifo = root / "fifo"
            os.mkfifo(fifo)
            with self.assertRaisesRegex(ValueError, "unsupported file"):
                offline._file_hash(fifo)
            regular = root / "regular"; regular.write_text("content")
            os.link(regular, root / "hardlink")
            with self.assertRaisesRegex(ValueError, "unsupported file"):
                offline._file_hash(regular)
        with tempfile.TemporaryDirectory(prefix="offline-depth-control-") as directory:
            root = Path(directory); nested = root
            for _ in range(33):
                nested = nested / "next"; nested.mkdir()
            with self.assertRaisesRegex(ValueError, "directory/depth bound"):
                offline._bundle_hash(root)

    def test_bundle_hash_detects_modified_bytes_and_rejects_symlinks(self):
        with tempfile.TemporaryDirectory(prefix="offline-bundle-control-") as directory:
            root = Path(directory); file = root / "index.js"; file.write_text("one")
            before = offline._bundle_hash(root)
            file.write_text("two")
            self.assertNotEqual(before, offline._bundle_hash(root))
            (root / "alias.js").symlink_to(file)
            with self.assertRaisesRegex(ValueError, "noncanonical"):
                offline._bundle_hash(root)


if __name__ == "__main__":
    if "--json" in sys.argv:
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(OfflineCheckTests))
        counts = {"run": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
                  "skipped": len(result.skipped), "expectedFailures": len(result.expectedFailures),
                  "unexpectedSuccesses": len(result.unexpectedSuccesses)}
        print(json.dumps({"kind": "native-offline-check-controls", "counts": counts}))
        sys.exit(0 if result.wasSuccessful() else 1)
    unittest.main()
