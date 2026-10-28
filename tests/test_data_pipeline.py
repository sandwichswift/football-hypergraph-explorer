"""A-module acceptance: real source reconciliation, rebuild, and malformed inputs.

Run: python -m unittest discover -s tests -p "test_data*.py" -v
No network is used. Real-source tests require scripts/load_data.py once.
"""

import copy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from calculate_stats import calculate_metrics
from load_data import SOURCE_FILES, fetch_sources, read_json, verify_file, write_json
from preprocess import diagnostics, normalize_events, normalize_players


def fixture():
    lineups = [
        {
            "team_id": 1,
            "team_name": "Fixture team",
            "lineup": [
                {
                    "player_id": 11,
                    "player_name": "Fixture One",
                    "jersey_number": 4,
                    "positions": [],
                },
                {
                    "player_id": 12,
                    "player_name": "Fixture Two",
                    "positions": [{"position": "Midfielder"}],
                },
            ],
        }
    ]
    event = {
        "id": "fixture-pass",
        "index": 1,
        "period": 1,
        "minute": 2,
        "second": 3,
        "type": {"name": "Pass"},
        "team": {"id": 1},
        "player": {"id": 11},
        "possession": 1,
        "pass": {"recipient": {"id": 12}},
    }
    return lineups, event


class BoundaryTests(unittest.TestCase):
    def test_empty_data(self):
        self.assertEqual(normalize_players([], []), [])
        self.assertEqual(normalize_events([], []), [])
        self.assertEqual(
            calculate_metrics([], {}, xg_available=False),
            {
                "passes": 0,
                "successful_passes": 0,
                "pass_accuracy": None,
                "shots": 0,
                "goals": 0,
                "assists": 0,
                "xg": None,
            },
        )

    def test_optional_fields_and_source_success_semantics(self):
        lineups, event = fixture()
        players = normalize_players(lineups, [event])
        result = normalize_events([event], players)[0]
        self.assertIsNone(players[0]["position"])
        self.assertIsNone(players[1]["shirt_number"])
        self.assertIsNone(result["location"])
        self.assertIsNone(result["xg"])
        self.assertEqual(result["outcome"], "complete")
        self.assertEqual(result["time_seconds"], 123)
        self.assertEqual(result["recipient_id"], "12")
        self.assertEqual(result["related_event_ids"], [])

    def test_missing_name_uses_only_observed_source_name(self):
        lineups, event = fixture()
        del lineups[0]["lineup"][0]["player_name"]
        self.assertIsNone(normalize_players(lineups, [event])[0]["player_name"])
        event["player"]["name"] = "Actual source name"
        self.assertEqual(
            normalize_players(lineups, [event])[0]["player_name"], "Actual source name"
        )

    def test_explicit_null_outcome_does_not_become_complete(self):
        lineups, event = fixture()
        event["pass"]["outcome"] = None
        result = normalize_events([event], normalize_players(lineups, [event]))[0]
        self.assertIsNone(result["outcome"])

    def test_missing_pass_object_fails_instead_of_inventing_success(self):
        lineups, event = fixture()
        del event["pass"]
        with self.assertRaisesRegex(ValueError, "missing its pass object"):
            normalize_events([event], normalize_players(lineups, [event]))

    def test_unknown_and_incomplete_passes_remain_distinct(self):
        for outcome in ("Unknown", "Incomplete", "Out", "Pass Offside"):
            with self.subTest(outcome=outcome):
                lineups, event = fixture()
                event["pass"]["outcome"] = {"name": outcome}
                normalized = normalize_events([event], normalize_players(lineups, [event]))
                self.assertEqual(normalized[0]["outcome"], outcome.lower())
                metric = calculate_metrics(normalized, {event["id"]: event}, xg_available=False)
                self.assertEqual(metric["successful_passes"], 0)
                self.assertEqual(metric["pass_accuracy"], 0)

    def test_goalkeeper_outcome_uses_actual_source_key(self):
        lineups, event = fixture()
        event["type"]["name"] = "Goal Keeper"
        event["goalkeeper"] = {"outcome": {"name": "Success"}}
        result = normalize_events([event], normalize_players(lineups, [event]))[0]
        self.assertEqual(result["outcome"], "success")

    def test_unknown_recipient_and_player_are_rejected_with_event_id(self):
        lineups, event = fixture()
        event["pass"]["recipient"]["id"] = 999
        with self.assertRaisesRegex(ValueError, "fixture-pass: recipient 999"):
            normalize_events([event], normalize_players(lineups, [event]))
        event["pass"].pop("recipient")
        event["player"]["id"] = 999
        with self.assertRaisesRegex(ValueError, "fixture-pass: player 999"):
            normalize_events([event], normalize_players(lineups, [event]))

    def test_duplicate_event_and_broken_reference_are_rejected(self):
        lineups, event = fixture()
        players = normalize_players(lineups, [event])
        with self.assertRaisesRegex(ValueError, "duplicate event id"):
            normalize_events([event, copy.deepcopy(event)], players)
        event["related_events"] = ["missing-id"]
        with self.assertRaisesRegex(ValueError, "related event IDs absent"):
            normalize_events([event], players)

    def test_non_finite_values_are_rejected(self):
        lineups, event = fixture()
        event["location"] = [float("nan"), 1]
        with self.assertRaisesRegex(ValueError, "invalid location"):
            normalize_events([event], normalize_players(lineups, [event]))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "existing.json"
            path.write_text("original", encoding="utf-8")
            with self.assertRaises(ValueError):
                write_json(path, {"xg": float("nan")})
            self.assertEqual(path.read_text(), "original")

    def test_missing_xg_stays_null_and_zero_shots_is_zero_only_when_available(self):
        shot = {"event_id": "s", "type": "Shot", "outcome": "goal", "xg": None}
        result = calculate_metrics([shot], {}, xg_available=True)
        self.assertIsNone(result["xg"])
        self.assertIsNone(result["pass_accuracy"])
        self.assertEqual(result["goals"], 1)
        self.assertEqual(calculate_metrics([], {}, xg_available=True)["xg"], 0)

    def test_missing_shot_detail_does_not_invent_zero_goals(self):
        lineups, event = fixture()
        event["type"]["name"] = "Shot"
        normalized = normalize_events([event], normalize_players(lineups, [event]))
        result = calculate_metrics(normalized, {event["id"]: event}, xg_available=False)
        self.assertEqual(result["shots"], 1)
        self.assertIsNone(result["goals"])
        self.assertIsNone(result["xg"])

    def test_assist_requires_actual_raw_flag(self):
        lineups, event = fixture()
        normalized = normalize_events([event], normalize_players(lineups, [event]))
        self.assertEqual(
            calculate_metrics(normalized, {event["id"]: event}, xg_available=False)["assists"], 0
        )
        event["pass"]["goal_assist"] = True
        self.assertEqual(
            calculate_metrics(normalized, {event["id"]: event}, xg_available=False)["assists"], 1
        )
        with self.assertRaisesRegex(ValueError, "Missing raw pass evidence"):
            calculate_metrics(normalized, {}, xg_available=False)

    def test_offline_missing_and_corrupted_cache_fail_without_network(self):
        with tempfile.TemporaryDirectory() as folder:
            raw_dir = Path(folder)
            with self.assertRaisesRegex(ValueError, "Offline input missing"):
                fetch_sources(raw_dir, offline=True)
            path = raw_dir / "events_3869685.json"
            path.write_text("[]", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "SHA256 mismatch"):
                verify_file(path, SOURCE_FILES[path.name][1])


class RealSourceAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw_dir = ROOT / "data/raw"
        if not (raw_dir / "events_3869685.json").exists():
            raise unittest.SkipTest(
                "Run python scripts/load_data.py to enable real-source acceptance"
            )
        cls.raw_events = read_json(raw_dir / "events_3869685.json")
        cls.lineups = read_json(raw_dir / "lineups_3869685.json")
        cls.players = read_json(ROOT / "data/processed/players.json")
        cls.events = read_json(ROOT / "data/processed/events.json")
        cls.stats = read_json(ROOT / "data/processed/stats.json")

    def test_all_contract_fields_ids_and_related_references(self):
        self.assertEqual(len(self.events), 4407)
        self.assertEqual(len(self.players), 50)
        expected_keys = {
            "event_id",
            "event_index",
            "period",
            "minute",
            "second",
            "time_seconds",
            "team_id",
            "player_id",
            "type",
            "possession_id",
            "recipient_id",
            "outcome",
            "location",
            "related_event_ids",
            "xg",
        }
        player_ids = {player["player_id"] for player in self.players}
        event_ids = {event["event_id"] for event in self.events}
        for event in self.events:
            self.assertEqual(set(event), expected_keys)
            for key in ("event_id", "team_id", "player_id", "possession_id", "recipient_id"):
                self.assertTrue(event[key] is None or isinstance(event[key], str))
            for key in ("player_id", "recipient_id"):
                self.assertTrue(event[key] is None or event[key] in player_ids)
            self.assertLessEqual(set(event["related_event_ids"]), event_ids)

    def test_all_fifty_player_metrics_against_raw_independent_counters(self):
        for player in self.players:
            with self.subTest(player=player["player_name"]):
                raw = [
                    event
                    for event in self.raw_events
                    if event["period"] < 5
                    and str(event.get("player", {}).get("id")) == player["player_id"]
                ]
                passes = [event for event in raw if event["type"]["name"] == "Pass"]
                shots = [event for event in raw if event["type"]["name"] == "Shot"]
                actual = self.stats["players"][player["player_id"]]
                success = sum("outcome" not in event["pass"] for event in passes)
                self.assertEqual(actual["passes"], len(passes))
                self.assertEqual(actual["successful_passes"], success)
                self.assertEqual(actual["pass_accuracy"], success / len(passes) if passes else None)
                self.assertEqual(actual["shots"], len(shots))
                self.assertEqual(
                    actual["goals"],
                    sum(event["shot"]["outcome"]["name"] == "Goal" for event in shots),
                )
                self.assertEqual(
                    actual["assists"],
                    sum(event["pass"].get("goal_assist") is True for event in passes),
                )
                self.assertAlmostEqual(
                    actual["xg"], sum(event["shot"]["statsbomb_xg"] for event in shots), places=6
                )

    def test_team_totals_and_shootout_are_separate(self):
        teams = {team["team_id"]: team for team in self.stats["teams"]}
        for team_id, expected in {
            "779": (693, 560, 20, 3, 4, 1, 2.758306),
            "771": (570, 434, 10, 3, 2, 1, 2.272618),
        }.items():
            actual = tuple(
                teams[team_id][key]
                for key in (
                    "passes",
                    "successful_passes",
                    "shots",
                    "goals",
                    "shootout_score",
                    "assists",
                    "xg",
                )
            )
            self.assertEqual(actual, expected)
        self.assertEqual(sum(player["goals"] for player in self.stats["players"].values()), 6)
        self.assertEqual(
            sum(event["type"] == "Shot" and event["period"] == 5 for event in self.events), 8
        )
        self.assertEqual(
            sum(event["outcome"] == "unknown" for event in self.events if event["type"] == "Pass"),
            10,
        )

    def test_source_clock_preserved_in_source_order_with_logged_anomalies(self):
        raw_by_id = {event["id"]: event for event in self.raw_events}
        self.assertEqual(
            self.events,
            sorted(self.events, key=lambda event: (event["period"], event["event_index"])),
        )
        for event in self.events:
            raw = raw_by_id[event["event_id"]]
            self.assertEqual(
                (event["minute"], event["second"], event["time_seconds"]),
                (raw["minute"], raw["second"], raw["minute"] * 60 + raw["second"]),
            )
        audit = diagnostics(self.players, self.events)
        self.assertEqual(
            [item["event_index"] for item in audit["clock_regressions"]],
            [1752, 3438, 3441, 3975, 3978, 4387],
        )
        self.assertEqual(audit["players_with_events"], 34)

    def test_rebuild_from_empty_directory_is_byte_identical_and_preserves_other_files(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            # Simulate other members' independently generated output; A must not remove it.
            sentinel = output / "collaboration_edges.json"
            sentinel.write_text("other member data", encoding="utf-8")
            for script in ("preprocess.py", "calculate_stats.py"):
                result = subprocess.run(
                    [sys.executable, str(ROOT / "scripts" / script), "--output-dir", str(output)],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                )
                self.assertEqual(result.returncode, 0, result.stderr)
            for name in ("players.json", "events.json", "stats.json"):
                self.assertEqual(
                    (output / name).read_bytes(), (ROOT / "data/processed" / name).read_bytes()
                )
            self.assertEqual(sentinel.read_text(), "other member data")


if __name__ == "__main__":
    unittest.main()
