import bpy
import os

OUT = r"C:\Users\yy197\Documents\GitHub\EOF-ATA\dev_web3d\assets\devices"
os.makedirs(OUT, exist_ok=True)

PAL = {
    'steel': (0.37, 0.39, 0.41),
    'steelDark': (0.20, 0.22, 0.24),
    'dark': (0.095, 0.105, 0.115),
    'ink': (0.055, 0.06, 0.065),
    'amber': (0.94, 0.69, 0.30),
    'amberDim': (0.48, 0.35, 0.16),
    'ice': (0.42, 0.84, 0.94),
    'iceDim': (0.20, 0.42, 0.48),
    'green': (0.48, 0.90, 0.52),
    'red': (0.88, 0.31, 0.25),
    'wood': (0.42, 0.32, 0.20),
    'gun': (0.58, 0.61, 0.64),
    'screenDark': (0.10, 0.18, 0.22),
    'screenFab': (0.09, 0.13, 0.15),
    'screenComms': (0.09, 0.13, 0.16),
    'keypad': (0.08, 0.10, 0.11),
}

prev_scene = bpy.context.window.scene
scene = bpy.data.scenes.new("EOFATA_DEVICES")
bpy.context.window.scene = scene

mats = {}
exported = []


def get_mat(key, glow):
    name = key + ('_glow' if glow else '')
    if name in mats:
        return mats[name]
    rgb = PAL[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    if glow:
        try:
            bsdf.inputs['Emission Color'].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
            bsdf.inputs['Emission Strength'].default_value = 1.0
        except Exception:
            pass
    mats[name] = m
    return m


def part(objs, lx, ly, lz, sx, sy, sz, key, yaw=0.0, rx=0.0, glow=False):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(lx, -lz, ly))
    o = bpy.context.object
    o.scale = (sx, sz, sy)
    o.rotation_euler = (rx, 0.0, yaw)
    o.data.materials.append(get_mat(key, glow))
    objs.append(o)
    return o


def export_device(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = 'device_' + name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    path = os.path.join(OUT, name + '.obj')
    bpy.ops.wm.obj_export(
        filepath=path,
        export_selected_objects=True,
        apply_modifiers=True,
        export_materials=True,
        export_triangulated_mesh=True,
        export_normals=False,
        export_uv=False,
        forward_axis='NEGATIVE_Z',
        up_axis='Y',
    )
    bb = [obj.matrix_world @ v.co for v in obj.data.vertices]
    xs = [v.x for v in bb]
    ys = [v.y for v in bb]
    zs = [v.z for v in bb]
    print("EXPORTED %s verts=%d size=(%.2f, %.2f, %.2f) min_y=%.3f" % (
        name, len(bb), max(xs) - min(xs), max(zs) - min(zs), max(ys) - min(ys), min(ys)))
    exported.append(obj)


# ---------------- ARMORY ----------------
o = []
part(o, 0, 0.07, 0, 3.0, 0.14, 1.65, 'dark')
part(o, 0, 1.28, -0.48, 2.9, 2.28, 0.70, 'steelDark')
part(o, -1.36, 1.30, -0.05, 0.22, 2.5, 1.55, 'dark')
part(o, 1.36, 1.30, -0.05, 0.22, 2.5, 1.55, 'dark')
part(o, 0, 2.48, -0.18, 3.02, 0.18, 0.92, 'amberDim')
part(o, 0, 2.60, 0.10, 2.55, 0.05, 0.05, 'amber', glow=True)
for i in (-1, 0, 1):
    x = i * 0.92
    part(o, x, 1.24, 0.17, 0.82, 1.86, 0.10, 'dark')
    for k in range(3):
        part(o, x, 0.58 + k * 0.47, 0.235, 0.56, 0.045, 0.025, 'amberDim', glow=True)
    part(o, x + 0.28, 1.04, 0.245, 0.055, 0.28, 0.035, 'amber', glow=True)
part(o, -0.58, 2.06, 0.23, 1.05, 0.085, 0.13, 'gun', yaw=0.28)
part(o, 0.58, 2.06, 0.23, 1.05, 0.085, 0.13, 'gun', yaw=-0.28)
part(o, -0.58, 2.13, 0.23, 0.28, 0.06, 0.09, 'iceDim', yaw=0.28, glow=True)
part(o, 0.58, 2.13, 0.23, 0.28, 0.06, 0.09, 'amberDim', yaw=-0.28, glow=True)
part(o, -1.44, 0.30, 0.62, 0.50, 0.46, 0.42, 'wood')
part(o, -1.44, 0.56, 0.62, 0.42, 0.04, 0.34, 'amber', glow=True)
part(o, 1.44, 0.30, 0.62, 0.50, 0.46, 0.42, 'steel')
part(o, 1.44, 0.56, 0.62, 0.42, 0.04, 0.34, 'ice', glow=True)
export_device('armory', o)

# ---------------- PRINTER ----------------
o = []
part(o, 0, 0.09, 0, 2.45, 0.18, 1.95, 'dark')
part(o, 0, 1.27, -0.02, 1.92, 2.22, 1.45, 'steelDark')
part(o, 0, 2.42, -0.02, 1.70, 0.20, 1.18, 'steel')
part(o, 0, 1.30, 0.72, 1.42, 1.50, 0.06, 'screenDark')
part(o, -0.70, 1.30, 0.755, 0.06, 1.42, 0.03, 'iceDim', glow=True)
part(o, 0.70, 1.30, 0.755, 0.06, 1.42, 0.03, 'iceDim', glow=True)
part(o, 0, 0.70, 0.74, 1.24, 0.08, 0.05, 'iceDim', glow=True)
part(o, 0, 0.80, 0.15, 1.26, 0.10, 0.92, 'dark')
part(o, 0, 1.83, 0.66, 1.34, 0.09, 0.08, 'steel')
part(o, -0.58, 1.55, 0.55, 0.05, 0.75, 0.05, 'steel')
part(o, 0.58, 1.55, 0.55, 0.05, 0.75, 0.05, 'steel')
part(o, 0, 1.16, 0.55, 0.18, 0.30, 0.16, 'amberDim')
part(o, 1.18, 1.60, 0.10, 0.24, 0.76, 0.76, 'iceDim')
part(o, 1.18, 1.60, 0.10, 0.30, 0.52, 0.52, 'ice')
part(o, 1.18, 1.60, 0.30, 0.16, 0.18, 0.03, 'ink')
part(o, -0.62, 2.72, -0.18, 0.18, 0.48, 0.18, 'steel')
part(o, -0.62, 2.98, -0.18, 0.34, 0.08, 0.34, 'steelDark')
part(o, 0.62, 2.55, 0.50, 0.55, 0.20, 0.08, 'dark')
part(o, 0.62, 2.55, 0.55, 0.42, 0.05, 0.03, 'green', glow=True)
export_device('printer', o)

# ---------------- STORAGE ----------------
o = []
part(o, 0, 0.07, 0, 3.1, 0.14, 1.75, 'dark')
part(o, 0, 1.32, -0.38, 3.0, 2.42, 0.62, 'steelDark')
part(o, -1.5, 1.30, -0.02, 0.20, 2.55, 1.55, 'dark')
part(o, 1.5, 1.30, -0.02, 0.20, 2.55, 1.55, 'dark')
for i in range(3):
    part(o, 0, 0.34 + i * 0.72, 0.03, 2.82, 0.09, 0.76, 'steel')
boxes = [
    [-1.02, 0.62, 0.02, 0.62, 0.48, 0.56, 'wood'],
    [-0.35, 0.60, 0.02, 0.54, 0.42, 0.50, 'iceDim'],
    [0.35, 0.64, 0.02, 0.60, 0.50, 0.58, 'wood'],
    [1.02, 0.62, 0.02, 0.56, 0.46, 0.52, 'steel'],
    [-1.02, 1.34, 0.02, 0.58, 0.44, 0.52, 'steel'],
    [-0.35, 1.30, 0.02, 0.62, 0.38, 0.56, 'wood'],
    [0.38, 1.34, 0.02, 0.52, 0.44, 0.48, 'iceDim'],
    [1.02, 1.30, 0.02, 0.60, 0.40, 0.54, 'wood'],
    [-0.78, 2.02, 0.02, 0.88, 0.50, 0.64, 'wood'],
    [0.42, 2.02, 0.02, 0.70, 0.48, 0.58, 'steel'],
]
for b in boxes:
    part(o, b[0], b[1], b[2], b[3], b[4], b[5], b[6])
    part(o, b[0], b[1] + b[4] * 0.5 + 0.02, b[2], b[3] * 0.62, 0.035, b[5] * 0.62, 'amberDim', glow=True)
part(o, 0.92, 2.72, -0.16, 0.42, 0.12, 0.42, 'steel')
part(o, 0.92, 2.64, -0.16, 0.18, 0.06, 0.18, 'amber', glow=True)
export_device('storage', o)

# ---------------- FABRICATOR ----------------
o = []
part(o, 0, 0.08, 0, 3.0, 0.16, 1.8, 'dark')
part(o, 0, 0.98, 0, 2.82, 0.18, 1.42, 'steelDark')
for sx in (-1, 1):
    for sz in (-1, 1):
        part(o, sx * 1.22, 0.50, sz * 0.48, 0.18, 0.84, 0.18, 'steel')
part(o, 0, 1.72, -0.46, 2.64, 1.50, 0.12, 'steelDark')
part(o, 0, 1.78, -0.38, 1.55, 0.82, 0.05, 'screenFab')
for i in range(4):
    part(o, -0.60 + i * 0.40, 1.50 + (i % 2) * 0.18, -0.345, 0.30, 0.035, 0.02, 'iceDim', glow=True)
part(o, 0, 2.40, -0.42, 2.70, 0.12, 0.20, 'amberDim')
part(o, 0, 2.33, -0.34, 2.40, 0.04, 0.04, 'amber', glow=True)
part(o, 0.78, 1.16, 0.26, 0.52, 0.32, 0.42, 'steel')
part(o, 0.78, 1.34, 0.26, 0.22, 0.08, 0.28, 'amberDim')
part(o, -0.72, 1.12, 0.40, 0.62, 0.10, 0.48, 'dark')
part(o, -0.72, 1.20, 0.40, 0.20, 0.12, 0.22, 'iceDim')
for i in (-1, 0, 1):
    part(o, -0.95 + i * 0.18, 2.55, -0.55, 0.07, 0.70, 0.07, 'steel')
part(o, -1.05, 2.82, -0.55, 0.34, 0.08, 0.10, 'steelDark')
export_device('fabricator', o)

# ---------------- COMMS ----------------
o = []
part(o, 0, 0.07, 0, 3.0, 0.14, 1.85, 'dark')
part(o, 0, 0.58, 0, 2.62, 1.08, 1.08, 'steelDark')
part(o, 0, 1.16, 0.28, 2.42, 0.14, 0.92, 'steel')
part(o, 0, 1.38, 0.50, 1.58, 0.06, 0.58, 'screenComms', rx=-0.35)
for i in range(5):
    part(o, -0.48 + (i % 3) * 0.32, 1.43 + (i // 3) * 0.11, 0.66, 0.20, 0.025, 0.02, 'ice', glow=True)
part(o, -0.72, 1.30, 0.82, 0.46, 0.055, 0.26, 'keypad')
for i in range(4):
    part(o, -0.91 + i * 0.12, 1.33, 0.82, 0.07, 0.012, 0.18, 'steel')
part(o, 0.92, 1.72, -0.42, 0.14, 3.16, 0.14, 'steel')
part(o, 0.92, 0.48, -0.42, 0.34, 0.82, 0.34, 'dark')
part(o, 0.92, 2.30, -0.42, 0.90, 0.08, 0.08, 'steel')
part(o, 0.92, 2.88, -0.42, 0.08, 0.08, 0.08, 'ice', glow=True)
part(o, 0.92, 3.22, -0.42, 0.06, 0.34, 0.06, 'steel')
part(o, 0.92, 3.42, -0.42, 0.10, 0.10, 0.10, 'red', glow=True)
part(o, -1.18, 0.76, -0.30, 0.42, 1.48, 0.58, 'steelDark')
part(o, -1.18, 1.20, -0.005, 0.30, 0.38, 0.03, 'iceDim', glow=True)
part(o, -1.18, 0.92, -0.005, 0.30, 0.10, 0.03, 'amberDim', glow=True)
export_device('comms', o)

# ---------------- TELEPORTER ----------------
o = []
for sx in (-1, 1):
    for sz in (-1, 1):
        part(o, sx * 1.34, 1.12, sz * 1.34, 0.22, 2.12, 0.22, 'steel')
        part(o, sx * 1.34, 2.22, sz * 1.34, 0.32, 0.12, 0.32, 'ice', glow=True)
        part(o, sx * 1.34, 0.24, sz * 1.34, 0.36, 0.18, 0.36, 'dark')
        part(o, sx * 1.20, 1.15, sz * 1.20, 0.05, 1.45, 0.05, 'iceDim', glow=True)
part(o, 0, 2.34, -1.34, 2.86, 0.14, 0.20, 'steelDark')
part(o, 0, 2.34, 1.34, 2.86, 0.14, 0.20, 'steelDark')
part(o, -1.34, 2.34, 0, 0.20, 0.14, 2.86, 'steelDark')
part(o, 1.34, 2.34, 0, 0.20, 0.14, 2.86, 'steelDark')
part(o, 0, 2.27, -1.34, 2.40, 0.04, 0.04, 'ice', glow=True)
part(o, 0, 2.27, 1.34, 2.40, 0.04, 0.04, 'ice', glow=True)
part(o, 0, 0.10, 0.98, 0.42, 0.07, 0.42, 'amberDim', glow=True)
part(o, 0, 0.10, -0.98, 0.42, 0.07, 0.42, 'amberDim', glow=True)
export_device('teleporter', o)

# restore scene, remove temp data
coll = bpy.data.collections.new("HallDevices")
scene.collection.children.link(coll)
for i, obj in enumerate(exported):
    obj.location = ((i - 2.5) * 4.2, 0.0, 0.0)
    coll.objects.link(obj)
try:
    bpy.data.libraries.write(os.path.join(OUT, 'devices.blend'), {coll}, fake_user=True)
    print("BLEND_WRITTEN")
except Exception as e:
    print("BLEND_FAILED", e)

bpy.context.window.scene = prev_scene
bpy.data.scenes.remove(scene)
for name in list(mats.keys()):
    m = bpy.data.materials.get(name)
    if m and m.users == 0:
        bpy.data.materials.remove(m)
print("DONE")
