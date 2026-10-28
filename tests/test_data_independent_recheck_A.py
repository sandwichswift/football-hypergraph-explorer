"""Independent A recheck: integrity failure and unknown/missing-data boundaries."""

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from shutil import copyfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from calculate_stats import build_stats, calculate_metrics
from load_data import SOURCE_FILES, fetch_sources
from preprocess import normalize_events, normalize_players


class IndependentRecheck(unittest.TestCase):
    def test_bad_network_content_never_replaces_existing_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            raw_dir = Path(folder)
            cached = raw_dir / "events_3869685.json"
            cached.write_bytes(b"existing cache must survive failed force download")
            with patch(
                "load_data.urllib.request.urlopen",
                return_value=io.BytesIO(b"wrong downloaded bytes"),
            ):
                with self.assertRaisesRegex(ValueError, "Downloaded checksum mismatch"):
                    fetch_sources(raw_dir, force=True)
            self.assertEqual(
                cached.read_bytes(), b"existing cache must survive failed force download"
            )
            self.assertFalse((raw_dir / "source_manifest.json").exists())
            self.assertFalse((raw_dir / "events_3869685.json.download").exists())

    def test_offline_validation_does_not_access_network(self):
        with tempfile.TemporaryDirectory() as folder:
            raw_dir = Path(folder)
            for name in SOURCE_FILES:
                copyfile(ROOT / "data/raw" / name, raw_dir / name)
            with (
                patch(
                    "load_data.urllib.request.urlopen",
                    side_effect=AssertionError("offline contacted network"),
                ),
                redirect_stdout(io.StringIO()),
            ):
                manifest = fetch_sources(raw_dir, offline=True)
            self.assertEqual(set(manifest["files"]), set(SOURCE_FILES))
            self.assertTrue((raw_dir / "source_manifest.json").is_file())

    def test_explicit_null_and_source_unknown_are_different_statistics(self):
        lineups = [
            {
                "team_id": 1,
                "team_name": "Synthetic boundary fixture",
                "lineup": [{"player_id": 1, "player_name": "Synthetic test player"}],
            }
        ]
        raw = {
            "id": "synthetic-null",
            "index": 1,
            "period": 1,
            "minute": 0,
            "second": 0,
            "type": {"name": "Pass"},
            "player": {"id": 1},
            "team": {"id": 1},
            "pass": {"outcome": None},
        }
        players = normalize_players(lineups, [raw])
        missing = calculate_metrics(
            normalize_events([raw], players), {raw["id"]: raw}, xg_available=False
        )
        self.assertIsNone(missing["successful_passes"])
        self.assertIsNone(missing["pass_accuracy"])
        raw["pass"]["outcome"] = {"name": "Unknown"}
        unknown = calculate_metrics(
            normalize_events([raw], players), {raw["id"]: raw}, xg_available=False
        )
        self.assertEqual(unknown["successful_passes"], 0)
        self.assertEqual(unknown["pass_accuracy"], 0)

    def test_manually_changed_processed_input_fails_before_stats_replacement(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            (output / "players.json").write_bytes(
                (ROOT / "data/processed/players.json").read_bytes()
            )
            events = json.loads((ROOT / "data/processed/events.json").read_text(encoding="utf-8"))
            events[0]["minute"] = 999
            (output / "events.json").write_text(json.dumps(events), encoding="utf-8")
            (output / "stats.json").write_text(
                "existing stats must survive rejected input", encoding="utf-8"
            )
            with self.assertRaisesRegex(ValueError, "Processed inputs differ"):
                build_stats(ROOT / "data/raw", output)
            self.assertEqual(
                (output / "stats.json").read_text(), "existing stats must survive rejected input"
            )


if __name__ == "__main__":
    unittest.main()
