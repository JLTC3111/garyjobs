"""Derive SVG paths from the supplied transparent logo; no relettering.

The PNG remains the original artwork. Four color regions retain the blue/cyan
illustration; the existing lettering silhouette is a separate themeable path.
Requires Pillow and numpy for regeneration only, not the site build/runtime.
"""
from pathlib import Path
from hashlib import sha256
import json
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'dist/assets/gary-agency-logo.png'
OUT = ROOT / 'dist/assets'
pixels = np.array(Image.open(SOURCE).convert('RGBA'))
height, width = pixels.shape[:2]
rgb = pixels[:, :, :3].astype(float)
# The raster has opaque white pixels in some glyph counters/edge mattes as well
# as transparent background. They are negative space, not blue brand artwork.
visible = (pixels[:, :, 3] >= 96) & (rgb[:, :, 2] - rgb[:, :, 0] > 20)
yy, xx = np.indices((height, width))
# Both original lines sit here; the cap, crescents and stars are outside it.
lettering = visible & (xx >= 190) & (yy >= 208) & (yy <= 303)
art = visible & ~lettering
centers = np.array([[37, 71, 143], [47, 78, 139], [68, 165, 216], [76, 159, 187]], dtype=float)
samples = rgb[art]
for _ in range(24):
    labels = ((samples[:, None, :] - centers[None, :, :]) ** 2).sum(2).argmin(1)
    updated = np.array([samples[labels == i].mean(0) if (labels == i).any() else center for i, center in enumerate(centers)])
    if np.max(abs(updated - centers)) < .01:
        break
    centers = updated
regions = np.full((height, width), -1, dtype=int)
regions[art] = ((rgb[art, None, :] - centers[None, :, :]) ** 2).sum(2).argmin(1)


def path_for(mask):
    """Trace oriented cell boundaries, retaining holes and original geometry."""
    edges = set()
    for y, x in zip(*np.where(mask)):
        x, y = int(x), int(y)
        if y == 0 or not mask[y - 1, x]: edges.add(((x, y), (x + 1, y)))
        if x == width - 1 or not mask[y, x + 1]: edges.add(((x + 1, y), (x + 1, y + 1)))
        if y == height - 1 or not mask[y + 1, x]: edges.add(((x + 1, y + 1), (x, y + 1)))
        if x == 0 or not mask[y, x - 1]: edges.add(((x, y + 1), (x, y)))
    adjacency = {}
    for a, b in edges: adjacency.setdefault(a, set()).add(b)
    paths = []
    while edges:
        start, next_point = min(edges)
        previous, current = start, next_point
        points = [start]
        edges.remove((previous, current))
        adjacency[previous].remove(current)
        while current != start:
            points.append(current)
            dx, dy = current[0] - previous[0], current[1] - previous[1]
            # At diagonal contact retain two shapes rather than crossing paths.
            preferred = [(current[0] - dy, current[1] + dx),
                         (current[0] + dx, current[1] + dy),
                         (current[0] + dy, current[1] - dx),
                         (current[0] - dx, current[1] - dy)]
            following = next(p for p in preferred if p in adjacency[current])
            edges.remove((current, following))
            adjacency[current].remove(following)
            previous, current = current, following
        # Merge collinear edges, without changing the silhouette at all.
        reduced = []
        for i, point in enumerate(points):
            before, after = points[i - 1], points[(i + 1) % len(points)]
            if (point[0] - before[0]) * (after[1] - point[1]) != (point[1] - before[1]) * (after[0] - point[0]):
                reduced.append(point)
        paths.append('M' + ' '.join(f'{x},{y}' for x, y in reduced) + 'Z')
    return ''.join(paths)


art_paths = [(f'#{int(round(c[0])):02x}{int(round(c[1])):02x}{int(round(c[2])):02x}', path_for(regions == i)) for i, c in enumerate(centers)]
text_path = path_for(lettering)
for theme, text_color in [('light', '#25478f'), ('dark', '#f7f5fb')]:
    shapes = '\n'.join(f'<path fill="{color}" d="{path}"/>' for color, path in art_paths)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" fill-rule="evenodd">
<title>Vietnam English Teaching Jobs</title>
<desc>Derived from the supplied transparent PNG. Original cap, crescents, stars and lettering outlines retained. {theme.title()} theme lettering.</desc>
<g id="brand-art">{shapes}</g>
<path id="brand-lettering" fill="{text_color}" d="{text_path}"/>
</svg>'''
    (OUT / f'teaching-jobs-logo-{theme}.svg').write_text(svg)
manifest = {'source': SOURCE.name, 'sha256': sha256(SOURCE.read_bytes()).hexdigest(), 'format': 'Derived SVG paths, not an original vector master', 'viewBox': [0, 0, width, height], 'method': 'Blue/cyan ink and alpha cell-contour tracing, excluding white raster matte/counters; four artwork color regions; unchanged lettering geometry across themes', 'letteringBounds': [190, 208, width, 304]}
(OUT / 'teaching-jobs-logo-provenance.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Created transparent SVG pair from {SOURCE.name}; original retained.')
