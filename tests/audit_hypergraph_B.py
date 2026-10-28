"""Independent B evidence audit against original StatsBomb events, not fixtures."""
from collections import Counter
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    load = lambda name: json.loads((ROOT / name).read_text(encoding="utf-8"))
    raw = load("data/raw/events_3869685.json")
    edges = load("data/processed/collaboration_edges.json")
    roster = {player["player_id"]: player for player in load("data/processed/players.json")}
    source = {event["id"]: event for event in raw}
    index = {event["id"]: position for position, event in enumerate(raw)}
    seen = set()
    for edge in edges:
        assert edge["edge_id"] not in seen
        seen.add(edge["edge_id"])
        events = [source[event_id] for event_id in edge["event_ids"]]
        assert 2 <= len(events) <= 4
        assert len({event["period"] for event in events}) == 1 and events[0]["period"] in (1, 2, 3, 4)
        assert len({event["possession"] for event in events}) == 1
        teams, participants = set(), set()
        for position, event in enumerate(events):
            assert event["type"]["name"] == "Pass"
            assert "outcome" not in event["pass"], "source must explicitly imply complete"
            actor, recipient = str(event["player"]["id"]), str(event["pass"]["recipient"]["id"])
            team = str(event["team"]["id"])
            assert roster[actor]["team_id"] == roster[recipient]["team_id"] == team
            participants.update((actor, recipient)); teams.add(team)
            if position:
                assert str(events[position-1]["pass"]["recipient"]["id"]) == actor
                assert index[events[position-1]["id"]] < index[event["id"]]
        assert set(edge["player_ids"]) == participants and 3 <= len(participants) <= 5
        assert len(teams) == 1 and set(edge["team_ids"]) == teams
        context = raw[index[events[0]["id"]]:index[events[-1]["id"]]+1]
        times = [event["minute"] * 60 + event["second"] for event in context]
        assert times == sorted(times) and times[-1] - times[0] <= 20
        assert all(event["type"]["name"] in {"Pass", "Carry", "Ball Receipt*", "Dribble"} for event in context)
        assert all(event["period"] == events[0]["period"] and event["possession"] == events[0]["possession"] and str(event["team"]["id"]) in teams for event in context)
        assert [event["id"] for event in context if event["type"]["name"] == "Pass"] == edge["event_ids"]
        assert edge["start_minute"] == times[0] / 60 and edge["end_minute"] == times[-1] / 60
        assert edge["weight"] == 1 and edge["evidence_type"] == "observed_event_sequence"
    counts = Counter(player for edge in edges for player in edge["player_ids"])
    report = {"status": "passed", "raw_event_count": len(raw), "collaboration_edges": len(edges),
              "team_counts": dict(Counter(edge["team_ids"][0] for edge in edges)),
              "cardinality_counts": dict(Counter(str(len(edge["player_ids"])) for edge in edges)),
              "star_participation": {roster[player]["player_name"]: counts[player] for player in ["5503", "3009"]},
              "sample_edge_id": next(edge["edge_id"] for edge in edges if "5503" in edge["player_ids"]),
              "checks": ["all raw source pass outcomes", "connected recipients and actors", "all intervening events", "period/possession/team continuity", "20 second / 4 pass / 5 player bounds", "exact participants, time and unit weight"]}
    destination = ROOT / "output/hypergraph-B-independent-audit.json"
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
