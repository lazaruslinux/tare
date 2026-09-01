#!/usr/bin/env python3
"""Administrative entry point. The commands themselves arrive with the
features that need them; for now this only reports what it can do."""

from __future__ import annotations

import argparse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="manage.py", description="tare administration")
    parser.add_subparsers(dest="command", metavar="command")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if args.command is None:
        print("No commands are available yet.")


if __name__ == "__main__":
    main()
