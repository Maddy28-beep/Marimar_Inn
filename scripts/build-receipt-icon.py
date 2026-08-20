"""Build a 1-bit dithered Marimar mark for ESC/POS raster printing."""

from __future__ import annotations

import base64
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "logo" / "icon.png"
OUT = ROOT / "src" / "lib" / "receipt-icon.ts"

WIDTH = 160


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    height = round(im.height * WIDTH / im.width)
    if height % 2:
        height += 1
    im = im.resize((WIDTH, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (WIDTH, height), (255, 255, 255, 255))
    canvas.paste(im, mask=im.split()[-1])
    bw = canvas.convert("L").convert("1", dither=Image.FLOYDSTEINBERG)
    px = bw.load()
    packed = bytearray()
    for y in range(height):
        for x in range(0, WIDTH, 8):
            byte = 0
            for bit in range(8):
                xx = x + bit
                if xx < WIDTH and px[xx, y] == 0:
                    byte |= 0x80 >> bit
            packed.append(byte)

    b64 = base64.b64encode(bytes(packed)).decode("ascii")
    chunks = [b64[i : i + 100] for i in range(0, len(b64), 100)]
    quoted = "\n".join(f'  "{chunk}"' for chunk in chunks)
    OUT.write_text(
        "\n".join(
            [
                "// 1-bit dithered Marimar mark for ESC/POS. Width is a multiple of 8",
                "// and small enough to sit inside 58mm paper with side margins so the",
                "// head does not clip the right edge.",
                f"export const RECEIPT_ICON_WIDTH = {WIDTH};",
                f"export const RECEIPT_ICON_HEIGHT = {height};",
                "export const RECEIPT_ICON_BASE64 =",
                quoted + ";",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(f"wrote {OUT} ({len(packed)} bytes, {WIDTH}x{height})")


if __name__ == "__main__":
    main()
