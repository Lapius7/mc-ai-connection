"""README のバナー画像を作る。docs/images/hero.png を横長に切り、角丸にして、プロジェクト名を白字で重ねる。

使い方: uv run --with pillow python scripts/make-banner.py
出力: docs/images/banner.png（2400x800、角丸は透過）
文字は暗い影で読みやすくする。光らせない。
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(ROOT, "docs", "images", "hero.png")
OUT = os.path.join(ROOT, "docs", "images", "banner.png")
W, H, RADIUS = 2400, 800, 72
TITLE = "MCP Minecraft Controller"
FONTS = [
    "/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]

def load_font(size):
    for path in FONTS:
        if os.path.exists(path):
            f = ImageFont.truetype(path, size)
            try:
                f.set_variation_by_name("Bold")
            except Exception:
                pass
            return f
    return ImageFont.load_default()

img = Image.open(SRC).convert("RGB")
top = 130  # 画面左下の旧タイトル文字を避け、聖堂が収まる高さで切る
img = img.crop((0, top, img.width, top + H))

# 全体を少し暗くして白字を読みやすくする
img = Image.composite(Image.new("RGB", (W, H), (8, 10, 14)), img, Image.new("L", (W, H), 110))

# 中央に1行
font = load_font(176)
tw = ImageDraw.Draw(img).textlength(TITLE, font=font)
x0, y0 = (W - tw) / 2, H / 2 - 120
shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(shadow).text((x0, y0 + 10), TITLE, font=font, fill=(0, 0, 0, 210))
shadow = shadow.filter(ImageFilter.GaussianBlur(14))
img = Image.alpha_composite(img.convert("RGBA"), shadow)
ImageDraw.Draw(img).text((x0, y0), TITLE, font=font, fill=(255, 255, 255, 255))

# 角丸（透過）
mask = Image.new("L", (W * 2, H * 2), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, W * 2 - 1, H * 2 - 1], RADIUS * 2, fill=255)
img.putalpha(mask.resize((W, H), Image.LANCZOS))
img.save(OUT, optimize=True)
print(OUT, img.size)
