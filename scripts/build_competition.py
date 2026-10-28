"""Module D: conservative, traceable event-window inference (standard library only).

Consumes A's normalized contract, never downloads or invents match observations.
Run from any directory; defaults are relative to the repository, not the shell.
"""
from __future__ import annotations

import argparse
from bisect import bisect_left, bisect_right
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
ANCHORS = frozenset({"Pressure", "Duel", "Interception", "Dispossessed", "Ball Recovery"})
CONTEXT = ANCHORS | {"Pass", "Carry", "Dribble", "Shot", "Ball Receipt*"}


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def identifier(value):
    return isinstance(value, str) and bool(value.strip())


def event_seconds(event):
    value = event.get("time_seconds")
    if number(value) and value >= 0:
        return value
    minute, second = event.get("minute"), event.get("second")
    if number(minute) and minute >= 0 and (second is None or (number(second) and 0 <= second < 60)):
        return minute * 60 + (second or 0)
    return None


def build_competition(players, events, *, window_seconds=5.0, max_players=8, max_events=24):
    """Return (raw_edges, diagnostics). Invalid rows break continuity; no guessing.

    A window is centered on an observed anchor, contained in one contiguous
    (period, possession_id) run. Clock regressions also break a run. Two teams
    must have actual actor events; a named Pass recipient alone is insufficient.
    """
    if not number(window_seconds) or window_seconds <= 0:
        raise ValueError("window_seconds must be finite and positive")
    if not isinstance(max_players, int) or max_players < 3 or not isinstance(max_events, int) or max_events < 1:
        raise ValueError("max_players >= 3 and max_events >= 1 are required")
    if not isinstance(players, list) or not isinstance(events, list):
        raise ValueError("players.json and events.json must be JSON arrays")
    roster = {}
    for player in players:
        if not isinstance(player, dict) or not identifier(player.get("player_id")) or not identifier(player.get("team_id")):
            raise ValueError("every roster row needs string player_id and team_id")
        if player["player_id"] in roster:
            raise ValueError(f"duplicate player_id: {player['player_id']}")
        roster[player["player_id"]] = player["team_id"]

    counts = Counter()
    seen_ids, ordering, duplicate_order = set(), [], set()
    for position, event in enumerate(events):
        if not isinstance(event, dict) or not identifier(event.get("event_id")):
            raise ValueError(f"event row {position} has no unique string event_id")
        if event["event_id"] in seen_ids:
            raise ValueError(f"duplicate event_id: {event['event_id']}")
        seen_ids.add(event["event_id"])
        period, index = event.get("period"), event.get("event_index")
        if not number(period) or int(period) != period or period not in (1, 2, 3, 4, 5):
            raise ValueError(f"{event['event_id']}: invalid period; ordering cannot be established")
        if not number(index) or int(index) != index or index < 0:
            raise ValueError(f"{event['event_id']}: missing/invalid event_index; ordering cannot be established")
        key = (period, index)
        if key in duplicate_order:
            raise ValueError(f"ambiguous duplicate period/event_index: {key}")
        duplicate_order.add(key)
        ordering.append(event)
    ordering.sort(key=lambda e: (e["period"], e["event_index"]))

    runs, run, previous_key, previous_time = [], [], None, None
    for event in ordering:
        time = event_seconds(event)
        player, team = event.get("player_id"), event.get("team_id")
        valid = (event["period"] != 5 and time is not None
                 and identifier(event.get("possession_id"))
                 and identifier(player) and roster.get(player) == team
                 and isinstance(event.get("type"), str) and bool(event["type"]))
        if not valid:
            counts["invalid_or_shootout_rows"] += 1
            if run:
                runs.append(run)
            run, previous_key, previous_time = [], None, None
            continue
        key = (event["period"], event["possession_id"])
        regression = previous_time is not None and time < previous_time
        if key != previous_key or regression:
            if run:
                runs.append(run)
            run = []
        if regression and key == previous_key:
            counts["clock_regressions"] += 1
        previous_key, previous_time = key, time
        run.append((event, time))
    if run:
        runs.append(run)

    edges, seen_windows = [], set()
    for run in runs:
        times = [time for _, time in run]
        for anchor, center in run:
            if anchor["type"] not in ANCHORS:
                continue
            counts["anchor_events"] += 1
            lo = bisect_left(times, center - window_seconds / 2)
            hi = bisect_right(times, center + window_seconds / 2)
            window = [(event, time) for event, time in run[lo:hi] if event["type"] in CONTEXT]
            if len(window) > max_events:
                counts["oversized_windows"] += 1
                continue
            actors = {roster[event["player_id"]] for event, _ in window}
            participants = set()
            for event, _ in window:
                participants.add(event["player_id"])
                recipient = event.get("recipient_id")
                if event["type"] == "Pass" and recipient is not None:
                    if identifier(recipient) and roster.get(recipient) == event["team_id"]:
                        participants.add(recipient)
                    else:
                        counts["unusable_recipient_occurrences"] += 1
            if len(actors) < 2 or len(participants) < 3:
                counts["insufficient_windows"] += 1
                continue
            if len(participants) > max_players:
                counts["oversized_windows"] += 1
                continue
            event_ids = tuple(event["event_id"] for event, _ in window)
            if event_ids in seen_windows:
                counts["duplicate_windows"] += 1
                continue
            seen_windows.add(event_ids)
            digest = hashlib.sha256(json.dumps(event_ids, ensure_ascii=False).encode("utf-8")).hexdigest()[:20]
            edges.append({
                "edge_id": f"competition_{digest}", "type": "competition",
                "player_ids": sorted(participants), "team_ids": sorted(actors),
                "start_minute": min(time for _, time in window) / 60,
                "end_minute": max(time for _, time in window) / 60,
                "event_ids": list(event_ids), "weight": 1,
                "evidence_type": "event_window_inference",
                "description": (
                    f"Observed actor events and explicitly named Pass recipients in a <= {window_seconds:g}s "
                    f"window, period {anchor['period']}, possession {anchor['possession_id']}; "
                    "includes an observed competition event. Event association inference, "
                    "not tracking positions, completed reception, or proof of direct opposition."
                ),
            })
    report = {
        "status": "ok" if edges else "empty",
        "input_players": len(players), "input_events": len(events), "output_edges": len(edges),
        "parameters": {"window_seconds": window_seconds, "max_players": max_players, "max_events": max_events},
        "counts": dict(sorted(counts.items())),
        "limitation": "No complete frame-by-frame positions. Overlapping windows are not independent contests. Empty output does not mean no competition occurred.",
    }
    return edges, report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--players", type=Path, default=ROOT / "data/processed/players.json")
    parser.add_argument("--events", type=Path, default=ROOT / "data/processed/events.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/processed/competition_edges.json")
    parser.add_argument("--diagnostics", type=Path, help="Optional separate audit JSON; never loaded as match data")
    parser.add_argument("--window-seconds", type=float, default=5.0)
    parser.add_argument("--max-players", type=int, default=8)
    parser.add_argument("--max-events", type=int, default=24)
    args = parser.parse_args(argv)
    if args.output.resolve() in {args.players.resolve(), args.events.resolve()}:
        parser.error("output must not overwrite input data")
    if args.diagnostics and args.diagnostics.resolve() in {args.players.resolve(), args.events.resolve(), args.output.resolve()}:
        parser.error("diagnostics must use a separate path")
    try:
        players = json.loads(args.players.read_text(encoding="utf-8-sig"))
        events = json.loads(args.events.read_text(encoding="utf-8-sig"))
        edges, report = build_competition(players, events, window_seconds=args.window_seconds,
                                         max_players=args.max_players, max_events=args.max_events)
        code = 0
    except (OSError, ValueError) as error:
        edges, code = [], 2
        report = {"status": "input_error", "output_edges": 0, "reason": str(error),
                  "limitation": "A's normalized source data unavailable or invalid. No match evidence has been inferred."}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(edges, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    if args.diagnostics:
        args.diagnostics.parent.mkdir(parents=True, exist_ok=True)
        args.diagnostics.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False), file=sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
