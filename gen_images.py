"""Generate placeholder images for Shotgun & Katana."""
from PIL import Image, ImageDraw, ImageFont
import os
import math

OUT = "images"
os.makedirs(OUT, exist_ok=True)

# Character sprite (top-down view, facing right) - 64x64
def make_character(filename, pose='idle'):
    img = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = 32, 32
    
    # Coat tail (behind)
    d.ellipse([cx - 18, cy - 12, cx - 4, cy + 12], fill=(20, 5, 12, 230), outline=(255, 32, 80, 255), width=1)
    
    # Body (circle)
    d.ellipse([cx - 12, cy - 12, cx + 12, cy + 12], fill=(34, 34, 40, 255), outline=(255, 32, 80, 255), width=2)
    
    # Gun (right side)
    if pose == 'shoot':
        # Gun with muzzle flash
        d.rectangle([cx + 6, cy - 4, cx + 26, cy + 4], fill=(80, 80, 80, 255), outline=(0,0,0,255), width=1)
        # Muzzle flash
        d.polygon([(cx + 26, cy - 5), (cx + 40, cy), (cx + 26, cy + 5)], fill=(255, 220, 0, 255))
        d.polygon([(cx + 28, cy - 3), (cx + 36, cy), (cx + 28, cy + 3)], fill=(255, 255, 200, 255))
    else:
        d.rectangle([cx + 6, cy - 3, cx + 24, cy + 3], fill=(60, 60, 60, 255), outline=(0,0,0,255), width=1)
    
    # Katana (left/top)
    if pose == 'slash':
        # Katana extended
        d.line([(cx, cy), (cx + 30, cy - 18)], fill=(220, 230, 255, 255), width=3)
        d.line([(cx + 5, cy), (cx + 33, cy - 18)], fill=(255, 255, 255, 255), width=1)
        # Slash trail
        for i in range(4):
            ang = math.radians(-50 + i * 15)
            x1 = cx + math.cos(ang) * 18
            y1 = cy + math.sin(ang) * 18
            x2 = cx + math.cos(ang) * 26
            y2 = cy + math.sin(ang) * 26
            d.line([(x1, y1), (x2, y2)], fill=(255, 255, 255, 100 - i * 20), width=2)
    else:
        # Sheathed katana on back
        d.line([(cx - 10, cy + 6), (cx - 24, cy + 12)], fill=(150, 150, 150, 255), width=2)
        d.line([(cx - 12, cy + 4), (cx - 22, cy + 8)], fill=(80, 80, 80, 255), width=1)
    
    # Head (slightly forward)
    d.ellipse([cx - 4, cy - 8, cx + 8, cy + 4], fill=(220, 220, 220, 255), outline=(0, 0, 0, 255), width=1)
    
    # Visor (red glow)
    d.rectangle([cx - 1, cy - 5, cx + 7, cy - 2], fill=(255, 32, 80, 255))
    
    if pose == 'move':
        # Slight motion lines behind
        for i in range(3):
            d.line([(cx - 18 - i*3, cy - 8 + i*4), (cx - 24 - i*3, cy - 8 + i*4)], fill=(0, 212, 255, 100 - i*20), width=1)
    
    img.save(f"{OUT}/{filename}")

make_character('player_idle.png', 'idle')
make_character('player_move.png', 'move')
make_character('player_shoot.png', 'shoot')
make_character('player_slash.png', 'slash')

# Title image
def make_title():
    img = Image.new('RGBA', (800, 200), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Just a dark background overlay with text — actual title rendered in HTML
    img.save(f"{OUT}/title.png")
make_title()

# Standing CG (right-bottom side)
def make_standing():
    img = Image.new('RGBA', (300, 480), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    
    cx, cy = 150, 280
    
    # Glow background
    for r in range(100, 0, -10):
        alpha = int((100 - r) * 0.5)
        d.ellipse([cx - r, cy - r - 50, cx + r, cy + r - 50], fill=(255, 32, 80, alpha))
    
    # Coat (long, hanging)
    d.polygon([
        (cx - 60, cy - 90),
        (cx + 60, cy - 90),
        (cx + 80, cy + 180),
        (cx - 80, cy + 180)
    ], fill=(15, 5, 10, 240), outline=(255, 32, 80, 255), width=3)
    
    # Inner red lining (visible at chest)
    d.polygon([
        (cx - 30, cy - 60),
        (cx + 30, cy - 60),
        (cx + 5, cy + 20),
        (cx - 5, cy + 20)
    ], fill=(120, 10, 30, 255))
    
    # Body torso
    d.rounded_rectangle([cx - 50, cy - 80, cx + 50, cy + 60], radius=15, fill=(30, 30, 40, 255), outline=(80, 80, 100, 255), width=2)
    
    # Belts
    d.rectangle([cx - 50, cy + 30, cx + 50, cy + 40], fill=(60, 50, 40, 255))
    d.ellipse([cx - 8, cy + 30, cx + 8, cy + 42], fill=(255, 200, 0, 255), outline=(0,0,0,255), width=1)
    
    # Head
    d.ellipse([cx - 30, cy - 130, cx + 30, cy - 70], fill=(220, 220, 220, 255), outline=(60, 60, 60, 255), width=2)
    
    # Hair (spiky, dark)
    for i in range(5):
        x = cx - 25 + i * 12
        d.polygon([(x, cy - 130), (x + 4, cy - 145), (x + 8, cy - 130)], fill=(20, 10, 15, 255))
    
    # Visor (glowing red band)
    d.rectangle([cx - 25, cy - 105, cx + 25, cy - 92], fill=(60, 0, 10, 255), outline=(255, 32, 80, 255), width=2)
    # Glow line in visor
    d.line([(cx - 22, cy - 99), (cx + 22, cy - 99)], fill=(255, 100, 130, 255), width=2)
    d.line([(cx - 22, cy - 100), (cx + 22, cy - 100)], fill=(255, 200, 220, 255), width=1)
    
    # Mouth (grim line)
    d.line([(cx - 12, cy - 78), (cx + 12, cy - 78)], fill=(60, 0, 10, 255), width=2)
    
    # Shotgun across body
    d.rectangle([cx + 30, cy - 30, cx + 90, cy - 18], fill=(80, 60, 40, 255), outline=(20, 10, 5, 255), width=2)
    d.rectangle([cx + 70, cy - 25, cx + 100, cy - 22], fill=(40, 40, 40, 255))
    d.rectangle([cx + 25, cy - 22, cx + 50, cy - 12], fill=(40, 30, 20, 255))  # grip
    
    # Katana sheath at hip (left side)
    d.rectangle([cx - 90, cy + 10, cx - 30, cy + 20], fill=(20, 5, 30, 255), outline=(120, 0, 60, 255), width=2)
    d.rectangle([cx - 36, cy + 5, cx - 30, cy + 25], fill=(200, 180, 120, 255))  # hilt
    
    # Arms
    d.rounded_rectangle([cx - 70, cy - 60, cx - 50, cy + 30], radius=10, fill=(30, 30, 40, 255), outline=(80, 80, 100, 255), width=2)
    d.rounded_rectangle([cx + 50, cy - 60, cx + 70, cy + 30], radius=10, fill=(30, 30, 40, 255), outline=(80, 80, 100, 255), width=2)
    
    # Hands (gloved)
    d.ellipse([cx - 75, cy + 25, cx - 45, cy + 55], fill=(15, 5, 10, 255), outline=(255, 32, 80, 255), width=1)
    d.ellipse([cx + 45, cy + 25, cx + 75, cy + 55], fill=(15, 5, 10, 255), outline=(255, 32, 80, 255), width=1)
    
    img.save(f"{OUT}/standing.png")
make_standing()

print("Done generating images:")
for f in os.listdir(OUT):
    p = os.path.join(OUT, f)
    print(f"  {p} ({os.path.getsize(p)} bytes)")
