"""Bake the six printed cut faces from The Met's public-domain JP1847 image."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

root = Path(__file__).resolve().parents[1]
media = root / 'dist/cardboard-gallery/media'
sheets = json.loads((root / 'src/great-wave-cuts.json').read_text())
size = (1200, 807)
source = Image.open(sys.argv[1]).convert('RGB').resize(size, Image.Resampling.LANCZOS)
atlas = Image.new('RGB', (size[0]*3, size[1]*2))
masks = []
for sheet in sheets:
    mask = Image.new('L', size)
    for polygon in sheet['cuts']:
        ImageDraw.Draw(mask).polygon([(round(x*1.5), round(y*1.5)) for x,y in polygon], fill=255)
    masks.append(mask)

# Sample clean sky and paper from the right of the original to reconstruct the
# background behind the crest. Retain the original cartouche on the exposed sky.
sky_strip = source.crop((735, 0, 900, 501))
sky = Image.new('RGB', size)
for i,x in enumerate(range(0,size[0],sky_strip.width)):
    strip = ImageOps.mirror(sky_strip) if i % 2 else sky_strip
    sky.paste(strip, (x,0))
    sky.paste(strip.crop((0,465,165,501)).resize((165,size[1]-501)), (x,501))
# Hidden registration margins show the natural card stock when taken apart.
# Give the stock a fine fibre texture instead of stretching the woodblock ink.
rng = np.random.default_rng(1847)
noise = rng.normal(0,3.2,(size[1],size[0],1))
paper = Image.fromarray(np.uint8(np.clip(np.array([187,158,118])+noise,0,255)))
draw = ImageDraw.Draw(paper)
for _ in range(9000):
    x,y = rng.integers([0,0],size)
    draw.line((x,y,x+rng.integers(2,8),y+int(rng.integers(-1,2))),fill=(179,150,114))
covered = Image.new('L',size)
for i in reversed(range(len(sheets))):
    if i == 0:
        title = Image.new('L',size)
        ImageDraw.Draw(title).rectangle((0,0,113,260),fill=255)
        face = Image.composite(source,sky,title.filter(ImageFilter.GaussianBlur(4)))
    else:
        face = Image.composite(paper,source,covered.filter(ImageFilter.MinFilter(9)))
    atlas.paste(face,((i%3)*size[0],(i//3)*size[1]))
    covered.paste(255,mask=masks[i])
atlas.save(media / 'great-wave-cuts.webp',quality=89,method=6)
