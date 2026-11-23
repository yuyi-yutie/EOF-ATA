"""
EOFATA — 美术圣经参照场景（三渲二 / cel shaded）

目的：把「人物 / 敌人 / 武器 / 地板 / 墙体 / 道具」放进同一个灯光、同一套
调色板、同一种描边粗细里，做一张可以对照的定调图。所有模型共用：
  · 同一套 cel 材质（Diffuse -> ShaderToRGB -> 常量 ColorRamp -> Emission）
  · 同一套倒壳描边（Solidify + Backface Culling）
  · 同一套主光 / 补光 / 环境遮蔽色

约定：
  · 1 世界单位 = 1 米，地砖 2m（= 游戏里 2 格 x 32px）
  · 角色朝 -Y 建模，脚底在 z=0
  · 武器朝 +X 建模，握把在原点
  · 描边粗细按物体族分级，见 OUTLINE 表

用法：
  exec(compile(open(r"...\\_blender\\artbible_scene.py").read(), "artbible_scene.py", "exec"))
  build_stage()
  build_characters()
  build_weapons()
  build_props()
  setup_render()          # 相机 + 灯光 + 输出
  render_all()
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = r"C:\Users\yy197\Documents\GitHub\EOF-ATA\dev_html"
OUT_DIR = os.path.join(ROOT, "art_draft", "artbible")
BLEND_OUT = os.path.join(ROOT, "blender_draft", "artbible.blend")
SCENE_NAME = "EOFATA_ArtBible"

# 描边粗细（米）：角色最粗，墙体最细，保持“同一种笔”
OUTLINE = {
    "chr": 0.019,
    "enemy": 0.019,
    "wpn": 0.012,
    "prop": 0.013,
    "arch": 0.009,
    "none": 0.0,
}

# ---------------------------------------------------------------- 调色板
# 所有颜色按「亮 / 中 / 暗」三档组织，三档之间的明度差保持一致，
# 这样不同族的东西放在一起才像同一层。
PAL = {
    # 场景
    "floor": "#C9B49A",
    "grout": "#8A7660",
    "base": "#3B3F47",
    "wall": "#E9DFCF",
    "wall_cap": "#DCD0BB",
    "wall_dark": "#C6B69C",
    "void": "#15171B",
    "static": "#3B4049",
    # 人类
    "skin": "#C99A76",
    "skin2": "#AF7F58",
    "hair": "#3A2E28",
    "helmet": "#3B424C",
    "scout_jacket": "#3F5C60",
    "scout_vest": "#5B7F82",
    "scout_pants": "#2A3A42",
    "assault_jacket": "#8A8055",
    "assault_vest": "#A79C6D",
    "assault_pants": "#4A4633",
    # 干尸
    "gaunt_skin": "#B3AC90",
    "gaunt_body": "#7E7A62",
    "gaunt_dark": "#55523F",
    # 玩家（深蓝灰 + 青色面罩 + 琥珀点缀）
    "slate": "#2E3540",
    "slate_m": "#3D4757",
    "slate_l": "#525F73",
    "visor": "#86E9F2",
    "amber": "#F0B04C",
    # 僵尸
    "olive": "#8FAE6B",
    "olive_m": "#6E8A52",
    "olive_d": "#4A5638",
    # 喷吐僵尸
    "blue": "#7FA8D2",
    "blue_m": "#5A7DA6",
    "blue_d": "#36496A",
    "violet": "#B98CFF",
    # 武器
    "gun": "#33383F",
    "gun_l": "#4B525C",
    "steel": "#B9C1CB",
    "orange": "#F0703C",
    # 道具
    "wood": "#A97C50",
    "wood_d": "#7A5736",
    "teal": "#3F5F63",
}

INK = "#16130F"      # 统一描边色：暖近黑，不用纯黑
SHADOW_TINT = (0.055, 0.075, 0.115)   # 暗部统一向冷色偏，制造“同一层”


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]

    def f(v):
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    return tuple(f(v) for v in c)


def shade_of(base, k=0.56):
    """由基色推暗部：压暗 + 往冷色拉一点。"""
    return tuple(min(1.0, base[i] * k + SHADOW_TINT[i]) for i in range(3))


def hi_of(base, k=1.16):
    return tuple(min(1.0, base[i] * k + 0.018) for i in range(3))


# ---------------------------------------------------------------- 材质
_MATS = {}


def cel_mat(hexcol, rim=0.0, emis=None, emis_str=1.0, shadow_k=0.56, hi_at=0.76):
    """三渲二材质：两段硬边 + 可选亮部 + 可选轮廓光。"""
    base = srgb(hexcol) if isinstance(hexcol, str) else hexcol
    key = ("cel", hexcol, round(rim, 3), emis, emis_str, shadow_k, hi_at)
    if key in _MATS:
        return _MATS[key]

    name = "AB_" + (hexcol.lstrip("#") if isinstance(hexcol, str) else "c")
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emi = nt.nodes.new("ShaderNodeEmission")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
    diff.inputs["Color"].default_value = (1, 1, 1, 1)
    diff.inputs["Roughness"].default_value = 0.0

    ramp.color_ramp.interpolation = "CONSTANT"
    e0 = ramp.color_ramp.elements[0]
    e0.position = 0.0
    e0.color = (*shade_of(base, shadow_k), 1)
    e1 = ramp.color_ramp.elements[1]
    e1.position = 0.30
    e1.color = (*base, 1)
    e2 = ramp.color_ramp.elements.new(hi_at)
    e2.color = (*hi_of(base), 1)

    nt.links.new(diff.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs[0], ramp.inputs[0])

    col_out = ramp.outputs[0]
    if rim > 0:
        # 轮廓光：Fresnel 外圈加一条冷色亮边（在描边内侧，提升“打光感”）
        lw = nt.nodes.new("ShaderNodeLayerWeight")
        lw.inputs["Blend"].default_value = 0.35
        rr = nt.nodes.new("ShaderNodeValToRGB")
        rr.color_ramp.interpolation = "CONSTANT"
        rr.color_ramp.elements[0].position = 0.62
        rr.color_ramp.elements[0].color = (0, 0, 0, 1)
        rr.color_ramp.elements[1].position = 0.80
        rr.color_ramp.elements[1].color = (1, 1, 1, 1)
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = rim
        nt.links.new(lw.outputs["Fresnel"], rr.inputs[0])
        nt.links.new(rr.outputs[0], mul.inputs[0])

        rim_col = tuple(min(1.0, c * 0.55 + 0.34) for c in (0.66, 0.82, 1.0))
        rim_emi = nt.nodes.new("ShaderNodeEmission")
        rim_emi.inputs["Color"].default_value = (*rim_col, 1)
        rim_add = nt.nodes.new("ShaderNodeAddShader")
        nt.links.new(mul.outputs[0], rim_emi.inputs["Strength"])
        rim_emi.inputs["Strength"].default_value = 1.0
    else:
        rim_emi = rim_add = None

    nt.links.new(col_out, emi.inputs["Color"])
    if emis is not None:
        nt.links.new(emis, emi.inputs["Strength"])
    else:
        emi.inputs["Strength"].default_value = 1.0

    if rim_add is not None:
        nt.links.new(emi.outputs[0], rim_add.inputs[0])
        nt.links.new(rim_emi.outputs[0], rim_add.inputs[1])
        nt.links.new(rim_add.outputs[0], out.inputs["Surface"])
    else:
        nt.links.new(emi.outputs[0], out.inputs["Surface"])

    _MATS[key] = mat
    return mat


def emis_mat(hexcol, strength=1.8):
    key = ("emis", hexcol, strength)
    if key in _MATS:
        return _MATS[key]
    mat = bpy.data.materials.new("AB_E_" + hexcol.lstrip("#"))
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emi = nt.nodes.new("ShaderNodeEmission")
    emi.inputs["Color"].default_value = (*srgb(hexcol), 1)
    emi.inputs["Strength"].default_value = strength
    nt.links.new(emi.outputs[0], out.inputs["Surface"])
    _MATS[key] = mat
    return mat


def grad_mat(name, top_hex, bot_hex):
    mat = bpy.data.materials.new("AB_" + name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emi = nt.nodes.new("ShaderNodeEmission")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "EASE"
    ramp.color_ramp.elements[0].color = (*srgb(bot_hex), 1)
    ramp.color_ramp.elements[1].color = (*srgb(top_hex), 1)
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], emi.inputs["Color"])
    nt.links.new(emi.outputs[0], out.inputs["Surface"])
    return mat


OUTLINE_MAT = None


def outline_mat():
    global OUTLINE_MAT
    if OUTLINE_MAT is None:
        m = bpy.data.materials.new("AB_Ink")
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        emi = nt.nodes.new("ShaderNodeEmission")
        emi.inputs["Color"].default_value = (*srgb(INK), 1)
        nt.links.new(emi.outputs[0], out.inputs["Surface"])
        m.use_backface_culling = True
        try:
            m.shadow_method = "NONE"
        except Exception:
            pass
        OUTLINE_MAT = m
    return OUTLINE_MAT


# ---------------------------------------------------------------- 几何工具
SC = None
COLLS = {}

# 低多边形总开关：打开后所有倒角只有 1 段、圆柱球体降面、全部平直着色。
# 整套美术的"面数预算"就靠这一个开关控制。
LOWPOLY = True
LOBEVEL = 1          # 倒角段数
LOBW = 0.5           # 倒角宽度系数（低模用窄倒角，别变成宝石）
LOSEG = 8            # 圆柱边数
LOSPHERE = (8, 5)    # 球体经纬段数


def fresh_scene():
    global SC, COLLS, _MATS
    old = bpy.data.scenes.get(SCENE_NAME)
    if old:
        for ob in list(old.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.scenes.remove(old)
    SC = bpy.data.scenes.new(SCENE_NAME)
    bpy.context.window.scene = SC

    w = bpy.data.worlds.new("W_AB")
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs[0].default_value = (0.55, 0.6, 0.7, 1)
    bg.inputs[1].default_value = 0.05
    wo = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs[0], wo.inputs["Surface"])
    SC.world = w

    COLLS = {}
    for cn in ("ARCH", "CHR", "ENEMY", "WPN", "PROP", "LIGHT", "CAM"):
        c = bpy.data.collections.new(cn)
        SC.collection.children.link(c)
        COLLS[cn] = c

    _MATS = {}
    return SC


def finish(bm, name, mat, loc=(0, 0, 0), rot=(0, 0, 0), coll="PROP",
           smooth=True, outline=0.0, cyl_axis=None, parent=None):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    if LOWPOLY:
        smooth = False
    for p in me.polygons:
        if not smooth:
            p.use_smooth = False
            continue
        if cyl_axis is not None:
            p.use_smooth = abs(p.normal[cyl_axis]) < 0.9
        else:
            p.use_smooth = True

    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.rotation_euler = rot
    (COLLS.get(coll) or SC.collection).objects.link(ob)

    if outline > 0:
        me.materials.append(outline_mat())
        m = ob.modifiers.new("Outline", "SOLIDIFY")
        m.thickness = outline
        m.offset = 1.0
        m.use_flip_normals = True
        m.material_offset = 1
        m.use_rim = False

    if parent is not None:
        ob.parent = parent
        ob.matrix_parent_inverse = Matrix.Identity(4)
    return ob


def box(name, size, loc, mat, bevel=0.04, seg=3, rot=(0, 0, 0),
        coll="PROP", outline=0.0, smooth=True, parent=None):
    if LOWPOLY:
        seg = LOBEVEL
        bevel *= LOBW
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    if bevel > 1e-5:
        b = min(bevel, min(size) * 0.48)
        bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges), offset=b,
                        segments=seg, profile=0.5, affect="EDGES",
                        clamp_overlap=True)
    return finish(bm, name, mat, loc, rot, coll, smooth, outline, None, parent)


def cyl(name, r, h, loc, mat, seg=20, rot=(0, 0, 0), coll="PROP",
        outline=0.0, r2=None, bevel=0.0, parent=None):
    if LOWPOLY:
        seg = min(seg, LOSEG)
    bm = bmesh.new()
    r2 = r if r2 is None else r2
    try:
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                              radius1=r, radius2=r2, depth=h)
    except TypeError:
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                              diameter1=r, diameter2=r2, depth=h)
    if bevel > 1e-5:
        bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges), offset=bevel,
                        segments=2, profile=0.5, affect="EDGES",
                        clamp_overlap=True)
    return finish(bm, name, mat, loc, rot, coll, True, outline, 2, parent)


def sph(name, r, loc, mat, useg=20, vseg=12, scale=(1, 1, 1), coll="PROP",
        outline=0.0, parent=None):
    if LOWPOLY:
        useg, vseg = LOSPHERE
    bm = bmesh.new()
    try:
        bmesh.ops.create_uvsphere(bm, u_segments=useg, v_segments=vseg, radius=r)
    except TypeError:
        bmesh.ops.create_uvsphere(bm, u_segments=useg, v_segments=vseg, diameter=r)
    for v in bm.verts:
        v.co.x *= scale[0]
        v.co.y *= scale[1]
        v.co.z *= scale[2]
    return finish(bm, name, mat, loc, (0, 0, 0), coll, True, outline, None, parent)


def plane(name, size, loc, mat, rot=(math.radians(90), 0, 0), coll="PROP"):
    bm = bmesh.new()
    verts = [bm.verts.new((-size[0] / 2, -size[1] / 2, 0)),
             bm.verts.new((size[0] / 2, -size[1] / 2, 0)),
             bm.verts.new((size[0] / 2, size[1] / 2, 0)),
             bm.verts.new((-size[0] / 2, size[1] / 2, 0))]
    bm.faces.new(verts)
    return finish(bm, name, mat, loc, rot, coll, True, 0.0, None, None)


def empty(name, loc=(0, 0, 0), rot=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.2
    e.location = loc
    e.rotation_euler = rot
    SC.collection.objects.link(e)
    return e


def face_rot(loc, target):
    """角色朝 -Y 建模；返回让它看向 target 的 Z 旋转。"""
    dx = target[0] - loc[0]
    dy = target[1] - loc[1]
    n = math.hypot(dx, dy) or 1.0
    ux, uy = dx / n, dy / n
    return math.atan2(ux, -uy)


def place(objs, loc=(0, 0, 0), rz=0.0, s=1.0):
    e = empty("GRP", loc, (0, 0, rz))
    e.scale = (s, s, s)
    for ob in objs:
        ob.parent = e
        ob.matrix_parent_inverse = Matrix.Identity(4)
    return e


# ---------------------------------------------------------------- 场景
def build_stage():
    """地板 / 墙 / 门洞 / 展台底座 / 背景板。"""
    m_base = cel_mat(PAL["base"], shadow_k=0.62, hi_at=0.99)
    m_floor = cel_mat(PAL["floor"], hi_at=0.99)
    m_grout = cel_mat(PAL["grout"], shadow_k=0.7, hi_at=0.99)
    m_wall = cel_mat(PAL["wall"], hi_at=0.99)
    m_cap = cel_mat(PAL["wall_cap"], hi_at=0.99)
    m_wdark = cel_mat(PAL["wall_dark"], hi_at=0.99)
    m_void = emis_mat(PAL["void"], 1.0)

    W, D = 10.0, 8.0
    # 展台底座（能看到切面，像模型套件）
    box("Basement", (W, D, 0.55), (0, 0, -0.275), m_base, 0.03, 2, coll="ARCH")

    # 勾缝底面
    box("Grout", (W, D, 0.02), (0, 0, 0.005), m_grout, 0.0, 1, coll="ARCH")

    # 2m 地砖（对应游戏 2 格）
    tile_n_x, tile_n_y = 5, 4
    tsz = 2.0
    gap = 0.045
    for ix in range(tile_n_x):
        for iy in range(tile_n_y):
            x = -W / 2 + tsz / 2 + ix * tsz
            y = -D / 2 + tsz / 2 + iy * tsz
            box("Tile_%d_%d" % (ix, iy),
                (tsz - gap, tsz - gap, 0.05), (x, y, 0.035),
                m_floor, 0.035, 3, coll="ARCH", outline=OUTLINE["none"])

    # 后墙 y=+4，门洞 x∈[2.1,3.3]
    wall_h, wall_t = 2.15, 0.4
    yc = D / 2 + wall_t / 2
    seg1 = 2.1 - (-W / 2)
    box("Wall_Back_L", (seg1, wall_t, wall_h),
        (-W / 2 + seg1 / 2, yc, wall_h / 2), m_wall, 0.02, 2,
        coll="ARCH", outline=OUTLINE["arch"])
    seg2 = W / 2 - 3.3
    box("Wall_Back_R", (seg2, wall_t, wall_h),
        (3.3 + seg2 / 2, yc, wall_h / 2), m_wall, 0.02, 2,
        coll="ARCH", outline=OUTLINE["arch"])
    box("Wall_Lintel", (1.2, wall_t, wall_h - 1.95),
        (2.7, yc, 1.95 + (wall_h - 1.95) / 2), m_wall, 0.02, 2,
        coll="ARCH", outline=OUTLINE["arch"])

    # 门洞里是一段暗走廊
    box("Door_Void", (1.2, 0.9, 1.95), (2.7, yc + 0.45, 0.975), m_void,
        0.0, 1, coll="ARCH")
    box("Door_End", (1.2, 0.05, 1.95), (2.7, yc + 0.9, 0.975), m_void,
        0.0, 1, coll="ARCH")

    # 门洞金属门框 + 走廊暖光
    m_frame = cel_mat("#4A505A", rim=0.2)
    box("Door_FrameL", (0.09, 0.46, 2.00), (2.06, yc, 0.99), m_frame, 0.02, 2,
        coll="ARCH", outline=OUTLINE["arch"])
    box("Door_FrameR", (0.09, 0.46, 2.00), (3.34, yc, 0.99), m_frame, 0.02, 2,
        coll="ARCH", outline=OUTLINE["arch"])
    box("Door_FrameT", (1.38, 0.46, 0.09), (2.70, yc, 1.99), m_frame, 0.02, 2,
        coll="ARCH", outline=OUTLINE["arch"])
    box("Door_Glow", (1.10, 0.02, 0.05), (2.70, yc + 0.42, 1.86),
        emis_mat("#FFD9A0", 1.4), 0.0, 1, coll="ARCH")

    # 地面上门洞前的暖光斑（贴花，不是灯）
    m_spill = emis_mat("#E9C48C", 0.32)
    box("Door_Spill", (1.5, 0.9, 0.004), (2.70, 3.45, 0.062), m_spill, 0.0, 1,
        coll="ARCH")

    # 墙面危险条纹（门洞左侧）
    m_haz = cel_mat(PAL["amber"], shadow_k=0.6, hi_at=0.99)
    for i in range(4):
        box("Hazard_%d" % i, (0.10, 0.02, 0.34),
            (1.35 + i * 0.19, yc - wall_t / 2 - 0.012, 1.25), m_haz, 0.004, 1,
            rot=(0, 0, 0), coll="ARCH", outline=0.0)


    xc = -W / 2 - wall_t / 2
    box("Wall_Left", (wall_t, D + wall_t, wall_h), (xc, -wall_t / 2, wall_h / 2),
        m_wall, 0.02, 2, coll="ARCH", outline=OUTLINE["arch"])

    # 墙顶压条 + 墙脚踢脚（最亮的压条和最暗的踢脚拉开层次）
    box("Cap_Back", (W, wall_t + 0.06, 0.09), (0, yc, wall_h + 0.04), m_cap,
        0.015, 2, coll="ARCH", outline=OUTLINE["arch"])
    box("Cap_Left", (wall_t + 0.06, D + wall_t, 0.09),
        (xc, -wall_t / 2, wall_h + 0.04), m_cap, 0.015, 2,
        coll="ARCH", outline=OUTLINE["arch"])
    box("Kick_Back", (W, 0.03, 0.14), (0, yc - wall_t / 2 - 0.015, 0.07),
        m_wdark, 0.0, 1, coll="ARCH")
    box("Kick_Left", (0.03, D, 0.14), (xc + wall_t / 2 + 0.015, 0, 0.07),
        m_wdark, 0.0, 1, coll="ARCH")

    # 墙面竖向分板线条（很浅的凸起，靠硬阴影读出结构）
    for i, x in enumerate([-4.2, -3.0, -1.8, -0.6, 0.6, 1.8]):
        box("WallRib_%d" % i, (0.05, 0.035, wall_h - 0.35),
            (x, yc - wall_t / 2 - 0.017, (wall_h - 0.35) / 2 + 0.16),
            m_wall, 0.008, 2, coll="ARCH", outline=0.0)

    # 地面喷漆标记（琥珀色粗线，指向门洞）
    m_paint = cel_mat(PAL["amber"], shadow_k=0.62)
    for i in range(3):
        box("Chevron_%d" % i, (0.5, 0.09, 0.012),
            (0.9 + i * 0.45, -2.6 + i * 0.28, 0.065), m_paint, 0.004, 1,
            rot=(0, 0, math.radians(32)), coll="ARCH", outline=0.0)

    # 背景板
    m_bg = grad_mat("Backdrop", "#C4CFD9", "#EDE3D3")
    plane("Backdrop", (40, 22), (0, 7.5, 4.0), m_bg)

    print("stage ok:", len([o for o in SC.objects]))
    return SC


# ---------------------------------------------------------------- 人物
# ---------------------------------------------------------------- 人物（极简低模）
# 规范：一个方块 = 头，一个方块 = 身体，两个方块 = 腿；不建手臂、不建手。
# 区分角色只靠：比例 / 头部色块 / 面部贴片（面罩、眼睛、嘴）/ 主色。
# ---------------------------------------------------------------- 人物（极简低模）
# 规范：一个方块 = 头，一个方块 = 身体，两个方块 = 腿；不建手臂、不建手。
# 区分角色只靠：比例 / 头部大小 / 面部贴片（面罩、眼睛、嘴）/ 主色。
# 比例按 Q 版走：头约占全身 34–36%。
# ---------------------------------------------------------------- 人物（极简低模）
# 规范：一个方块 = 头，一个方块 = 身体，两个方块 = 腿；不建手臂、不建手。
# 面部只用贴片（眼 / 嘴 / 面罩 / 牙），不加几何细节。
# 区分角色只靠：头身比例、头部大小、发型/头盔、服装色块、面部贴片。
def build_human_scout(name="CHR_Scout", coll="CHR"):
    """潜行者：瘦，深青夹克 + 毛线帽 + 小背包。"""
    M = dict(
        skin=cel_mat(PAL["skin"], rim=0.26),
        hair=cel_mat(PAL["hair"], rim=0.20),
        jacket=cel_mat(PAL["scout_jacket"], rim=0.28),
        vest=cel_mat(PAL["scout_vest"], rim=0.28),
        pants=cel_mat(PAL["scout_pants"], rim=0.22),
        dark=cel_mat("#20252D", rim=0.18),
        eye=cel_mat("#221E1B", rim=0.0),
    )
    o = OUTLINE["chr"]
    P = []
    # 头（裸露的脸）
    P.append(box(name + "_Head", (0.50, 0.44, 0.50), (0, -0.01, 1.40),
                 M["skin"], 0.0, 1, coll=coll, outline=o))
    # 毛线帽（盖住头顶）
    P.append(box(name + "_Cap", (0.54, 0.48, 0.10), (0, 0.005, 1.66),
                 M["hair"], 0.0, 1, coll=coll, outline=o))
    P.append(box(name + "_HairBack", (0.50, 0.12, 0.30), (0, 0.205, 1.44),
                 M["hair"], 0.0, 1, coll=coll, outline=o))
    for s in (-1, 1):
        P.append(box(name + "_Eye%d" % s, (0.07, 0.02, 0.05), (s * 0.10, -0.235, 1.43),
                     M["eye"], 0.0, 1, coll=coll, outline=0))
    P.append(box(name + "_Mouth", (0.10, 0.02, 0.022), (0, -0.235, 1.31),
                 M["eye"], 0.0, 1, coll=coll, outline=0))
    # 脖子（一小截，避免头和身体断开）
    P.append(box(name + "_Neck", (0.16, 0.16, 0.08), (0, 0, 1.12),
                 M["skin"], 0.0, 1, coll=coll, outline=0))
    # 身体
    P.append(box(name + "_Torso", (0.42, 0.28, 0.46), (0, 0, 0.86),
                 M["jacket"], 0.0, 1, coll=coll, outline=o))
    P.append(box(name + "_Vest", (0.28, 0.02, 0.24), (0, -0.142, 0.88),
                 M["vest"], 0.0, 1, coll=coll, outline=0))
    P.append(box(name + "_Belt", (0.44, 0.30, 0.06), (0, 0, 0.63),
                 M["dark"], 0.0, 1, coll=coll, outline=0))
    P.append(box(name + "_Pack", (0.30, 0.15, 0.26), (0, 0.20, 0.90),
                 M["dark"], 0.0, 1, coll=coll, outline=o))
    # 腿
    for s in (-1, 1):
        P.append(box(name + "_Leg%d" % s, (0.16, 0.19, 0.60), (s * 0.10, 0, 0.30),
                     M["pants"], 0.0, 1, coll=coll, outline=o))
    return P


def build_human_assault(name="CHR_Assault", coll="CHR"):
    """突击手：壮，沙色战术服 + 头盔 + 胸挂。"""
    M = dict(
        skin=cel_mat(PAL["skin2"], rim=0.26),
        helmet=cel_mat(PAL["helmet"], rim=0.24),
        jacket=cel_mat(PAL["assault_jacket"], rim=0.26),
        vest=cel_mat(PAL["assault_vest"], rim=0.26),
        pants=cel_mat(PAL["assault_pants"], rim=0.22),
        dark=cel_mat("#2A2723", rim=0.18),
        eye=cel_mat("#221E1B", rim=0.0),
    )
    o = OUTLINE["chr"]
    P = []
    P.append(box(name + "_Head", (0.52, 0.46, 0.50), (0, -0.01, 1.40),
                 M["skin"], 0.0, 1, coll=coll, outline=o))
    # 头盔 + 帽檐
    P.append(box(name + "_Helmet", (0.58, 0.50, 0.20), (0, 0.005, 1.63),
                 M["helmet"], 0.0, 1, coll=coll, outline=o))
    P.append(box(name + "_Brim", (0.54, 0.10, 0.05), (0, -0.255, 1.545),
                 M["helmet"], 0.0, 1, coll=coll, outline=o))
    for s in (-1, 1):
        P.append(box(name + "_Eye%d" % s, (0.08, 0.02, 0.05), (s * 0.105, -0.235, 1.41),
                     M["eye"], 0.0, 1, coll=coll, outline=0))
    P.append(box(name + "_Mouth", (0.11, 0.02, 0.022), (0, -0.235, 1.29),
                 M["eye"], 0.0, 1, coll=coll, outline=0))
    P.append(box(name + "_Neck", (0.18, 0.18, 0.08), (0, 0, 1.12),
                 M["skin"], 0.0, 1, coll=coll, outline=0))
    # 身体（更宽）+ 胸挂 + 弹匣袋
    P.append(box(name + "_Torso", (0.50, 0.34, 0.48), (0, 0, 0.84),
                 M["jacket"], 0.0, 1, coll=coll, outline=o))
    P.append(box(name + "_Vest", (0.36, 0.03, 0.26), (0, -0.185, 0.87),
                 M["vest"], 0.0, 1, coll=coll, outline=0))
    for s in (-1, 1):
        P.append(box(name + "_Pouch%d" % s, (0.10, 0.05, 0.10), (s * 0.13, -0.19, 0.68),
                     M["dark"], 0.0, 1, coll=coll, outline=0))
    P.append(box(name + "_Belt", (0.52, 0.36, 0.06), (0, 0, 0.60),
                 M["dark"], 0.0, 1, coll=coll, outline=0))
    # 腿
    for s in (-1, 1):
        P.append(box(name + "_Leg%d" % s, (0.19, 0.21, 0.58), (s * 0.12, 0, 0.29),
                     M["pants"], 0.0, 1, coll=coll, outline=o))
    return P


def build_zombie(name="ENEMY_Zombie", coll="ENEMY"):
    """僵尸：大头低埋（驼背）、宽身、短腿 + 琥珀眼 + 牙。"""
    M = dict(
        skin=cel_mat(PAL["olive"], rim=0.30),
        mid=cel_mat(PAL["olive_m"], rim=0.25),
        dark=cel_mat(PAL["olive_d"], rim=0.2),
        ink=cel_mat("#1F2418", rim=0.0),
        eye=emis_mat("#F2C46B", 1.4),
        bone=cel_mat("#E4DCC4", rim=0.1),
    )
    o = OUTLINE["enemy"]
    P = []
    # 头：最大，压到肩膀上
    P.append(box(name + "_Head", (0.64, 0.52, 0.60), (0, -0.02, 1.40),
                 M["skin"], 0.0, 1, coll=coll, outline=o))
    for s in (-1, 1):
        P.append(box(name + "_Eye%d" % s, (0.12, 0.02, 0.085), (s * 0.135, -0.283, 1.46),
                     M["eye"], 0.0, 1, coll=coll, outline=0))
    P.append(box(name + "_Mouth", (0.28, 0.02, 0.09), (0.01, -0.283, 1.26),
                 M["ink"], 0.0, 1, coll=coll, outline=0))
    for i, tx in enumerate((-0.075, 0.005, 0.085)):
        P.append(box(name + "_Tooth%d" % i, (0.045, 0.02, 0.055), (tx, -0.288, 1.295),
                     M["bone"], 0.0, 1, coll=coll, outline=0))
    # 身体
    P.append(box(name + "_Torso", (0.50, 0.36, 0.50), (0, 0, 0.81),
                 M["mid"], 0.0, 1, coll=coll, outline=o))
    P.append(box(name + "_Belly", (0.26, 0.02, 0.26), (0, -0.182, 0.81),
                 M["skin"], 0.0, 1, coll=coll, outline=0))
    # 腿
    for s in (-1, 1):
        P.append(box(name + "_Leg%d" % s, (0.19, 0.22, 0.54), (s * 0.13, 0, 0.27),
                     M["dark"], 0.0, 1, coll=coll, outline=o))
    return P


def build_zombie_gaunt(name="ENEMY_Gaunt", coll="ENEMY"):
    """干尸：窄高头 + 凹陷眼窝 + 张开的颌，瘦长四肢，土黄尸体色。"""
    M = dict(
        skin=cel_mat(PAL["gaunt_skin"], rim=0.26),
        mid=cel_mat(PAL["gaunt_body"], rim=0.22),
        dark=cel_mat(PAL["gaunt_dark"], rim=0.2),
        ink=cel_mat("#1A1813", rim=0.0),
        eye=emis_mat("#E8A34A", 1.1),
        bone=cel_mat("#DDD6BE", rim=0.08),
    )
    o = OUTLINE["enemy"]
    P = []
    # 头：窄高
    P.append(box(name + "_Head", (0.50, 0.44, 0.62), (0, -0.02, 1.48),
                 M["skin"], 0.0, 1, coll=coll, outline=o))
    for s in (-1, 1):
        P.append(box(name + "_Socket%d" % s, (0.14, 0.02, 0.12), (s * 0.115, -0.238, 1.60),
                     M["ink"], 0.0, 1, coll=coll, outline=0))
        P.append(box(name + "_Eye%d" % s, (0.05, 0.02, 0.045), (s * 0.115, -0.244, 1.595),
                     M["eye"], 0.0, 1, coll=coll, outline=0))
    # 张开的颌 + 牙
    P.append(box(name + "_Jaw", (0.28, 0.02, 0.14), (0, -0.238, 1.28),
                 M["ink"], 0.0, 1, coll=coll, outline=0))
    for i, tx in enumerate((-0.085, -0.005, 0.075)):
        P.append(box(name + "_Tooth%d" % i, (0.042, 0.02, 0.06), (tx, -0.244, 1.325),
                     M["bone"], 0.0, 1, coll=coll, outline=0))
    # 身体：瘦，露肋
    P.append(box(name + "_Torso", (0.40, 0.30, 0.54), (0, 0, 0.87),
                 M["mid"], 0.0, 1, coll=coll, outline=o))
    P.append(box(name + "_Rib", (0.26, 0.02, 0.28), (0, -0.152, 0.92),
                 M["skin"], 0.0, 1, coll=coll, outline=0))
    P.append(box(name + "_RibBar", (0.22, 0.02, 0.035), (0, -0.158, 0.96),
                 M["dark"], 0.0, 1, coll=coll, outline=0))
    # 腿：细长
    for s in (-1, 1):
        P.append(box(name + "_Leg%d" % s, (0.14, 0.17, 0.60), (s * 0.10, 0, 0.30),
                     M["dark"], 0.0, 1, coll=coll, outline=o))
    return P


def build_spitter(name="ENEMY_Spitter", coll="ENEMY"):
    """喷吐僵尸：窄高头 + 发光巨口、细长身体、长腿。"""
    M = dict(
        skin=cel_mat(PAL["blue"], rim=0.30),
        mid=cel_mat(PAL["blue_m"], rim=0.25),
        dark=cel_mat(PAL["blue_d"], rim=0.2),
        glow=emis_mat(PAL["violet"], 1.8),
    )
    o = OUTLINE["enemy"]
    P = []
    # 头：窄高
    P.append(box(name + "_Head", (0.48, 0.46, 0.60), (0, -0.02, 1.50),
                 M["skin"], 0.0, 1, coll=coll, outline=o))
    P.append(box(name + "_Maw", (0.30, 0.02, 0.17), (0, -0.252, 1.35),
                 M["glow"], 0.0, 1, coll=coll, outline=0))
    for s in (-1, 1):
        P.append(box(name + "_Eye%d" % s, (0.085, 0.02, 0.06), (s * 0.105, -0.252, 1.62),
                     M["glow"], 0.0, 1, coll=coll, outline=0))
    # 身体：窄
    P.append(box(name + "_Torso", (0.42, 0.30, 0.52), (0, 0, 0.92),
                 M["mid"], 0.0, 1, coll=coll, outline=o))
    P.append(box(name + "_Rib", (0.26, 0.02, 0.16), (0, -0.152, 0.96),
                 M["dark"], 0.0, 1, coll=coll, outline=0))
    # 腿：长
    for s in (-1, 1):
        P.append(box(name + "_Leg%d" % s, (0.15, 0.18, 0.62), (s * 0.115, 0, 0.31),
                     M["dark"], 0.0, 1, coll=coll, outline=o))
    return P


# ---------------------------------------------------------------- 武器
def _gun_base(name, accent_hex, coll="WPN"):
    """五把枪共用的机匣/枪托/握把/弹匣，保证是一个枪族。"""
    M = dict(
        gun=cel_mat(PAL["gun"], rim=0.25),
        gun_l=cel_mat(PAL["gun_l"], rim=0.25),
        steel=cel_mat(PAL["steel"], rim=0.2),
        dark=cel_mat("#22262B", rim=0.15),
        accent=cel_mat(accent_hex, rim=0.35),
        glow=emis_mat(accent_hex, 1.6),
    )
    return M


def build_weapon(idx, name=None, coll="WPN"):
    """0 声学 / 1 光学 / 2 热学 / 3 力学 / 4 电学。握把在原点，枪口朝 +X。"""
    accent = [PAL["amber"], "#8FE3F2", PAL["orange"], "#DDE3EA", "#B491F0"][idx]
    name = name or "WPN_%d" % idx
    M = _gun_base(name, accent, coll)
    o = OUTLINE["wpn"]
    P = []

    def add(*a, **k):
        k.setdefault("coll", coll)
        k.setdefault("outline", o)
        P.append(box(*a, **k))

    # 共用机匣
    add(name + "_Receiver", (0.34, 0.085, 0.125), (0.06, 0, 0.025), M["gun"], 0.022, 3)
    add(name + "_Rail", (0.30, 0.05, 0.028), (0.07, 0, 0.105), M["gun_l"], 0.008, 2)
    add(name + "_Stock", (0.20, 0.07, 0.105), (-0.19, 0, 0.02), M["gun"], 0.03, 3)
    add(name + "_StockPad", (0.035, 0.075, 0.115), (-0.295, 0, 0.02), M["dark"], 0.012, 2)
    add(name + "_Grip", (0.07, 0.075, 0.155), (-0.02, 0, -0.095), M["dark"], 0.022, 2,
        rot=(0, math.radians(-14), 0))
    add(name + "_Mag", (0.075, 0.065, 0.13), (0.115, 0, -0.085), M["gun_l"], 0.018, 2,
        rot=(0, math.radians(9), 0))
    add(name + "_Trigger", (0.045, 0.03, 0.05), (0.035, 0, -0.045), M["dark"], 0.008, 1)
    add(name + "_Accent", (0.10, 0.09, 0.022), (0.03, 0, 0.075), M["accent"], 0.006, 1)

    if idx == 0:
        # 声学：喇叭口 + 格栅
        add(name + "_Barrel", (0.16, 0.07, 0.075), (0.30, 0, 0.035), M["gun_l"], 0.018, 2)
        P.append(cyl(name + "_Bell", 0.052, 0.24, (0.46, 0, 0.035), M["gun_l"], 20,
                     rot=(0, math.radians(90), 0), coll=coll, outline=o, r2=0.105))
        P.append(cyl(name + "_BellRing", 0.115, 0.035, (0.575, 0, 0.035), M["accent"], 20,
                     rot=(0, math.radians(90), 0), coll=coll, outline=o))
        P.append(cyl(name + "_BellHole", 0.085, 0.02, (0.595, 0, 0.035), M["glow"], 20,
                     rot=(0, math.radians(90), 0), coll=coll, outline=0))
        for i in range(3):
            add(name + "_Grille%d" % i, (0.02, 0.095, 0.085), (0.17 + i * 0.05, 0, 0.03),
                M["dark"], 0.004, 1)
    elif idx == 1:
        # 光学：细长枪管 + 棱镜 + 瞄准镜
        P.append(cyl(name + "_Barrel", 0.024, 0.46, (0.45, 0, 0.04), M["steel"], 16,
                     rot=(0, math.radians(90), 0), coll=coll, outline=o))
        add(name + "_Prism", (0.10, 0.09, 0.09), (0.36, 0, 0.055), M["accent"], 0.01, 1,
            rot=(math.radians(45), 0, math.radians(45)))
        P.append(cyl(name + "_Muzzle", 0.045, 0.09, (0.695, 0, 0.04), M["dark"], 14,
                     rot=(0, math.radians(90), 0), coll=coll, outline=o))
        P.append(cyl(name + "_TipGlow", 0.028, 0.02, (0.735, 0, 0.04), M["glow"], 12,
                     rot=(0, math.radians(90), 0), coll=coll, outline=0))
        add(name + "_Scope", (0.16, 0.055, 0.055), (0.12, 0, 0.165), M["gun_l"], 0.016, 3)
        add(name + "_ScopeLens", (0.02, 0.045, 0.045), (0.205, 0, 0.165), M["glow"], 0.006, 1)
        add(name + "_ScopeMount", (0.03, 0.04, 0.04), (0.12, 0, 0.125), M["dark"], 0.006, 1)
    elif idx == 2:
        # 热学：燃料罐 + 喷口
        P.append(cyl(name + "_Tank", 0.075, 0.28, (0.02, 0, 0.175), M["gun_l"], 18,
                     rot=(0, math.radians(90), 0), coll=coll, outline=o))
        for i, tx in enumerate((-0.07, 0.11)):
            P.append(cyl(name + "_TankBand%d" % i, 0.082, 0.028, (tx, 0, 0.175), M["accent"], 18,
                         rot=(0, math.radians(90), 0), coll=coll, outline=0))
        P.append(cyl(name + "_TankCap", 0.082, 0.03, (0.165, 0, 0.175), M["dark"], 18,
                     rot=(0, math.radians(90), 0), coll=coll, outline=o))
        P.append(cyl(name + "_Barrel", 0.045, 0.26, (0.35, 0, 0.045), M["gun_l"], 16,
                     rot=(0, math.radians(90), 0), coll=coll, outline=o))
        P.append(cyl(name + "_Nozzle", 0.05, 0.13, (0.53, 0, 0.045), M["dark"], 16,
                     rot=(0, math.radians(90), 0), coll=coll, outline=o, r2=0.095))
        P.append(cyl(name + "_NozzleGlow", 0.075, 0.02, (0.60, 0, 0.045), M["glow"], 16,
                     rot=(0, math.radians(90), 0), coll=coll, outline=0))
        for i in range(3):
            add(name + "_Vent%d" % i, (0.03, 0.10, 0.02), (0.24 + i * 0.05, 0, 0.10),
                M["dark"], 0.004, 1)
    elif idx == 3:
        # 力学：双轨 + 制退器，最贴合“轨道步枪”
        for s in (-1, 1):
            add(name + "_Rail%d" % s, (0.44, 0.028, 0.03), (0.40, s * 0.035, 0.055),
                M["steel"], 0.006, 2)
        add(name + "_Shroud", (0.18, 0.10, 0.075), (0.24, 0, 0.045), M["gun_l"], 0.02, 3)
        add(name + "_Brake", (0.11, 0.105, 0.085), (0.62, 0, 0.045), M["gun"], 0.018, 2)
        for i in range(2):
            add(name + "_BrakeSlot%d" % i, (0.018, 0.115, 0.06), (0.595 + i * 0.045, 0, 0.045),
                M["dark"], 0.004, 1)
        P.append(cyl(name + "_Muzzle", 0.032, 0.05, (0.70, 0, 0.045), M["accent"], 12,
                     rot=(0, math.radians(90), 0), coll=coll, outline=o))
        add(name + "_Scope", (0.14, 0.05, 0.05), (0.15, 0, 0.17), M["gun_l"], 0.015, 3)
    else:
        # 电学：线圈 + 双叉
        P.append(cyl(name + "_Barrel", 0.03, 0.40, (0.41, 0, 0.045), M["gun_l"], 16,
                     rot=(0, math.radians(90), 0), coll=coll, outline=o))
        for i in range(3):
            P.append(cyl(name + "_Coil%d" % i, 0.072, 0.045, (0.30 + i * 0.10, 0, 0.045),
                         M["accent"], 18, rot=(0, math.radians(90), 0), coll=coll, outline=o))
        for s in (-1, 1):
            add(name + "_Prong%d" % s, (0.15, 0.028, 0.028), (0.66, s * 0.055, 0.045),
                M["steel"], 0.006, 2, rot=(0, 0, math.radians(-6 * s)))
        P.append(cyl(name + "_ArcCore", 0.035, 0.03, (0.61, 0, 0.045), M["glow"], 12,
                     rot=(0, math.radians(90), 0), coll=coll, outline=0))
    return P


# ---------------------------------------------------------------- 道具
def build_props():
    m_wood = cel_mat(PAL["wood"], rim=0.18)
    m_wood_d = cel_mat(PAL["wood_d"], rim=0.15)
    m_steel = cel_mat(PAL["steel"], rim=0.2)
    m_dark = cel_mat(PAL["gun"], rim=0.15)
    m_teal = cel_mat(PAL["teal"], rim=0.2)
    o = OUTLINE["prop"]
    P = []

    # 补给箱（左后）
    bx, by = -4.30, 2.55
    P.append(box("PROP_Crate", (0.92, 0.92, 0.86), (bx, by, 0.43), m_wood, 0.06, 3, coll="PROP", outline=o))
    P.append(box("PROP_CrateLid", (0.96, 0.96, 0.10), (bx, by, 0.90), m_wood_d, 0.03, 2, coll="PROP", outline=o))
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box("PROP_CrateBrace_%d_%d" % (sx, sy), (0.10, 0.10, 0.74),
                         (bx + sx * 0.44, by + sy * 0.44, 0.42), m_dark, 0.02, 2,
                         coll="PROP", outline=o))
    P.append(box("PROP_CrateTag", (0.30, 0.03, 0.20), (bx, by - 0.47, 0.52),
                 emis_mat(PAL["amber"], 1.0), 0.01, 1, coll="PROP", outline=0))
    # 叠一个小箱
    P.append(box("PROP_CrateSmall", (0.62, 0.62, 0.56), (bx + 0.10, by - 0.08, 1.23), m_wood, 0.05, 3,
                 rot=(0, 0, math.radians(12)), coll="PROP", outline=o))
    P.append(box("PROP_CrateSmallLid", (0.66, 0.66, 0.08), (bx + 0.10, by - 0.08, 1.54), m_wood_d, 0.025, 2,
                 rot=(0, 0, math.radians(12)), coll="PROP", outline=o))

    # 油桶（左）
    P.append(cyl("PROP_Barrel", 0.27, 0.92, (-4.55, 1.10, 0.46), m_teal, 22, coll="PROP", outline=o))
    for z in (0.18, 0.46, 0.74):
        P.append(cyl("PROP_BarrelRing%.2f" % z, 0.285, 0.045, (-4.55, 1.10, z), m_dark, 22,
                     coll="PROP", outline=o))
    P.append(cyl("PROP_BarrelCap", 0.245, 0.03, (-4.55, 1.10, 0.925), m_steel, 22, coll="PROP", outline=o))

    # 战利品箱摆在补给箱上（左侧的"点"）
    P.append(box("PROP_LootCase", (0.52, 0.40, 0.22), (bx + 0.02, by - 0.16, 1.66), m_teal, 0.035, 3,
                 rot=(0, 0, math.radians(7)), coll="PROP", outline=o))
    P.append(box("PROP_LootGlow", (0.46, 0.03, 0.045), (bx + 0.02, by - 0.365, 1.70),
                 emis_mat(PAL["amber"], 2.0), 0.008, 1, rot=(0, 0, math.radians(7)),
                 coll="PROP", outline=0))

    # 墙面：枪械陈列板（竖挂，四把枪的侧影完整露出来）
    bx0 = -1.70
    P.append(box("PROP_Board", (3.60, 0.06, 1.34), (bx0, 3.845, 1.34), m_dark, 0.03, 2,
                 coll="PROP", outline=o))
    P.append(box("PROP_BoardFrameT", (3.66, 0.09, 0.07), (bx0, 3.85, 2.04), m_steel, 0.02, 2,
                 coll="PROP", outline=o))
    P.append(box("PROP_BoardFrameB", (3.66, 0.09, 0.07), (bx0, 3.85, 0.64), m_steel, 0.02, 2,
                 coll="PROP", outline=o))
    for i, (x, z) in enumerate(((-3.15, 1.60), (-1.55, 1.60), (-3.15, 1.04), (-1.55, 1.04))):
        P.append(box("PROP_ClampT%d" % i, (0.10, 0.12, 0.09), (x, 3.80, z + 0.26), m_steel, 0.015, 2,
                     coll="PROP", outline=o))
        P.append(box("PROP_ClampB%d" % i, (0.10, 0.12, 0.09), (x, 3.80, z - 0.26), m_steel, 0.015, 2,
                     coll="PROP", outline=o))
    # 板上小铭牌
    for i, (x, z) in enumerate(((-3.15, 1.60), (-1.55, 1.60), (-3.15, 1.04), (-1.55, 1.04))):
        P.append(box("PROP_Tag%d" % i, (0.16, 0.02, 0.05), (x - 0.18, 3.80, z - 0.34),
                     emis_mat(PAL["amber"], 0.55), 0.006, 1, coll="PROP", outline=0))

    # 墙面灯具（移到门左侧的空墙）
    P.append(box("PROP_WallLamp", (0.90, 0.06, 0.055), (0.35, 3.845, 1.62),
                 emis_mat("#F6E7C8", 1.3), 0.012, 1, coll="PROP", outline=0))
    P.append(box("PROP_WallLampFrame", (1.00, 0.10, 0.13), (0.35, 3.85, 1.62), m_steel, 0.02, 2,
                 coll="PROP", outline=o))

    # 墙面管道（贴地走的线缆套管，不挡视线）
    P.append(cyl("PROP_Pipe", 0.045, 4.4, (-2.55, 3.855, 0.24), m_steel, 12,
                 rot=(0, math.radians(90), 0), coll="PROP", outline=o))
    for i, x in enumerate((-4.4, -3.2, -2.0, -0.8)):
        P.append(cyl("PROP_PipeClamp%d" % i, 0.062, 0.05, (x, 3.855, 0.24), m_dark, 12,
                     rot=(0, math.radians(90), 0), coll="PROP", outline=0))

    # 前景木托盘 + 弹药箱（填补左前空地，形成前中后景）
    m_olive = cel_mat("#5E6B4A", rim=0.15)
    px, py = -2.20, -0.40
    for i in range(3):
        P.append(box("PROP_PalletPlank%d" % i, (0.95, 0.20, 0.05), (px, py - 0.30 + i * 0.30, 0.10),
                     m_wood, 0.01, 1, coll="PROP", outline=o))
    for s in (-1, 1):
        P.append(box("PROP_PalletRunner%d" % s, (0.98, 0.09, 0.09), (px, py + s * 0.34, 0.045),
                     m_wood_d, 0.01, 1, coll="PROP", outline=o))
    P.append(box("PROP_Ammo1", (0.38, 0.26, 0.20), (px - 0.16, py - 0.04, 0.225), m_olive, 0.02, 2,
                 rot=(0, 0, math.radians(6)), coll="PROP", outline=o))
    P.append(box("PROP_Ammo2", (0.38, 0.26, 0.20), (px + 0.20, py + 0.08, 0.225), m_olive, 0.02, 2,
                 rot=(0, 0, math.radians(-8)), coll="PROP", outline=o))
    P.append(box("PROP_AmmoStripe1", (0.30, 0.02, 0.05), (px - 0.16, py - 0.18, 0.24),
                 emis_mat(PAL["amber"], 0.7), 0.006, 1, rot=(0, 0, math.radians(6)),
                 coll="PROP", outline=0))
    P.append(box("PROP_AmmoStripe2", (0.30, 0.02, 0.05), (px + 0.20, py - 0.06, 0.24),
                 emis_mat(PAL["amber"], 0.7), 0.006, 1, rot=(0, 0, math.radians(-8)),
                 coll="PROP", outline=0))
    return P


# ---------------------------------------------------------------- 摆位
def build_characters():
    p = build_human_scout()
    place(p, (0.85, 0.10, 0.0), math.radians(20))

    z = build_zombie()
    place(z, (2.52, 0.95, 0.0), face_rot((2.52, 0.95), (0.85, 0.10)) + math.radians(26))

    s = build_spitter()
    place(s, (3.50, 2.40, 0.0), face_rot((3.50, 2.40), (0.85, 0.10)) + math.radians(38))

    # 玩家手里的枪（枪口朝右前方，和游戏里“枪跟着准星转”一致）
    w = build_weapon(0, "WPN_Sonic")
    place(w, (1.11, 0.19, 0.86), math.radians(-13), 1.26)
    return p, z, s


def build_weapons():
    """后墙陈列板：其余四把两排横挂，枪口统一朝右。"""
    objs = []
    for i, (x, z) in enumerate(((-3.15, 1.60), (-1.55, 1.60), (-3.15, 1.04), (-1.55, 1.04))):
        w = build_weapon(i + 1, "WPN_%d" % (i + 1))
        e = place(w, (x, 3.79, z), 0.0, 1.18)
        objs.append(e)
    return objs


# ---------------------------------------------------------------- 展示页
def build_sheets():
    """资产对照页：角色一排 + 枪械一排，同一套光与材质，用来验证‘同一层’。"""
    m_floor = cel_mat(PAL["floor"], hi_at=0.99)
    m_grout = cel_mat(PAL["grout"], shadow_k=0.7, hi_at=0.99)
    m_bg = grad_mat("Backdrop2", "#D9DFE4", "#F2EADC")

    def platform(y0):
        box("Sheet_Base_%d" % y0, (9.0, 4.2, 0.56), (0, y0, -0.28), m_grout, 0.02, 2, coll="ARCH")
        box("Sheet_Floor_%d" % y0, (9.0, 4.2, 0.03), (0, y0, 0.015), m_floor, 0.0, 1, coll="ARCH")
        plane("Sheet_Bg_%d" % y0, (26, 16), (0, y0 + 2.6, 5.0), m_bg)

    platform(20.0)
    builds = (build_human_scout, build_human_assault, build_zombie, build_zombie_gaunt)
    for i, x in enumerate((-2.55, -0.85, 0.85, 2.55)):
        place(builds[i](), (x, 20.0, 0.03), 0.0, 1.0)

    platform(26.5)
    for i in range(5):
        w = build_weapon(i, "WPN_Sheet%d" % i)
        place(w, (-2.70 + i * 1.35, 26.5, 0.85), 0.0, 1.22)

    sc = SC
    for nm, loc, tgt, osc in (
        ("Cam_Sheet", (0.0, 13.2, 0.92), (0.0, 20.0, 0.92), 6.0),
        ("Cam_Guns", (0.0, 23.4, 0.86), (0.0, 26.5, 0.86), 7.9),
    ):
        cd = bpy.data.cameras.new(nm)
        cd.type = "ORTHO"
        cd.ortho_scale = osc
        ob = bpy.data.objects.new(nm, cd)
        ob.location = loc
        ob.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        COLLS["CAM"].objects.link(ob)


# ---------------------------------------------------------------- 灯光 / 相机
def setup_light():
    def sun(name, travel, energy, col=(1, 1, 1), ang=0.03):
        L = bpy.data.lights.new(name, "SUN")
        L.energy = energy
        L.color = col
        L.angle = ang
        o = bpy.data.objects.new(name, L)
        o.location = (0, 0, 7)
        o.rotation_euler = Vector(travel).to_track_quat("-Z", "Y").to_euler()
        COLLS["LIGHT"].objects.link(o)
        return o

    # 主光：左前上方（正面 base / 顶面 highlight / 右侧 shadow）
    sun("AB_Key", (0.52, 0.49, -0.70), 3.6, (1.0, 0.98, 0.94))
    # 补光：右前，冷色，压不死暗部细节
    sun("AB_Fill", (-0.80, 0.30, -0.52), 0.55, (0.72, 0.84, 1.0))
    # 轮廓光：后上方
    sun("AB_Rim", (-0.35, -0.86, -0.37), 0.8, (1.0, 0.92, 0.84))


def setup_cameras():
    def cam(name, loc, target, lens=None, ortho=None):
        cd = bpy.data.cameras.new(name)
        if ortho:
            cd.type = "ORTHO"
            cd.ortho_scale = ortho
        else:
            cd.lens = lens
        ob = bpy.data.objects.new(name, cd)
        ob.location = loc
        ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        COLLS["CAM"].objects.link(ob)
        return ob

    hero = cam("Cam_Hero", (2.10, -9.8, 7.7), (0.35, 1.85, 1.20), lens=50)
    close = cam("Cam_Close", (1.95, -4.3, 2.75), (1.45, 0.55, 1.10), lens=62)
    game = cam("Cam_Game", (0.4, -6.6, 15.4), (0.4, 0.9, 0.0), ortho=11.2)
    line = cam("Cam_Lineup", (0.2, -9.0, 2.6), (0.2, 0.0, 0.95), ortho=5.4)
    return hero, game, line, close


def setup_render():
    sc = SC
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = 1920
    sc.render.resolution_y = 1080
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    try:
        sc.eevee.taa_render_samples = 64
    except Exception:
        pass
    setup_light()
    return setup_cameras()


def render_to(cam, path, rx=None, ry=None):
    sc = SC
    sc.camera = cam
    if rx:
        sc.render.resolution_x = rx
        sc.render.resolution_y = ry
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def build_all():
    fresh_scene()
    build_stage()
    build_characters()
    build_weapons()
    build_props()
    setup_render()
    build_sheets()
    print("built objects:", len(SC.objects))
    return SC


def render_all():
    hero = bpy.data.objects["Cam_Hero"]
    close = bpy.data.objects["Cam_Close"]
    sheet = bpy.data.objects["Cam_Sheet"]
    guns = bpy.data.objects["Cam_Guns"]
    render_to(hero, os.path.join(OUT_DIR, "01_scene_hero.png"), 1920, 1080)
    render_to(close, os.path.join(OUT_DIR, "02_scene_closeup.png"), 1600, 900)
    render_to(sheet, os.path.join(OUT_DIR, "03_characters.png"), 1500, 750)
    render_to(guns, os.path.join(OUT_DIR, "04_weapons.png"), 1800, 560)
    return OUT_DIR


def save_source():
    os.makedirs(os.path.dirname(BLEND_OUT), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT, copy=True)
    return BLEND_OUT

