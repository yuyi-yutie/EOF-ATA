"""
EOFATA — 三渲二地砖 / 墙体贴图。

和角色、武器同一套 cel 材质；正交相机俯视，渲染出可平铺的单格贴图：
  · floor_0..3.png：带倒角的米色地砖，四周留缝（缝里是深色勾缝底面）
  · wall.png     ：暖白墙面板（只有很淡的倒角高光，平铺后不会出现砖缝）

用法：
  exec(compile(open(r"...\\dev_html\\_blender\\render_tiles_toon.py").read(), "render_tiles_toon.py", "exec"))
  render_all()
  save_source()
"""
import math
import os

import bpy

OUT_ROOT = r"C:\Users\yy197\Documents\GitHub\EOF-ATA\dev_html\art_draft\tiles3d"
BLEND_OUT = r"C:\Users\yy197\Documents\GitHub\EOF-ATA\dev_html\blender_draft\tiles_toon.blend"
SCENE_NAME = "EOFATA_Tiles3D"


def srgb(c):
    def f(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(f(v) for v in c)


FLOOR = srgb((205, 181, 160))
FLOOR_SH = tuple(c * 0.72 for c in FLOOR)
GROUT = srgb((158, 139, 122))
GROUT_SH = tuple(c * 0.8 for c in GROUT)
WALL = srgb((238, 231, 220))
WALL_SH = tuple(c * 0.80 for c in WALL)


def fresh_scene():
    old = bpy.data.scenes.get(SCENE_NAME)
    if old:
        for ob in list(old.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.scenes.remove(old)
    sc = bpy.data.scenes.new(SCENE_NAME)
    bpy.context.window.scene = sc
    world = bpy.data.worlds.new("W_T")
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new('ShaderNodeBackground')
    wo = nt.nodes.new('ShaderNodeOutputWorld')
    bg.inputs[1].default_value = 0.0
    nt.links.new(bg.outputs[0], wo.inputs['Surface'])
    sc.world = world

    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.film_transparent = False
    sc.render.resolution_x = 256
    sc.render.resolution_y = 256
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.view_settings.view_transform = 'Standard'
    try:
        sc.eevee.taa_render_samples = 24
    except Exception:
        pass
    return sc


def cel_mat(name, base, shadow, flat=1.0):
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
    e2.color = (*[min(1.0, c * 1.05) for c in base], 1)
    emi = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(diff.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs[0], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], emi.inputs['Color'])
    nt.links.new(emi.outputs[0], out.inputs['Surface'])
    return mat


def slab(name, size, z, mat, bevel):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, z))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (size[0], size[1], size[2])
    ob.data.materials.append(mat)
    m = ob.modifiers.new("bevel", 'BEVEL')
    m.width = bevel
    m.segments = 3
    return ob


def camera_top(scale):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("Cam")
    cd.type = 'ORTHO'
    cd.ortho_scale = scale
    cam = bpy.data.objects.new("Cam", cd)
    sc.collection.objects.link(cam)
    cam.location = (0, 0, 6)
    cam.rotation_euler = (0, 0, 0)
    sc.camera = cam
    return cam


def sun():
    sc = bpy.context.scene
    d = bpy.data.lights.new("Key", 'SUN')
    d.energy = 2.6
    d.angle = math.radians(20)
    ob = bpy.data.objects.new("Key", d)
    sc.collection.objects.link(ob)
    ob.rotation_euler = (math.radians(38), 0, math.radians(-30))
    return ob


def render_floor_variant(i):
    sc = fresh_scene()
    camera_top(0.5)
    sun()
    # 勾缝底面（铺满整个画面，保证平铺无缝）
    slab("Grout", (0.5, 0.5, 0.02), 0.0, cel_mat("M_Grout", GROUT, GROUT_SH), 0.0)
    # 地砖本体，四周留 12% 缝
    m = cel_mat("M_Floor", FLOOR, FLOOR_SH)
    slab("Tile", (0.5 * 0.94, 0.5 * 0.94, 0.05), 0.02, m, 0.03)
    # 每个变体换个光照角度，避免整片地面过于统一
    light = bpy.data.objects["Key"]
    light.rotation_euler = (math.radians(38), 0, math.radians(-30 + i * 90))
    d = os.path.join(OUT_ROOT, "floor")
    os.makedirs(d, exist_ok=True)
    sc.render.filepath = os.path.join(d, "%d.png" % i)
    bpy.ops.render.render(write_still=True)


def render_wall():
    sc = fresh_scene()
    camera_top(1.0)
    sun()
    m = cel_mat("M_Wall", WALL, WALL_SH)
    slab("Wall", (1.25, 1.25, 0.10), 0.05, m, 0.06)
    d = os.path.join(OUT_ROOT, "wall")
    os.makedirs(d, exist_ok=True)
    sc.render.filepath = os.path.join(d, "001.png")
    bpy.ops.render.render(write_still=True)


def render_all():
    for i in range(4):
        render_floor_variant(i)
    render_wall()
    return OUT_ROOT


def save_source():
    os.makedirs(os.path.dirname(BLEND_OUT), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    return BLEND_OUT
