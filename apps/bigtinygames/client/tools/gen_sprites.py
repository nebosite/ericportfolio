#!/usr/bin/env python3
"""Generate the Big Pac Tiny Man sprite PNGs.

These are intentionally simple, hand-tunable placeholders at the real arcade
sizes (Pac 13x13, ghosts 14x15, fruit 13x13). The owner can open the PNGs in
any pixel editor and repaint them; the game just loads whatever is in
public/sprites/. Re-run this script to regenerate the defaults.

    python tools/gen_sprites.py
"""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "sprites")


def write_png(path, w, h, px):
    """px: list of (r,g,b,a) rows-major, length w*h."""
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter: none
        for x in range(w):
            raw += bytes(px[y * w + x])

    def chunk(typ, data):
        return (
            struct.pack(">I", len(data))
            + typ
            + data
            + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)


CLEAR = (0, 0, 0, 0)


def grid(w, h, fill=CLEAR):
    return [fill] * (w * h)


def disc(px, w, cx, cy, r, color):
    for y in range(len(px) // w):
        for x in range(w):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                px[y * w + x] = color


def from_pattern(pattern, colors):
    """pattern: list[str]; colors: dict char->rgba. Spaces/'.' => transparent."""
    h = len(pattern)
    w = len(pattern[0])
    px = grid(w, h)
    for y, row in enumerate(pattern):
        for x, ch in enumerate(row):
            if ch in colors:
                px[y * w + x] = colors[ch]
    return w, h, px


# ---- Pac (13x13): yellow disc, open frame has a wedge mouth facing right ----
YELLOW = (255, 225, 75, 255)


def pac(open_mouth):
    w = h = 13
    cx = cy = 6.0
    px = grid(w, h)
    half = math.radians(38) if open_mouth else 0.0
    for y in range(h):
        for x in range(w):
            dx, dy = x - cx, y - cy
            if dx * dx + dy * dy <= 6.2 * 6.2:
                if open_mouth and abs(math.atan2(dy, dx)) < half:
                    continue  # carve the mouth wedge
                px[y * w + x] = YELLOW
    return w, h, px


# ---- Ghost (14x15): white body so the engine can tint it; black pupils ----
# '#' body (tintable white), 'x' pupil (stays dark after tint), '.' transparent.
GHOST_BODY = [
    "....######....",
    "..##########..",
    ".############.",
    ".############.",
    "##############",
    "##############",
    "###xx####xx###",
    "###xx####xx###",
    "##############",
    "##############",
    "##############",
    "##############",
    "##############",
    "##.##.##.##.##",
    "#..#.#..#.#..#",
]
GHOST_COLORS = {"#": (255, 255, 255, 255), "x": (20, 20, 30, 255)}

# Frightened ghost: deep blue body, pale eyes + wavy mouth. Rendered untinted.
FRIGHT = [
    "....######....",
    "..##########..",
    ".############.",
    ".############.",
    "##############",
    "##oo####oo####"[:14],
    "##oo####oo####"[:14],
    "##############",
    "##############",
    "##m##m##m##m##",
    "##############",
    "##############",
    "##############",
    "##.##.##.##.##",
    "#..#.#..#.#..#",
]
FRIGHT_COLORS = {
    "#": (33, 33, 222, 255),
    "o": (240, 240, 255, 255),
    "m": (240, 240, 255, 255),
}

# ---- Fruit (13x13): a little cherry/apple near the ghost bases ----
FRUIT = [
    ".......g.....",
    "......g......",
    ".....g.LL....",
    "....s..L.....",
    "...rrr.......",
    "..rrrrr......",
    ".rrrrrrr.....",
    ".rrrrrrr.....",
    ".rrrrrrr.....",
    ".rrrrrrr.....",
    "..rrrrr......",
    "...rrr.......",
    ".............",
]
FRUIT_COLORS = {
    "r": (224, 48, 48, 255),
    "s": (120, 70, 30, 255),
    "g": (120, 70, 30, 255),
    "L": (70, 190, 70, 255),
}


def main():
    w, h, px = pac(True)
    write_png(os.path.join(OUT, "pac-open.png"), w, h, px)
    w, h, px = pac(False)
    write_png(os.path.join(OUT, "pac-closed.png"), w, h, px)
    write_png(os.path.join(OUT, "ghost.png"), *from_pattern(GHOST_BODY, GHOST_COLORS))
    write_png(os.path.join(OUT, "ghost-frightened.png"), *from_pattern(FRIGHT, FRIGHT_COLORS))
    write_png(os.path.join(OUT, "fruit.png"), *from_pattern(FRUIT, FRUIT_COLORS))
    print("wrote sprites to", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
