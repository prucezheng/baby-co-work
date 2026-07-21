from __future__ import annotations

import argparse
import sys

from .core import TranscriptionError, transcribe_media_file


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ark-audio-transcribe",
        description="Upload one local media file to Ark and transcribe its audio.",
    )
    parser.add_argument(
        "file",
        help="Path to a local video or audio file.",
    )
    parser.add_argument(
        "--keep-files",
        action="store_true",
        help="Keep temporary media files for debugging.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        result = transcribe_media_file(args.file, keep_files=args.keep_files)
    except TranscriptionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("error: interrupted", file=sys.stderr)
        return 130

    print(result)
    return 0
