from pathlib import Path

from PIL import Image

src = Image.open('alllogos.png').convert('RGB')
w, h = src.size
cols, rows = 3, 3
cell_w = w // cols
cell_h = h // rows

names = [
    ['st-courier', 'trackon', 'delhivery'],
    ['bluedart', 'dtdc', 'ecosafe'],
    ['aps', 'personal-collection', 'own-vehicle'],
]

out_dir = Path('public/logistics')
out_dir.mkdir(parents=True, exist_ok=True)


def trim_tile(img: Image.Image, bg: tuple[int, int, int] = (254, 254, 254), pad: int = 10) -> Image.Image:
    pixels = img.load()
    iw, ih = img.size
    min_x, min_y, max_x, max_y = iw, ih, 0, 0
    for y in range(ih):
        for x in range(iw):
            r, g, b = pixels[x, y]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 18:
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    if max_x < min_x:
        return img
    left = max(0, min_x - pad)
    top = max(0, min_y - pad)
    right = min(iw, max_x + pad + 1)
    bottom = min(ih, max_y + pad + 1)
    return img.crop((left, top, right, bottom))


for row in range(rows):
    for col in range(cols):
        left = col * cell_w
        top = row * cell_h
        right = left + cell_w if col < cols - 1 else w
        bottom = top + cell_h if row < rows - 1 else h
        tile = src.crop((left, top, right, bottom))
        tile = trim_tile(tile)
        canvas = Image.new('RGB', tile.size, (255, 255, 255))
        canvas.paste(tile)
        out = out_dir / f'{names[row][col]}.png'
        canvas.save(out, optimize=True)
        print(f'{out}: {canvas.size[0]}x{canvas.size[1]}')
