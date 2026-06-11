#!/usr/bin/env python3
"""Generate the Big Pac Tiny Man sound effects as MP3s.

Simple retro blips synthesized with numpy and encoded to MP3 with lameenc.
The game just plays whatever is in public/sounds/, so the owner can drop in
their own MP3s with the same names. Re-run to regenerate the defaults.

    pip install numpy lameenc
    python tools/gen_sounds.py
"""
import os

import lameenc
import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "sounds")


def envelope(n, attack=0.005, release=0.02):
    """Short attack/release ramp so samples don't click on start/stop."""
    env = np.ones(n)
    a = int(SR * attack)
    r = int(SR * release)
    if a:
        env[:a] = np.linspace(0, 1, a)
    if r:
        env[-r:] = np.linspace(1, 0, r)
    return env


def square(freq, t):
    return np.sign(np.sin(2 * np.pi * freq * t))


def encode(samples, path, bitrate=96):
    samples = np.clip(samples, -1, 1)
    pcm = (samples * 0.5 * 32767).astype("<i2")  # 0.5 = headroom
    enc = lameenc.Encoder()
    enc.set_bit_rate(bitrate)
    enc.set_in_sample_rate(SR)
    enc.set_channels(1)
    enc.set_quality(5)
    data = enc.encode(pcm.tobytes()) + enc.flush()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return len(data)


def waka():
    """A short dot-munch: a quick downward pitch blip."""
    dur = 0.08
    t = np.linspace(0, dur, int(SR * dur), False)
    freq = np.linspace(600, 300, t.size)
    return square(freq, t) * envelope(t.size)


def power():
    """Power-pellet warble — a wobbling siren that says 'something changed'."""
    dur = 0.5
    t = np.linspace(0, dur, int(SR * dur), False)
    freq = 380 + 170 * np.sin(2 * np.pi * 11 * t)
    decay = np.linspace(1, 0.5, t.size)
    return square(freq, t) * decay * envelope(t.size, release=0.08)


def note(freq, dur):
    t = np.linspace(0, dur, int(SR * dur), False)
    return square(freq, t) * envelope(t.size)


def fruit():
    """A cheerful two-note up-chirp for eating fruit."""
    return np.concatenate([note(659, 0.08), note(988, 0.11)])  # E5 -> B5


def main():
    for name, fn in (("waka", waka), ("power", power), ("fruit", fruit)):
        n = encode(fn(), os.path.join(OUT, f"{name}.mp3"))
        print(f"{name}.mp3: {n} bytes")
    print("wrote sounds to", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
