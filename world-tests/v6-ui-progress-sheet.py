"""Contact sheet for the progress UI renders (world-tests/v6-ui-progress.mjs).

    python3 world-tests/v6-ui-progress-sheet.py <out.png> <cols> <png> [<png> ...]

Tiles the shots at a common width with their file name under each, so a
whole set (the eight stops, the eight click-ins) can be judged in one image.
"""
import os
import sys

from PIL import Image, ImageDraw

out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
W = 845
tiles = []
for f in files:
    im = Image.open(f).convert("RGB")
    h = round(im.height * W / im.width)
    tiles.append((os.path.basename(f), im.resize((W, h), Image.LANCZOS)))
rows = (len(tiles) + cols - 1) // cols
cell_h = max(t.height for _, t in tiles) + 26
sheet = Image.new("RGB", (cols * W + (cols - 1) * 8, rows * cell_h), (29, 24, 38))
draw = ImageDraw.Draw(sheet)
for i, (name, t) in enumerate(tiles):
    x = (i % cols) * (W + 8)
    y = (i // cols) * cell_h
    sheet.paste(t, (x, y))
    draw.text((x + 6, y + t.height + 6), name, fill=(246, 239, 230))
sheet.save(out)
print(out, sheet.size)
