"""
EOFATA — 用 Blender 生成「三渲二」(cel-shaded 3D → 2D sprite) 的僵尸动画帧。

思路：
  · 方块角色（大头 + 小身 + 短腿），倒角模拟圆角，全部刚性绑到骨架
  · 材质：Diffuse → Shader to RGB → ColorRamp(CONSTANT) → Emission，硬边明暗两步
  · 描边：Solidify + 翻转法线 + 背面剔除的纯黑材质（inverted hull）
  · 正交相机，正面偏 20° 的四分之三视角，透明背景
  · 逐帧渲染成 PNG，再交给 _tools/build_sprite_assets.py 排帧表

用法（在 Blender 里执行）：
  exec(compile(open(r".../dev_html/_blender/render_zombie.py").read(), "render_zombie.py", "exec"))
  build_all()            # 建场景 + 骨架 + 三段动作
  render_action("walk")  # 渲染整段
"""
import bpy
import math
import os

OUT_ROOT = r"C:\Users\yy197\Documents\GitHub\EOF-ATA\dev_html\art_draft\enemies\zombie3d"
SCENE_NAME = "EOFATA_Zombie3D"

# 参考图取色（sRGB 0-255）；渲染前转线性，否则渲出来会偏白
def srgb(c):
    def f(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(f(v) for v in c)


HEAD = srgb((149, 155, 143))
BODY = srgb((69, 74, 67))
LEG = srgb((60, 60, 62))
HEAD_SH = tuple(c * 0.66 for c in HEAD)
BODY_SH = tuple(c * 0.62 for c in BODY)
LEG_SH = tuple(c * 0.62 for c in LEG)
INK = (0.008, 0.008, 0.008)


# ----------------------------------------------------------------- 场景
def fresh_scene():
    old = bpy.data.scenes.get(SCENE_NAME)
    if old:
        for ob in list(old.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.scenes.remove(old)
    sc = bpy.data.scenes.new(SCENE_NAME)
    bpy.context.window.scene = sc

    world = bpy.data.worlds.new("EOFATA_World")
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
    sc.render.resolution_percentage = 100
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


# ----------------------------------------------------------------- 材质
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


def ink_mat():
    mat = bpy.data.materials.new("Ink")
    mat.use_nodes = True
    mat.use_backface_culling = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emi = nt.nodes.new('ShaderNodeEmission')
    emi.inputs['Color'].default_value = (*INK, 1)
    nt.links.new(emi.outputs[0], out.inputs['Surface'])
    return mat


# ----------------------------------------------------------------- 建模
def box(name, size, loc, mat, outline, bevel=0.055, segments=3):
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
    ob.data.materials.append(outline)

    if bevel > 0:
        m = ob.modifiers.new("bevel", 'BEVEL')
        m.width = bevel
        m.segments = segments
        m.limit_method = 'ANGLE'
        m.harden_normals = False

    # 描边不在这里做：渲染出干净 RGBA，再用 PIL 膨胀 alpha 画黑边，
    # 这样线宽在最终贴图分辨率上恒定，不会因模型比例变化。
    return ob


def build_character(kind="zombie"):
    sc = bpy.context.scene
    m_head = cel_mat("M_Head", HEAD, HEAD_SH)
    m_body = cel_mat("M_Body", BODY, BODY_SH)
    m_arm = cel_mat("M_Arm", tuple(c * 0.9 for c in BODY), tuple(c * 0.9 for c in BODY_SH))
    m_leg = cel_mat("M_Leg", LEG, LEG_SH)
    m_ink = ink_mat()

    parts = []
    # 比例照原画：头 ~39% 高、身体 ~51%、腿只从身体底下露一点
    parts.append(("head", box("Head", (0.80, 0.56, 0.70), (0, 0, 1.46), m_head, m_ink, 0.15, 4)))
    parts.append(("spine", box("Body", (0.62, 0.44, 0.92), (0, 0, 0.64), m_body, m_ink, 0.08, 3)))
    for s, tag in ((1, "L"), (-1, "R")):
        parts.append(("arm." + tag, box("Arm" + tag, (0.17, 0.20, 0.62), (s * 0.42, 0, 0.80), m_arm, m_ink, 0.05, 3)))
    for s, tag in ((1, "L"), (-1, "R")):
        parts.append(("leg." + tag, box("Leg" + tag, (0.22, 0.23, 0.40), (s * 0.17, 0, 0.20), m_leg, m_ink, 0.06, 3)))
    # 眼睛
    for s, tag in ((1, "L"), (-1, "R")):
        parts.append(("head", box("Eye" + tag, (0.11, 0.06, 0.13), (s * 0.16, -0.315, 1.50), m_ink, m_ink, 0.012, 2)))
    # 远程僵尸的蓝色口水
    if kind == "zombie_y":
        m_goo = cel_mat("M_Goo", srgb((40, 110, 220)), tuple(c * 0.6 for c in srgb((40, 110, 220))))
        parts.append(("head", box("Drool", (0.09, 0.05, 0.30), (0.05, -0.315, 1.30), m_goo, m_ink, 0.03, 3)))
        parts.append(("head", box("DroolTip", (0.07, 0.05, 0.09), (0.05, -0.315, 1.14), m_goo, m_ink, 0.03, 3)))
    return parts


# ----------------------------------------------------------------- 骨架
def build_rig(parts):
    arm_data = bpy.data.armatures.new("ZombieRig")
    rig = bpy.data.objects.new("ZombieRig", arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')

    def bone(name, head, tail, parent=None):
        b = arm_data.edit_bones.new(name)
        b.head = head
        b.tail = tail
        if parent:
            b.parent = arm_data.edit_bones[parent]
            b.use_connect = False
        return b

    bone("root", (0, 0, 0), (0, 0, 0.12))
    bone("spine", (0, 0, 0.30), (0, 0, 1.10), "root")
    bone("chest", (0, 0, 1.10), (0, 0, 1.14), "spine")
    bone("head", (0, 0, 1.10), (0, 0, 1.82), "chest")
    for s, tag in ((1, "L"), (-1, "R")):
        bone("arm." + tag, (s * 0.40, 0, 1.05), (s * 0.40, 0, 0.48), "chest")
        bone("leg." + tag, (s * 0.14, 0, 0.34), (s * 0.14, 0, 0.00), "spine")

    bpy.ops.object.mode_set(mode='OBJECT')

    for bone_name, ob in parts:
        ob.parent = rig
        ob.matrix_parent_inverse = rig.matrix_world.inverted()
        vg = ob.vertex_groups.new(name=bone_name)
        vg.add(range(len(ob.data.vertices)), 1.0, 'REPLACE')
        mod = ob.modifiers.new("armature", 'ARMATURE')
        mod.object = rig
    return rig


# ----------------------------------------------------------------- 相机 / 灯光
def build_camera_light(yaw_deg=20.0):
    sc = bpy.context.scene
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 2.0
    cam = bpy.data.objects.new("Cam", cam_data)
    sc.collection.objects.link(cam)
    cam.location = (0, -6.0, 0.90)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam

    light_data = bpy.data.lights.new("Key", 'SUN')
    light_data.energy = 2.2
    light_data.angle = math.radians(6)
    light = bpy.data.objects.new("Key", light_data)
    sc.collection.objects.link(light)
    light.rotation_euler = (math.radians(55), 0, math.radians(-52))

    fill_data = bpy.data.lights.new("Fill", 'SUN')
    fill_data.energy = 0.15
    fill = bpy.data.objects.new("Fill", fill_data)
    sc.collection.objects.link(fill)
    fill.rotation_euler = (math.radians(72), 0, math.radians(120))
    return cam


def setup_yaw(rig, yaw_deg):
    rig.rotation_euler = (0, 0, math.radians(yaw_deg))


# ----------------------------------------------------------------- 渲染
def render_frames(action_name, first, last, out_dir, step=1):
    sc = bpy.context.scene
    os.makedirs(out_dir, exist_ok=True)  # out_dir 例：.../zombie3d/zombie/walk
    for f in range(first, last + 1, step):
        sc.frame_set(f)
        sc.render.filepath = os.path.join(out_dir, "%03d.png" % (f - first + 1))
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    pass


# ----------------------------------------------------------------- 动画
def pose(rig, name, x=0.0, y=0.0, z=0.0):
    pb = rig.pose.bones[name]
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = (x, y, z)


def bake(name, length, fn):
    """逐帧烘焙，保证循环与节奏完全可控"""
    rig = bpy.data.objects["ZombieRig"]
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
    pose(rig, "leg.L", x=0.16 * c, z=0.34 * s)
    pose(rig, "leg.R", x=-0.16 * c, z=-0.34 * s)
    pose(rig, "arm.L", x=-0.34 * s, z=0.07)
    pose(rig, "arm.R", x=0.34 * s, z=-0.07)
    pose(rig, "spine", x=0.10, z=0.05 * s)
    pose(rig, "chest", z=-0.03 * s)
    pose(rig, "head", z=-0.05 * s)
    rig.pose.bones["root"].location = (0, 0, -0.035 * abs(math.sin(p)))


def run_pose(rig, f, n):
    p = 2 * math.pi * (f - 1) / n
    s, c = math.sin(p), math.cos(p)
    pose(rig, "leg.L", x=0.34 * c, z=0.52 * s)
    pose(rig, "leg.R", x=-0.34 * c, z=-0.52 * s)
    pose(rig, "arm.L", x=-0.85 * s, z=0.10)
    pose(rig, "arm.R", x=0.85 * s, z=-0.10)
    pose(rig, "spine", x=0.26, z=0.08 * s)
    pose(rig, "chest", z=-0.05 * s)
    pose(rig, "head", x=-0.10, z=-0.08 * s)
    rig.pose.bones["root"].location = (0, 0, -0.07 * abs(math.sin(p)))


def attack_pose(rig, f, n):
    # 0-16 抬手蓄力，17 挥下，18-36 收势
    import math as m
    if f <= 16:
        t = (f - 1) / 15.0
        raise_ = 0.35 + 1.45 * (t ** 1.5)
        lunge = -0.12 * t
        drop = 0.10 * t
    elif f == 17:
        raise_ = -0.15
        lunge = 0.34
        drop = -0.16
    else:
        t = min(1.0, (f - 17) / 19.0)
        k = 1 - (1 - t) ** 2
        raise_ = -0.15 * (1 - k)
        lunge = 0.34 * (1 - k)
        drop = -0.16 * (1 - k)

    pose(rig, "arm.L", x=raise_, z=0.10)
    pose(rig, "arm.R", x=raise_, z=-0.10)
    pose(rig, "spine", x=lunge)
    pose(rig, "chest", x=0.10 if f <= 16 else -0.12)
    pose(rig, "head", x=-0.12 if f <= 16 else 0.10)
    pose(rig, "leg.L", z=0.06, x=0.05)
    pose(rig, "leg.R", z=-0.06, x=-0.05)
    rig.pose.bones["root"].location = (0, 0, drop)


def spit_pose(rig, f, n):
    """远程僵尸：缩头 → 前探喷吐 → 回位（12 帧，第 3 帧出伤）"""
    if f <= 2:
        t = (f - 1) / 1.0
        head, body = -0.20 * t, -0.08 * t
    elif f <= 5:
        t = (f - 2) / 3.0
        head, body = -0.20 + 0.62 * t, -0.08 + 0.26 * t
    else:
        t = min(1.0, (f - 5) / 7.0)
        k = 1 - (1 - t) ** 2
        head, body = 0.42 * (1 - k), 0.18 * (1 - k)

    pose(rig, "head", x=head)
    pose(rig, "chest", x=body * 0.5)
    pose(rig, "spine", x=body)
    pose(rig, "arm.L", x=0.10 + body * 0.4, z=0.08)
    pose(rig, "arm.R", x=0.10 + body * 0.4, z=-0.08)
    pose(rig, "leg.L", z=0.04)
    pose(rig, "leg.R", z=-0.04)
