"""制作六位选手的身体网格，沿用比赛骨架的顶点编号和蒙皮权重。"""

import base64
import json
import math
import struct
from pathlib import Path


# 依次为胸、背、腰、肩围、上臂、前臂、髋、腿、鞋楦的调整量。
PROFILES = {
    "fan": (.14, .12, .06, .08, .15, .11, .09, .09, .02),
    "ma": (.04, .06, -.05, .03, .06, .04, -.03, .02, .01),
    "wang": (.05, .08, -.07, .02, .03, .05, -.035, .015, .015),
    "harimoto": (-.01, .02, -.08, -.025, .035, -.01, -.065, -.02, -.01),
    "sun": (-.035, -.035, -.10, -.065, -.08, -.09, .06, -.09, -.035),
    "ovtcharov": (.14, .16, -.03, .08, .12, .09, .02, .11, .035),
}
ROOT = Path(__file__).resolve().parents[1]


def asset():
    source = (ROOT / "render" / "athlete-mesh.js").read_text("utf-8")
    mesh = json.JSONDecoder().raw_decode(source.split("window.PP_ATHLETE_MESH = ", 1)[1])[0]
    add_shoes(mesh)
    return mesh


def decode(data, code):
    return tuple(value[0] for value in struct.iter_unpack("<" + code, base64.b64decode(data)))


def encode(values, code):
    return base64.b64encode(struct.pack(f"<{len(values)}{code}", *values)).decode("ascii")


def add_shoes(mesh):
    positions = list(decode(mesh["pos"], "f"))
    joints = list(decode(mesh["joints"], "B"))
    weights = list(decode(mesh["weights"], "B"))
    regions = list(decode(mesh["regions"], "B"))
    shade = list(decode(mesh["shade"], "B"))
    old_triangles = decode(mesh["index"], "H")
    index = []
    for j in range(0, len(old_triangles), 3):
        triangle = old_triangles[j:j+3]
        if sum(positions[i*3+1] for i in triangle) / 3 > .079:
            index.extend(triangle)
    # 从后跟、足弓到前掌重新做鞋楦，脚趾几何藏在鞋面内。
    rails = [(-.081,.010,.054),(-.069,.040,.095),(-.046,.050,.103),
             (-.010,.051,.118),(.028,.051,.122),(.063,.054,.110),
             (.101,.058,.090),(.135,.060,.074),(.167,.057,.059),
             (.194,.050,.050),(.218,.033,.047),(.228,.006,.033)]
    sides = 32
    for bone, side in [(6, -1), (12, 1)]:
        ankle = mesh["bind"][bone][0]
        start = len(regions)
        for j, (z, width, top) in enumerate(rails):
            for k in range(sides):
                angle = k * math.tau / sides
                upper = math.sin(angle)
                x = ankle[0] + side * z * .035 + width * math.cos(angle)
                height = .025 + (top - .025) * max(0, upper)**.68 + .019 * min(0, upper)
                positions.extend((x, height, z + ankle[2]))
                joints.extend((bone, 0, 0, 0))
                weights.extend((255, 0, 0, 0))
                regions.append(4)
                shade.append(236 if upper > 0 else 220)
                if j:
                    a = start + (j-1)*sides + k
                    b = start + (j-1)*sides + (k+1) % sides
                    index.extend((a, b, b+sides, a, b+sides, a+sides))
        last = start + (len(rails)-1)*sides
        for k in range(1, sides-1):
            index.extend((start, start+k+1, start+k, last, last+k, last+k+1))
    for key, values, code in [
        ("pos", positions, "f"), ("joints", joints, "B"), ("weights", weights, "B"),
        ("regions", regions, "B"), ("shade", shade, "B"), ("index", index, "H"),
    ]:
        mesh[key] = encode(values, code)


def smooth(a, b, x):
    v = max(0.0, min(1.0, (x - a) / (b - a)))
    return v * v * (3 - 2 * v)


def bell(x, center, radius):
    return math.exp(-((x - center) / radius) ** 2)


def axis_point(point, a, b):
    line = tuple(end - start for start, end in zip(a, b))
    distance = sum((p - start) * d for p, start, d in zip(point, a, line))
    t = distance / sum(d * d for d in line)
    return t, tuple(start + t * d for start, d in zip(a, line))


def sculpt(mesh, key):
    chest, back, waist, shoulder, upper, fore, seat, leg, shoe = PROFILES[key]
    xyz = decode(mesh["pos"], "f")
    joints = decode(mesh["joints"], "B")
    weights = decode(mesh["weights"], "B")
    regions = decode(mesh["regions"], "B")
    points = []
    for i, region in enumerate(regions):
        point = x, y, z = xyz[i * 3:i * 3 + 3]
        side = 1 if x < 0 else 7
        bind = mesh["bind"]
        arm_t, arm_axis = axis_point(point, *bind[side])
        fore_t, fore_axis = axis_point(point, *bind[side + 1])
        influences = dict(zip(joints[i * 4:i * 4 + 4], weights[i * 4:i * 4 + 4]))
        if influences.get(side + 2, 0) > 0 or (fore_t > .72 and abs(x) > .36 and y > .78):
            points.extend(point)
            continue

        if region == 1:
            torso = 1 - smooth(.16, .30, abs(x))
            collar = 1 - smooth(1.369, 1.418, y)
            ribs = bell(y, 1.244, .126)
            lower = bell(y, 1.023, .128)
            body_volume = (chest if z > 0 else back) * ribs + waist * lower
            x *= 1 + torso * collar * (waist * lower + shoulder * bell(y, 1.30, .055))
            z *= 1 + torso * collar * body_volume
            # 袖口翻边、肩缝和腰侧褶皱都直接塑在球衣表面。
            cuff = bell(arm_t, .49, .048) * smooth(.186, .235, abs(x))
            deltoid = bell(arm_t, .25, .24) * smooth(.155, .26, abs(x))
            arm_round = .065 * cuff + upper * deltoid
            side_fold = smooth(.075, .155, abs(x)) * bell(y, 1.012, .11)
            folds = math.sin((y - 1.05) * 115 + abs(x) * 27) * side_fold
            x += (x - arm_axis[0]) * arm_round
            z += (z - arm_axis[2]) * arm_round + math.copysign(1, z) * folds * .0028 * torso
        elif region == 2:
            thigh_t, thigh_axis = axis_point(point, *bind[side + 3])
            fabric = smooth(.06, .43, thigh_t) * (1 - smooth(.59, .75, thigh_t))
            hem = bell(y, .652, .018)
            rise = bell(y, .854, .103)
            fold = math.sin(thigh_t * 19 + abs(x) * 25) * fabric * .024
            width = .10 * fabric + .09 * hem + fold
            x = thigh_axis[0] + (x - thigh_axis[0]) * (1 + width) + x * seat * rise
            z = thigh_axis[2] + (z - thigh_axis[2]) * (1 + width + seat * rise * .75)
        elif region == 0 and abs(x) > .22 and y > .80:
            arm_round = (fore * bell(fore_t, .31, .27) + upper * .3 * bell(arm_t, .76, .19))
            arm_round *= 1 - smooth(.47, .72, fore_t)
            x += (x - fore_axis[0]) * arm_round
            z += (z - fore_axis[2]) * arm_round
        elif region == 0 and .16 < y < .64:
            _, calf_axis = axis_point(point, *bind[side + 4])
            calf = leg * bell(y, .327, .137)
            x += (x - calf_axis[0]) * calf
            z += (z - calf_axis[2]) * calf * 1.16
        elif region == 4:
            # 鞋楦横截面、前脚掌和鞋底轮廓与脚踝分开调整。
            ankle = bind[side + 5][0]
            outsole = 1 - smooth(.018, .034, y)
            forefoot = smooth(.044, .146, z)
            x += (x - ankle[0]) * (shoe + .10 * forefoot + .12 * outsole) * (1 - smooth(.048, .075, y))
            z += max(0, z - .055) * (.075 + shoe) * forefoot
            y -= min(.002, y) * outsole
        points.extend((x, y, z))
    return points


def main():
    mesh = asset()
    shapes = {}
    for key in PROFILES:
        points = sculpt(mesh, key)
        shapes[key] = encode(points, "f")
        print(key, len(points) // 3, "vertices")
    target = ROOT / "render" / "athlete-body-data.js"
    target.write_text("window.PP_ATHLETE_BODY_BIND = " + json.dumps(mesh, separators=(",", ":")) + ";\n"
                      "window.PP_ATHLETE_BODIES = " + json.dumps(shapes, indent=2) + ";\n", "utf-8")


if __name__ == "__main__":
    main()
