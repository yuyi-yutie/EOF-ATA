# Blender 5.3 character builder for EOFATA box characters.
# Run inside Blender (Blender MCP execute_blender_code):
#   exec(open(r"...\assets\chars\build_characters.py").read())
# Writes js/charmodels.js and renders preview images into assets/chars/.
#
# Conventions match js/models.js: X = right, Y = up, Z = forward; origin at feet.
# All geometry is authored BEFORE the game's 0.78 vertical squash, then exported
# already squashed so js/models.js can use it directly.

import bpy, os, json, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # dev_web3d
YS = 0.78

with open(os.path.join(HERE, 'base_units.json'), 'r', encoding='utf-8') as f:
    BASE = json.load(f)


# ---------------------------------------------------------------- part helpers
def part(x, y, z, sx, sy, sz, col, **kw):
    p = {'x': x, 'y': y, 'z': z, 'sx': sx, 'sy': sy, 'sz': sz, 'color': list(col)}
    p.update(kw)
    return p


def dark(col, k=0.78):
    return [min(1.0, c * k) for c in col]


# ---------------------------------------------------------------- base restore
# base_units.json is already squashed; restore authoring space for patching.
for key, unit in BASE.items():
    for p in unit['parts']:
        p['y'] = p['y'] / YS
        p['sy'] = p['sy'] / YS
        p.pop('grp', None)
        p.pop('hips', None)
    unit['height'] = unit['height'] / YS
    unit['eye'] = unit['eye'] / YS
    unit.pop('hips', None)


def remove_parts(unit, pred):
    unit['parts'] = [p for p in unit['parts'] if not pred(p)]


# ---------------------------------------------------------------- 修缮旧模型
# 1) 去掉袖口 / 手套 / “手” 方块。
remove_parts(BASE['raider'], lambda p: abs(p['x']) > 0.30 and 0.65 <= p['y'] <= 0.76)
remove_parts(BASE['scav'], lambda p: abs(p['x']) > 0.25 and 0.64 <= p['y'] <= 0.76)
remove_parts(BASE['veteran'], lambda p: abs(p['x']) > 0.25 and 0.64 <= p['y'] <= 0.76)

# 2) 人物不再有手臂 / 肩甲：所有身体两侧的凸出部件在导出前统一剔除。
def strip_side_limbs(unit):
    unit['parts'] = [
        p for p in unit['parts']
        if p.get('castOnly') or p.get('leg')
        or not (abs(p['x']) >= 0.26 and 0.56 < p['y'] < 1.30)
    ]


# ---------------------------------------------------------------- new units
def cast_shadow(u):
    u['parts'].append(part(0, 0.30, 0, 0.60, 0.60, 0.58, [0.05, 0.055, 0.06],
                           castOnly=True))


def base_body(parts, suit, suitL, suitD, torso_w=0.48, leg_w=0.18, leg_col=None,
              boot_col=None):
    leg_col = leg_col or suitD
    boot_col = boot_col or suitD
    parts.append(part(-0.115, 0.29, 0, leg_w, 0.58, 0.21, leg_col, leg='L'))
    parts.append(part(0.115, 0.29, 0, leg_w, 0.58, 0.21, leg_col, leg='R'))
    parts.append(part(-0.115, 0.055, 0.015, leg_w + 0.02, 0.11, 0.28, boot_col))
    parts.append(part(0.115, 0.055, 0.015, leg_w + 0.02, 0.11, 0.28, boot_col))
    parts.append(part(-0.115, 0.012, 0.02, leg_w + 0.03, 0.025, 0.30,
                      [0.05, 0.05, 0.055], outline=0))
    parts.append(part(0.115, 0.012, 0.02, leg_w + 0.03, 0.025, 0.30,
                      [0.05, 0.05, 0.055], outline=0))
    parts.append(part(0, 0.61, 0, torso_w + 0.04, 0.08, 0.36, [0.10, 0.11, 0.12]))
    parts.append(part(0, 0.86, 0, torso_w, 0.48, 0.34, suit))
    parts.append(part(0, 1.10, 0, 0.16, 0.08, 0.16, suitD, outline=0))
    parts.append(part(0, 1.38, 0, 0.50, 0.50, 0.44, suitD))
    parts.append(part(0, 1.68, 0, 0.58, 0.17, 0.50, suitL))
    parts.append(part(0, 1.555, 0.245, 0.52, 0.06, 0.10, suitL))


def tactical_body(parts, suit, suitL, suitD, vest, accent, torso_w=0.48):
    base_body(parts, suit, suitL, suitD, torso_w)
    # 战术背心 / 胸挂
    parts.append(part(0, 0.88, 0.172, torso_w - 0.10, 0.34, 0.04, vest))
    parts.append(part(0, 0.86, -0.172, torso_w - 0.10, 0.32, 0.04, vest))
    for i in range(-1, 2):
        parts.append(part(i * 0.10, 0.79, 0.205, 0.085, 0.10, 0.055, [0.35, 0.33, 0.26]))
        parts.append(part(i * 0.10, 0.832, 0.232, 0.07, 0.02, 0.015, [0.08, 0.08, 0.09], outline=0))
    # 背包 / 电台 / 发光小灯
    parts.append(part(0, 0.90, -0.235, 0.36, 0.34, 0.14, suitD))
    parts.append(part(0.19, 0.95, -0.18, 0.09, 0.20, 0.07, suitD))
    parts.append(part(0.20, 1.06, -0.185, 0.018, 0.16, 0.018, suitD))
    parts.append(part(0.20, 1.145, -0.185, 0.05, 0.04, 0.02, accent, outline=0, emis=True))
    parts.append(part(0, 0.90, 0.196, 0.04, 0.06, 0.02, accent, outline=0, emis=True))
    # 膝垫 / 大腿挂包
    for side in (-1, 1):
        parts.append(part(side * 0.115, 0.43, 0.108, 0.185, 0.14, 0.05, suitL))
    parts.append(part(0.245, 0.62, 0.11, 0.10, 0.15, 0.09, [0.35, 0.33, 0.26]))


def long_visor(parts, accent, housing, y=1.44, z=0.245, w=0.44, h=0.045):
    parts.append(part(0, y, z, w + 0.10, 0.12, 0.055, housing, outline=0))
    parts.append(part(0, y, z + 0.045, w, h, 0.018, accent, outline=0, emis=True))


def specter():
    parts = []
    S = [0.105, 0.125, 0.165]; SL = [0.175, 0.205, 0.265]; SD = [0.045, 0.055, 0.080]
    MET = [0.27, 0.31, 0.36]; CY = [0.38, 0.92, 0.98]
    tactical_body(parts, S, SL, SD, [0.14, 0.165, 0.205], CY)
    long_visor(parts, CY, SD)
    # 长条目镜两侧的黑色端盖
    parts.append(part(-0.245, 1.44, 0.262, 0.055, 0.10, 0.035, SD, outline=0))
    parts.append(part(0.245, 1.44, 0.262, 0.055, 0.10, 0.035, SD, outline=0))
    # 头盔侧板 / 天线
    for side in (-1, 1):
        parts.append(part(side * 0.29, 1.48, 0, 0.075, 0.20, 0.24, SD))
    parts.append(part(0.25, 1.78, -0.02, 0.018, 0.22, 0.018, MET, outline=0))
    parts.append(part(0.25, 1.89, -0.02, 0.03, 0.03, 0.03, CY, outline=0, emis=True))
    cast_shadow({'parts': parts})
    return {'parts': parts, 'height': 1.80, 'eye': 1.45,
            'style': {'cadence': 8.8, 'swing': 0.48, 'bob': 0.050, 'lean': 0.09}}


def ranger():
    parts = []
    O = [0.30, 0.34, 0.23]; OL = [0.41, 0.45, 0.31]; OD = [0.18, 0.20, 0.14]
    TAN = [0.50, 0.45, 0.32]; AMB = [0.98, 0.70, 0.26]
    tactical_body(parts, O, OL, OD, [0.38, 0.35, 0.25], AMB)
    long_visor(parts, AMB, OD, w=0.42)
    # 兜帽 / 头盔罩
    parts.append(part(0, 1.60, -0.06, 0.60, 0.22, 0.50, O))
    parts.append(part(0, 1.70, 0.08, 0.46, 0.06, 0.30, OL))
    # 右肩斜挎带
    parts.append(part(0.13, 0.99, 0.198, 0.045, 0.26, 0.02, TAN))
    # 轻装护腿
    for side in (-1, 1):
        parts.append(part(side * 0.115, 0.53, 0.105, 0.15, 0.16, 0.035, OD, outline=0))
    cast_shadow({'parts': parts})
    return {'parts': parts, 'height': 1.79, 'eye': 1.45,
            'style': {'cadence': 9.1, 'swing': 0.50, 'bob': 0.047, 'lean': 0.08}}


def breacher():
    parts = []
    C = [0.20, 0.21, 0.22]; CL = [0.31, 0.32, 0.33]; CD = [0.09, 0.10, 0.11]
    ORG = [0.93, 0.45, 0.20]; TAN = [0.42, 0.38, 0.29]
    tactical_body(parts, C, CL, CD, [0.30, 0.30, 0.29], ORG, torso_w=0.52)
    long_visor(parts, ORG, CD, w=0.46)
    # 重型胸甲 / 肩盾
    parts.append(part(0, 0.90, 0.198, 0.46, 0.30, 0.05, CL))
    parts.append(part(0, 0.775, 0.225, 0.34, 0.06, 0.025, ORG, outline=0, emis=True))
    # 破障背包 / 破门工具
    parts.append(part(0, 0.92, -0.26, 0.42, 0.38, 0.18, CD))
    parts.append(part(-0.16, 0.94, -0.37, 0.10, 0.30, 0.06, CL))
    parts.append(part(0.16, 0.94, -0.37, 0.10, 0.30, 0.06, CL))
    parts.append(part(0, 0.74, 0.18, 0.16, 0.10, 0.10, TAN))
    for side in (-1, 1):
        parts.append(part(side * 0.14, 0.43, 0.112, 0.19, 0.15, 0.05, CL))
    cast_shadow({'parts': parts})
    return {'parts': parts, 'height': 1.83, 'eye': 1.47,
            'style': {'cadence': 7.8, 'swing': 0.43, 'bob': 0.060, 'lean': 0.11}}


def power_base(parts, suit, suitL, suitD, accent, torso_w=0.60, height=1.98):
    # 粗腿 / 厚重靴 / 护膝 / 髋甲
    for side in (-1, 1):
        parts.append(part(side * 0.155, 0.33, 0, 0.24, 0.62, 0.26, suitD, leg=('L' if side < 0 else 'R')))
        parts.append(part(side * 0.155, 0.065, 0.015, 0.26, 0.13, 0.32, suitD))
        parts.append(part(side * 0.155, 0.44, 0.13, 0.25, 0.17, 0.06, suitL))
        parts.append(part(side * 0.155, 0.30, 0.128, 0.11, 0.20, 0.03, suitD, outline=0))
        parts.append(part(side * 0.27, 0.60, 0, 0.14, 0.20, 0.30, suitL))
    parts.append(part(0, 0.63, 0, torso_w + 0.06, 0.10, 0.40, suitD))
    # 躯干 / 胸甲 / 反应堆
    parts.append(part(0, 0.94, 0, torso_w, 0.50, 0.40, suit))
    parts.append(part(0, 0.96, 0.215, torso_w - 0.08, 0.34, 0.055, suitL))
    parts.append(part(0, 1.06, 0.245, torso_w - 0.20, 0.05, 0.02, accent, outline=0, emis=True))
    parts.append(part(0, 0.87, 0.246, 0.10, 0.10, 0.02, accent, outline=0, emis=True))
    # 头 / 头盔 / 长条目镜
    parts.append(part(0, 1.18, 0, 0.18, 0.08, 0.18, suitD, outline=0))
    parts.append(part(0, 1.46, 0, 0.34, 0.34, 0.34, suitD))
    parts.append(part(0, 1.54, 0, 0.44, 0.30, 0.40, suitL))
    parts.append(part(0, 1.50, 0.212, 0.30, 0.045, 0.02, accent, outline=0, emis=True))
    parts.append(part(0, 1.40, 0.19, 0.24, 0.06, 0.02, suitD, outline=0))
    # 背包 / 散热口
    parts.append(part(0, 0.98, -0.30, 0.46, 0.40, 0.22, suitD))
    parts.append(part(0, 1.10, -0.42, 0.30, 0.10, 0.03, accent, outline=0, emis=True))
    parts.append(part(0, 0.86, -0.42, 0.30, 0.05, 0.03, suitD, outline=0))
    parts.append(part(0, 0.30, 0, 0.70, 0.62, 0.68, [0.05, 0.055, 0.06], castOnly=True))
    return {'parts': parts, 'height': height, 'eye': 1.50}


def juggernaut():
    m = power_base([], [0.30, 0.31, 0.33], [0.42, 0.43, 0.45], [0.13, 0.14, 0.15],
                   [0.95, 0.38, 0.16], 0.64, 2.02)
    parts = m['parts']
    # 排气烟囱 / 肩部铆钉 / 面罩罩框
    parts.append(part(-0.10, 1.30, -0.30, 0.10, 0.26, 0.10, [0.09, 0.10, 0.11]))
    parts.append(part(0.10, 1.30, -0.30, 0.10, 0.26, 0.10, [0.09, 0.10, 0.11]))
    parts.append(part(0, 1.50, 0.224, 0.36, 0.14, 0.04, [0.09, 0.10, 0.11], outline=0))
    m['style'] = {'cadence': 6.5, 'swing': 0.36, 'bob': 0.075, 'lean': 0.14}
    return m


def vanguard():
    m = power_base([], [0.56, 0.58, 0.60], [0.74, 0.77, 0.80], [0.24, 0.26, 0.28],
                   [0.36, 0.86, 0.96], 0.56, 1.96)
    parts = m['parts']
    # 白色装甲上的青色导流条
    for side in (-1, 1):
        parts.append(part(side * 0.22, 0.94, 0.246, 0.035, 0.26, 0.02,
                          [0.36, 0.86, 0.96], outline=0, emis=True))
    # 推进背包喷口
    parts.append(part(-0.16, 1.08, -0.44, 0.12, 0.10, 0.04, [0.36, 0.86, 0.96], outline=0, emis=True))
    parts.append(part(0.16, 1.08, -0.44, 0.12, 0.10, 0.04, [0.36, 0.86, 0.96], outline=0, emis=True))
    m['style'] = {'cadence': 7.2, 'swing': 0.41, 'bob': 0.065, 'lean': 0.12}
    return m


def sentinel():
    m = power_base([], [0.22, 0.26, 0.20], [0.32, 0.37, 0.28], [0.10, 0.12, 0.09],
                   [0.98, 0.66, 0.20], 0.62, 1.99)
    parts = m['parts']
    # 面罩
    parts.append(part(0, 1.50, 0.218, 0.34, 0.05, 0.02,
                      [0.98, 0.66, 0.20], outline=0, emis=True))
    m['style'] = {'cadence': 6.9, 'swing': 0.39, 'bob': 0.070, 'lean': 0.13}
    return m


BASE['specter'] = specter()
BASE['ranger'] = ranger()
BASE['breacher'] = breacher()
BASE['juggernaut'] = juggernaut()
BASE['vanguard'] = vanguard()
BASE['sentinel'] = sentinel()

# ---------------------------------------------------------------- finalize
def classify_group(p):
    """按部位语义绑定骨骼组，而不是只看高度。
    head: 头 / 头盔 / 面部 / 头戴天线
    body: 躯干 / 背包 / 胸挂 / 腰包
    legL / legR: 腿 / 靴 / 膝甲 / 护胫
    """
    x, y, z = p['x'], p['y'], p['z']
    if p.get('leg'):
        return 'legL' if p['leg'] == 'L' else 'legR'
    # 髋线以下的护腿 / 靴子：按左右分给对应腿
    if (y < 0.56 and abs(x) >= 0.05 and p['sx'] < 0.30
            and not (z < -0.10 and y > 0.42)):
        p['leg'] = 'L' if x < 0 else 'R'
        return 'legL' if x < 0 else 'legR'
    head = y > 1.05
    if head:
        # 背包 / 排气 / 后部电台：跟随躯干
        if z <= -0.24:
            head = False
        elif z < -0.10 and abs(x) >= 0.15 and y < 1.25:
            head = False
        # 胸灯带 / 领口 / 围巾等低位正面部件：跟随躯干
        elif z > 0.10 and y < 1.18:
            head = False
    return 'head' if head else 'body'


FINAL = {}
for key, unit in BASE.items():
    strip_side_limbs(unit)
    parts = unit['parts']
    for p in parts:
        if p.get('castOnly'):
            p['grp'] = None
        else:
            p['grp'] = classify_group(p)
        p['hips'] = (not p.get('leg') and not p.get('castOnly')
                     and 0.55 < p['y'] < 0.68)
        p['y'] = round(p['y'] * YS, 4)
        p['sy'] = round(p['sy'] * YS, 4)
        for k in ('x', 'z', 'sx', 'sz'):
            p[k] = round(p[k], 4)
        p['color'] = [round(c, 4) for c in p['color']]
        if p.get('outline') == 0:
            p['outline'] = 0
        else:
            p.pop('outline', None)
        if not p.get('emis'):
            p.pop('emis', None)
        if not p.get('castOnly'):
            p.pop('castOnly', None)
        if not p.get('leg'):
            p.pop('leg', None)
        if p['hips'] is False:
            p.pop('hips', None)
    FINAL[key] = {
        'squashed': True,
        'height': round(unit['height'] * YS, 4),
        'eye': round(unit['eye'] * YS, 4),
        'hips': round(0.60 * YS, 4),
        'style': unit['style'],
        'parts': parts,
    }

js = ("/* Generated by Blender MCP from assets/chars/build_characters.py. "
      "Do not hand-edit. */\n")
js += "'use strict';\n\nconst CHARMODELS = "
js += json.dumps(FINAL, ensure_ascii=False, separators=(',', ':'))
js += ";\n"
with open(os.path.join(ROOT, 'js', 'charmodels.js'), 'w', encoding='utf-8') as f:
    f.write(js)


# ---------------------------------------------------------------- Blender preview
def cleanup():
    for s in list(bpy.data.scenes):
        if s.name.startswith('EOFATA_Chars'):
            bpy.data.scenes.remove(s)
    for o in list(bpy.data.objects):
        if o.name.startswith('EC_'):
            bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.materials):
        if m.name.startswith('ECM_'):
            bpy.data.materials.remove(m)


cleanup()
scene = bpy.data.scenes.new('EOFATA_Chars')
bpy.context.window.scene = scene
if not scene.world:
    scene.world = bpy.data.worlds.new('EOFATA_CharsWorld')
scene.render.fps = 24
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1800
scene.render.resolution_y = 760
scene.render.film_transparent = False
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes.get('Background')
if bg:
    bg.inputs[0].default_value = (0.035, 0.045, 0.055, 1)
    bg.inputs[1].default_value = 0.6

MATS = {}


def mat_for(col, emis=False):
    k = (round(col[0], 3), round(col[1], 3), round(col[2], 3), emis)
    if k in MATS:
        return MATS[k]
    m = bpy.data.materials.new('ECM_%02d%02d%02d%s' % (
        int(col[0] * 255), int(col[1] * 255), int(col[2] * 255), 'e' if emis else ''))
    m.use_nodes = True
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b:
        b.inputs['Base Color'].default_value = (col[0], col[1], col[2], 1)
        b.inputs['Roughness'].default_value = 0.62
        b.inputs['Metallic'].default_value = 0.15
        if emis:
            b.inputs['Emission Color'].default_value = (col[0], col[1], col[2], 1)
            b.inputs['Emission Strength'].default_value = 1.4
    m.diffuse_color = (col[0], col[1], col[2], 1)
    MATS[k] = m
    return m


def build_unit(key, xoff):
    u = FINAL[key]
    for i, p in enumerate(u['parts']):
        if p.get('castOnly'):
            continue
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
        o = bpy.context.object
        o.name = 'EC_%s_%03d' % (key, i)
        o.data.materials.append(mat_for(p['color'], p.get('emis')))
        o.location = (xoff + p['x'], -p['z'], p['y'])
        o.scale = (p['sx'], p['sz'], p['sy'])
        o.display_type = 'SOLID'


def place_row(keys, gap):
    widths = [max((p['sx'] for p in FINAL[k]['parts']), default=0.6) for k in keys]
    total = sum(max(0.85, w) for w in widths) + gap * (len(keys) - 1)
    x = -total * 0.5
    centers = []
    for k, w in zip(keys, widths):
        xoff = x + max(0.85, w) * 0.5
        build_unit(k, xoff)
        centers.append(xoff)
        x += max(0.85, w) + gap
    return total, centers


def add_ground(width):
    bpy.ops.mesh.primitive_plane_add(size=max(30, width + 8), location=(0, 0, -0.005))
    g = bpy.context.object
    g.name = 'EC_Ground'
    g.data.materials.append(mat_for([0.07, 0.08, 0.09]))


def add_lights():
    sun_d = bpy.data.lights.new('EC_Sun', 'SUN')
    sun_d.energy = 3.2
    sun = bpy.data.objects.new('EC_Sun', sun_d)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(58), 0, math.radians(-38))
    area_d = bpy.data.lights.new('EC_Fill', 'AREA')
    area_d.energy = 500
    area_d.size = 8
    fill = bpy.data.objects.new('EC_Fill', area_d)
    scene.collection.objects.link(fill)
    fill.location = (-4, -5, 5)
    fill.rotation_euler = (math.radians(52), 0, math.radians(-120))


def render_row(keys, path, distance=7.0, gap=0.22):
    cleanup_objects = [o for o in bpy.data.objects if o.name.startswith('EC_')]
    for o in cleanup_objects:
        bpy.data.objects.remove(o, do_unlink=True)
    width, centers = place_row(keys, gap)
    add_ground(width)
    add_lights()
    cam_d = bpy.data.cameras.new('EC_Cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = width + 0.9
    cam = bpy.data.objects.new('EC_Cam', cam_d)
    scene.collection.objects.link(cam)
    cam.location = (0, -distance, 0.95)
    target = Vector((0, 0, 0.95))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('RENDER', path, 'units', len(keys), 'width', round(width, 2))


render_row(['scout', 'assault', 'tactical', 'scav', 'raider', 'veteran', 'zombie',
            'spitter', 'gaunt'], os.path.join(HERE, 'preview_existing.png'), 6.6, 0.18)
render_row(['specter', 'ranger', 'breacher'], os.path.join(HERE, 'preview_tactical.png'), 4.4, 0.35)
render_row(['juggernaut', 'vanguard', 'sentinel'], os.path.join(HERE, 'preview_power.png'), 4.8, 0.35)


def save_reference():
    for o in list(bpy.data.objects):
        if o.name.startswith('EC_'):
            bpy.data.objects.remove(o, do_unlink=True)
    keys = ['scout', 'assault', 'tactical', 'scav', 'raider', 'veteran', 'zombie',
            'spitter', 'gaunt', 'specter', 'ranger', 'breacher', 'juggernaut',
            'vanguard', 'sentinel']
    widths = [max(0.85, max((p['sx'] for p in FINAL[k]['parts']), default=0.6)) for k in keys]
    total = sum(widths) + 0.28 * (len(keys) - 1)
    cx = -total * 0.5
    for k, w in zip(keys, widths):
        build_unit(k, cx + w * 0.5)
        cx += w + 0.28
    add_ground(total)
    add_lights()
    cam_d = bpy.data.cameras.new('EC_Cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = total + 0.9
    cam = bpy.data.objects.new('EC_Cam', cam_d)
    scene.collection.objects.link(cam)
    cam.location = (0, -9, 0.95)
    cam.rotation_euler = (Vector((0, 0, 0.85)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'eofata_chars.blend'), copy=True)
    print('SAVED', os.path.join(HERE, 'eofata_chars.blend'))


save_reference()

print('UNITS', list(FINAL.keys()))
print('CHARMODELS', os.path.join(ROOT, 'js', 'charmodels.js'))
print('SIZES', {k: (len(v['parts']), v['height'], v['eye']) for k, v in FINAL.items()})
