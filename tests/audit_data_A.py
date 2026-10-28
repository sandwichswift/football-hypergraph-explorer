"""Independent read-only reconciliation of A's outputs against source records.

Run after the three pipeline commands: python tests/audit_data_A.py
This auditor deliberately does not import the preprocessing/statistics code.
"""

import json
import math
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def audit(root=ROOT):
    raw = read_json(root / "data/raw/events_3869685.json")
    lineups = read_json(root / "data/raw/lineups_3869685.json")
    events = read_json(root / "data/processed/events.json")
    players = read_json(root / "data/processed/players.json")
    stats = read_json(root / "data/processed/stats.json")
    source_players = {str(p["player_id"]): (p, t) for t in lineups for p in t["lineup"]}
    source_events = {e["id"]: e for e in raw}
    processed_players = {p["player_id"]: p for p in players}
    assert len(processed_players) == len(players) == len(source_players)
    assert set(processed_players) == set(source_players)
    assert len(events) == len(source_events)
    assert {e["event_id"] for e in events} == set(source_events)
    assert [(e["period"], e["event_index"]) for e in events] == sorted(
        (e["period"], e["index"]) for e in raw
    )

    player_keys = {"player_id", "player_name", "team_id", "team_name", "position", "shirt_number"}
    event_keys = {
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
    for pid, p in processed_players.items():
        source, team = source_players[pid]
        assert set(p) == player_keys
        assert p["player_name"] == source["player_name"]
        assert p["team_id"] == str(team["team_id"])
        assert p["team_name"] == team["team_name"]
        assert p["shirt_number"] == source.get("jersey_number")
        positions = source.get("positions", [])
        assert p["position"] == (positions[0]["position"] if positions else None)

    for e in events:
        s = source_events[e["event_id"]]
        assert set(e) == event_keys
        assert e["event_index"] == s["index"]
        assert e["period"] == s["period"]
        assert (e["minute"], e["second"]) == (s["minute"], s["second"])
        assert e["time_seconds"] == s["minute"] * 60 + s["second"]
        assert e["type"] == s["type"]["name"]
        assert e["team_id"] == str(s["team"]["id"])
        assert e["player_id"] == (str(s["player"]["id"]) if "player" in s else None)
        assert e["location"] == s.get("location")
        assert e["related_event_ids"] == s.get("related_events", [])
        assert all(r in source_events for r in e["related_event_ids"])
        for field in ("player_id", "recipient_id"):
            assert e[field] is None or (isinstance(e[field], str) and e[field] in source_players)
        assert e["possession_id"] == (
            str(s["possession"]) if s.get("possession") is not None else None
        )
        assert e["recipient_id"] == (
            str(s["pass"]["recipient"]["id"]) if "recipient" in s.get("pass", {}) else None
        )
        assert e["xg"] == s.get("shot", {}).get("statsbomb_xg")
        if e["type"] == "Pass":
            assert e["outcome"] == s["pass"].get("outcome", {}).get("name", "complete").lower()
        if e["type"] == "Shot":
            assert e["outcome"] == s["shot"]["outcome"]["name"].lower()
        if e["type"] not in ("Pass", "Shot"):
            source_key = {
                "Goal Keeper": "goalkeeper",
                "Ball Receipt*": "ball_receipt",
                "50/50": "50_50",
            }.get(e["type"], e["type"].lower().replace(" ", "_"))
            expected_outcome = s.get(source_key, {}).get("outcome", {}).get("name")
            assert e["outcome"] == (expected_outcome.lower() if expected_outcome else None), (
                e["event_id"],
                e["type"],
                expected_outcome,
                e["outcome"],
            )

    field_events = [e for e in raw if 1 <= e["period"] <= 4]
    assert stats["match_id"] == "3869685"
    assert set(stats["players"]) == set(source_players)
    for pid in source_players:
        own = [e for e in field_events if str(e.get("player", {}).get("id")) == pid]
        passes = [e for e in own if e["type"]["name"] == "Pass"]
        shots = [e for e in own if e["type"]["name"] == "Shot"]
        success = sum("outcome" not in e["pass"] for e in passes)
        expected = {
            "passes": len(passes),
            "successful_passes": success,
            "pass_accuracy": success / len(passes) if passes else None,
            "shots": len(shots),
            "goals": sum(e["shot"]["outcome"]["name"] == "Goal" for e in shots),
            "assists": sum(e["pass"].get("goal_assist") is True for e in passes),
            "xg": sum(e["shot"]["statsbomb_xg"] for e in shots),
        }
        actual = stats["players"][pid]
        for key, expected_value in expected.items():
            value = actual[key]
            if isinstance(expected_value, float):
                assert math.isclose(value, expected_value, abs_tol=1e-6), (
                    pid,
                    key,
                    expected_value,
                    value,
                )
            else:
                assert value == expected_value, (pid, key, expected_value, value)

    source_matches = read_json(root / "data/raw/matches_43_106.json")
    source_match = next(m for m in source_matches if m["match_id"] == 3869685)
    assert len(stats["teams"]) == 2
    for team in stats["teams"]:
        tid = team["team_id"]
        own = [e for e in field_events if str(e["team"]["id"]) == tid]
        passes = [e for e in own if e["type"]["name"] == "Pass"]
        shots = [e for e in own if e["type"]["name"] == "Shot"]
        assert team["passes"] == len(passes)
        assert team["successful_passes"] == sum("outcome" not in e["pass"] for e in passes)
        assert team["shots"] == len(shots)
        assert team["goals"] == sum(e["shot"]["outcome"]["name"] == "Goal" for e in shots)
        assert team["score"] == source_match[f"{team['side']}_score"]
        assert team["shootout_score"] == sum(
            e["period"] == 5
            and str(e["team"]["id"]) == tid
            and e.get("shot", {}).get("outcome", {}).get("name") == "Goal"
            for e in raw
        )
        assert math.isclose(team["xg"], sum(e["shot"]["statsbomb_xg"] for e in shots), abs_tol=1e-6)

    regressions = []
    for previous, current in zip(raw, raw[1:]):
        if (
            previous["minute"] * 60 + previous["second"]
            > current["minute"] * 60 + current["second"]
        ):
            regressions.append(
                {
                    "previous_index": previous["index"],
                    "event_index": current["index"],
                    "event_id": current["id"],
                    "period": current["period"],
                    "type": current["type"]["name"],
                    "same_period": previous["period"] == current["period"],
                }
            )
    assert len(regressions) == 6
    assert [r["event_index"] for r in regressions if r["same_period"]] == [3438, 3975]
    summary = {
        "status": "passed",
        "match_id": "3869685",
        "events": len(events),
        "players_on_team_sheets": len(players),
        "players_with_events": len({e["player"]["id"] for e in raw if "player" in e}),
        "period_counts": dict(Counter(e["period"] for e in raw)),
        "source_pass_outcomes": dict(
            Counter(
                e["pass"].get("outcome", {}).get("name", "complete")
                for e in raw
                if e["type"]["name"] == "Pass"
            )
        ),
        "field_play_shots": sum(e["type"]["name"] == "Shot" for e in field_events),
        "field_play_goals": sum(
            e.get("shot", {}).get("outcome", {}).get("name") == "Goal" for e in field_events
        ),
        "clock_regressions": regressions,
        "checks": [
            "exact v1 keys",
            "all source events retained",
            "all player and event references valid",
            "source clock preserved; period/index order",
            "per-player passes/shots/goals/assists/xG reconciled independently",
        ],
    }
    return summary


if __name__ == "__main__":
    print(json.dumps(audit(), ensure_ascii=False, indent=2))
