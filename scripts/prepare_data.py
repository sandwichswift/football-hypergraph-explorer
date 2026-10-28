"""Rebuild the available team modules; never manufacture undelivered B data."""
from pathlib import Path
import argparse
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Verify cached sources without downloading")
    args = parser.parse_args()
    commands = [
        ["load_data.py", *(["--offline"] if args.offline else [])],
        ["preprocess.py"], ["calculate_stats.py"],
        ["build_competition.py", "--diagnostics", str(ROOT / "output/competition-build-audit.json")],
    ]
    if (ROOT / "scripts/build_collaboration.py").is_file():
        commands.append(["build_collaboration.py"])
    else:
        print("B collaboration builder is not delivered; no empty substitute will be created.", flush=True)
    for script, *arguments in commands:
        result = subprocess.run([sys.executable, str(ROOT / "scripts" / script), *arguments], cwd=ROOT)
        if result.returncode:
            return result.returncode
    print("Available data rebuilt. Serve this repository and open /src/.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
