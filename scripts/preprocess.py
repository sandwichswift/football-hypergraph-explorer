"""Normalize pinned StatsBomb events and lineups without changing the team contract."""

from __future__ import annotations

import argparse
import math
import sys
from collections import Counter
from pathlib import Path

from load_data import (
    MATCH_ID,
    ROOT,
    SOURCE_COMMIT,
    load_match,
    read_json,
    verify_sources,
    write_json,
)


def identifier(value):
    return None if value is None or value == "" else str(value)


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def named(value):
    return value.get("name") if isinstance(value, dict) else None


def object_id(value):
    return identifier(value.get("id")) if isinstance(value, dict) else None


def normalize_players(lineups, raw_events):
    players = {}
    # Use only actual source names as a fallback; no invented display name.
    event_names = {
        object_id(event.get("player")): named(event.get("player"))
        for event in raw_events
        if named(event.get("player"))
    }
    for team in lineups:
        team_id = identifier(team.get("team_id"))
        if team_id is None:
            raise ValueError("Lineup team is missing team_id")
        for player in team.get("lineup", []):
            player_id = identifier(player.get("player_id"))
            if player_id is None or player_id in players:
                raise ValueError(f"Missing or duplicate lineup player_id: {player_id}")
            positions = player.get("positions") or []
            # First recorded position, NOT inferred from shirt number or averaged.
            position = positions[0].get("position") if positions else None
            players[player_id] = {
                "player_id": player_id,
                "player_name": player.get("player_name") or event_names.get(player_id),
                "team_id": team_id,
                "team_name": team.get("team_name"),
                "position": position,
                "shirt_number": player.get("jersey_number"),
            }
    return sorted(players.values(), key=lambda player: (player["team_id"], player["player_id"]))


def normalize_events(raw_events, players):
    player_map = {player["player_id"]: player for player in players}
    team_ids = {player["team_id"] for player in players}
    events, seen_ids, seen_indices = [], set(), set()
    for raw in raw_events:
        event_id = identifier(raw.get("id"))
        index, period = raw.get("index"), raw.get("period")
        if not event_id or event_id in seen_ids:
            raise ValueError(f"Missing or duplicate event id: {event_id}")
        if type(index) is not int or index < 1 or index in seen_indices:
            raise ValueError(f"Event {event_id}: missing, invalid or duplicate index {index}")
        if type(period) is not int or period not in (1, 2, 3, 4, 5):
            raise ValueError(f"Event {event_id}: invalid period {period}")
        minute, second = raw.get("minute"), raw.get("second")
        if type(minute) is not int or minute < 0 or type(second) is not int or not 0 <= second < 60:
            raise ValueError(f"Event {event_id}: invalid source match clock {minute}:{second}")
        event_type = named(raw.get("type"))
        if not isinstance(event_type, str) or not event_type:
            raise ValueError(f"Event {event_id}: missing event type")
        team_id = object_id(raw.get("team"))
        player_id = object_id(raw.get("player"))
        if team_id is not None and team_id not in team_ids:
            raise ValueError(f"Event {event_id}: team {team_id} absent from lineups")
        if player_id is not None and player_id not in player_map:
            raise ValueError(f"Event {event_id}: player {player_id} absent from lineups")
        if (
            player_id is not None
            and team_id is not None
            and player_map[player_id]["team_id"] != team_id
        ):
            raise ValueError(f"Event {event_id}: player's lineup team differs from event team")
        detail_key = {
            "Ball Receipt*": "ball_receipt",
            "50/50": "50_50",
            "Goal Keeper": "goalkeeper",
        }.get(event_type, event_type.lower().replace(" ", "_"))
        detail = raw.get(detail_key)
        if event_type == "Pass" and not isinstance(detail, dict):
            raise ValueError(
                f"Event {event_id}: Pass is missing its pass object; success cannot be inferred"
            )
        detail = detail if isinstance(detail, dict) else {}
        outcome = named(detail.get("outcome"))
        if event_type == "Pass" and "outcome" not in detail:
            # StatsBomb specification: successful passes omit the outcome field.
            outcome = "complete"
        elif isinstance(outcome, str):
            outcome = outcome.lower()
        recipient_id = object_id(detail.get("recipient")) if event_type == "Pass" else None
        if recipient_id is not None and recipient_id not in player_map:
            raise ValueError(f"Event {event_id}: recipient {recipient_id} absent from lineups")
        location = raw.get("location")
        if location is not None and (
            not isinstance(location, list)
            or len(location) != 2
            or not all(finite_number(value) for value in location)
        ):
            raise ValueError(f"Event {event_id}: invalid location {location}")
        xg = detail.get("statsbomb_xg") if event_type == "Shot" else None
        if xg is not None and (not finite_number(xg) or not 0 <= xg <= 1):
            raise ValueError(f"Event {event_id}: invalid xG {xg}")
        related = raw.get("related_events") or []
        if not isinstance(related, list) or any(identifier(value) is None for value in related):
            raise ValueError(f"Event {event_id}: invalid related_events")
        events.append(
            {
                "event_id": event_id,
                "event_index": index,
                "period": period,
                "minute": minute,
                "second": second,
                "time_seconds": minute * 60 + second,
                "team_id": team_id,
                "player_id": player_id,
                "type": event_type,
                "possession_id": identifier(raw.get("possession")),
                "recipient_id": recipient_id,
                "outcome": outcome,
                "location": location,
                "related_event_ids": [str(value) for value in related],
                "xg": xg,
            }
        )
        seen_ids.add(event_id)
        seen_indices.add(index)
    events.sort(key=lambda event: (event["period"], event["event_index"]))
    for event in events:
        missing = set(event["related_event_ids"]) - seen_ids
        if missing:
            raise ValueError(
                f"Event {event['event_id']}: related event IDs absent from source: {sorted(missing)}"
            )
    return events


def diagnostics(players, events):
    regressions = []
    for previous, event in zip(events, events[1:]):
        if event["time_seconds"] < previous["time_seconds"]:
            regressions.append(
                {
                    "previous_event_id": previous["event_id"],
                    "event_id": event["event_id"],
                    "event_index": event["event_index"],
                    "type": event["type"],
                    "previous_period": previous["period"],
                    "period": event["period"],
                    "previous_time_seconds": previous["time_seconds"],
                    "time_seconds": event["time_seconds"],
                }
            )
    return {
        "match_id": MATCH_ID,
        "source_commit": SOURCE_COMMIT,
        "players": len(players),
        "players_with_events": len(
            {event["player_id"] for event in events if event["player_id"] is not None}
        ),
        "events": len(events),
        "period_counts": dict(sorted(Counter(str(event["period"]) for event in events).items())),
        "event_type_counts": dict(sorted(Counter(event["type"] for event in events).items())),
        "pass_outcomes": dict(
            sorted(
                Counter(
                    str(event["outcome"]) for event in events if event["type"] == "Pass"
                ).items()
            )
        ),
        "clock_regressions": regressions,
        "missing_player_names": [
            player["player_id"] for player in players if player["player_name"] is None
        ],
        "missing_locations": sum(event["location"] is None for event in events),
        "missing_recipients_on_passes": sum(
            event["recipient_id"] is None for event in events if event["type"] == "Pass"
        ),
        "missing_xg_on_shots": sum(
            event["xg"] is None for event in events if event["type"] == "Shot"
        ),
    }


def preprocess(raw_dir: Path, output_dir: Path):
    verify_sources(raw_dir, ["events_3869685.json", "lineups_3869685.json", "matches_43_106.json"])
    load_match(raw_dir)
    raw_events = read_json(raw_dir / "events_3869685.json")
    players = normalize_players(read_json(raw_dir / "lineups_3869685.json"), raw_events)
    events = normalize_events(raw_events, players)
    audit = diagnostics(players, events)
    # Validation finishes before either public contract file is replaced.
    write_json(output_dir / "players.json", players)
    write_json(output_dir / "events.json", events)
    write_json(raw_dir / "preprocessing_diagnostics.json", audit)
    for regression in audit["clock_regressions"]:
        print(
            f"WARNING clock regression: index={regression['event_index']} type={regression['type']} period={regression['period']} source time={regression['time_seconds']}; retained source clock and period/index ordering",
            file=sys.stderr,
        )
    print(f"Generated {len(players)} players and {len(events)} events in {output_dir}")
    return players, events


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=ROOT / "data/raw")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data/processed")
    args = parser.parse_args()
    try:
        preprocess(args.raw_dir, args.output_dir)
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
