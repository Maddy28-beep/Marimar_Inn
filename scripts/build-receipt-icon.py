"""Build a high-contrast 1-bit Marimar mark for ESC/POS and paper receipts."""

from __future__ import annotations

import base64
import io
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
    if luminance < 32:
        return False
    return True


def chunk_b64(value: str, size: int = 100) -> str:
    parts = [value[i : i + size] for i in range(0, len(value), size)]
    return "\n".join(f'  "{part}"' for part in parts)


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    height = round(im.height * WIDTH / im.width)
    if height % 2:
        height += 1
    im = im.resize((WIDTH, height), Image.Resampling.LANCZOS)
    px = im.load()
    packed = bytearray()
    bw = Image.new("1", (WIDTH, height), 1)
    bw_px = bw.load()
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
                    bw_px[xx, y] = 0
            packed.append(byte)

    png = io.BytesIO()
    bw.save(png, format="PNG")
    png_b64 = base64.b64encode(png.getvalue()).decode("ascii")
    packed_b64 = base64.b64encode(bytes(packed)).decode("ascii")

    OUT.write_text(
        "\n".join(
            [
                "// 1-bit Marimar mark for ESC/POS and paper receipts.",
                f"export const RECEIPT_ICON_WIDTH = {WIDTH};",
                f"export const RECEIPT_ICON_HEIGHT = {height};",
                "export const RECEIPT_ICON_BASE64 =",
                chunk_b64(packed_b64) + ";",
                "export const RECEIPT_ICON_PNG_DATA_URL =",
                chunk_b64("data:image/png;base64," + png_b64) + ";",
                "",
            ]
        ),
        encoding="utf8",
    )
    print(f"wrote {OUT} ({len(packed)} bytes, {WIDTH}x{height}, png {len(png_b64)} b64)")


if __name__ == "__main__":
    main()
