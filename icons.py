#!/usr/bin/env python3
"""Draws the extension icons.

Generating them keeps binaries out of the repository and makes the design a
thing you can edit. The mark is a transcript: stacked lines on the panel purple.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

BACKGROUND = (109, 76, 125)
FOREGROUND = (255, 255, 255)
CORNER_RADIUS = 0.20
SUPERSAMPLE = 4

# x start, x end, y centre, thickness — all as fractions of the canvas.
BARS = (
    (0.24, 0.76, 0.30, 0.115),
    (0.24, 0.64, 0.50, 0.115),
    (0.24, 0.72, 0.70, 0.115),
)


def rounded_rect_coverage(x: float, y: float, x0: float, y0: float, x1: float, y1: float,
                          radius: float) -> bool:
    """True when the point lies inside a rounded rectangle."""
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + radius), x1 - radius)
    cy = min(max(y, y0 + radius), y1 - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2 or (
        x0 + radius <= x <= x1 - radius or y0 + radius <= y <= y1 - radius
    )


def sample(x: float, y: float) -> tuple[int, int, int, int]:
    if not rounded_rect_coverage(x, y, 0.0, 0.0, 1.0, 1.0, CORNER_RADIUS):
        return (0, 0, 0, 0)
    for x0, x1, cy, thickness in BARS:
        radius = thickness / 2
        if rounded_rect_coverage(x, y, x0, cy - radius, x1, cy + radius, radius):
            return (*FOREGROUND, 255)
    return (*BACKGROUND, 255)


def render(size: int) -> bytes:
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            totals = [0, 0, 0, 0]
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    x = (px + (sx + 0.5) / SUPERSAMPLE) / size
                    y = (py + (sy + 0.5) / SUPERSAMPLE) / size
                    pixel = sample(x, y)
                    # Premultiply so transparent corners do not darken the edge.
                    alpha = pixel[3] / 255
                    for channel in range(3):
                        totals[channel] += pixel[channel] * alpha
                    totals[3] += pixel[3]
            samples = SUPERSAMPLE ** 2
            alpha = totals[3] / samples
            if alpha == 0:
                row.extend((0, 0, 0, 0))
                continue
            scale = samples * (alpha / 255)
            row.extend(
                (
                    round(totals[0] / scale),
                    round(totals[1] / scale),
                    round(totals[2] / scale),
                    round(alpha),
                )
            )
        rows.append(bytes(row))
    return b"".join(b"\x00" + row for row in rows)


def chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def write_png(path: Path, size: int) -> None:
    header = struct.pack(">2I5B", size, size, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(render(size), 9))
        + chunk(b"IEND", b"")
    )


def write_all(directory: Path, sizes: tuple[int, ...] = (16, 48, 128)) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    written = []
    for size in sizes:
        path = directory / f"icon{size}.png"
        write_png(path, size)
        written.append(path)
    return written


if __name__ == "__main__":
    for path in write_all(Path(__file__).parent / "dist" / "extension" / "icons"):
        print(path)
