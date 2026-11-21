"""Render two original sequenced sketches for the portfolio player."""
import subprocess
from pathlib import Path

import numpy as np


def render(name, bpm, roots, melody):
    rate = 44100
    beat = 60 / bpm
    mix = np.zeros(round(beat * 32 * rate))
    rng = np.random.default_rng(42)

    def add(start, samples):
        offset = round(start * rate)
        length = min(len(samples), len(mix) - offset)
        if length > 0:
            mix[offset:offset + length] += samples[:length]

    def note(start, midi, beats, level, overtone):
        t = np.arange(round(beats * beat * rate)) / rate
        phase = 2 * np.pi * 440 * 2 ** ((midi - 69) / 12) * t
        envelope = np.minimum(t / .012, 1) * np.minimum((t[-1] - t) / .07, 1) * np.exp(-2.8 * t)
        add(start, level * envelope * (np.sin(phase) + overtone * np.sin(2 * phase)))

    for bar in range(8):
        root = roots[bar % len(roots)]
        for step, offset in enumerate(melody):
            note((4 * bar + step / 2) * beat, root + 24 + offset, .85, .14, .22)
        for step in (0, 2.5):
            note((4 * bar + step) * beat, root, 1.25, .29, .18)
        for step in range(4):
            t = np.arange(round(.17 * rate)) / rate
            if step % 2 == 0:
                add((4 * bar + step) * beat, .31 * np.sin(2 * np.pi * (49 * t + 1.8 * (1 - np.exp(-32 * t)))) * np.exp(-28 * t))
            noise = rng.standard_normal(len(t))
            add((4 * bar + step + .5) * beat, .034 * np.diff(noise, prepend=0) * np.exp(-75 * t))
    mix[-round(.08 * rate):] *= np.linspace(1, 0, round(.08 * rate))
    output = Path(__file__).resolve().parents[1] / "dist" / "assets" / (name + ".mp3")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "f32le",
                    "-ar", str(rate), "-ac", "1", "-i", "pipe:0", "-b:a", "96k", str(output)],
                   input=mix.astype("<f4").tobytes(), check=True)


render("soft-circuit", 94, [45, 41, 48, 43], [0, 7, 12, 3, 10, 7, 3, 7])
render("afterimage", 112, [38, 43, 41, 45], [12, 7, 5, 0, 7, 12, 14, 7])
