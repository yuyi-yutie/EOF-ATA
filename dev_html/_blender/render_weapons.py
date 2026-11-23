import bpy, math, os

# Output dir: set EOFATA_W_OUT to render into a scratch folder first.
OUT = os.environ.get(
    "EOFATA_W_OUT",
    r"C:/Users/yy197/Documents/GitHub/EOF-ATA/dev_html/assets",
)
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

# Hands: matte leather-tan, deliberately duller than the gun metal.
M_HAND   = mat("M_HAND",   (0.075, 0.05, 0.034), 0.0, 0.80)
M_HAND_D = mat("M_HAND_D", (0.048, 0.032, 0.022), 0.0, 0.84)


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


# ------------------------------------------------------------
# Hand seen from above: back of the hand over the gun's near top
# edge, four fingers hooked down its near side, thumb forward.
# `top` is the gun's top surface height at that station.
# ------------------------------------------------------------
def hand(A, x, top=0.125, big=1.0):
    zt = top + 0.012
    A(sphere("palm", (x - 0.004, -0.115, zt), (0.10 * big, 0.062 * big, 0.038 * big), M_HAND))
    for k in range(4):
        fx = x - 0.058 + k * 0.0385
        A(rbox("finger", (fx, -0.142, zt - 0.055), (0.015, 0.026, 0.055), 0.008, M_HAND_D))
    A(sphere("thumb", (x + 0.078 * big, -0.148, zt - 0.015), (0.045 * big, 0.026, 0.024), M_HAND))


def build_weapon(i, with_hands=False):
    objs = []
    A = objs.append
    grip_x = 0.0

    if i == 0:
        # Sonic shotgun: chunky receiver, pump handguard, fat muzzle.
        A(rbox("sg_recv", (-0.16, 0, 0.0), (0.34, 0.145, 0.125), 0.045, M_MID))
        A(rbox("sg_rail", (0.02, 0, 0.128), (0.24, 0.06, 0.022), 0.01, M_DARK))
        A(rbox("sg_stock", (-0.72, 0, -0.01), (0.24, 0.105, 0.10), 0.035, M_DARK))
        A(rbox("sg_butt", (-0.97, 0, -0.01), (0.05, 0.115, 0.11), 0.02, M_MID))
        A(rbox("sg_grip", (-0.40, 0, -0.13), (0.075, 0.075, 0.135), 0.03, M_DARK,
               rot=(0, math.radians(-16), 0)))
        A(cyl("sg_pump", (0.42, 0, -0.02), 0.105, 0.40, M_MID, verts=20))
        for k in range(3):
            A(torus("sg_pump_ring", (0.28 + k * 0.14, 0, -0.02), 0.108, 0.014, M_DARK))
        A(cyl("sg_barrel", (0.92, 0, 0.01), 0.052, 0.66, M_TRIM))
        A(cyl("sg_tube", (0.86, 0, -0.105), 0.038, 0.58, M_DARK))
        A(cone("sg_muzzle", (1.27, 0, 0.01), 0.115, 0.085, 0.10, M_DARK))
        A(torus("sg_ring", (1.22, 0, 0.01), 0.10, 0.018, M_AMBER))
        A(rbox("sg_fs", (1.10, 0, 0.085), (0.018, 0.022, 0.05), 0.006, M_DARK))
        A(rbox("sg_rs", (-0.10, 0, 0.125), (0.035, 0.045, 0.035), 0.008, M_DARK))
        A(rbox("sg_mag", (0.06, 0, -0.20), (0.10, 0.085, 0.085), 0.02, M_TRIM))
        A(rbox("sg_glow", (0.04, 0.15, 0.02), (0.20, 0.012, 0.03), 0.006, M_AMBER))
        grip_x = -0.40
        if with_hands:
            hand(A, -0.40, top=0.125)
            hand(A, 0.46, top=0.085)

    elif i == 1:
        # Prism laser: slim receiver, long barrel, crystal muzzle.
        A(rbox("ls_recv", (-0.08, 0, 0.0), (0.30, 0.105, 0.095), 0.035, M_MID))
        A(rbox("ls_rail", (0.02, 0, 0.10), (0.22, 0.045, 0.02), 0.008, M_DARK))
        A(rbox("ls_stock", (-0.62, 0, -0.005), (0.24, 0.08, 0.075), 0.025, M_DARK))
        A(rbox("ls_butt", (-0.85, 0, -0.005), (0.04, 0.088, 0.085), 0.015, M_MID))
        A(rbox("ls_grip", (-0.30, 0, -0.12), (0.065, 0.068, 0.125), 0.025, M_DARK,
               rot=(0, math.radians(-16), 0)))
        A(rbox("ls_guard", (0.36, 0, -0.005), (0.20, 0.075, 0.075), 0.03, M_MID))
        A(cyl("ls_barrel", (0.95, 0, 0.0), 0.030, 1.00, M_STEEL))
        A(cyl("ls_shroud", (0.62, 0, 0.0), 0.048, 0.34, M_TRIM))
        A(torus("ls_r1", (1.10, 0, 0), 0.072, 0.014, M_CYAN))
        A(torus("ls_r2", (1.24, 0, 0), 0.062, 0.013, M_CYAN))
        A(sphere("ls_crystal", (1.40, 0, 0), (0.085, 0.085, 0.085), M_CYAN))
        A(rbox("ls_prism", (0.06, 0, 0.135), (0.075, 0.055, 0.045), 0.012, M_CYAN,
               rot=(0, 0, math.radians(45))))
        A(rbox("ls_glow", (0.0, 0.108, 0.005), (0.18, 0.012, 0.026), 0.005, M_CYAN))
        grip_x = -0.30
        if with_hands:
            hand(A, -0.30, top=0.100)
            hand(A, 0.38, top=0.070)

    elif i == 2:
        # Thermal launcher: fat body, side canister, flared nozzle.
        A(rbox("rp_body", (0.06, 0, 0.0), (0.36, 0.165, 0.145), 0.05, M_MID))
        A(rbox("rp_rail", (0.06, 0, 0.15), (0.22, 0.06, 0.02), 0.008, M_DARK))
        A(rbox("rp_stock", (-0.60, 0, -0.01), (0.24, 0.115, 0.105), 0.03, M_DARK))
        A(rbox("rp_butt", (-0.85, 0, -0.01), (0.04, 0.12, 0.11), 0.015, M_MID))
        A(rbox("rp_grip", (-0.28, 0, -0.15), (0.075, 0.075, 0.135), 0.028, M_DARK,
               rot=(0, math.radians(-16), 0)))
        A(cyl("rp_tank", (-0.16, 0.22, -0.01), 0.115, 0.42, M_DARK))
        A(torus("rp_tank_ring", (0.02, 0.22, -0.01), 0.118, 0.016, M_ORANGE))
        A(cone("rp_nozzle", (0.70, 0, 0.0), 0.10, 0.215, 0.42, M_MID))
        A(torus("rp_nozzle_ring", (0.88, 0, 0.0), 0.205, 0.022, M_ORANGE))
        A(rbox("rp_glow", (0.10, 0.168, 0.02), (0.16, 0.012, 0.035), 0.006, M_ORANGE))
        A(rbox("rp_glow2", (0.10, -0.168, 0.02), (0.16, 0.012, 0.035), 0.006, M_ORANGE))
        grip_x = -0.28
        if with_hands:
            hand(A, -0.28, top=0.145)
            hand(A, 0.54, top=0.130)

    elif i == 3:
        # Railgun: twin rails, glowing core, top optic.
        A(rbox("rg_recv", (-0.38, 0, 0.0), (0.30, 0.125, 0.105), 0.04, M_MID))
        A(rbox("rg_stock", (-0.78, 0, -0.005), (0.20, 0.10, 0.09), 0.03, M_DARK))
        A(rbox("rg_butt", (-0.99, 0, -0.005), (0.04, 0.108, 0.10), 0.015, M_MID))
        A(rbox("rg_grip", (-0.34, 0, -0.135), (0.07, 0.072, 0.13), 0.026, M_DARK,
               rot=(0, math.radians(-15), 0)))
        A(rbox("rg_rail1", (0.36, 0.062, 0.0), (0.62, 0.024, 0.055), 0.012, M_STEEL))
        A(rbox("rg_rail2", (0.36, -0.062, 0.0), (0.62, 0.024, 0.055), 0.012, M_STEEL))
        A(rbox("rg_core", (0.36, 0, -0.012), (0.60, 0.016, 0.018), 0.006, M_CYAN))
        for k in range(4):
            A(rbox("rg_bridge", (0.02 + k * 0.22, 0, 0.012), (0.018, 0.075, 0.045), 0.006, M_TRIM))
        A(cyl("rg_muzzle", (1.02, 0, 0.0), 0.048, 0.10, M_TRIM))
        A(rbox("rg_scope", (-0.18, 0, 0.135), (0.16, 0.055, 0.05), 0.015, M_DARK))
        A(cyl("rg_lens", (-0.03, 0, 0.135), 0.042, 0.03, M_CYAN))
        A(rbox("rg_fs", (0.86, 0, -0.012), (0.016, 0.03, 0.075), 0.006, M_DARK))
        grip_x = -0.34
        if with_hands:
            hand(A, -0.34, top=0.105)
            hand(A, 0.30, top=0.060)

    else:
        # Arc gun: coiled barrel, split electrode.
        A(rbox("ag_recv", (-0.10, 0, 0.0), (0.32, 0.135, 0.115), 0.04, M_MID))
        A(rbox("ag_rail", (0.02, 0, 0.12), (0.20, 0.05, 0.02), 0.008, M_DARK))
        A(rbox("ag_stock", (-0.62, 0, -0.005), (0.22, 0.095, 0.085), 0.028, M_DARK))
        A(rbox("ag_butt", (-0.84, 0, -0.005), (0.04, 0.102, 0.092), 0.015, M_MID))
        A(rbox("ag_grip", (-0.30, 0, -0.13), (0.07, 0.07, 0.13), 0.026, M_DARK,
               rot=(0, math.radians(-15), 0)))
        A(cyl("ag_guard", (0.30, 0, -0.005), 0.075, 0.24, M_TRIM))
        A(cyl("ag_barrel", (0.86, 0, 0.0), 0.048, 0.80, M_STEEL))
        for k in range(3):
            A(torus("ag_coil", (0.56 + k * 0.20, 0, 0), 0.125, 0.024, M_VIOLET))
        A(rbox("ag_prong1", (1.24, 0.085, 0), (0.13, 0.022, 0.038), 0.008, M_TRIM))
        A(rbox("ag_prong2", (1.24, -0.085, 0), (0.13, 0.022, 0.038), 0.008, M_TRIM))
        A(sphere("ag_tip", (1.28, 0, 0), (0.045, 0.045, 0.045), M_VIOLET))
        A(rbox("ag_glow", (0.0, 0.138, 0.005), (0.16, 0.012, 0.03), 0.006, M_VIOLET))
        grip_x = -0.30
        if with_hands:
            hand(A, -0.30, top=0.115)
            hand(A, 0.34, top=0.070)

    return objs, grip_x


def clear_objs(objs):
    for ob in objs:
        bpy.data.objects.remove(ob, do_unlink=True)


cam_data = bpy.data.cameras.new("W_CAM")
cam_data.type = 'ORTHO'
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

# Per weapon: top view + side view (both clean, hands are gone).
for i in range(5):
    objs, gx = build_weapon(i)
    for ob in objs:
        ob.location.x -= gx

    cam_data.ortho_scale = 3.5
    cam.location = (0, 0, 8)
    cam.rotation_euler = (0, 0, 0)
    scene.render.filepath = OUT + ("/w%d_top.png" % i)
    bpy.ops.render.render(write_still=True)
    clear_objs(objs)

    objs, gx = build_weapon(i)
    for ob in objs:
        ob.location.x -= gx
    cam_data.ortho_scale = 2.9
    cam.location = (0.38, -8, 0.10)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.render.filepath = OUT + ("/w%d_side.png" % i)
    bpy.ops.render.render(write_still=True)
    clear_objs(objs)

# Lineup for proportion checks.
all_objs = []
for i in range(5):
    objs, _ = build_weapon(i)
    for ob in objs:
        ob.location.x += (i - 2) * 3.6
    all_objs += objs
cam.location = (0, 0, 8)
cam.rotation_euler = (0, 0, 0)
cam_data.ortho_scale = 18.0
scene.render.resolution_x = 1792
scene.render.resolution_y = 512
scene.render.filepath = OUT + "/weapons_lineup.png"
bpy.ops.render.render(write_still=True)

print("WEAPONS DONE ->", OUT)
