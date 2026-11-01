from pathlib import Path
from PIL import Image
import sys

master = Path(sys.argv[1])
assets = Path(sys.argv[2])
sizes = [16, 20, 24, 32, 40, 48, 64, 80, 128, 256]
source = Image.open(master).convert("RGBA")
alpha = source.getchannel("A")
for size in sizes:
    image = Image.new("RGBA", (size, size), (91, 155, 213, 0))
    image.putalpha(alpha.resize((size, size), Image.Resampling.BOX))
    image.save(assets / f"icon-{size}.png", optimize=True)
print(f"rendered {len(sizes)} transparent icon sizes")
