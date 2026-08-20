"""Build a high-contrast 1-bit Marimar mark for ESC/POS raster printing.

The source icon is glossy cyan/magenta. Floyd–Steinberg dither of those
mid-tones looks almost blank on cheap thermal heads, so colored pixels
become solid black and near-black/transparent pixels stay paper-white.
"""

from __future__ import annotations

import base64
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "logo" / "icon.png"
OUT = ROOT / "src" / "lib" / "receipt-icon.ts"

WIDTH = 192


def is_mark_pixel(r: int, g: int, b: int, a: int) -> bool:
    if a < 40:
        return False
    luminance = 0.299 * r + 0.587 * g + 0.114 * b
    # Opaque black in the PNG is background, not the M.
    if luminance < 32:
        return False
    return True


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    height = round(im.height * WIDTH / im.width)
    if height % 2:
        height += 1
    im = im.resize((WIDTH, height), Image.Resampling.LANCZOS)
    px = im.load()
    packed = bytearray()
    for y in range(height):
        for x in range(0, WIDTH, 8):
            byte = 0
            for bit in range(8):
                xx = x + bit
                if xx >= WIDTH:
                    continue
                r, g, b, a = px[xx, y]
                if is_mark_pixel(r, g, b, a):
                    byte |= 0x80 >> bit
            packed.append(byte)

    b64 = base64.b64encode(bytes(packed)).decode("ascii")
    chunks = [b64[i : i + 100] for i in range(0, len(b64), 100)]
    quoted = "\n".join(f'  "{chunk}"' for chunk in chunks)
    OUT.write_text(
        "\n".join(
            [
                "// 1-bit Marimar mark for ESC/POS. Colored pixels are solid black;",
                "// transparent and near-black background stay white so the M actually",
                "// burns in on cheap 58mm heads.",
                f"export const RECEIPT_ICON_WIDTH = {WIDTH};",
                f"export const RECEIPT_ICON_HEIGHT = {height};",
                "export const RECEIPT_ICON_BASE64 =",
                quoted + ";",
                "",
            ]
        ),
        encoding="utf8",
    )
    print(f"wrote {OUT} ({len(packed)} bytes, {WIDTH}x{height})")


if __name__ == "__main__":
    main()
