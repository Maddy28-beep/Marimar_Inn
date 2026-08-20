"""Build a chunky 1-bit M the 58mm head can actually burn.

The glossy PNG is too detailed for this clone. This draws a thick stencil M
so most dots are solid black, then writes the packed ESC/POS bytes plus a
magnified preview PNG.
"""

from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "lib" / "receipt-icon.ts"
PREVIEW = ROOT / "scripts" / "receipt-icon-preview.png"

WIDTH = 48
HEIGHT = 40


def draw_m(size: tuple[int, int]) -> Image.Image:
    im = Image.new("1", size, 1)
    d = ImageDraw.Draw(im)
    w, h = size
    # Inset so the M does not clip the last column of a cheap head.
    x0, y0, x1, y1 = 2, 2, w - 3, h - 3
    mid = (x0 + x1) / 2
    stem = max(6, round((x1 - x0) * 0.22))
    # Outer M: left leg, left diagonal, right diagonal, right leg.
    d.polygon(
        [
            (x0, y1),
            (x0, y0),
            (x0 + stem, y0),
            (mid, y0 + (y1 - y0) * 0.55),
            (x1 - stem, y0),
            (x1, y0),
            (x1, y1),
            (x1 - stem, y1),
            (x1 - stem, y0 + (y1 - y0) * 0.42),
            (mid, y1 - 2),
            (x0 + stem, y0 + (y1 - y0) * 0.42),
            (x0 + stem, y1),
        ],
        fill=0,
    )
    return im


def chunk_b64(value: str, size: int = 100) -> str:
    parts = [value[i : i + size] for i in range(0, len(value), size)]
    return "\n".join(f'  "{part}"' for part in parts)


def pack(im: Image.Image) -> bytes:
    px = im.load()
    w, h = im.size
    packed = bytearray()
    for y in range(h):
        for x in range(0, w, 8):
            byte = 0
            for bit in range(8):
                xx = x + bit
                if xx < w and px[xx, y] == 0:
                    byte |= 0x80 >> bit
            packed.append(byte)
    return bytes(packed)


def main() -> None:
    im = draw_m((WIDTH, HEIGHT))
    packed = pack(im)
    black = sum(bin(b).count("1") for b in packed)
    print(f"bitmap {WIDTH}x{HEIGHT}, {len(packed)} bytes, black {black}/{len(packed)*8} ({100*black/(len(packed)*8):.0f}%)")

    preview = im.resize((WIDTH * 8, HEIGHT * 8), Image.Resampling.NEAREST)
    preview.save(PREVIEW)

    png = io.BytesIO()
    im.save(png, format="PNG")
    png_b64 = base64.b64encode(png.getvalue()).decode("ascii")
    packed_b64 = base64.b64encode(packed).decode("ascii")

    OUT.write_text(
        "\n".join(
            [
                "// Chunky 1-bit M for cheap 58mm ESC/POS. Solid black, 48x40.",
                f"export const RECEIPT_ICON_WIDTH = {WIDTH};",
                f"export const RECEIPT_ICON_HEIGHT = {HEIGHT};",
                "export const RECEIPT_ICON_BASE64 =",
                chunk_b64(packed_b64) + ";",
                "export const RECEIPT_ICON_PNG_DATA_URL =",
                chunk_b64("data:image/png;base64," + png_b64) + ";",
                "",
            ]
        ),
        encoding="utf8",
    )
    print(f"wrote {OUT} and {PREVIEW}")


if __name__ == "__main__":
    main()
