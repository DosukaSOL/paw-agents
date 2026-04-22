#!/usr/bin/env python3
"""
Regenerate Pawl sprite frames from the master sprite sheet.

The source sheet (assets/pawl-sprites.png) is 1536×1024 with a 4×3 grid of cells
(cell ≈ 384×341.33 px — non-integer height). Naive integer-cropped slices bleed
content from neighbouring cells and clip the dog's body parts that extend across
nominal cell boundaries.

This script avoids those issues by operating on the entire sheet:

  1. Make pure-white background pixels transparent.
  2. Run a connected-components flood fill to discover every dog blob (and its
     decorations: eye sparkles, hearts, music notes, "zZ" letters, etc).
  3. For each named frame, pick the largest blob whose centroid lies strictly
     inside the target cell. That's the dog body.
  4. Optionally merge nearby satellite blobs (only for frames that *should* have
     decorations: love, excited, happy, mad, sleep, sleep_zzz, wag).
  5. Copy ONLY the kept pixels (per-pixel mask) into a fresh transparent canvas
     sized to the merged bounding box. This guarantees no cross-cell bleed.
  6. Pad to a square, resize to 192×192 with LANCZOS, save as PNG.

Output: 13 PNGs in assets/pawl-frames/ (one per entry in NAME_MAP).

Run:    python3 scripts/regen-pawl-frames.py
Deps:   Pillow (PIL). No numpy/scipy required.
"""

from __future__ import annotations

import os
from collections import deque
from pathlib import Path

from PIL import Image

# ─── Paths ───
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "pawl-sprites.png"
OUT_DIR = ROOT / "assets" / "pawl-frames"

# ─── Layout ───
COLS = 4
ROWS = 3

# name → (col, row). `sleep` and `sleep_zzz` are aliases of the same cell.
NAME_MAP: dict[str, tuple[int, int]] = {
    "idle_front":   (0, 0),
    "walk_right_1": (1, 0),
    "walk_right_2": (2, 0),
    "walk_right_3": (3, 0),
    "love":         (0, 1),
    "excited":      (1, 1),
    "happy":        (2, 1),
    "mad":          (3, 1),
    "play":         (0, 2),
    "sleep":        (1, 2),
    "sleep_zzz":    (1, 2),
    "sleep_peek":   (2, 2),
    "wag":          (3, 2),
}

# Frames whose source artwork includes intentional decorations near the dog body
# (eye sparkles, hearts, music notes, "zZ" letters, anger flame).
ALLOW_SATELLITES = {"love", "excited", "happy", "mad", "sleep", "sleep_zzz", "wag"}

TARGET_SIZE = 192       # output PNG side (square)
PAD_RATIO = 0.06        # transparent margin around the dog
SATELLITE_GAP_PX = 30   # max gap between main bbox and satellite bbox
SATELLITE_MAX_RATIO = 0.15  # satellite must be ≤ 15% of main blob size


def is_dog_pixel(rgba: tuple[int, int, int, int]) -> bool:
    r, g, b, a = rgba
    if a < 16:
        return False
    # Treat near-pure-white as background (the sheet's canvas).
    if r > 245 and g > 245 and b > 245:
        return False
    return True


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing source sheet: {SRC}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    sheet = Image.open(SRC).convert("RGBA")
    W, H = sheet.size
    cell_w = W / COLS
    cell_h = H / ROWS

    # 1. Replace background-white with full transparency.
    spx = sheet.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = spx[x, y]
            if a > 0 and r > 245 and g > 245 and b > 245:
                spx[x, y] = (r, g, b, 0)

    # 2. Connected-components on the entire cleaned sheet.
    print(f"scanning {W}×{H} sheet for blobs…")
    visited = bytearray(W * H)

    def vidx(x: int, y: int) -> int:
        return y * W + x

    blobs: list[dict] = []
    for y0 in range(H):
        for x0 in range(W):
            if visited[vidx(x0, y0)] or not is_dog_pixel(spx[x0, y0]):
                continue
            queue: deque[tuple[int, int]] = deque()
            queue.append((x0, y0))
            visited[vidx(x0, y0)] = 1
            pixels: list[tuple[int, int]] = []
            sx = sy = 0
            minx = maxx = x0
            miny = maxy = y0
            while queue:
                x, y = queue.popleft()
                pixels.append((x, y))
                sx += x
                sy += y
                if x < minx: minx = x
                if y < miny: miny = y
                if x > maxx: maxx = x
                if y > maxy: maxy = y
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if (
                        0 <= nx < W
                        and 0 <= ny < H
                        and not visited[vidx(nx, ny)]
                        and is_dog_pixel(spx[nx, ny])
                    ):
                        visited[vidx(nx, ny)] = 1
                        queue.append((nx, ny))
            n = len(pixels)
            if n < 30:
                continue  # skip noise specks
            blobs.append(
                {
                    "n": n,
                    "cx": sx / n,
                    "cy": sy / n,
                    "bbox": (minx, miny, maxx + 1, maxy + 1),
                    "pixels": pixels,
                }
            )
    print(f"  found {len(blobs)} blobs")

    def in_strict_cell(bx: float, by: float, c: int, r: int) -> bool:
        return c * cell_w <= bx < (c + 1) * cell_w and r * cell_h <= by < (r + 1) * cell_h

    # 3 & 4. For each frame, build the kept-pixel set.
    cell_cache: dict[tuple[int, int], Image.Image] = {}
    for name, (c, r) in NAME_MAP.items():
        cell_blobs = [b for b in blobs if in_strict_cell(b["cx"], b["cy"], c, r)]
        if not cell_blobs:
            print(f"  WARN: no blobs in cell ({c},{r}) for {name!r}")
            continue
        cell_blobs.sort(key=lambda b: -b["n"])
        main = cell_blobs[0]
        keep = set(main["pixels"])
        merged = list(main["bbox"])

        if name in ALLOW_SATELLITES:
            mx0, my0, mx1, my1 = main["bbox"]
            for b in cell_blobs[1:]:
                if b["n"] > main["n"] * SATELLITE_MAX_RATIO:
                    continue
                bx0, by0, bx1, by1 = b["bbox"]
                gap_x = max(0, max(bx0 - mx1, mx0 - bx1))
                gap_y = max(0, max(by0 - my1, my0 - by1))
                if gap_x > SATELLITE_GAP_PX or gap_y > SATELLITE_GAP_PX:
                    continue
                keep.update(b["pixels"])
                merged[0] = min(merged[0], bx0)
                merged[1] = min(merged[1], by0)
                merged[2] = max(merged[2], bx1)
                merged[3] = max(merged[3], by1)

        # 5. Copy kept pixels into fresh transparent canvas (per-pixel mask).
        bx0, by0, bx1, by1 = merged
        cw, ch = bx1 - bx0, by1 - by0
        cropped = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        cpx = cropped.load()
        for x, y in keep:
            cpx[x - bx0, y - by0] = spx[x, y]

        # 6. Pad to square + resize.
        side = max(cw, ch)
        pad = int(side * PAD_RATIO)
        canvas_side = side + pad * 2
        canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
        canvas.paste(
            cropped,
            (pad + (side - cw) // 2, pad + (side - ch) // 2),
            cropped,
        )
        final = canvas.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)
        out_path = OUT_DIR / f"{name}.png"
        final.save(out_path, "PNG", optimize=True)
        cell_cache[(c, r)] = final
        print(
            f"  {name:14s} cell=({c},{r}) main={main['n']}px kept={len(keep)} → {out_path.relative_to(ROOT)}"
        )

    print("done")


if __name__ == "__main__":
    main()
