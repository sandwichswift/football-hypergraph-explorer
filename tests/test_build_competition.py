"""All observations in this file are synthetic test records, never match truth."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest

from scripts.build_competition import build_competition, main

PLAYERS = [{"player_id": player, "team_id": team} for player, team in
           [("a", "A"), ("b", "A"), ("c", "A"), ("x", "B"), ("y", "B")]]


def event(index, player, kind, seconds, **patch):
    return {"event_id": f"e{index}", "event_index": index, "period": 1,
            "possession_id": "pos1", "player_id": player,
            "team_id": next(p["team_id"] for p in PLAYERS if p["player_id"] == player),
            "time_seconds": seconds, "type": kind, **patch}


def normal():
    return [event(1, "a", "Pass", 60, recipient_id="b"), event(2, "x", "Pressure", 61),
            event(3, "b", "Carry", 62)]


class CompetitionEvidenceTests(unittest.TestCase):
    def test_normal_traceability_determinism_and_exact_time(self):
        records = normal()
        edges, report = build_competition(PLAYERS, records)
        self.assertEqual(report["output_edges"], 1)
        edge = edges[0]
        self.assertEqual(edge["player_ids"], ["a", "b", "x"])
        self.assertEqual(edge["team_ids"], ["A", "B"])
        self.assertEqual(edge["event_ids"], ["e1", "e2", "e3"])
        self.assertEqual((edge["start_minute"], edge["end_minute"]), (1, 62 / 60))
        self.assertEqual(edge["weight"], 1)
        self.assertEqual(edge["evidence_type"], "event_window_inference")
        self.assertEqual(build_competition(PLAYERS, list(reversed(records)))[0], edges)

    def test_empty_and_two_player_windows(self):
        self.assertEqual(build_competition([], [])[0], [])
        self.assertEqual(build_competition(PLAYERS, [event(1, "a", "Duel", 0), event(2, "x", "Duel", 0)])[0], [])

    def test_no_actual_competition_event_does_not_become_competition(self):
        records = [event(1, "a", "Pass", 0, recipient_id="b"), event(2, "x", "Carry", 1)]
        self.assertEqual(build_competition(PLAYERS, records)[0], [])

    def test_window_exact_endpoints_included_but_outside_excluded(self):
        records = [event(1, "a", "Pass", 0), event(2, "x", "Pressure", 2.5), event(3, "b", "Carry", 5)]
        self.assertEqual(len(build_competition(PLAYERS, records)[0]), 1)
        records[2]["time_seconds"] = 5.00001
        self.assertEqual(build_competition(PLAYERS, records)[0], [])

    def test_no_cross_period_possession_or_reused_possession_bridge(self):
        for key, value in [("period", 2), ("possession_id", "pos2")]:
            records = normal()
            records[1][key] = value
            self.assertEqual(build_competition(PLAYERS, records)[0], [])
        records = normal()
        records.insert(1, event(10, "y", "Carry", 60.5, possession_id="other", event_index=1.5))
        # Invalid ordering is explicit rather than silently using input order.
        with self.assertRaises(ValueError):
            build_competition(PLAYERS, records)

    def test_returning_possession_does_not_rejoin_noncontiguous_runs(self):
        records = [event(1, "a", "Pass", 0), event(2, "y", "Carry", 1, possession_id="other"),
                   event(3, "x", "Pressure", 2), event(4, "b", "Carry", 3)]
        self.assertEqual(build_competition(PLAYERS, records)[0], [])

    def test_regressing_clock_and_missing_times_break_runs(self):
        records = normal()
        records[1]["time_seconds"] = 59
        self.assertEqual(build_competition(PLAYERS, records)[0], [])
        records = normal()
        records[1]["time_seconds"] = None
        self.assertEqual(build_competition(PLAYERS, records)[0], [])

    def test_unknown_players_and_opposing_pass_recipient_not_invented(self):
        records = [event(1, "a", "Pass", 0, recipient_id="unknown"), event(2, "x", "Pressure", 1)]
        self.assertEqual(build_competition(PLAYERS, records)[0], [])
        records[0]["recipient_id"] = "y"
        self.assertEqual(build_competition(PLAYERS, records)[0], [])
        records[0]["recipient_id"] = "b"
        self.assertEqual(len(build_competition(PLAYERS, records)[0]), 1)
        records[1]["team_id"] = "A"
        self.assertEqual(build_competition(PLAYERS, records)[0], [])

    def test_identical_source_windows_deduplicated_not_player_combinations(self):
        records = normal()
        records[2]["type"] = "Duel"
        edges, report = build_competition(PLAYERS, records)
        self.assertEqual(len(edges), 1)
        self.assertEqual(report["counts"]["duplicate_windows"], 1)
        later = [dict(row, event_id=f"later-{row['event_id']}", event_index=row["event_index"] + 10,
                      time_seconds=row["time_seconds"] + 20) for row in normal()]
        self.assertEqual(len(build_competition(PLAYERS, normal() + later)[0]), 2)

    def test_shootout_null_possession_and_size_limits(self):
        self.assertEqual(build_competition(PLAYERS, [dict(row, period=5) for row in normal()])[0], [])
        self.assertEqual(build_competition(PLAYERS, [dict(row, possession_id=None) for row in normal()])[0], [])
        self.assertEqual(build_competition(PLAYERS, normal(), max_events=2)[0], [])
        records = normal() + [event(4, "y", "Duel", 62.5)]
        self.assertEqual(build_competition(PLAYERS, records, max_players=3)[0], [])

    def test_duplicates_missing_order_and_bad_parameters_fail_explicitly(self):
        with self.assertRaises(ValueError): build_competition(PLAYERS, normal() * 2)
        with self.assertRaises(ValueError): build_competition(PLAYERS, [dict(normal()[0], event_index=None)])
        for window in [0, -1, float("nan"), float("inf")]:
            with self.assertRaises(ValueError): build_competition(PLAYERS, normal(), window_seconds=window)

    def test_cli_missing_input_outputs_empty_and_exit_two_then_recovers(self):
        # Keep generated test files inside the checkout on restricted Windows hosts.
        with tempfile.TemporaryDirectory(prefix="module-d-", dir=Path(__file__).resolve().parent) as temporary:
            root = Path(temporary)
            players, events, output = [root / name for name in ["players.json", "events.json", "edges.json"]]
            args = ["--players", str(players), "--events", str(events), "--output", str(output)]
            with contextlib.redirect_stderr(io.StringIO()) as log:
                self.assertEqual(main(args), 2)
            self.assertIn("input_error", log.getvalue())
            self.assertEqual(json.loads(output.read_text()), [])
            players.write_text(json.dumps(PLAYERS), encoding="utf-8")
            events.write_text(json.dumps(normal()), encoding="utf-8")
            with contextlib.redirect_stderr(io.StringIO()): self.assertEqual(main(args), 0)
            self.assertEqual(len(json.loads(output.read_text())), 1)


if __name__ == "__main__":
    unittest.main()
