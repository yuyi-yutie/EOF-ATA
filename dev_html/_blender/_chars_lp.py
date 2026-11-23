# ---------------------------------------------------------------- 人物（极简低模）
# 规范：一个方块 = 头，一个方块 = 身体，两个方块 = 腿；不建手臂、不建手。
# 面部只用贴片（眼 / 嘴 / 面罩 / 牙），不加几何细节。
# 区分角色只靠：头身比例、头部大小、发型/头盔、服装色块、面部贴片。
def build_human_scout(name="CHR_Scout", coll="CHR"):
    """潜行者：瘦，深青夹克 + 毛线帽 + 小背包。"""
    M = dict(
        skin=cel_mat(PAL["skin"], rim=0.26),
        hair=cel_mat(PAL["hair"], rim=0.20),
        jacket=cel_mat(PAL["scout_jacket"], rim=0.28),
        vest=cel_mat(PAL["scout_vest"], rim=0.28),
        pants=cel_mat(PAL["scout_pants"], rim=0.22),
        dark=cel_mat("#20252D", rim=0.18),
        eye=cel_mat("#221E1B", rim=0.0),
    )
    o = OUTLINE["chr"]
    P = []
    # 头（裸露的脸）
    P.append(box(name + "_Head", (0.50, 0.44, 0.50), (0, -0.01, 1.40),
                 M["skin"], 0.0, 1, coll=coll, outline=o))
    # 毛线帽（盖住头顶）
    P.append(box(name + "_Cap", (0.54, 0.48, 0.16), (0, 0.005, 1.62),
                 M["hair"], 0.0, 1, coll=coll, outline=o))
    for s in (-1, 1):
        P.append(box(name + "_Eye%d" % s, (0.07, 0.02, 0.05), (s * 0.10, -0.235, 1.43),
                     M["eye"], 0.0, 1, coll=coll, outline=0))
    P.append(box(name + "_Mouth", (0.10, 0.02, 0.022), (0, -0.235, 1.31),
                 M["eye"], 0.0, 1, coll=coll, outline=0))
    # 脖子（一小截，避免头和身体断开）
    P.append(box(name + "_Neck", (0.16, 0.16, 0.08), (0, 0, 1.12),
                 M["skin"], 0.0, 1, coll=coll, outline=0))
    # 身体
    P.append(box(name + "_Torso", (0.42, 0.28, 0.46), (0, 0, 0.86),
                 M["jacket"], 0.0, 1, coll=coll, outline=o))
    P.append(box(name + "_Vest", (0.28, 0.02, 0.24), (0, -0.142, 0.88),
                 M["vest"], 0.0, 1, coll=coll, outline=0))
    P.append(box(name + "_Belt", (0.44, 0.30, 0.06), (0, 0, 0.63),
                 M["dark"], 0.0, 1, coll=coll, outline=0))
    P.append(box(name + "_Pack", (0.30, 0.15, 0.26), (0, 0.20, 0.90),
                 M["dark"], 0.0, 1, coll=coll, outline=o))
    # 腿
    for s in (-1, 1):
        P.append(box(name + "_Leg%d" % s, (0.16, 0.19, 0.60), (s * 0.10, 0, 0.30),
                     M["pants"], 0.0, 1, coll=coll, outline=o))
    return P


def build_human_assault(name="CHR_Assault", coll="CHR"):
    """突击手：壮，沙色战术服 + 头盔 + 胸挂。"""
    M = dict(
        skin=cel_mat(PAL["skin2"], rim=0.26),
        helmet=cel_mat(PAL["helmet"], rim=0.24),
        jacket=cel_mat(PAL["assault_jacket"], rim=0.26),
        vest=cel_mat(PAL["assault_vest"], rim=0.26),
        pants=cel_mat(PAL["assault_pants"], rim=0.22),
        dark=cel_mat("#2A2723", rim=0.18),
        eye=cel_mat("#221E1B", rim=0.0),
    )
    o = OUTLINE["chr"]
    P = []
    P.append(box(name + "_Head", (0.52, 0.46, 0.50), (0, -0.01, 1.40),
                 M["skin"], 0.0, 1, coll=coll, outline=o))
    # 头盔 + 帽檐
    P.append(box(name + "_Helmet", (0.58, 0.50, 0.20), (0, 0.005, 1.63),
                 M["helmet"], 0.0, 1, coll=coll, outline=o))
    P.append(box(name + "_Brim", (0.54, 0.10, 0.05), (0, -0.255, 1.545),
                 M["helmet"], 0.0, 1, coll=coll, outline=o))
    for s in (-1, 1):
        P.append(box(name + "_Eye%d" % s, (0.08, 0.02, 0.05), (s * 0.105, -0.235, 1.41),
                     M["eye"], 0.0, 1, coll=coll, outline=0))
    P.append(box(name + "_Mouth", (0.11, 0.02, 0.022), (0, -0.235, 1.29),
                 M["eye"], 0.0, 1, coll=coll, outline=0))
    P.append(box(name + "_Neck", (0.18, 0.18, 0.08), (0, 0, 1.12),
                 M["skin"], 0.0, 1, coll=coll, outline=0))
    # 身体（更宽）+ 胸挂 + 弹匣袋
    P.append(box(name + "_Torso", (0.50, 0.34, 0.48), (0, 0, 0.84),
                 M["jacket"], 0.0, 1, coll=coll, outline=o))
    P.append(box(name + "_Vest", (0.36, 0.03, 0.26), (0, -0.185, 0.87),
                 M["vest"], 0.0, 1, coll=coll, outline=0))
    for s in (-1, 1):
        P.append(box(name + "_Pouch%d" % s, (0.10, 0.05, 0.10), (s * 0.13, -0.19, 0.68),
                     M["dark"], 0.0, 1, coll=coll, outline=0))
    P.append(box(name + "_Belt", (0.52, 0.36, 0.06), (0, 0, 0.60),
                 M["dark"], 0.0, 1, coll=coll, outline=0))
    # 腿
    for s in (-1, 1):
        P.append(box(name + "_Leg%d" % s, (0.19, 0.21, 0.58), (s * 0.12, 0, 0.29),
                     M["pants"], 0.0, 1, coll=coll, outline=o))
    return P


def build_zombie(name="ENEMY_Zombie", coll="ENEMY"):
    """僵尸：大头低埋（驼背）、宽身、短腿 + 琥珀眼 + 牙。"""
    M = dict(
        skin=cel_mat(PAL["olive"], rim=0.30),
        mid=cel_mat(PAL["olive_m"], rim=0.25),
        dark=cel_mat(PAL["olive_d"], rim=0.2),
        ink=cel_mat("#1F2418", rim=0.0),
        eye=emis_mat("#F2C46B", 1.4),
        bone=cel_mat("#E4DCC4", rim=0.1),
    )
    o = OUTLINE["enemy"]
    P = []
    # 头：最大，压到肩膀上
    P.append(box(name + "_Head", (0.64, 0.52, 0.60), (0, -0.02, 1.40),
                 M["skin"], 0.0, 1, coll=coll, outline=o))
    for s in (-1, 1):
        P.append(box(name + "_Eye%d" % s, (0.12, 0.02, 0.085), (s * 0.135, -0.283, 1.46),
                     M["eye"], 0.0, 1, coll=coll, outline=0))
    P.append(box(name + "_Mouth", (0.28, 0.02, 0.09), (0.01, -0.283, 1.26),
                 M["ink"], 0.0, 1, coll=coll, outline=0))
    for i, tx in enumerate((-0.075, 0.005, 0.085)):
        P.append(box(name + "_Tooth%d" % i, (0.045, 0.02, 0.055), (tx, -0.288, 1.295),
                     M["bone"], 0.0, 1, coll=coll, outline=0))
    # 身体
    P.append(box(name + "_Torso", (0.50, 0.36, 0.50), (0, 0, 0.81),
                 M["mid"], 0.0, 1, coll=coll, outline=o))
    P.append(box(name + "_Belly", (0.26, 0.02, 0.26), (0, -0.182, 0.81),
                 M["skin"], 0.0, 1, coll=coll, outline=0))
    # 腿
    for s in (-1, 1):
        P.append(box(name + "_Leg%d" % s, (0.19, 0.22, 0.54), (s * 0.13, 0, 0.27),
                     M["dark"], 0.0, 1, coll=coll, outline=o))
    return P


def build_zombie_gaunt(name="ENEMY_Gaunt", coll="ENEMY"):
    """干尸：窄高头 + 凹陷眼窝 + 张开的颌，瘦长四肢，土黄尸体色。"""
    M = dict(
        skin=cel_mat(PAL["gaunt_skin"], rim=0.26),
        mid=cel_mat(PAL["gaunt_body"], rim=0.22),
        dark=cel_mat(PAL["gaunt_dark"], rim=0.2),
        ink=cel_mat("#1A1813", rim=0.0),
        eye=emis_mat("#E8A34A", 1.1),
        bone=cel_mat("#DDD6BE", rim=0.08),
    )
    o = OUTLINE["enemy"]
    P = []
    # 头：窄高
    P.append(box(name + "_Head", (0.50, 0.44, 0.62), (0, -0.02, 1.48),
                 M["skin"], 0.0, 1, coll=coll, outline=o))
    for s in (-1, 1):
        P.append(box(name + "_Socket%d" % s, (0.14, 0.02, 0.12), (s * 0.115, -0.238, 1.60),
                     M["ink"], 0.0, 1, coll=coll, outline=0))
        P.append(box(name + "_Eye%d" % s, (0.05, 0.02, 0.045), (s * 0.115, -0.244, 1.595),
                     M["eye"], 0.0, 1, coll=coll, outline=0))
    # 张开的颌 + 牙
    P.append(box(name + "_Jaw", (0.28, 0.02, 0.14), (0, -0.238, 1.28),
                 M["ink"], 0.0, 1, coll=coll, outline=0))
    for i, tx in enumerate((-0.085, -0.005, 0.075)):
        P.append(box(name + "_Tooth%d" % i, (0.042, 0.02, 0.06), (tx, -0.244, 1.325),
                     M["bone"], 0.0, 1, coll=coll, outline=0))
    # 身体：瘦，露肋
    P.append(box(name + "_Torso", (0.40, 0.30, 0.54), (0, 0, 0.87),
                 M["mid"], 0.0, 1, coll=coll, outline=o))
    P.append(box(name + "_Rib", (0.26, 0.02, 0.28), (0, -0.152, 0.92),
                 M["skin"], 0.0, 1, coll=coll, outline=0))
    for i, z in enumerate((1.00, 0.94, 0.88)):
        P.append(box(name + "_RibBar%d" % i, (0.22, 0.02, 0.03), (0, -0.158, z),
                     M["dark"], 0.0, 1, coll=coll, outline=0))
    # 腿：细长
    for s in (-1, 1):
        P.append(box(name + "_Leg%d" % s, (0.14, 0.17, 0.60), (s * 0.10, 0, 0.30),
                     M["dark"], 0.0, 1, coll=coll, outline=o))
    return P


def build_spitter(name="ENEMY_Spitter", coll="ENEMY"):
    """喷吐僵尸：窄高头 + 发光巨口、细长身体、长腿。"""
    M = dict(
        skin=cel_mat(PAL["blue"], rim=0.30),
        mid=cel_mat(PAL["blue_m"], rim=0.25),
        dark=cel_mat(PAL["blue_d"], rim=0.2),
        glow=emis_mat(PAL["violet"], 1.8),
    )
    o = OUTLINE["enemy"]
    P = []
    # 头：窄高
    P.append(box(name + "_Head", (0.48, 0.46, 0.60), (0, -0.02, 1.50),
                 M["skin"], 0.0, 1, coll=coll, outline=o))
    P.append(box(name + "_Maw", (0.30, 0.02, 0.17), (0, -0.252, 1.35),
                 M["glow"], 0.0, 1, coll=coll, outline=0))
    for s in (-1, 1):
        P.append(box(name + "_Eye%d" % s, (0.085, 0.02, 0.06), (s * 0.105, -0.252, 1.62),
                     M["glow"], 0.0, 1, coll=coll, outline=0))
    # 身体：窄
    P.append(box(name + "_Torso", (0.42, 0.30, 0.52), (0, 0, 0.92),
                 M["mid"], 0.0, 1, coll=coll, outline=o))
    P.append(box(name + "_Rib", (0.26, 0.02, 0.16), (0, -0.152, 0.96),
                 M["dark"], 0.0, 1, coll=coll, outline=0))
    # 腿：长
    for s in (-1, 1):
        P.append(box(name + "_Leg%d" % s, (0.15, 0.18, 0.62), (s * 0.115, 0, 0.31),
                     M["dark"], 0.0, 1, coll=coll, outline=o))
    return P


