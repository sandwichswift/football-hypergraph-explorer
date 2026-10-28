"""Compute periods 1-4 metrics; keep shootout scores separate from player goals."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from load_data import MATCH_ID, ROOT, load_match, read_json, verify_sources, write_json
from preprocess import finite_number, normalize_events, normalize_players


def calculate_metrics(events, raw_by_id, *, xg_available):
    passes = [event for event in events if event["type"] == "Pass"]
    shots = [event for event in events if event["type"] == "Shot"]
    # An explicit source "unknown" participates in the documented conservative
    # ratio. A missing/empty outcome is unavailable data, matching the overview.
    outcomes_available = all(
        isinstance(event.get("outcome"), str) and bool(event["outcome"].strip()) for event in passes
    )
    successful = (
        sum(event["outcome"] == "complete" for event in passes) if outcomes_available else None
    )
    assists = 0
    for event in passes:
        raw = raw_by_id.get(event["event_id"])
        if raw is None or not isinstance(raw.get("pass"), dict):
            raise ValueError(f"Missing raw pass evidence for assists: {event['event_id']}")
        flag = raw["pass"].get("goal_assist", False)
        if type(flag) is not bool:
            raise ValueError(f"Invalid goal_assist flag: {event['event_id']}")
        assists += flag
    complete_xg = all(finite_number(event.get("xg")) and 0 <= event["xg"] <= 1 for event in shots)
    xg = round(sum(event["xg"] for event in shots), 6) if xg_available and complete_xg else None
    shot_outcomes = {
        "goal",
        "saved",
        "blocked",
        "off t",
        "post",
        "wayward",
        "saved off target",
        "saved to post",
    }
    goals = (
        sum(event["outcome"] == "goal" for event in shots)
        if all(event.get("outcome") in shot_outcomes for event in shots)
        else None
    )
    return {
        "passes": len(passes),
        "successful_passes": successful,
        "pass_accuracy": successful / len(passes) if passes and outcomes_available else None,
        "shots": len(shots),
        "goals": goals,
        "assists": assists,
        "xg": xg,
    }


def calculate_stats(players, events, raw_events, match):
    raw_by_id = {str(event["id"]): event for event in raw_events}
    if set(raw_by_id) != {event["event_id"] for event in events}:
        raise ValueError("Normalized and raw event IDs differ; rerun preprocessing")
    regular = [event for event in events if event["period"] in (1, 2, 3, 4)]
    xg_available = any(
        event["type"] == "Shot" and finite_number(event.get("xg")) for event in regular
    )
    player_stats = {
        player["player_id"]: calculate_metrics(
            [event for event in regular if event["player_id"] == player["player_id"]],
            raw_by_id,
            xg_available=xg_available,
        )
        for player in players
    }
    teams = []
    for side in ("home", "away"):
        source = match[f"{side}_team"]
        team_id = str(source[f"{side}_team_id"])
        team_events = [event for event in regular if event["team_id"] == team_id]
        metrics = calculate_metrics(team_events, raw_by_id, xg_available=xg_available)
        score = match[f"{side}_score"]
        if metrics["goals"] is None:
            raise ValueError(
                f"Team {team_id}: missing or unknown shot outcomes; cannot reconcile score"
            )
        observed_score = metrics["goals"] + sum(
            event["type"] == "Own Goal For" for event in team_events
        )
        if observed_score != score:
            raise ValueError(
                f"Team {team_id}: goal events ({observed_score}) do not reconcile with source score ({score})"
            )
        teams.append(
            {
                "team_id": team_id,
                "team_name": source[f"{side}_team_name"],
                "side": side,
                "score": score,
                "shootout_score": sum(
                    event["period"] == 5
                    and event["team_id"] == team_id
                    and event["type"] == "Shot"
                    and event["outcome"] == "goal"
                    for event in events
                ),
                **metrics,
            }
        )
    return {"match_id": str(match["match_id"]), "teams": teams, "players": player_stats}


def build_stats(raw_dir: Path, output_dir: Path):
    verify_sources(raw_dir, ["events_3869685.json", "lineups_3869685.json", "matches_43_106.json"])
    raw_events = read_json(raw_dir / "events_3869685.json")
    players = read_json(output_dir / "players.json")
    events = read_json(output_dir / "events.json")
    expected_players = normalize_players(read_json(raw_dir / "lineups_3869685.json"), raw_events)
    if players != expected_players or events != normalize_events(raw_events, expected_players):
        raise ValueError(
            "Processed inputs differ from pinned source normalization; rerun preprocess.py"
        )
    stats = calculate_stats(players, events, raw_events, load_match(raw_dir))
    write_json(output_dir / "stats.json", stats)
    print(
        f"Generated stats for match {MATCH_ID}: "
        + " / ".join(
            f"{team['team_name']} {team['score']} (shootout {team['shootout_score']})"
            for team in stats["teams"]
        )
    )
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=ROOT / "data/raw")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data/processed")
    args = parser.parse_args()
    try:
        build_stats(args.raw_dir, args.output_dir)
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
