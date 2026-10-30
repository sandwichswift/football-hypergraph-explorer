"""Packaging tests use already prepared real data; no invented match outputs."""
import json
from pathlib import Path
import tempfile
import unittest
from scripts.build_offline import ROOT, build, embedded_json


class OfflineBuildTests(unittest.TestCase):
    def setUp(self):
        (ROOT / "output").mkdir(exist_ok=True)

    def test_embedded_json_cannot_close_script_and_roundtrips(self):
        value = {"name": "</script><script>alert(1)</script>\u2028中文"}
        result = embedded_json(value)
        self.assertNotIn("<", result)
        self.assertEqual(json.loads(result), value)

    def test_complete_package_has_embedded_sources_assets_and_real_counts(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "output") as directory:
            output = Path(directory) / "index.html"
            report = build(output)
            self.assertEqual((report["events"], report["collaboration_edges"], report["competition_edges"]), (4407, 531, 385))
            text = output.read_text(encoding="utf-8")
            self.assertIn('data-offline', text)
            self.assertIn("connect-src 'none'", text)
            self.assertIn("data:image/png;base64,", text)
            self.assertIn("data:text/css;base64,", text)
            self.assertNotIn('src="./js/', text)
            self.assertNotIn('href="./css/', text)

    def test_missing_inputs_fail_before_existing_output_is_touched(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "output") as directory:
            output = Path(directory) / "index.html"
            output.write_text("previous verified package", encoding="utf-8")
            with self.assertRaises(OSError):
                build(output, data_dir=Path(directory) / "missing")
            self.assertEqual(output.read_text(), "previous verified package")
