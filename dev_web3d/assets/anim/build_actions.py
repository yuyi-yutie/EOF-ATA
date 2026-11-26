# Blender 5.3 action builder for EOFATA box characters.
# Run inside Blender (Blender MCP execute_blender_code):
#   exec(open(r"...\assets\anim\build_actions.py").read())
# It writes js/animdata.js and saves assets/anim/eofata_actions.blend (copy).

import bpy, math, os, json
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # dev_web3d
ANIMDIR = HERE

OBJ_NAMES = {
    "BodyCtl", "HeadCtl", "LegL", "LegR", "GunCtl", "MagCtl",
    "Body", "Vest", "Head", "Hair", "EyeL", "EyeR", "Mouth",
    "LegLMesh", "LegRMesh", "GunReceiver", "GunBarrel", "GunStock",
    "GunGrip", "GunSight", "MagBody", "MagBase",
    "PreviewFloor", "PreviewCam", "Key", "Fill",
}
MAT_NAMES = {"skin", "pants", "body", "vest", "hair", "gun", "gunL",
             "accent", "mag", "floor"}


def cleanup():
    for s in list(bpy.data.scenes):
        if s.name.startswith("EOFATA_AnimPreview"):
            bpy.data.scenes.remove(s)
    for o in list(bpy.data.objects):
        if o.name.split(".")[0] in OBJ_NAMES:
            bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        if a.name.startswith(("walk_", "sprint_", "reload_")):
            bpy.data.actions.remove(a)
    for m in list(bpy.data.materials):
        if m.name.split(".")[0] in MAT_NAMES:
            bpy.data.materials.remove(m)


cleanup()

scene = bpy.data.scenes.new("EOFATA_AnimPreview")
bpy.context.window.scene = scene
if not scene.world:
    scene.world = bpy.data.worlds.new("EOFATA_World")
scene.render.fps = 24
scene.frame_start = 0
scene.frame_end = 24
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.film_transparent = False
scene.world.color = (0.055, 0.065, 0.08)


def mat(name, col, rough=0.75, metal=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (col[0], col[1], col[2], 1)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    if b:
        b.inputs["Base Color"].default_value = (col[0], col[1], col[2], 1)
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = metal
    return m


M = {
    "skin": mat("skin", (0.76, 0.58, 0.42)),
    "pants": mat("pants", (0.20, 0.24, 0.26)),
    "body": mat("body", (0.44, 0.47, 0.32)),
    "vest": mat("vest", (0.17, 0.18, 0.19)),
    "hair": mat("hair", (0.10, 0.09, 0.08)),
    "gun": mat("gun", (0.13, 0.15, 0.17), 0.45, 0.35),
    "gunL": mat("gunL", (0.33, 0.36, 0.40), 0.45, 0.35),
    "accent": mat("accent", (0.94, 0.43, 0.23), 0.35, 0.1),
    "mag": mat("mag", (0.19, 0.21, 0.24), 0.5, 0.25),
    "floor": mat("floor", (0.12, 0.14, 0.16), 0.9),
}


def empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.empty_display_size = 0.08
    if parent:
        e.parent = parent
    e.location = loc
    return e


def cube(name, loc, scale, material, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    if parent:
        o.parent = parent
    o.location = loc
    o.scale = scale
    return o


bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
floor = bpy.context.object
floor.name = "PreviewFloor"
floor.data.materials.append(M["floor"])

# hips -> body / head / legs / gun
hips = empty("BodyCtl", (0, 0, 0.47))
cube("Body", (0, 0, 0.193), (0.44, 0.30, 0.36), M["body"], hips)
cube("Vest", (0, -0.158, 0.200), (0.36, 0.035, 0.28), M["vest"], hips)
head = empty("HeadCtl", (0, 0, 0.388), hips)
cube("Head", (0, 0, 0.218), (0.44, 0.38, 0.44), M["skin"], head)
cube("Hair", (0, 0, 0.440), (0.46, 0.40, 0.075), M["hair"], head)
cube("EyeL", (-0.10, -0.196, 0.245), (0.07, 0.012, 0.045), M["hair"], head)
cube("EyeR", (0.10, -0.196, 0.245), (0.07, 0.012, 0.045), M["hair"], head)
cube("Mouth", (0, -0.197, 0.145), (0.11, 0.012, 0.022), M["hair"], head)

legL = empty("LegL", (-0.105, 0, 0.0), hips)
legR = empty("LegR", (0.105, 0, 0.0), hips)
cube("LegLMesh", (0, 0, -0.235), (0.17, 0.20, 0.47), M["pants"], legL)
cube("LegRMesh", (0, 0, -0.235), (0.17, 0.20, 0.47), M["pants"], legR)

gun = empty("GunCtl", (0.10, -0.18, 0.27), hips)
cube("GunReceiver", (0, 0, 0), (0.10, 0.34, 0.13), M["gun"], gun)
cube("GunBarrel", (0, -0.38, 0.02), (0.05, 0.44, 0.05), M["gunL"], gun)
cube("GunStock", (0, 0.26, 0), (0.09, 0.24, 0.12), M["gun"], gun)
cube("GunGrip", (0, 0.08, -0.08), (0.08, 0.07, 0.16), M["gun"], gun)
cube("GunSight", (0, -0.10, 0.09), (0.05, 0.12, 0.035), M["accent"], gun)
mag = empty("MagCtl", (0, 0.02, -0.15), gun)
cube("MagBody", (0, 0, 0), (0.07, 0.06, 0.16), M["mag"], mag)
cube("MagBase", (0, 0, -0.085), (0.085, 0.07, 0.025), M["gunL"], mag)

cam_data = bpy.data.cameras.new("PreviewCam")
cam = bpy.data.objects.new("PreviewCam", cam_data)
scene.collection.objects.link(cam)
cam.location = (3.1, -5.2, 2.5)
direction = Vector((0, 0, 0.78)) - cam.location
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam

sun_data = bpy.data.lights.new("Key", 'SUN')
sun_data.energy = 3.0
sun = bpy.data.objects.new("Key", sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(55), 0, math.radians(-35))
fill_data = bpy.data.lights.new("Fill", 'AREA')
fill_data.energy = 160
fill_data.size = 5
fill = bpy.data.objects.new("Fill", fill_data)
scene.collection.objects.link(fill)
fill.location = (-4, -3, 4)
fill.rotation_euler = (math.radians(50), 0, math.radians(-125))

CTL = {'BodyCtl': hips, 'HeadCtl': head, 'LegL': legL, 'LegR': legR,
       'GunCtl': gun, 'MagCtl': mag}


def reset_pose():
    hips.location = (0, 0, 0.47)
    hips.rotation_euler = (0, 0, 0)
    head.location = (0, 0, 0.388)
    head.rotation_euler = (0, 0, 0)
    legL.rotation_euler = (0, 0, 0)
    legR.rotation_euler = (0, 0, 0)
    gun.location = (0.10, -0.18, 0.27)
    gun.rotation_euler = (0, 0, 0)
    mag.location = (0, 0.02, -0.15)
    mag.scale = (1, 1, 1)


def pose_clip(name, u):
    t = u * math.pi * 2.0
    if name == 'walk':
        hips.location.z = 0.47 + abs(math.cos(t)) * 0.018
        hips.rotation_euler.x = 0.055
        legL.rotation_euler.x = math.sin(t) * 0.55
        legR.rotation_euler.x = -math.sin(t) * 0.55
        head.location.x = math.sin(t) * 0.034
        head.location.z = 0.388 + math.sin(t * 2.0) * 0.007
        head.rotation_euler.z = math.sin(t) * 0.24
        head.rotation_euler.x = math.sin(t * 2.0 + 0.7) * 0.07
        gun.rotation_euler.x = 0.02
        gun.location.z = 0.27 + math.sin(t * 2.0) * 0.006
    elif name == 'sprint':
        hips.location.z = 0.47 + abs(math.cos(t)) * 0.030
        hips.rotation_euler.x = 0.18
        legL.rotation_euler.x = math.sin(t) * 0.82
        legR.rotation_euler.x = -math.sin(t) * 0.82
        head.location.x = math.sin(t) * 0.014
        head.location.z = 0.400 + math.sin(t * 2.0) * 0.006
        head.rotation_euler.z = math.sin(t) * 0.045
        head.rotation_euler.x = -0.04 + math.sin(t * 2.0) * 0.02
        # rifle carried horizontally across the chest
        gun.location = (0.02, -0.20, 0.25 + math.sin(t * 2.0) * 0.008)
        gun.rotation_euler.z = 1.52
        gun.rotation_euler.x = 0.10
    elif name == 'reload':
        down = min(1.0, u / 0.20) if u < 0.20 else (1.0 if u < 0.72 else max(0.0, (1.0 - u) / 0.28))
        ease = down * down * (3 - 2 * down)
        hips.rotation_euler.x = 0.055 + ease * 0.04
        head.rotation_euler.x = ease * 0.13
        gun.location = (0.10 + ease * 0.055, -0.18 + ease * 0.02, 0.27 - ease * 0.125)
        gun.rotation_euler.z = -ease * 0.42
        gun.rotation_euler.x = ease * 0.72
        if u < 0.50:
            mag.location.z = -0.15 - (u / 0.50) * 0.48
        elif u < 0.72:
            mag.location.z = -0.63
            mag.scale = (0.03, 0.03, 0.03)
        else:
            k = (u - 0.72) / 0.28
            mag.location.z = -0.63 + k * 0.48


def key_clip(clip_name, frames):
    acts = {}
    for name, o in CTL.items():
        o.animation_data_create()
        a = bpy.data.actions.new(clip_name + "_" + name)
        a.use_fake_user = True
        o.animation_data.action = a
        acts[name] = a
    for f in frames:
        reset_pose()
        u = f / float(frames[-1])
        pose_clip(clip_name, u)
        for name, o in CTL.items():
            o.keyframe_insert(data_path="location", frame=f)
            o.keyframe_insert(data_path="rotation_euler", frame=f)
            o.keyframe_insert(data_path="scale", frame=f)
    return acts


ACTS = {
    'walk': key_clip('walk', list(range(0, 25))),
    'sprint': key_clip('sprint', list(range(0, 18))),
    'reload': key_clip('reload', list(range(0, 25))),
}


def assign(acts):
    for name, a in acts.items():
        CTL[name].animation_data.action = a


def sampled(acts, n, specs, end):
    assign(acts)
    frames = [round(i * end / (n - 1)) for i in range(n)]
    data = {}
    for outname, (obj, attr, idx, base) in specs.items():
        arr = []
        for f in frames:
            bpy.context.scene.frame_set(f)
            u = f / float(end)
            v = getattr(obj, attr)[idx]
            if base is not None:
                v -= base
            arr.append([round(u, 4), round(float(v), 5)])
        data[outname] = arr
    return data


walk_data = sampled(ACTS['walk'], 13, {
    'headYaw': (head, 'rotation_euler', 2, None),
    'headPitch': (head, 'rotation_euler', 0, None),
    'headX': (head, 'location', 0, None),
    'headY': (head, 'location', 2, 0.388),
}, 24)
sprint_data = sampled(ACTS['sprint'], 9, {
    'headYaw': (head, 'rotation_euler', 2, None),
    'headPitch': (head, 'rotation_euler', 0, None),
    'headX': (head, 'location', 0, None),
    'headY': (head, 'location', 2, 0.388),
    'lean': (hips, 'rotation_euler', 0, None),
    'gunYaw': (gun, 'rotation_euler', 2, None),
    'gunPitch': (gun, 'rotation_euler', 0, None),
    'gunY': (gun, 'location', 2, 0.27),
}, 17)
reload_data = sampled(ACTS['reload'], 17, {
    'gunYaw': (gun, 'rotation_euler', 2, None),
    'gunPitch': (gun, 'rotation_euler', 0, None),
    'gunY': (gun, 'location', 2, 0.27),
    'gunX': (gun, 'location', 0, 0.10),
    'gunZ': (gun, 'location', 1, -0.18),
    'magY': (mag, 'location', 2, -0.15),
    'magScale': (mag, 'scale', 0, None),
}, 24)

out = {
    'source': 'Blender MCP action export',
    'blender': bpy.app.version_string,
    'fps': 24,
    'clips': {
        'walk': {'duration': 1.0, 'loop': True, **walk_data},
        'sprint': {'duration': 0.72, 'loop': True, **sprint_data},
        'reload': {'duration': 1.0, 'loop': False, **reload_data},
    }
}
js = "/* Generated by Blender MCP from assets/anim/eofata_actions.blend. Do not hand-edit. */\n"
js += "'use strict';\n\nconst ANIMDATA = " + json.dumps(out, ensure_ascii=False, indent=2) + ";\n"
with open(os.path.join(ROOT, 'js', 'animdata.js'), 'w', encoding='utf-8') as f:
    f.write(js)

assign(ACTS['walk'])
scene.frame_set(6)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ANIMDIR, 'eofata_actions.blend'), copy=True)
print('NAMES', [o.name for o in CTL.values()])
print('SAVED', os.path.join(ANIMDIR, 'eofata_actions.blend'))
print('ANIMDATA', os.path.join(ROOT, 'js', 'animdata.js'))
