"""Ground truth: read the cmap out of the vendored woff2 files themselves.

Every browser-side method for "does this font have this glyph" is an
inference. Advance-width comparison — measure the character with the font
first in the stack, then with only the fallback, and call it covered when
the widths differ — has a real false-negative mode: when the font's advance
happens to equal the fallback's, a present glyph reads as absent. Controls
of the form "a definitely-present char and a definitely-absent char behave
correctly" do NOT catch that, because they say nothing about a coincidental
advance match on some third character.

So this does not measure anything. It opens the actual .woff2 shipped to
visitors and asks its character map which code points it contains. There is
no inference left to be wrong about.

    python tools/screens/font-coverage.py [U+XXXX ...]
"""

import sys
from pathlib import Path
from fontTools.ttLib import TTFont

FONT_DIR = Path(__file__).resolve().parents[2] / "apps" / "web" / "public" / "fonts"

# The characters this project actually renders outside ASCII, plus controls.
DEFAULT_CODEPOINTS = [
    (0x0041, "A", "control: must be PRESENT"),
    (0x27FF, "⟿", "control: must be ABSENT"),
    (0x2014, "—", "em dash — disputed"),
    (0x2013, "–", "en dash"),
    (0x2192, "→", "right arrow"),
    (0x25B8, "▸", "black right pointing small triangle"),
    (0x2691, "⚑", "black flag"),
    (0x00B7, "·", "middle dot"),
    (0x2019, "’", "right single quote"),
    (0x00A7, "§", "section sign"),
    (0x2212, "−", "minus sign"),
    (0x2264, "≤", "less-than-or-equal"),
    (0x2265, "≥", "greater-than-or-equal"),
]


def coverage(path: Path) -> set[int]:
    font = TTFont(str(path), fontNumber=0, lazy=True)
    covered: set[int] = set()
    for table in font["cmap"].tables:
        covered.update(table.cmap.keys())
    font.close()
    return covered


def emit_manifest(maps: dict[str, set[int]], out: Path) -> None:
    """Write the union of every vendored font's cmap as a committed manifest.

    The JS gate and the e2e spec read THIS rather than measuring anything,
    so neither can produce a false negative. Regenerate with
    `python tools/screens/font-coverage.py --emit` after changing a font.
    """
    import json

    union = sorted(set().union(*maps.values()))
    payload = {
        "generatedBy": "tools/screens/font-coverage.py",
        "fonts": {name: len(cov) for name, cov in sorted(maps.items())},
        "note": (
            "Union of the cmap of every vendored woff2. Read from the font "
            "files themselves — not inferred from advance widths, which have "
            "a false-negative mode when a font's advance coincides with the "
            "fallback's, and not inferred from the declared unicode-range, "
            "which this project does not declare at all."
        ),
        "codePoints": union,
    }
    out.write_text(json.dumps(payload, indent=2) + chr(10), encoding="utf-8")
    print(f"wrote {out} ({len(union)} code points)")


def main() -> int:
    fonts = sorted(FONT_DIR.glob("*.woff2"))
    if not fonts:
        print(f"no woff2 files under {FONT_DIR}")
        return 2

    maps = {}
    for f in fonts:
        maps[f.name] = coverage(f)
        print(f"{f.name}: {len(maps[f.name])} code points in cmap")

    args = [a for a in sys.argv[1:] if a != "--emit"]
    if "--emit" in sys.argv:
        emit_manifest(maps, Path(__file__).resolve().parent / "font-coverage.json")

    if args:
        wanted = []
        for arg in args:
            cp = int(arg.replace("U+", "").replace("u+", ""), 16)
            wanted.append((cp, chr(cp), ""))
    else:
        wanted = DEFAULT_CODEPOINTS

    print()
    header = "  code    ch   " + "".join(n.replace("-variable", "").replace("-regular", "").replace(".woff2", "").ljust(14) for n in maps)
    print(header + "note")
    print("  " + "-" * (len(header) + 10))

    ok = True
    for cp, ch, note in wanted:
        cells = ""
        for name, cov in maps.items():
            cells += ("PRESENT" if cp in cov else "absent").ljust(14)
        print(f"  U+{cp:04X}  {ch}    {cells}{note}")
        if note.startswith("control: must be PRESENT") and not all(cp in c for c in maps.values()):
            ok = False
        if note.startswith("control: must be ABSENT") and any(cp in c for c in maps.values()):
            ok = False

    print()
    print("controls behaved correctly" if ok else "CONTROL FAILED — do not trust this run")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
