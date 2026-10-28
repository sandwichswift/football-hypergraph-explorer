"""Fetch only the pinned StatsBomb World Cup final inputs (Python stdlib only)."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATCH_ID = "3869685"
SOURCE_COMMIT = "4b73468fc5b0f1950f9f66fada70ad3a4f9327cb"
SOURCE_BASE = f"https://raw.githubusercontent.com/hudl/open-data/{SOURCE_COMMIT}/"
SOURCE_FILES = {
    "events_3869685.json": (
        "data/events/3869685.json",
        "a0b0036d50c10a4c8879d1ee9f24a7502ec2cfb264a61951c8d500dfc897ec35",
    ),
    "lineups_3869685.json": (
        "data/lineups/3869685.json",
        "2b00c4cbf027b36ae2ce99f183a0943c649bb5bdcb8324683a8603785beffed5",
    ),
    "matches_43_106.json": (
        "data/matches/43/106.json",
        "b9d7516dc9919a825f04c204ca85487958c8a2431e84140a48e944934661efc7",
    ),
    "LICENSE.pdf": (
        "LICENSE.pdf",
        "a5462e69aeb71a39268b760b110c5c2190a2e0cee3015ba976f66bd71f6c2bb4",
    ),
    "SOURCE_README.md": (
        "README.md",
        "98a757466c4d931dba4b6c4290c55c2fe74e4550d7455bbe05fd884dc831aff3",
    ),
    "EVENTS_SPEC.pdf": (
        "doc/Open Data Events v4.0.0.pdf",
        "05de42cc76b0c9cd26213d8e5c72610cac7d4d92c9c2ac878073a565dbb6c44a",
    ),
    "OPEN_DATA_SPEC.pdf": (
        "doc/StatsBomb Open Data Specification v1.1.pdf",
        "d5a8267939c5db35a9501b1a272cc9861a2bb3bef2f53c723d4a43ec1f5ef477",
    ),
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verify_file(path: Path, expected: str) -> None:
    if not path.is_file():
        raise ValueError(f"Missing source file: {path}. Run scripts/load_data.py first.")
    actual = sha256(path.read_bytes())
    if actual != expected:
        raise ValueError(
            f"SHA256 mismatch for {path.name}: {actual}; expected {expected}. Use load_data.py --force to restore the pinned source."
        )


def write_json(path: Path, value) -> None:
    """Do not leave truncated JSON if serialization or replacement fails."""
    data = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def read_json(path: Path):
    def reject_constant(value):
        raise ValueError(f"Non-finite JSON number in {path}: {value}")

    return json.loads(path.read_text(encoding="utf-8"), parse_constant=reject_constant)


def verify_sources(raw_dir: Path, names=None) -> None:
    for name in names if names is not None else SOURCE_FILES:
        verify_file(raw_dir / name, SOURCE_FILES[name][1])


def load_match(raw_dir: Path) -> dict:
    matches = read_json(raw_dir / "matches_43_106.json")
    candidates = [match for match in matches if str(match.get("match_id")) == MATCH_ID]
    if len(candidates) != 1:
        raise ValueError(f"Expected exactly one match {MATCH_ID}; found {len(candidates)}")
    match = candidates[0]
    if (
        match.get("home_team", {}).get("home_team_id"),
        match.get("away_team", {}).get("away_team_id"),
        match.get("match_date"),
    ) != (779, 771, "2022-12-18"):
        raise ValueError(
            "Pinned match metadata does not identify Argentina vs France on 2022-12-18"
        )
    return match


def fetch_sources(raw_dir: Path, *, offline=False, force=False) -> dict:
    if offline and force:
        raise ValueError("--offline and --force cannot be combined")
    raw_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "source": "StatsBomb Open Data",
        "repository": "https://github.com/hudl/open-data",
        "commit": SOURCE_COMMIT,
        "match_id": MATCH_ID,
        "files": {},
    }
    for name, (remote_path, expected) in SOURCE_FILES.items():
        target = raw_dir / name
        url = SOURCE_BASE + urllib.parse.quote(remote_path)
        if target.exists() and not force:
            verify_file(target, expected)
            action = "verified cache"
        else:
            if offline:
                raise ValueError(f"Offline input missing: {target}")
            request = urllib.request.Request(
                url, headers={"User-Agent": "Football-Hypergraph-Coursework/1.0"}
            )
            with urllib.request.urlopen(request, timeout=60) as response:
                data = response.read()
            if sha256(data) != expected:
                raise ValueError(
                    f"Downloaded checksum mismatch for {name}; existing file was not replaced"
                )
            temporary = target.with_suffix(target.suffix + ".download")
            temporary.write_bytes(data)
            temporary.replace(target)
            action = "downloaded"
        manifest["files"][name] = {"url": url, "sha256": expected, "bytes": target.stat().st_size}
        print(f"{action}: {name}")
    load_match(raw_dir)
    write_json(raw_dir / "source_manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=ROOT / "data/raw")
    parser.add_argument(
        "--offline", action="store_true", help="Verify the cached sources without network access"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Redownload the pinned inputs; only replace after SHA256 validation",
    )
    args = parser.parse_args()
    try:
        fetch_sources(args.raw_dir, offline=args.offline, force=args.force)
    except (ValueError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
