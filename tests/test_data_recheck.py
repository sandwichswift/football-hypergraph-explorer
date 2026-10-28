"""Additional A missing-field regressions, using explicitly synthetic fixtures.

These tests exercise pure functions only. The production CLI is pinned to one
verified match and is not a general-purpose importer for arbitrary StatsBomb data.
"""

import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from calculate_stats import calculate_metrics
from preprocess import normalize_events, normalize_players


def inputs():
    lineups = [
        {
            "team_id": 1,
            "team_name": "Synthetic team",
            "lineup": [
                {
                    "player_id": 11,
                    "player_name": "Synthetic player",
                    "jersey_number": 5,
                    "positions": [{"position": "Midfielder"}],
                },
            ],
        }
    ]
    event = {
        "id": "synthetic-pass",
        "index": 1,
        "period": 1,
        "minute": 3,
        "second": 4,
        "type": {"name": "Pass"},
        "team": {"id": 1},
        "player": {"id": 11},
        "pass": {},
        "location": None,
    }
    return lineups, event


class DataMissingFieldRecheck(unittest.TestCase):
    def normalize(self, lineups, event):
        players = normalize_players(lineups, [event])
        return players, normalize_events([event], players)

    def test_name_missing_in_both_sources_is_null(self):
        lineups, event = inputs()
        lineups[0]["lineup"][0].pop("player_name")
        players, _ = self.normalize(lineups, event)
        self.assertIsNone(players[0]["player_name"])

    def test_name_fallback_uses_observed_event_name_only(self):
        lineups, event = inputs()
        lineups[0]["lineup"][0]["player_name"] = None
        event["player"]["name"] = "Observed source name"
        players, _ = self.normalize(lineups, event)
        self.assertEqual(players[0]["player_name"], "Observed source name")

    def test_shirt_number_and_position_missing_are_null(self):
        lineups, event = inputs()
        lineups[0]["lineup"][0].pop("jersey_number")
        lineups[0]["lineup"][0]["positions"] = None
        players, _ = self.normalize(lineups, event)
        self.assertIsNone(players[0]["shirt_number"])
        self.assertIsNone(players[0]["position"])

    def test_null_location_recipient_and_related_records_are_safe(self):
        lineups, event = inputs()
        event["related_events"] = None
        event["pass"]["recipient"] = None
        _, events = self.normalize(lineups, event)
        self.assertIsNone(events[0]["location"])
        self.assertIsNone(events[0]["recipient_id"])
        self.assertEqual(events[0]["related_event_ids"], [])

    def test_shot_unknown_outcome_is_unknown_goal_count(self):
        lineups, event = inputs()
        event["type"]["name"] = "Shot"
        event["shot"] = {"outcome": {"name": "Unknown"}, "statsbomb_xg": 0.12}
        _, events = self.normalize(lineups, event)
        result = calculate_metrics(events, {event["id"]: event}, xg_available=True)
        self.assertEqual(events[0]["outcome"], "unknown")
        self.assertEqual(result["shots"], 1)
        self.assertIsNone(result["goals"])
        self.assertEqual(result["xg"], 0.12)

    def test_explicit_null_pass_outcome_does_not_report_zero_success_rate(self):
        lineups, event = inputs()
        event["pass"]["outcome"] = None
        _, events = self.normalize(lineups, event)
        result = calculate_metrics(events, {event["id"]: event}, xg_available=False)
        self.assertIsNone(events[0]["outcome"])
        self.assertEqual(result["passes"], 1)
        self.assertIsNone(result["successful_passes"])
        self.assertIsNone(result["pass_accuracy"])

    def test_recorded_unknown_pass_retains_documented_confirmed_success_fraction(self):
        lineups, event = inputs()
        event["pass"]["outcome"] = {"name": "Unknown"}
        _, events = self.normalize(lineups, event)
        result = calculate_metrics(events, {event["id"]: event}, xg_available=False)
        self.assertEqual(result["successful_passes"], 0)
        self.assertEqual(result["pass_accuracy"], 0.0)

    def test_missing_or_empty_normalized_pass_result_returns_null(self):
        lineups, event = inputs()
        _, events = self.normalize(lineups, event)
        for missing_key in (False, True):
            with self.subTest(missing_key=missing_key):
                candidate = copy.deepcopy(events)
                if missing_key:
                    candidate[0].pop("outcome")
                else:
                    candidate[0]["outcome"] = ""
                result = calculate_metrics(candidate, {event["id"]: event}, xg_available=False)
                self.assertIsNone(result["successful_passes"])
                self.assertIsNone(result["pass_accuracy"])

    def test_partially_missing_xg_is_null_not_partial_sum(self):
        lineups, event = inputs()
        event["type"]["name"] = "Shot"
        event["shot"] = {"outcome": {"name": "Saved"}, "statsbomb_xg": 0.4}
        second = copy.deepcopy(event)
        second["id"], second["index"] = "synthetic-shot-two", 2
        second["shot"].pop("statsbomb_xg")
        players = normalize_players(lineups, [event, second])
        events = normalize_events([event, second], players)
        result = calculate_metrics(
            events, {event["id"]: event, second["id"]: second}, xg_available=True
        )
        self.assertEqual(result["shots"], 2)
        self.assertIsNone(result["xg"])


if __name__ == "__main__":
    unittest.main()
