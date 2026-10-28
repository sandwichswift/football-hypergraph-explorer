"""B: build bounded, connected collaboration sequences from A's normalized data.

Only confirmed complete passes contribute participants. Context can bridge passes,
but it never invents a recipient. Uses the Python standard library only.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BRIDGES = {"Carry", "Ball Receipt*", "Dribble"}


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def identifier(value):
    return isinstance(value, str) and bool(value.strip())


def seconds(event):
    value = event.get("time_seconds")
    if number(value) and value >= 0:
        return value
    minute, second = event.get("minute"), event.get("second", 0)
    if number(minute) and minute >= 0 and number(second) and 0 <= second < 60:
        return minute * 60 + second
    return None


def build_collaboration(players, events, *, max_passes=4, max_seconds=20.0, max_players=5):
    """Return raw edges and a separate audit, without mutating inputs.

    Emit a trailing window at each successful pass, after bounding its length and
    duration. The next actor must be the preceding recipient. Windows overlap;
    their number is NOT a number of independent attacks or a quality score.
    """
    if isinstance(max_passes, bool) or not isinstance(max_passes, int) or max_passes < 2:
        raise ValueError("max_passes must be an integer >= 2")
    if not number(max_seconds) or max_seconds <= 0:
        raise ValueError("max_seconds must be finite and positive")
    if isinstance(max_players, bool) or not isinstance(max_players, int) or max_players < 3:
        raise ValueError("max_players must be an integer >= 3")
    if not isinstance(players, list) or not isinstance(events, list):
        raise ValueError("players and events must be JSON arrays")
    roster = {}
    for row in players:
        if not isinstance(row, dict) or not identifier(row.get("player_id")) or not identifier(row.get("team_id")):
            raise ValueError("roster rows require string player_id and team_id")
        if row["player_id"] in roster:
            raise ValueError("duplicate player_id: " + row["player_id"])
        roster[row["player_id"]] = row["team_id"]
    seen_ids, seen_order = set(), set()
    for event in events:
        if not isinstance(event, dict) or not identifier(event.get("event_id")) or event["event_id"] in seen_ids:
            raise ValueError("events require unique string event_id")
        seen_ids.add(event["event_id"])
        period, index = event.get("period"), event.get("event_index")
        if isinstance(period, bool) or period not in (1, 2, 3, 4, 5):
            raise ValueError(event["event_id"] + ": invalid period")
        if isinstance(index, bool) or not isinstance(index, int) or index < 0 or (period, index) in seen_order:
            raise ValueError(event["event_id"] + ": invalid or duplicate event_index")
        seen_order.add((period, index))

    counts = Counter()
    chain, previous_key, previous_time = [], None, None
    edges = []
    for event in sorted(events, key=lambda e: (e["period"], e["event_index"])):
        time = seconds(event)
        key = (event["period"], event.get("possession_id"))
        if key != previous_key or (time is not None and previous_time is not None and time < previous_time):
            if key == previous_key:
                counts["clock_regressions"] += 1
            chain = []
        previous_key, previous_time = key, time
        if event["period"] == 5 or time is None or not identifier(event.get("possession_id")):
            counts["unusable_context_or_shootout"] += 1
            chain = []
            continue
        actor, team = event.get("player_id"), event.get("team_id")
        if not identifier(actor) or roster.get(actor) != team:
            counts["unusable_actor"] += 1
            chain = []
            continue
        if event.get("type") != "Pass":
            if event.get("type") not in BRIDGES or (chain and team != chain[-1][0]["team_id"]):
                chain = []
            continue
        recipient = event.get("recipient_id")
        if event.get("outcome") != "complete":
            counts["non_complete_passes"] += 1
            chain = []
            continue
        if not identifier(recipient) or roster.get(recipient) != team or recipient == actor:
            counts["unusable_recipients"] += 1
            chain = []
            continue
        counts["usable_passes"] += 1
        if chain and (team != chain[-1][0]["team_id"] or actor != chain[-1][0]["recipient_id"]):
            counts["disconnected_passes"] += 1
            chain = []
        chain.append((event, time))
        while len(chain) > max_passes or time - chain[0][1] > max_seconds:
            chain.pop(0)
        participants = {value for item, _ in chain for value in (item["player_id"], item["recipient_id"])}
        if len(participants) < 3:
            counts["fewer_than_three_windows"] += 1
            continue
        if len(participants) > max_players:
            counts["oversized_windows"] += 1
            continue
        event_ids = [item["event_id"] for item, _ in chain]
        digest = hashlib.sha256(json.dumps(event_ids).encode()).hexdigest()[:20]
        edges.append({
            "edge_id": "collab_" + digest,
            "type": "collaboration",
            "player_ids": sorted(participants),
            "team_ids": [team],
            "start_minute": chain[0][1] / 60,
            "end_minute": time / 60,
            "event_ids": event_ids,
            "weight": 1,
            "evidence_type": "observed_event_sequence",
            "description": (
                f"Connected complete-pass sequence in period {event['period']}, "
                f"possession {event['possession_id']}; <= {max_passes} passes, "
                f"<= {max_seconds:g}s, <= {max_players} players. "
                "Overlapping windows are not independent attacks."
            ),
        })
    report = {
        "status": "ok", "input_players": len(players), "input_events": len(events),
        "output_edges": len(edges),
        "parameters": {"max_passes": max_passes, "max_seconds": max_seconds, "max_players": max_players},
        "counts": dict(sorted(counts.items())),
        "cardinality_counts": dict(sorted(Counter(str(len(e["player_ids"])) for e in edges).items())),
        "team_counts": dict(sorted(Counter(e["team_ids"][0] for e in edges).items())),
        "limitation": "Conservative observed complete-pass chains; overlapping windows are not independent attacks. No inferred positions or unrecorded participants.",
    }
    return edges, report


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, suffix=".tmp", encoding="utf-8", delete=False) as file:
        temporary = Path(file.name)
        try:
            json.dump(value, file, ensure_ascii=False, indent=2, allow_nan=False)
            file.write("\n")
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--players", type=Path, default=ROOT / "data/processed/players.json")
    parser.add_argument("--events", type=Path, default=ROOT / "data/processed/events.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/processed/collaboration_edges.json")
    parser.add_argument("--diagnostics", type=Path, default=ROOT / "output/collaboration-build-audit.json")
    parser.add_argument("--max-passes", type=int, default=4)
    parser.add_argument("--max-seconds", type=float, default=20.0)
    parser.add_argument("--max-players", type=int, default=5)
    args = parser.parse_args(argv)
    inputs = {args.players.resolve(), args.events.resolve()}
    if args.output.resolve() in inputs or args.diagnostics.resolve() in inputs | {args.output.resolve()}:
        parser.error("output and diagnostics must be separate from both inputs and each other")
    try:
        players = json.loads(args.players.read_text(encoding="utf-8"))
        events = json.loads(args.events.read_text(encoding="utf-8"))
        edges, report = build_collaboration(players, events, max_passes=args.max_passes,
                                            max_seconds=args.max_seconds, max_players=args.max_players)
        write_json(args.output, edges)
        write_json(args.diagnostics, report)
    except (OSError, ValueError, TypeError) as error:
        print(f"Collaboration build FAILED: {error}. Existing output is not a fresh successful build.", file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
