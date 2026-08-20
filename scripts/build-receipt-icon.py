"""Build a chunky 1-bit version of the real Marimar Inn tulip mark, sized for
a 58mm ESC/POS head.

Earlier attempts sent the full glossy logo PNG straight to the printer and it
went completely silent (nothing printed at all, not even the text below it) —
this clone's raster support chokes on anything with fine detail or gradients.
The fix that actually got dots on paper was a hand-drawn block "M" at a tiny,
solid 48x40 stencil. This script keeps that exact same safe envelope (size,
solid fills, no dithering) but derives the shape from the real logo mark
(public/logo/icon.png) instead of a generic letterform, so the receipt shows
an actual (if simplified) silhouette of the brand mark rather than a plain M.
"""

from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "logo" / "icon.png"
OUT = ROOT / "src" / "lib" / "receipt-icon.ts"
PREVIEW = ROOT / "scripts" / "receipt-icon-preview.png"

WIDTH = 48
HEIGHT = 40
THRESHOLD = 110  # out of 255 — tuned so the silhouette stays chunky/solid, not speckled.


def build_silhouette(size: tuple[int, int]) -> Image.Image:
    src = Image.open(SOURCE).convert("RGBA")
    # The mark is opaque color on a transparent background — alpha itself is
    # the shape. Treat it directly as ink coverage (fully opaque -> black).
    alpha = src.split()[3]
    ink = Image.eval(alpha, lambda a: 255 - a)

    w, h = size
    # Downsample in two hops with a small margin so the tulip's pointed tips
    # survive instead of aliasing away, then a closing pass (dilate, erode)
    # merges anti-aliasing speckle into solid regions — the same "most dots
    # are solid black" chunkiness that made the hand-drawn M print reliably.
    margin = 2
    inner = (w - margin * 2, h - margin * 2)
    small = ink.resize(inner, Image.Resampling.LANCZOS)
    bw = small.point(lambda p: 0 if p < THRESHOLD else 255, mode="L")
    # Closing (dilate then erode) to fill small anti-aliasing gaps without
    # shrinking the shape overall — MinFilter dilates the black regions
    # (picks the darkest neighbor), MaxFilter then eats back the growth
    # while leaving newly-closed gaps filled. Order matters: doing this
    # backwards erodes the already-thin blade strokes down to nothing
    # before there's anything left to close.
    bw = bw.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))

    canvas = Image.new("L", size, 255)
    canvas.paste(bw, (margin, margin))
    return canvas.convert("1")


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
    im = build_silhouette((WIDTH, HEIGHT))
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
                "// Chunky 1-bit silhouette of the Marimar Inn tulip mark, for cheap 58mm ESC/POS. Solid black, 48x40.",
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
