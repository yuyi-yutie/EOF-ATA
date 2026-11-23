"""
EOFATA — 三渲二三渲二武器（五把）。

和角色同一套：方块/圆柱拼装，Diffuse → Shader to RGB → 常量 ColorRamp → Emission，
正交相机从侧面拍（枪口朝 +X），描边在贴图阶段 alpha 膨胀。
每把枪的「握把」建在世界原点，渲染时把原点的像素坐标写进 pivot.json，
排帧表时用它算旋转锚点 gx/gy。

用法：
  exec(compile(open(r"...\\dev_html\\_blender\\render_weapons_toon.py").read(), "render_weapons_toon.py", "exec"))
  render_all()        # 五把全渲
  save_source()       # 存 .blend
"""
import json
import math
import os

import bpy

OUT_ROOT = r"C:\Users\yy197\Documents\GitHub\EOF-ATA\dev_html\art_draft\weapons3d"
BLEND_OUT = r"C:\Users\yy197\Documents\GitHub\EOF-ATA\dev_html\blender_draft\weapons_toon.blend"
SCENE_NAME = "EOFATA_Weapons3D"

RES = 512
ORTHO = 2.8
CAM_X = 0.25


def srgb(c):
    def f(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(f(v) for v in c)


METAL = srgb((104, 108, 116))
METAL_SH = tuple(c * 0.6 for c in METAL)
DARK = srgb((62, 65, 72))
DARK_SH = tuple(c * 0.6 for c in DARK)
LIGHT = srgb((176, 180, 188))
LIGHT_SH = tuple(c * 0.62 for c in LIGHT)
ACCENT = {
    "w0": srgb((90, 220, 200)),   # 声学：青绿
    "w1": srgb((140, 230, 255)),  # 光学：冰蓝
    "w2": srgb((255, 110, 60)),   # 热学：橙红
    "w3": srgb((225, 228, 232)),  # 力学：钢白
    "w4": srgb((178, 140, 255)),  # 电学：紫
}
INK = (0.008, 0.008, 0.008)


def fresh_scene():
    old = bpy.data.scenes.get(SCENE_NAME)
    if old:
        for ob in list(old.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.scenes.remove(old)
    sc = bpy.data.scenes.new(SCENE_NAME)
    bpy.context.window.scene = sc

    world = bpy.data.worlds.new("W_W")
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new('ShaderNodeBackground')
    wout = nt.nodes.new('ShaderNodeOutputWorld')
    bg.inputs[1].default_value = 0.0
    nt.links.new(bg.outputs[0], wout.inputs['Surface'])
    sc.world = world

    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.film_transparent = True
    sc.render.resolution_x = RES
    sc.render.resolution_y = RES
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    try:
        sc.eevee.taa_render_samples = 16
    except Exception:
        pass

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = ORTHO
    cam = bpy.data.objects.new("Cam", cam_data)
    sc.collection.objects.link(cam)
    cam.location = (CAM_X, -6.0, 0.0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam

    key = bpy.data.lights.new("Key", 'SUN')
    key.energy = 2.4
    key.angle = math.radians(8)
    ko = bpy.data.objects.new("Key", key)
    sc.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(52), 0, math.radians(-40))
    fill = bpy.data.lights.new("Fill", 'SUN')
    fill.energy = 0.2
    fo = bpy.data.objects.new("Fill", fill)
    sc.collection.objects.link(fo)
    fo.rotation_euler = (math.radians(70), 0, math.radians(140))
    return sc


def cel_mat(name, base, shadow):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    diff = nt.nodes.new('ShaderNodeBsdfDiffuse')
    diff.inputs['Color'].default_value = (1, 1, 1, 1)
    s2r = nt.nodes.new('ShaderNodeShaderToRGB')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    e0 = ramp.color_ramp.elements[0]
    e0.position = 0.0
    e0.color = (*shadow, 1)
    e1 = ramp.color_ramp.elements[1]
    e1.position = 0.25
    e1.color = (*base, 1)
    e2 = ramp.color_ramp.elements.new(0.90)
    e2.color = (*[min(1.0, c * 1.06) for c in base], 1)
    emi = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(diff.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs[0], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], emi.inputs['Color'])
    nt.links.new(emi.outputs[0], out.inputs['Surface'])
    return mat


def box(name, size, loc, mat, bevel=0.02):
    sx, sy, sz = (s * 0.5 for s in size)
    mesh = bpy.data.meshes.new(name)
    verts = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
             (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2),
             (2, 6, 7, 3), (3, 7, 4, 0)]
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.data.materials.append(mat)
    if bevel > 0:
        m = ob.modifiers.new("bevel", 'BEVEL')
        m.width = bevel
        m.segments = 2
        m.limit_method = 'ANGLE'
    return ob


def cyl(name, r, depth, loc, mat, axis='X', verts=20, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    if axis == 'X':
        ob.rotation_euler = (0, math.radians(90), 0)
    elif axis == 'Y':
        ob.rotation_euler = (math.radians(90), 0, 0)
    ob.data.materials.append(mat)
    return ob


# ----------------------------------------------------------------- 五把枪
def build_weapon(kind, keep=False, x_offset=0.0):
    sc = bpy.context.scene if keep else fresh_scene()
    before = set(bpy.data.objects)
    m_metal = cel_mat("M_Metal", METAL, METAL_SH)
    m_dark = cel_mat("M_Dark", DARK, DARK_SH)
    m_light = cel_mat("M_Light", LIGHT, LIGHT_SH)
    m_acc = cel_mat("M_Accent", ACCENT[kind], tuple(c * 0.62 for c in ACCENT[kind]))
    m_ink = cel_mat("M_Ink", INK, INK)

    # 共用：握把 + 枪托（握把顶 = 世界原点）
    box("Grip", (0.13, 0.17, 0.30), (0, 0, -0.16), m_dark, 0.03)
    box("Stock", (0.30, 0.14, 0.16), (-0.42, 0, 0.04), m_metal, 0.03)

    if kind == "w1":            # 光学：细长步枪 + 瞄准镜
        box("Body", (0.86, 0.20, 0.18), (0.10, 0, 0.10), m_metal, 0.03)
        box("Scope", (0.34, 0.16, 0.11), (0.02, 0, 0.26), m_dark, 0.03)
        box("Cell", (0.20, 0.10, 0.07), (0.30, 0, 0.20), m_acc, 0.02)
        cyl("Barrel", 0.045, 0.95, (0.95, 0, 0.10), m_light)
        cyl("Muzzle", 0.065, 0.10, (1.40, 0, 0.10), m_dark)
        box("Rail", (0.60, 0.10, 0.05), (0.30, 0, -0.01), m_dark, 0.02)
        box("Stripe", (0.30, 0.06, 0.04), (-0.10, -0.10, 0.10), m_acc, 0.015)

    elif kind == "w0":          # 声学：喇叭口 + 喇叭盘
        box("Body", (0.82, 0.24, 0.24), (0.06, 0, 0.12), m_metal, 0.03)
        cyl("Horn", 0.05, 0.52, (0.80, 0, 0.12), m_acc, r2=0.30, verts=24)
        cyl("HornRing", 0.32, 0.06, (1.06, 0, 0.12), m_dark, verts=24)
        cyl("Speaker", 0.10, 0.28, (0.02, 0, 0.14), m_acc, axis='Y', verts=20)
        box("Cap", (0.16, 0.18, 0.10), (-0.22, 0, 0.22), m_dark, 0.02)
        box("Stripe", (0.26, 0.06, 0.05), (-0.02, -0.12, 0.10), m_acc, 0.015)

    elif kind == "w2":          # 热学：粗机匣 + 长枪管 + 散热片
        box("Body", (0.74, 0.26, 0.24), (0.02, 0, 0.12), m_acc, 0.03)
        box("Sink", (0.30, 0.28, 0.10), (0.30, 0, 0.24), m_dark, 0.02)
        cyl("Barrel", 0.05, 0.80, (0.80, 0, 0.12), m_metal)
        for i in range(3):
            cyl("Ring%d" % i, 0.075, 0.04, (0.60 + i * 0.14, 0, 0.12), m_dark, verts=16)
        box("Tank", (0.16, 0.14, 0.20), (-0.10, 0, 0.30), m_metal, 0.03)
        box("Stripe", (0.24, 0.06, 0.05), (-0.12, -0.13, 0.12), m_acc, 0.015)

    elif kind == "w3":          # 力学：轨道步枪 + 弹匣
        box("Body", (0.95, 0.20, 0.18), (0.12, 0, 0.10), m_metal, 0.03)
        box("RailTop", (0.80, 0.10, 0.05), (0.25, 0, 0.21), m_light, 0.02)
        box("RailBot", (0.55, 0.10, 0.05), (0.12, 0, -0.02), m_dark, 0.02)
        cyl("Barrel", 0.04, 0.72, (1.05, 0, 0.10), m_light)
        box("Mag", (0.12, 0.14, 0.26), (0.05, 0, -0.16), m_dark, 0.02)
        box("Accent", (0.20, 0.08, 0.05), (0.42, 0, 0.10), m_acc, 0.02)
        box("Stripe", (0.34, 0.06, 0.05), (-0.06, -0.11, 0.10), m_acc, 0.015)

    else:                       # w4 电学：线圈 + 双叉
        box("Body", (0.78, 0.24, 0.22), (0.04, 0, 0.11), m_metal, 0.03)
        for i in range(4):
            cyl("Coil%d" % i, 0.13, 0.05, (0.52 + i * 0.11, 0, 0.11), m_acc, verts=20)
        cyl("Core", 0.05, 0.60, (0.66, 0, 0.11), m_dark)
        box("ProngL", (0.26, 0.05, 0.05), (1.02, -0.06, 0.16), m_light, 0.01)
        box("ProngR", (0.26, 0.05, 0.05), (1.02, 0.06, 0.06), m_light, 0.01)
        box("Tank", (0.18, 0.18, 0.14), (-0.16, 0, 0.26), m_acc, 0.03)
        box("Stripe", (0.26, 0.06, 0.05), (-0.10, -0.12, 0.11), m_acc, 0.015)

    if x_offset:
        for ob in set(bpy.data.objects) - before:
            ob.location.x += x_offset
    return sc


def pivot_px():
    """世界原点（握把）在渲染图里的像素坐标"""
    p = RES / ORTHO
    return [RES / 2 - CAM_X * p, RES / 2]


def render_all():
    out = {}
    for kind in ("w0", "w1", "w2", "w3", "w4"):
        sc = build_weapon(kind)
        d = os.path.join(OUT_ROOT, kind)
        os.makedirs(d, exist_ok=True)
        sc.render.filepath = os.path.join(d, "001.png")
        bpy.ops.render.render(write_still=True)
        with open(os.path.join(d, "pivot.json"), "w") as f:
            json.dump({"res": RES, "pivot": pivot_px()}, f)
        out[kind] = os.path.join(d, "001.png")
    return out


def build_all_and_save():
    """五把并排摆一个场景，存 .blend"""
    for i, kind in enumerate(("w0", "w1", "w2", "w3", "w4")):
        build_weapon(kind, keep=(i > 0), x_offset=i * 3.0 - 6.0)
    os.makedirs(os.path.dirname(BLEND_OUT), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    return BLEND_OUT
