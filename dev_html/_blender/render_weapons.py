import bpy, math, os

OUT = r"C:/Users/yy197/Documents/GitHub/EOF-ATA/dev_html/assets"
os.makedirs(OUT, exist_ok=True)

for s in list(bpy.data.scenes):
    if s.name == "EOFATA_WEAPONS":
        bpy.data.scenes.remove(s)
scene = bpy.data.scenes.new("EOFATA_WEAPONS")
bpy.context.window.scene = scene

scene.render.engine = 'BLENDER_EEVEE'
scene.render.film_transparent = True
scene.render.resolution_x = 512
scene.render.resolution_y = 256
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


M_DARK   = mat("M_DARK",   (0.055, 0.075, 0.095), 0.75, 0.34)
M_MID    = mat("M_MID",    (0.11, 0.145, 0.18), 0.65, 0.40)
M_TRIM   = mat("M_TRIM",   (0.32, 0.38, 0.44), 0.85, 0.28)
M_STEEL  = mat("M_STEEL",  (0.48, 0.54, 0.60), 0.90, 0.24)
M_CYAN   = mat("M_CYAN",   (0.03, 0.22, 0.32), 0.2, 0.2, (0.30, 0.90, 1.0), 1.3)
M_AMBER  = mat("M_AMBER",  (0.35, 0.16, 0.03), 0.3, 0.25, (1.0, 0.50, 0.08), 1.1)
M_ORANGE = mat("M_ORANGE", (0.40, 0.12, 0.03), 0.3, 0.25, (1.0, 0.35, 0.08), 1.4)
M_VIOLET = mat("M_VIOLET", (0.22, 0.08, 0.35), 0.3, 0.22, (0.65, 0.30, 1.0), 1.5)

# 每把枪的握把位置：渲染前平移到原点，作为旋转轴
GRIP_X = [-0.22, -0.18, -0.10, -0.30, -0.16]


def rbox(name, loc, scale, bevel=0.03, material=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=2, location=loc, rotation=rot)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel:
        md = ob.modifiers.new("bev", 'BEVEL')
        md.width = bevel
        md.segments = 2
        md.limit_method = 'ANGLE'
    if material:
        ob.data.materials.append(material)
    return ob


def cyl(name, loc, radius, depth, material, rot=(0, math.radians(90), 0), verts=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot)
    ob = bpy.context.object
    ob.name = name
    if material:
        ob.data.materials.append(material)
    return ob


def cone(name, loc, r1, r2, depth, material, rot=(0, math.radians(90), 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    ob = bpy.context.object
    ob.name = name
    if material:
        ob.data.materials.append(material)
    return ob


def torus(name, loc, major, minor, material, rot=(0, math.radians(90), 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=24, minor_segments=10,
                                     location=loc, rotation=rot)
    ob = bpy.context.object
    ob.name = name
    if material:
        ob.data.materials.append(material)
    return ob


def sphere(name, loc, scale, material):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        ob.data.materials.append(material)
    return ob


def build_weapon(i):
    objs = []
    A = objs.append

    if i == 0:  # 共振霰弹：厚重、宽枪口、琥珀色
        A(rbox("sg_body", (0.0, 0, 0.0), (0.52, 0.13, 0.12), 0.05, M_MID))
        A(rbox("sg_top", (0.0, 0, 0.13), (0.40, 0.09, 0.03), 0.02, M_DARK))
        A(cyl("sg_barrel", (0.72, 0, 0.02), 0.085, 0.70, M_TRIM))
        A(cyl("sg_tube", (0.72, 0, -0.08), 0.055, 0.62, M_DARK))
        A(cyl("sg_muzzle", (1.10, 0, 0.02), 0.13, 0.10, M_DARK))
        A(torus("sg_ring", (1.05, 0, 0.02), 0.115, 0.02, M_AMBER))
        A(rbox("sg_stock", (-0.62, 0, -0.01), (0.28, 0.10, 0.09), 0.04, M_DARK))
        A(rbox("sg_grip", (-0.22, 0, -0.16), (0.08, 0.07, 0.12), 0.03, M_DARK))
        A(rbox("sg_glow", (0.02, 0.115, 0.0), (0.26, 0.02, 0.04), 0.01, M_AMBER))

    elif i == 1:  # 棱镜激光：细长、晶体、青色
        A(rbox("ls_body", (0.02, 0, 0.0), (0.42, 0.10, 0.10), 0.04, M_MID))
        A(cyl("ls_barrel", (0.72, 0, 0.0), 0.042, 1.10, M_STEEL))
        A(rbox("ls_stock", (-0.50, 0, 0.0), (0.22, 0.08, 0.08), 0.03, M_DARK))
        A(rbox("ls_grip", (-0.18, 0, -0.14), (0.07, 0.06, 0.11), 0.02, M_DARK))
        A(torus("ls_ring1", (0.88, 0, 0), 0.085, 0.016, M_CYAN))
        A(torus("ls_ring2", (1.02, 0, 0), 0.075, 0.014, M_CYAN))
        A(sphere("ls_crystal", (1.22, 0, 0), (0.10, 0.10, 0.10), M_CYAN))
        A(rbox("ls_glow", (0.0, 0.095, 0.0), (0.20, 0.015, 0.03), 0.01, M_CYAN))

    elif i == 2:  # 辐射投射器：罐体、粗喷口、橙色
        A(rbox("rp_body", (0.10, 0, 0.0), (0.40, 0.18, 0.14), 0.05, M_MID))
        A(cyl("rp_tank", (-0.30, 0, 0.06), 0.16, 0.46, M_DARK, rot=(0, math.radians(90), 0)))
        A(torus("rp_tank_ring", (-0.45, 0, 0.06), 0.16, 0.02, M_ORANGE))
        A(cone("rp_nozzle", (0.85, 0, 0.0), 0.10, 0.22, 0.40, M_TRIM))
        A(torus("rp_nozzle_ring", (1.03, 0, 0.0), 0.215, 0.025, M_ORANGE))
        A(rbox("rp_grip", (-0.10, 0, -0.18), (0.08, 0.07, 0.13), 0.03, M_DARK))
        A(rbox("rp_glow", (0.16, 0.16, 0.0), (0.18, 0.02, 0.05), 0.01, M_ORANGE))
        A(rbox("rp_glow2", (0.16, -0.16, 0.0), (0.18, 0.02, 0.05), 0.01, M_ORANGE))

    elif i == 3:  # 轨道步枪：双轨、长、白蓝
        A(rbox("rg_body", (-0.34, 0, 0.0), (0.30, 0.13, 0.10), 0.04, M_MID))
        A(rbox("rg_rail1", (0.40, 0.055, 0.0), (0.78, 0.028, 0.05), 0.015, M_STEEL))
        A(rbox("rg_rail2", (0.40, -0.055, 0.0), (0.78, 0.028, 0.05), 0.015, M_STEEL))
        A(rbox("rg_core", (0.40, 0, -0.01), (0.74, 0.018, 0.02), 0.01, M_CYAN))
        A(rbox("rg_scope", (-0.28, 0, 0.12), (0.20, 0.06, 0.06), 0.02, M_DARK))
        A(cyl("rg_scope_lens", (-0.06, 0, 0.12), 0.045, 0.04, M_CYAN))
        A(rbox("rg_stock", (-0.72, 0, -0.01), (0.22, 0.09, 0.08), 0.03, M_DARK))
        A(rbox("rg_grip", (-0.30, 0, -0.15), (0.07, 0.06, 0.11), 0.02, M_DARK))
        A(cyl("rg_muzzle", (1.18, 0, 0.0), 0.05, 0.08, M_TRIM))

    else:  # 电弧枪：线圈、紫色
        A(rbox("ag_body", (0.0, 0, 0.0), (0.40, 0.13, 0.12), 0.05, M_MID))
        A(cyl("ag_barrel", (0.75, 0, 0.0), 0.055, 1.00, M_STEEL))
        A(torus("ag_coil1", (0.52, 0, 0), 0.135, 0.028, M_VIOLET))
        A(torus("ag_coil2", (0.74, 0, 0), 0.135, 0.028, M_VIOLET))
        A(torus("ag_coil3", (0.96, 0, 0), 0.135, 0.028, M_VIOLET))
        A(rbox("ag_prong1", (1.18, 0.09, 0), (0.14, 0.025, 0.04), 0.01, M_TRIM))
        A(rbox("ag_prong2", (1.18, -0.09, 0), (0.14, 0.025, 0.04), 0.01, M_TRIM))
        A(sphere("ag_tip", (1.22, 0, 0), (0.05, 0.05, 0.05), M_VIOLET))
        A(rbox("ag_grip", (-0.16, 0, -0.17), (0.07, 0.06, 0.12), 0.02, M_DARK))
        A(rbox("ag_glow", (0.0, 0.115, 0.0), (0.18, 0.018, 0.04), 0.01, M_VIOLET))

    return objs


def clear_objs(objs):
    for ob in objs:
        bpy.data.objects.remove(ob, do_unlink=True)


# ---------- 相机 & 灯光 ----------
cam_data = bpy.data.cameras.new("W_CAM")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.55
cam = bpy.data.objects.new("W_CAM", cam_data)
scene.collection.objects.link(cam)
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
    return ob


area("wkey", (-2.2, -2.4, 5.0), 900, (1.0, 0.96, 0.9), 3.0, (math.radians(35), 0, math.radians(-35)))
area("wfill", (2.8, -1.6, 3.6), 360, (0.45, 0.75, 1.0), 3.0, (math.radians(55), 0, math.radians(50)))
area("wrim", (0.4, 2.8, 3.2), 650, (0.55, 0.9, 1.0), 3.0, (math.radians(-140), 0, math.radians(6)))

# 逐个武器：俯视 + 侧视
for i in range(5):
    objs = build_weapon(i)
    # 握把移到原点：贴图的中心就是旋转轴
    for ob in objs:
        ob.location.x -= GRIP_X[i]

    cam_data.ortho_scale = 3.2
    cam.location = (0, 0, 8)
    cam.rotation_euler = (0, 0, 0)
    scene.render.filepath = OUT + ("/w%d_top.png" % i)
    bpy.ops.render.render(write_still=True)

    cam_data.ortho_scale = 2.6
    cam.location = (0.38, -8, 0.10)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.render.filepath = OUT + ("/w%d_side.png" % i)
    bpy.ops.render.render(write_still=True)

    clear_objs(objs)

# 一排总览（便于检查比例）
all_objs = []
for i in range(5):
    objs = build_weapon(i)
    for ob in objs:
        ob.location.x += (i - 2) * 3.4
    all_objs += objs
cam.location = (0, 0, 8)
cam.rotation_euler = (0, 0, 0)
cam_data.ortho_scale = 17.0
scene.render.resolution_x = 1792
scene.render.resolution_y = 512
scene.render.filepath = OUT + "/weapons_lineup.png"
bpy.ops.render.render(write_still=True)

print("WEAPONS DONE")
