"""
EOFATA — 三渲二玩家角色（潜行者 / 突击手）。

和 render_zombie.py 同一套做法：
  · 方块模型 + 刚性绑骨架
  · Diffuse → Shader to RGB → ColorRamp(CONSTANT) → Emission → 硬边两段明暗
  · 正交相机、18° 侧视角、透明背景
  · 描边不在这里做，导出后在 _tools/build_sprite_assets.py 里用 alpha 膨胀画

用法（在 Blender 里执行）：
  exec(compile(open(r"...\\dev_html\\_blender\\render_player_toon.py").read(), "render_player_toon.py", "exec"))
  build("c1"); render_all("c1")
  build("c2"); render_all("c2")
  save_source()      # 存 .blend 源文件
"""
import math
import os

import bpy

OUT_ROOT = r"C:\Users\yy197\Documents\GitHub\EOF-ATA\dev_html\art_draft\player3d"
BLEND_OUT = r"C:\Users\yy197\Documents\GitHub\EOF-ATA\dev_html\blender_draft\player_toon.blend"
SCENE_NAME = "EOFATA_Player3D"


def srgb(c):
    def f(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(f(v) for v in c)


CREAM = srgb((246, 235, 207))
CREAM_SH = tuple(c * 0.68 for c in CREAM)
BODY1 = srgb((77, 79, 66))
BODY1_SH = tuple(c * 0.6 for c in BODY1)
INK = (0.008, 0.008, 0.008)

DARK = srgb((61, 60, 63))
DARK_SH = tuple(c * 0.55 for c in DARK)
GOGGLE = srgb((120, 124, 132))
GOGGLE_SH = tuple(c * 0.55 for c in GOGGLE)
LENS = srgb((40, 42, 46))


# ----------------------------------------------------------------- 场景
def fresh_scene():
    old = bpy.data.scenes.get(SCENE_NAME)
    if old:
        for ob in list(old.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.scenes.remove(old)
    sc = bpy.data.scenes.new(SCENE_NAME)
    bpy.context.window.scene = sc

    world = bpy.data.worlds.new("EOFATA_PlayerWorld")
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new('ShaderNodeBackground')
    wout = nt.nodes.new('ShaderNodeOutputWorld')
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 0.0
    nt.links.new(bg.outputs[0], wout.inputs['Surface'])
    sc.world = world

    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.film_transparent = True
    sc.render.resolution_x = 512
    sc.render.resolution_y = 560
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.fps = 24
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    try:
        sc.eevee.taa_render_samples = 16
    except Exception:
        pass
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
    emi.inputs['Strength'].default_value = 1.0
    nt.links.new(diff.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs[0], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], emi.inputs['Color'])
    nt.links.new(emi.outputs[0], out.inputs['Surface'])
    return mat


def box(name, size, loc, mat, bevel=0.05, segments=3):
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
        m.segments = segments
        m.limit_method = 'ANGLE'
    return ob


def cyl(name, radius, depth, loc, mat, rot=(math.radians(90), 0, 0), verts=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc,
                                        rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    return ob


# ----------------------------------------------------------------- 两个角色
def build(kind="c1", keep_scene=False, x_offset=0.0):
    sc = bpy.context.scene if keep_scene else fresh_scene()
    m_cream = cel_mat("M_Cream", CREAM, CREAM_SH)
    m_b1 = cel_mat("M_Body1", BODY1, BODY1_SH)
    m_dark = cel_mat("M_Dark", DARK, DARK_SH)
    m_gog = cel_mat("M_Goggle", GOGGLE, GOGGLE_SH)
    m_lens = cel_mat("M_Lens", LENS, tuple(c * 0.8 for c in LENS))
    m_ink = cel_mat("M_Ink", INK, INK)

    parts = []

    if kind == "c1":
        # 潜行者：大圆角米色脑袋 + 一颗眼 + 深橄榄身体
        parts.append(("head", box("Face", (0.66, 0.52, 0.66), (0, 0, 1.44), m_cream, 0.13, 4)))
        parts.append(("head", box("Eye", (0.10, 0.05, 0.10), (0.06, -0.26, 1.46), m_ink, 0.012, 2)))
        parts.append(("spine", box("Body", (0.52, 0.38, 0.74), (0, 0, 0.75), m_b1, 0.09, 3)))
        for s, tag in ((1, "L"), (-1, "R")):
            parts.append(("arm." + tag, box("Arm" + tag, (0.13, 0.16, 0.46), (s * 0.31, 0, 0.86), m_b1, 0.05, 3)))
        for s, tag in ((1, "L"), (-1, "R")):
            parts.append(("leg." + tag, box("Leg" + tag, (0.19, 0.20, 0.40), (s * 0.13, 0, 0.20), m_b1, 0.05, 3)))
    else:
        # 突击手：头盔 + 护目镜 + 米色脸 + 战术背心 + 背包
        parts.append(("head", box("Head", (0.62, 0.50, 0.52), (0, 0, 1.34), m_dark, 0.10, 4)))
        parts.append(("head", box("Face", (0.44, 0.10, 0.30), (0, -0.235, 1.30), m_cream, 0.06, 3)))
        parts.append(("head", box("Eye", (0.075, 0.05, 0.075), (0.05, -0.285, 1.32), m_ink, 0.01, 2)))
        parts.append(("head", box("Helmet", (0.68, 0.54, 0.26), (0, 0.01, 1.56), m_dark, 0.12, 4)))
        parts.append(("head", box("Goggle", (0.60, 0.14, 0.14), (0, -0.24, 1.50), m_gog, 0.05, 3)))
        for s, tag in ((1, "L"), (-1, "R")):
            parts.append(("head", box("Lens" + tag, (0.16, 0.05, 0.09), (s * 0.15, -0.30, 1.50), m_lens, 0.02, 2)))
        parts.append(("spine", box("Vest", (0.54, 0.40, 0.64), (0, 0, 0.84), m_dark, 0.08, 3)))
        parts.append(("spine", box("Belt", (0.58, 0.42, 0.10), (0, 0, 0.56), m_b1, 0.03, 2)))
        parts.append(("spine", box("Pack", (0.20, 0.22, 0.42), (-0.36, 0.10, 0.86), m_b1, 0.05, 3)))
        disc = cyl("Chest", 0.11, 0.06, (0.02, -0.215, 0.88), m_b1)
        parts.append(("chest", disc))
        for s, tag in ((1, "L"), (-1, "R")):
            parts.append(("arm." + tag, box("Arm" + tag, (0.15, 0.18, 0.48), (s * 0.375, 0, 0.86), m_dark, 0.05, 3)))
        for s, tag in ((1, "L"), (-1, "R")):
            parts.append(("leg." + tag, box("Leg" + tag, (0.21, 0.22, 0.50), (s * 0.14, 0, 0.25), m_b1, 0.05, 3)))

    rig = build_rig(parts)
    if not keep_scene:
        build_camera_light()
    setup_yaw(rig, 15.0)
    if x_offset:
        rig.location.x = x_offset
    return rig


def build_rig(parts):
    arm_data = bpy.data.armatures.new("PlayerRig")
    rig = bpy.data.objects.new("PlayerRig", arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')

    def bone(name, head, tail, parent=None):
        b = arm_data.edit_bones.new(name)
        b.head = head
        b.tail = tail
        if parent:
            b.parent = arm_data.edit_bones[parent]

    bone("root", (0, 0, 0), (0, 0, 0.12))
    bone("spine", (0, 0, 0.30), (0, 0, 1.02), "root")
    bone("chest", (0, 0, 1.02), (0, 0, 1.08), "spine")
    bone("head", (0, 0, 1.05), (0, 0, 1.78), "chest")
    for s, tag in ((1, "L"), (-1, "R")):
        bone("arm." + tag, (s * 0.33, 0, 1.02), (s * 0.33, 0, 0.56), "chest")
        bone("leg." + tag, (s * 0.13, 0, 0.40), (s * 0.13, 0, 0.00), "spine")

    bpy.ops.object.mode_set(mode='OBJECT')

    for bone_name, ob in parts:
        ob.parent = rig
        ob.matrix_parent_inverse = rig.matrix_world.inverted()
        vg = ob.vertex_groups.new(name=bone_name)
        vg.add(range(len(ob.data.vertices)), 1.0, 'REPLACE')
        mod = ob.modifiers.new("armature", 'ARMATURE')
        mod.object = rig
    return rig


def build_camera_light():
    sc = bpy.context.scene
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 2.0
    cam = bpy.data.objects.new("Cam", cam_data)
    sc.collection.objects.link(cam)
    cam.location = (0, -6.0, 0.90)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam

    key = bpy.data.lights.new("Key", 'SUN')
    key.energy = 2.2
    key.angle = math.radians(6)
    ko = bpy.data.objects.new("Key", key)
    sc.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(55), 0, math.radians(-52))

    fill = bpy.data.lights.new("Fill", 'SUN')
    fill.energy = 0.15
    fo = bpy.data.objects.new("Fill", fill)
    sc.collection.objects.link(fo)
    fo.rotation_euler = (math.radians(72), 0, math.radians(120))
    return cam


def setup_yaw(rig, yaw_deg):
    rig.rotation_euler = (0, 0, math.radians(yaw_deg))


# ----------------------------------------------------------------- 动画
def pose(rig, name, x=0.0, y=0.0, z=0.0):
    pb = rig.pose.bones[name]
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = (x, y, z)


def bake(name, length, fn, rig):
    rig.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data.action = act
    for f in range(1, length + 1):
        for pb in rig.pose.bones:
            pb.rotation_mode = 'XYZ'
            pb.rotation_euler = (0, 0, 0)
            pb.location = (0, 0, 0)
        fn(rig, f, length)
        for pb in rig.pose.bones:
            pb.keyframe_insert("rotation_euler", frame=f)
            pb.keyframe_insert("location", frame=f)
    return act


def walk_pose(rig, f, n):
    p = 2 * math.pi * (f - 1) / n
    s, c = math.sin(p), math.cos(p)
    pose(rig, "leg.L", x=0.18 * c, z=0.30 * s)
    pose(rig, "leg.R", x=-0.18 * c, z=-0.30 * s)
    pose(rig, "arm.L", x=-0.36 * s, z=0.06)
    pose(rig, "arm.R", x=0.36 * s, z=-0.06)
    pose(rig, "spine", x=0.05, z=0.04 * s)
    pose(rig, "head", z=-0.04 * s)
    rig.pose.bones["root"].location = (0, 0, -0.03 * abs(math.sin(p)))


def idle_pose(rig, f, n):
    pose(rig, "spine", x=0.03)
    pose(rig, "head", x=0.02)
    pose(rig, "arm.L", z=0.05)
    pose(rig, "arm.R", z=-0.05)


def render_all(kind, walk_frames=12):
    sc = bpy.context.scene
    rig = bpy.data.objects["PlayerRig"]
    walk = bake("walk_" + kind, walk_frames + 1, walk_pose, rig)
    idle = bake("idle_" + kind, 1, idle_pose, rig)

    base = os.path.join(OUT_ROOT, kind)
    d = os.path.join(base, "walk")
    os.makedirs(d, exist_ok=True)
    rig.animation_data.action = walk
    for f in range(1, walk_frames + 1):
        sc.frame_set(f)
        sc.render.filepath = os.path.join(d, "%03d.png" % f)
        bpy.ops.render.render(write_still=True)

    d = os.path.join(base, "idle")
    os.makedirs(d, exist_ok=True)
    rig.animation_data.action = idle
    sc.frame_set(1)
    sc.render.filepath = os.path.join(d, "001.png")
    bpy.ops.render.render(write_still=True)
    return rig


def save_source():
    os.makedirs(os.path.dirname(BLEND_OUT), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    return BLEND_OUT


def build_both_and_save():
    """一个场景里并排摆两个角色，存成 .blend 方便后续改"""
    r1 = build("c1", keep_scene=False, x_offset=-1.2)
    r1.name = "Rig_Scout"
    r2 = build("c2", keep_scene=True, x_offset=1.2)
    r2.name = "Rig_Assault"
    for ob in bpy.context.scene.objects:
        if ob.name.startswith("PlayerRig"):
            ob.name = ob.name.replace("PlayerRig", "Rig")
    return save_source()
