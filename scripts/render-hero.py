# README のヒーロー画像を Blender (bpy) で3Dレンダリングする。
# 使い方: scripts/render-hero.sh   （中身は uv run --python 3.11 --with bpy --with pillow python scripts/render-hero.py）
# 環境変数: HERO_W / HERO_H（既定 2400x1200）、HERO_SAMPLES（既定 160）、HERO_OUT（既定 docs/images/hero.png）
# ブロックの質感は numpy で作った16x16のピクセルテクスチャ、形はコードで組んだボクセルの大聖堂。
# 色は寒色の石（青みのある灰）と、足場と設計線の琥珀色の2色だけ。
import math
import os
import random
import sys

import bpy
import numpy as np
from mathutils import Vector

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
W = int(os.environ.get("HERO_W", 2400))
H = int(os.environ.get("HERO_H", 1200))
SAMPLES = int(os.environ.get("HERO_SAMPLES", 160))
OUT = os.environ.get("HERO_OUT", os.path.join(ROOT, "docs", "images", "hero.png"))

# ---------- パレット（2色） ----------
STONE = np.array([0.50, 0.55, 0.62])   # 寒色の石
AMBER = np.array([0.80, 0.52, 0.18])   # 足場・設計線・松明

# ---------- テクスチャアトラス ----------
T = 16
TILES = ["brick", "brick_dark", "roof", "planks", "ground", "glass"]
rng = np.random.default_rng(7)


def noise(shape, amp):
    return rng.normal(0, amp, shape)


def tile_brick(base, mortar, var):
    t = np.zeros((T, T, 3))
    for y in range(T):
        for x in range(T):
            row = y // 4
            off = 4 if row % 2 else 0
            bx = (x + off) % 8
            if y % 4 == 3 or bx == 7:
                t[y, x] = base * mortar
            else:
                t[y, x] = base * (1 + var * (((x + off) // 8 + row * 3) % 3 - 1) * 0.6)
    t *= (1 + noise((T, T, 1), 0.05))
    return t


def make_tiles():
    tiles = {}
    tiles["brick"] = tile_brick(STONE * 0.72, 0.55, 0.12)
    tiles["brick_dark"] = tile_brick(STONE * 0.42, 0.55, 0.10)
    # 屋根: スレート（横縞）
    r = np.zeros((T, T, 3))
    for y in range(T):
        r[y, :] = STONE * (0.30 if y % 4 == 3 else 0.38 + 0.03 * ((y // 4) % 2))
    tiles["roof"] = r * (1 + noise((T, T, 1), 0.06))
    # 足場の板: 琥珀色の板目
    p = np.zeros((T, T, 3))
    for y in range(T):
        p[y, :] = AMBER * (0.35 if y % 8 == 7 else 0.55 + 0.06 * math.sin(y * 1.7))
    p *= 1 + noise((T, T, 1), 0.07)
    tiles["planks"] = p
    g = STONE * 0.2 * (1 + noise((T, T, 1), 0.1))
    tiles["ground"] = g
    # ガラス: 暗い石色に格子
    gl = np.zeros((T, T, 3)) + STONE * 0.10
    gl[::4, :] = STONE * 0.3
    gl[:, ::4] = STONE * 0.3
    tiles["glass"] = gl
    return tiles


def build_atlas():
    tiles = make_tiles()
    n = len(TILES)
    atlas = np.ones((T, T * n, 4))
    for i, k in enumerate(TILES):
        atlas[:, i * T:(i + 1) * T, :3] = np.clip(tiles[k], 0, 1)
    img = bpy.data.images.new("atlas", T * n, T, alpha=False)
    img.colorspace_settings.name = "sRGB"
    # Blender は左下原点
    flat = atlas[::-1].reshape(-1)
    img.pixels.foreach_set(flat.astype(np.float32))
    img.update()
    img.pack()
    return img


# ---------- ボクセルの建物 ----------
vox = {}


def put(x, y, z, k):
    vox[(x, y, z)] = k


def box(x0, x1, y0, y1, z0, z1, k):
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            for z in range(z0, z1 + 1):
                put(x, y, z, k)


def build_world():
    rnd = random.Random(3)
    # 地面
    for x in range(-90, 91):
        for y in range(-60, 110):
            put(x, y, -2, "ground")
    for x in range(-90, 91):
        for y in range(-60, 110):
            if rnd.random() < 0.02:
                put(x, y, -1, "ground")
    # 身廊（完成した前半 y0..17）
    FIN = 17
    for y in range(0, FIN + 1):
        for z in range(0, 12):
            put(-5, y, z, "brick")
            put(5, y, z, "brick")
        for x in range(-5, 6):
            put(x, y, -1, "brick_dark")
    # 基壇と軒の帯
    for y in range(0, FIN + 1):
        for x in (-5, 5):
            put(x, y, 0, "brick_dark")
            put(x, y, 11, "brick_dark")
    # 正面の壁（厚さ2）
    for y in (0, 1):
        for x in range(-5, 6):
            for z in range(0, 12):
                put(x, y, z, "brick")
        for x in range(-5, 6):
            put(x, y, 0, "brick_dark")
            put(x, y, 11, "brick_dark")
    # 切妻屋根と正面の破風
    for k in range(0, 6):
        z = 12 + k
        for y in range(-1, FIN + 2):
            put(5 - k, y, z, "roof")
            put(-(5 - k), y, z, "roof")
            if k == 5:
                put(0, y, z, "roof")
        if True:
            for y in (0, 1):
                for x in range(-(5 - k), 5 - k + 1):
                    put(x, y, z, "brick")
            for x in range(-(5 - k), 5 - k + 1):
                put(x, -1, z, "brick_dark") if k in (0,) else None
    # 棟
    for y in range(-1, FIN + 2):
        put(0, y, 18, "brick_dark")
    # バラ窓
    for x in range(-5, 6):
        for z in range(0, 20):
            d = math.hypot(x - 0, z - 7)
            if (x, 0, z) in vox and d <= 3.3 and d >= 1.2:
                put(x, 0, z, "glass")
                put(x, 1, z, "glass")
    # 扉と尖頭アーチ
    for x in (-1, 0, 1):
        for z in range(0, 5):
            vox.pop((x, 0, z), None); vox.pop((x, 1, z), None)
    vox.pop((0, 0, 5), None); vox.pop((0, 1, 5), None)
    # 側面のステンドグラス
    for yy in (7, 11, 15):
        for z in range(3, 10):
            if (z == 9):
                continue
            put(-5, yy, z, "glass")
            put(5, yy, z, "glass")
    # 扶壁
    for yy in (5, 9, 13, 17):
        for s in (-1, 1):
            for z in range(0, 10):
                put(s * 6, yy, z, "brick")
            for z in range(0, 5):
                put(s * 7, yy, z, "brick")
            put(s * 6, yy, 10, "brick_dark")
            put(s * 6, yy, 0, "brick_dark")
    # 双塔
    for s in (-1, 1):
        cx = s * 8
        box(cx - 2, cx + 2, 0, 4, 0, 23, "brick")
        for z in range(0, 24, 8):
            for x in range(cx - 2, cx + 3):
                for y in (0, 4):
                    put(x, y, z, "brick_dark")
        # 塔の細い窓
        for z in (6, 7, 8, 14, 15, 16, 17):
            put(cx, 0, z, "glass")
            put(cx - s * 2, 2, z, "glass") if False else None
            put(cx + s * 2, 2, z, "glass")
        for x in range(cx - 2, cx + 3):
            for y in range(0, 5):
                put(x, y, 24, "brick_dark")
        # 胸壁
        for x in range(cx - 2, cx + 3):
            for y in range(0, 5):
                if (x + y) % 2 == 0 and (x in (cx - 2, cx + 2) or y in (0, 4)):
                    put(x, y, 25, "brick_dark")
        # 尖塔
        for i, r in enumerate((2, 1, 1, 0)):
            for x in range(cx - r, cx + r + 1):
                for y in range(2 - r, 2 + r + 1):
                    put(x, y, 25 + i if i else 25, "roof") if i else None
        for i, r in enumerate((2, 1)):
            for x in range(cx - r, cx + r + 1):
                for y in range(2 - r, 2 + r + 1):
                    put(x, y, 26 + i, "roof")
        for z in range(28, 32):
            put(cx, 2, z, "brick_dark")
    # 未完成の後半 y18..28 : 壁は低く崩れた高さまで
    for y in range(FIN + 1, 29):
        for s in (-1, 1):
            h = rnd.choice([2, 3, 3, 4, 5, 6]) if y < 26 else rnd.choice([1, 2, 3])
            for z in range(0, h + 1):
                put(s * 5, y, z, "brick" if z else "brick_dark")
        for x in range(-5, 6):
            put(x, y, -1, "brick_dark")
    # 足場（琥珀色の板）: 奥側(+x)に本格的に、手前(-x)は支柱だけ
    for y in (18, 23, 28):
        for z in range(0, 14):
            put(8, y, z, "planks")
            if y in (18, 28):
                put(-8, y, z, "planks")
    for z in (5, 10):
        for y in range(18, 29):
            put(8, y, z, "planks")
        for x in range(5, 9):
            for y in (18, 23, 28):
                put(x, y, z, "planks")
    for i in range(0, 6):
        put(8, 18 + i, 5 + i // 1 if i < 5 else 10, "planks")
    # 積まれた石と散らばった資材
    for (x, y, z) in [(-12, 8, -1), (-12, 9, -1), (-12, 8, 0), (13, 22, -1), (14, 22, -1), (12, 20, -1),
                      (-9, 30, -1), (-9, 31, -1), (-9, 30, 0), (9, 33, -1)]:
        put(x, y, z, "brick")


GHOST = set()


def build_ghost():
    # 未完成部分の設計線: 完成していれば立つはずの壁と屋根の外側の面
    g = {}
    for y in range(18, 29):
        for z in range(0, 12):
            if (-5, y, z) not in vox:
                g[(-5, y, z)] = 1
            if (5, y, z) not in vox:
                g[(5, y, z)] = 1
    for k in range(0, 6):
        for y in range(18, 29):
            g[(5 - k, y, 12 + k)] = 1
            g[(-(5 - k), y, 12 + k)] = 1
    for y in range(18, 29):
        g[(0, y, 18)] = 1
    return g


FACES = {
    # (法線, 4頂点の相対座標)
    "top": ((0, 0, 1), [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]),
    "bot": ((0, 0, -1), [(0, 1, 0), (1, 1, 0), (1, 0, 0), (0, 0, 0)]),
    "px": ((1, 0, 0), [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)]),
    "nx": ((-1, 0, 0), [(0, 1, 0), (0, 0, 0), (0, 0, 1), (0, 1, 1)]),
    "py": ((0, 1, 0), [(1, 1, 0), (0, 1, 0), (0, 1, 1), (1, 1, 1)]),
    "ny": ((0, -1, 0), [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)]),
}


def make_mesh(name, blocks, material, uv_kind=True):
    verts, faces, uvs = [], [], []
    n = len(TILES)
    for (x, y, z), k in blocks.items():
        ti = TILES.index(k) if uv_kind else 0
        for key, (nrm, vs) in FACES.items():
            if (x + nrm[0], y + nrm[1], z + nrm[2]) in blocks:
                continue
            i0 = len(verts)
            for v in vs:
                verts.append((x + v[0], y + v[1], z + v[2]))
            faces.append((i0, i0 + 1, i0 + 2, i0 + 3))
            e = 0.002
            u0, u1 = (ti + e) / n, (ti + 1 - e) / n
            uvs += [(u0, e), (u1, e), (u1, 1 - e), (u0, 1 - e)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    uv = me.uv_layers.new(name="uv")
    flat = np.array(uvs, dtype=np.float32).reshape(-1)
    uv.data.foreach_set("uv", flat)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    return ob


# ---------- シーン ----------
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    cy.device = "CPU"
    cy.samples = SAMPLES
    cy.use_denoising = True
    try:
        cy.denoiser = "OPENIMAGEDENOISE"
    except TypeError:
        pass
    cy.max_bounces = 6
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "Filmic" if "Filmic" in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties["view_transform"].enum_items] else "Standard"
    sc.view_settings.look = "None"

    # 材質
    atlas = build_atlas()
    mat = bpy.data.materials.new("blocks")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = atlas
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.92
    mat_ghost = bpy.data.materials.new("ghost")
    mat_ghost.use_nodes = True
    gb = next(n for n in mat_ghost.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    gb.inputs["Base Color"].default_value = (*AMBER, 1)
    gb.inputs["Roughness"].default_value = 0.6

    build_world()
    make_mesh("world", vox, mat)
    ghost = make_mesh("ghost", {k: "brick" for k in build_ghost()}, mat_ghost)
    wf = ghost.modifiers.new("wire", "WIREFRAME")
    wf.thickness = 0.11
    wf.use_replace = True
    wf.use_boundary = True

    # 世界色（暗い寒色の夜。グラデーションなし）
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.012, 0.018, 0.028, 1)
    bg.inputs["Strength"].default_value = 1.0
    sc.world = world

    # 光: 月明かり（寒色）+ 松明（琥珀）
    sun = bpy.data.lights.new("moon", "SUN")
    sun.energy = 3.2
    sun.color = tuple(STONE / STONE.max() * 0.9 + 0.1)
    sun.angle = math.radians(1.2)
    so = bpy.data.objects.new("moon", sun)
    so.rotation_euler = (math.radians(58), 0, math.radians(-40))
    bpy.context.collection.objects.link(so)

    def torch(x, y, z, power=900):
        l = bpy.data.lights.new("t", "POINT")
        l.energy = power
        l.color = tuple(AMBER / AMBER.max())
        l.shadow_soft_size = 0.25
        o = bpy.data.objects.new("t", l)
        o.location = (x, y, z)
        bpy.context.collection.objects.link(o)

    for (x, y, z) in [(-3.5, -1.5, 3), (3.5, -1.5, 3), (-9, 20, 3), (9, 24, 3), (-3, 23, 1.5)]:
        torch(x, y, z)

    # 霧（薄い体積）
    bpy.ops.mesh.primitive_cube_add(size=1)
    fog = bpy.context.active_object
    fog.scale = (260, 260, 70)
    fog.location = (0, 12, 20)
    fm = bpy.data.materials.new("fog")
    fm.use_nodes = True
    fn = fm.node_tree.nodes
    for n in list(fn):
        fn.remove(n)
    pv = fn.new("ShaderNodeVolumeScatter")
    pv.inputs["Color"].default_value = (0.55, 0.62, 0.72, 1)
    pv.inputs["Density"].default_value = 0.0022
    pv.inputs["Anisotropy"].default_value = 0.35
    out = fn.new("ShaderNodeOutputMaterial")
    fm.node_tree.links.new(pv.outputs[0], out.inputs["Volume"])
    fog.data.materials.append(fm)
    fog.display_type = "WIRE"
    fog.visible_shadow = False

    # カメラ: 左前の低い位置から、双塔と奥の工事中を見る
    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = 19
    cam = bpy.data.objects.new("cam", cam_d)
    cam.location = (-40, -13, 6)
    bpy.context.collection.objects.link(cam)
    target = Vector((7, 22, 12))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    cam_d.dof.use_dof = True
    focus = bpy.data.objects.new("focus", None)
    focus.location = (-8, 2, 9)
    bpy.context.collection.objects.link(focus)
    cam_d.dof.focus_object = focus
    cam_d.dof.aperture_fstop = 4.5

    sc.render.filepath = OUT + ".raw.png"
    sc.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)

    # 文字は最小限: プロジェクト名だけ
    from PIL import Image, ImageDraw, ImageFont
    im = Image.open(OUT + ".raw.png").convert("RGB")
    d = ImageDraw.Draw(im)
    size = max(18, W // 62)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", size)
    except OSError:
        font = ImageFont.load_default()
    d.text((W // 50, H - H // 14), "mc-ai-connection", font=font, fill=(205, 212, 222))
    im.save(OUT, optimize=True)
    os.remove(OUT + ".raw.png")
    print("wrote", OUT)


main()
