import bpy, math, os

OUT = r"C:/Users/yy197/Documents/GitHub/EOF-ATA/dev_html/assets"
os.makedirs(OUT, exist_ok=True)

for s in list(bpy.data.scenes):
    if s.name == "EOFATA_RENDER":
        bpy.data.scenes.remove(s)
scene = bpy.data.scenes.new("EOFATA_RENDER")
bpy.context.window.scene = scene

scene.render.engine = 'BLENDER_EEVEE'
scene.render.film_transparent = True
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.eevee.taa_render_samples = 32
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'

world = bpy.data.worlds.get("EOFATA_W") or bpy.data.worlds.new("EOFATA_W")
scene.world = world
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs[0].default_value = (0.01, 0.02, 0.03, 1)
bg.inputs[1].default_value = 0.35


def mat(name, color, metallic=0.65, rough=0.32, emit=None, strength=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


M_DARK  = mat("M_DARK",  (0.055, 0.075, 0.095), 0.75, 0.34)
M_MID   = mat("M_MID",   (0.11, 0.145, 0.18), 0.65, 0.40)
M_TRIM  = mat("M_TRIM",  (0.32, 0.38, 0.44), 0.85, 0.28)
M_CYAN  = mat("M_CYAN",  (0.03, 0.22, 0.32), 0.2, 0.2, (0.30, 0.90, 1.0), 1.3)
M_AMBER = mat("M_AMBER", (0.35, 0.16, 0.03), 0.3, 0.25, (1.0, 0.50, 0.08), 1.1)


def rbox(name, loc, scale, bevel=0.06, material=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=2, location=loc, rotation=rot)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel:
        md = ob.modifiers.new("bev", 'BEVEL')
        md.width = bevel
        md.segments = 4
        md.limit_method = 'ANGLE'
    if material:
        ob.data.materials.append(material)
    return ob


def cyl(name, loc, radius, depth, material, rot=(0, 0, 0), verts=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot)
    ob = bpy.context.object
    ob.name = name
    if material:
        ob.data.materials.append(material)
    return ob


def sphere(name, loc, scale, material, seg=32, ring=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=1, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        ob.data.materials.append(material)
    return ob


def torus(name, loc, major, minor, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=32, minor_segments=10,
                                     location=loc, rotation=rot)
    ob = bpy.context.object
    ob.name = name
    if material:
        ob.data.materials.append(material)
    return ob


# ---------- 侧视 Q 版：无手无脚，悬浮 ----------
# 身体（小）
rbox("body", (0, 0, 0.54), (0.30, 0.24, 0.30), 0.12, M_MID)
rbox("body_band", (0, 0, 0.40), (0.31, 0.25, 0.04), 0.02, M_TRIM)
rbox("core", (0.335, 0, 0.60), (0.06, 0.08, 0.08), 0.03, M_AMBER)

# 头（大，1:1 以上）
cyl("neck", (0.02, 0, 0.84), 0.13, 0.10, M_DARK)
head = rbox("head", (0.03, 0, 1.30), (0.50, 0.42, 0.45), 0.19, M_MID)
# 侧视目镜：贴在朝向 +X 的前脸
rbox("visor_frame", (0.49, 0, 1.30), (0.06, 0.34, 0.20), 0.05, M_DARK)
rbox("visor", (0.545, 0, 1.30), (0.035, 0.29, 0.15), 0.04, M_CYAN)
# 侧视时朝向镜头的一只大眼睛
rbox("eye_frame", (0.26, -0.395, 1.31), (0.25, 0.05, 0.17), 0.06, M_DARK)
rbox("eye", (0.27, -0.43, 1.31), (0.20, 0.035, 0.125), 0.05, M_CYAN)
rbox("eye_glint", (0.32, -0.45, 1.35), (0.05, 0.012, 0.035), 0.015, M_TRIM)
# 头顶小檐 + 天线
rbox("crest", (0.02, 0, 1.755), (0.30, 0.30, 0.025), 0.01, M_TRIM)
cyl("antenna", (-0.22, 0.05, 1.86), 0.016, 0.24, M_TRIM, rot=(0, math.radians(-8), 0))
sphere("antenna_tip", (-0.19, 0.05, 1.985), (0.032, 0.032, 0.032), M_AMBER)

# 背包（后侧）
rbox("pack", (-0.41, 0, 0.86), (0.13, 0.21, 0.25), 0.06, M_DARK)
rbox("pack_glow", (-0.545, 0, 0.86), (0.02, 0.15, 0.17), 0.01, M_CYAN)

# 悬浮环（代替脚）
torus("hover_ring", (0, 0, 0.20), 0.26, 0.024, M_CYAN)
sphere("thruster", (0, 0, 0.16), (0.10, 0.10, 0.035), M_CYAN)

# ---------- 相机 & 灯光 ----------
cam_data = bpy.data.cameras.new("EOFATA_CAM")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.15
cam = bpy.data.objects.new("EOFATA_CAM", cam_data)
scene.collection.objects.link(cam)
cam.location = (0.06, -8, 1.02)
cam.rotation_euler = (math.radians(90), 0, 0)
scene.camera = cam


def area(name, loc, energy, color, size, rot):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = energy
    d.color = color
    d.size = size
    ob = bpy.data.objects.new(name, d)
    scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot


area("key", (-3.2, -4.0, 4.2), 900, (1.0, 0.96, 0.9), 4.0, (math.radians(48), 0, math.radians(-38)))
area("fill", (3.6, -2.6, 2.0), 380, (0.45, 0.75, 1.0), 3.0, (math.radians(70), 0, math.radians(58)))
area("rim", (0.6, 4.2, 3.4), 700, (0.55, 0.9, 1.0), 3.0, (math.radians(-125), 0, math.radians(8)))

scene.render.filepath = OUT + "/player.png"
bpy.ops.render.render(write_still=True)
print("RENDERED", scene.render.filepath)
