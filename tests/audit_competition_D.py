"""Independent raw-source audit of D output; requires prepare_data.py first.

Does not use D's extraction helpers to validate evidence. Sensitivity results
invoke the builder separately and are not independent football ground truth.
"""
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def audit():
    def read(name):
        return json.loads((ROOT / name).read_text(encoding="utf-8"))
    source_path = ROOT / "data/raw/events_3869685.json"
    assert hashlib.sha256(source_path.read_bytes()).hexdigest() == "a0b0036d50c10a4c8879d1ee9f24a7502ec2cfb264a61951c8d500dfc897ec35"
    raw = {event["id"]: event for event in read("data/raw/events_3869685.json")}
    players = read("data/processed/players.json")
    roster = {player["player_id"]: player for player in players}
    events = sorted(read("data/processed/events.json"), key=lambda event: (event["period"], event["event_index"]))
    normalized = {event["event_id"]: event for event in events}
    positions = {event["event_id"]: index for index, event in enumerate(events)}
    edges = read("data/processed/competition_edges.json")
    anchors = {"Pressure", "Duel", "Interception", "Dispossessed", "Ball Recovery"}
    contexts = anchors | {"Pass", "Carry", "Dribble", "Shot", "Ball Receipt*"}
    edge_ids, windows, sizes = set(), set(), Counter()
    for edge in edges:
        assert edge["edge_id"] not in edge_ids
        edge_ids.add(edge["edge_id"])
        ids = edge["event_ids"]
        assert ids and len(ids) == len(set(ids)) and tuple(ids) not in windows
        windows.add(tuple(ids))
        assert 3 <= len(edge["player_ids"]) <= 8
        assert len(edge["player_ids"]) == len(set(edge["player_ids"]))
        assert edge["weight"] == 1 and edge["type"] == "competition"
        assert edge["evidence_type"] == "event_window_inference"
        sources = [raw[event_id] for event_id in ids]
        assert len(sources) <= 24
        assert len({event["period"] for event in sources}) == 1 and sources[0]["period"] in (1, 2, 3, 4)
        assert len({event["possession"] for event in sources}) == 1
        participants, actor_teams, times = set(), set(), []
        for event in sources:
            assert event["type"]["name"] in contexts
            actor, team = str(event["player"]["id"]), str(event["team"]["id"])
            assert roster[actor]["team_id"] == team
            assert normalized[event["id"]]["player_id"] == actor
            participants.add(actor)
            actor_teams.add(team)
            if event["type"]["name"] == "Pass" and event.get("pass", {}).get("recipient"):
                recipient = str(event["pass"]["recipient"]["id"])
                if recipient in roster and roster[recipient]["team_id"] == team:
                    participants.add(recipient)
            times.append(event["minute"] * 60 + event["second"])
        assert participants == set(edge["player_ids"])
        assert actor_teams == set(edge["team_ids"]) and len(actor_teams) >= 2
        assert abs(min(times) / 60 - edge["start_minute"]) < 1e-9
        assert abs(max(times) / 60 - edge["end_minute"]) < 1e-9
        assert max(times) - min(times) <= 5
        assert any(event["type"]["name"] in anchors and all(abs(time - times[index]) <= 2.5 for time in times)
                   for index, event in enumerate(sources))
        indices = [positions[event_id] for event_id in ids]
        assert indices == sorted(indices)
        intervening = events[min(indices):max(indices) + 1]
        assert all(event["period"] == sources[0]["period"] and event["possession_id"] == normalized[ids[0]]["possession_id"]
                   and event.get("player_id") in roster for event in intervening)
        assert all(left["time_seconds"] <= right["time_seconds"] for left, right in zip(intervening, intervening[1:]))
        sizes[len(participants)] += 1
    from scripts.build_competition import build_competition
    sensitivity = {}
    for seconds in (3, 5, 8):
        result, _ = build_competition(players, events, window_seconds=seconds)
        sensitivity[str(seconds)] = len(result)
        if seconds == 5:
            assert result == edges, "committed/default output must reproduce exactly"
    sample = next(edge for edge in edges if "5503" in edge["player_ids"])
    return {
        "status": "passed", "match_id": "3869685", "competition_edges": len(edges),
        "cardinality_counts": dict(sorted(sizes.items())),
        "star_participation": {player: sum(player in edge["player_ids"] for edge in edges) for player in ("5503", "3009")},
        "window_seconds_sensitivity": sensitivity,
        "sample": {**sample, "player_names": [roster[player]["player_name"] for player in sample["player_ids"]]},
        "checks": ["pinned raw event SHA256", "every participant independently traced to raw actor/intended recipient",
                   "two actual actor teams", "period/possession/order/clock continuity", "exact raw times and anchor-centered 5s bounds",
                   "unique evidence windows, unit weights, 3-8 players, <=24 events", "default extraction reproduces all edges"],
    }


if __name__ == "__main__":
    print(json.dumps(audit(), ensure_ascii=False, indent=2))
