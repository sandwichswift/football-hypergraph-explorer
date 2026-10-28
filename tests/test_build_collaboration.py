"""B fixtures are synthetic and never loaded into the production page."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("collaboration_b", ROOT / "scripts/build_collaboration.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
build = module.build_collaboration
PLAYERS = [{"player_id": f"mock-{i}", "team_id": "A" if i < 7 else "B"} for i in range(1, 9)]


def event(index, actor=1, recipient=2, **patch):
    return {"event_id": f"mock-event-{index}", "event_index": index, "period": 1,
            "time_seconds": index, "minute": 0, "second": index,
            "type": "Pass", "outcome": "complete", "team_id": "A",
            "player_id": f"mock-{actor}", "recipient_id": f"mock-{recipient}",
            "possession_id": "mock-possession", **patch}


class CollaborationTests(unittest.TestCase):
    def test_exact_three_preserves_evidence_and_input(self):
        events = [event(1), event(2, 2, 3)]
        before = copy.deepcopy(events)
        edges, audit = build(PLAYERS, events)
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["player_ids"], ["mock-1", "mock-2", "mock-3"])
        self.assertEqual(edges[0]["event_ids"], ["mock-event-1", "mock-event-2"])
        self.assertEqual((edges[0]["start_minute"], edges[0]["end_minute"]), (1/60, 2/60))
        self.assertEqual(edges[0]["weight"], 1)
        self.assertEqual(audit["output_edges"], 1)
        self.assertEqual(events, before)

    def test_empty_single_pass_and_two_players_do_not_become_pair_graphs(self):
        for events in [[], [event(1)], [event(1), event(2, 2, 1), event(3, 1, 2)]]:
            with self.subTest(events=events):
                self.assertEqual(build(PLAYERS, events)[0], [])

    def test_source_order_not_input_array_order_and_stable_ids(self):
        events = [event(1), event(2, 2, 3), event(3, 3, 4)]
        self.assertEqual(build(PLAYERS, events)[0], build(PLAYERS, list(reversed(events)))[0])

    def test_trailing_windows_keep_raw_unit_weight_and_bound_passes(self):
        roster = [{**player, "team_id": "A"} for player in PLAYERS]
        edges, _ = build(roster, [event(i, i, i+1) for i in range(1, 7)])
        self.assertEqual([len(edge["event_ids"]) for edge in edges], [2, 3, 4, 4, 4])
        self.assertTrue(all(edge["weight"] == 1 for edge in edges))
        self.assertEqual(len({edge["edge_id"] for edge in edges}), len(edges))

    def test_duration_closed_boundary_and_just_outside(self):
        self.assertEqual(len(build(PLAYERS, [event(1, time_seconds=0), event(2, 2, 3, time_seconds=20)])[0]), 1)
        self.assertEqual(build(PLAYERS, [event(1, time_seconds=0), event(2, 2, 3, time_seconds=20.001)])[0], [])

    def test_cardinality_limit_skips_entire_window_not_members(self):
        edges, audit = build(PLAYERS, [event(1), event(2, 2, 3), event(3, 3, 4)], max_players=3)
        self.assertEqual(len(edges), 1)
        self.assertEqual(audit["counts"]["oversized_windows"], 1)

    def test_possession_period_shootout_and_clock_regressions_break(self):
        for patch in [{"possession_id": "other"}, {"period": 2}, {"period": 5}, {"time_seconds": 0}, {"possession_id": None}]:
            with self.subTest(patch=patch):
                self.assertEqual(build(PLAYERS, [event(1), event(2, 2, 3, **patch)])[0], [])

    def test_unknown_failed_missing_and_foreign_recipient_break_chain(self):
        for patch in [{"outcome": "unknown"}, {"outcome": "incomplete"}, {"outcome": None}, {"recipient_id": None}, {"recipient_id": "missing"}, {"recipient_id": "mock-7"}, {"recipient_id": "mock-2"}]:
            with self.subTest(patch=patch):
                edges, _ = build(PLAYERS, [event(1), event(2, 2, 3, **patch), event(3, 3, 4)])
                self.assertEqual(edges, [])

    def test_disconnected_next_actor_does_not_link_unobserved_pass(self):
        self.assertEqual(build(PLAYERS, [event(1), event(2, 3, 4)])[0], [])

    def test_bridges_allow_carry_but_stoppages_and_opponents_break(self):
        for kind, team, actor, expected in [("Carry", "A", 2, 1), ("Shot", "A", 2, 0), ("Pressure", "B", 7, 0), ("Carry", "B", 7, 0)]:
            with self.subTest(kind=kind, team=team):
                edges, _ = build(PLAYERS, [event(1), event(2, actor, type=kind, team_id=team, recipient_id=None), event(3, 2, 3)])
                self.assertEqual(len(edges), expected)

    def test_reused_possession_id_after_interruption_is_not_stitched(self):
        self.assertEqual(build(PLAYERS, [event(1), event(2, possession_id="other", type="Carry"), event(3, 2, 3)])[0], [])

    def test_bad_time_or_unknown_actor_cannot_bridge(self):
        for patch in [{"time_seconds": None, "minute": None}, {"player_id": None}, {"player_id": "missing"}, {"team_id": "B"}]:
            self.assertEqual(build(PLAYERS, [event(1), event(2, 2, 3, **patch), event(3, 3, 4)])[0], [])

    def test_invalid_configuration_and_identity_fail_explicitly(self):
        for patch in [{"max_passes": 1}, {"max_passes": True}, {"max_players": 2}, {"max_seconds": float("nan")}, {"max_seconds": 0}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                build(PLAYERS, [], **patch)
        for events in [[event(1), event(1)], [event(1, event_id="other"), event(1)], [event(1, event_index=None)], [event(1, period=True)]]:
            with self.assertRaises(ValueError): build(PLAYERS, events)
        with self.assertRaises(ValueError): build(PLAYERS + [PLAYERS[0]], [])

    def test_cli_normal_empty_failure_and_no_input_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            players, events, output, diagnostics = [root / name for name in ["p.json", "e.json", "out.json", "audit.json"]]
            players.write_text(json.dumps(PLAYERS))
            events.write_text(json.dumps([event(1), event(2, 2, 3)]))
            command = [sys.executable, str(ROOT / "scripts/build_collaboration.py"), "--players", str(players), "--events", str(events), "--output", str(output), "--diagnostics", str(diagnostics)]
            result = subprocess.run(command, capture_output=True, text=True, cwd=directory)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(len(json.loads(output.read_text())), 1)
            events.write_text("[]")
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(json.loads(output.read_text()), [])
            events.unlink()
            failure = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(failure.returncode, 2)
            self.assertIn("FAILED", failure.stderr)
            self.assertEqual(json.loads(output.read_text()), [])
            self.assertEqual(subprocess.run(command + ["--output", str(players)], capture_output=True).returncode, 2)
            self.assertEqual(json.loads(players.read_text()), PLAYERS)


if __name__ == "__main__":
    unittest.main()
