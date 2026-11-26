"""为公开网页打包球员几何，并用原创程序纹理替换照片烘焙贴图。"""

import argparse
import io
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SIZE = 1024
# 分别标记两眼、唇线和肤色。坐标对应建模检查相机的正面投影。
PLAYERS = {
    "fan": ("樊振东", (203, 158, 133), (263, 240, 22, 7), (365, 240, 23, 7), (312, 345, 44)),
    "ma": ("马龙", (199, 151, 128), (265, 240, 23, 7), (364, 240, 23, 6), (314, 344, 45)),
    "wang": ("王楚钦", (205, 157, 139), (267, 240, 22, 7), (366, 240, 25, 7), (316, 345, 44)),
    "harimoto": ("张本智和", (205, 158, 132), (267, 239, 22, 7), (368, 240, 22, 7), (315, 342, 43)),
    "sun": ("孙颖莎", (214, 167, 140), (266, 240, 22, 7), (365, 239, 22, 7), (314, 345, 39)),
    "ovtcharov": ("奥恰洛夫", (211, 165, 145), (266, 240, 21, 8), (365, 240, 22, 8), (317, 344, 44)),
}


def smooth(low, high, value):
    t = np.clip((value - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def read_accessor(gltf, buffer, key, components):
    accessor = gltf["accessors"][key]
    view = gltf["bufferViews"][accessor["bufferView"]]
    dtype = np.dtype({5123: "<u2", 5125: "<u4", 5126: "<f4"}[accessor["componentType"]])
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", dtype.itemsize * components)
    return np.ndarray((accessor["count"], components), dtype=dtype, buffer=buffer,
                      offset=offset, strides=(stride, dtype.itemsize))


def surface_map(gltf, buffer):
    # 找到使用面部纹理的网格，把三维表面位置插值到 UV 像素。
    primitive = next(
        part for mesh in gltf["meshes"] for part in mesh["primitives"]
        if "baseColorTexture" in gltf["materials"][part["material"]]["pbrMetallicRoughness"]
    )
    points = read_accessor(gltf, buffer, primitive["attributes"]["POSITION"], 3)
    uv = read_accessor(gltf, buffer, primitive["attributes"]["TEXCOORD_0"], 2) * SIZE - .5
    indices = read_accessor(gltf, buffer, primitive["indices"], 1).reshape(-1, 3)
    surface = np.full((SIZE, SIZE, 3), np.nan, np.float32)
    for triangle in indices:
        p = uv[triangle]
        low = np.maximum(p.min(axis=0).astype(int) - 1, 0)
        high = np.minimum(p.max(axis=0).astype(int) + 2, SIZE)
        start, end = points[triangle][1:] - points[triangle][0]
        a, b = p[1:] - p[0]
        det = a[0] * b[1] - a[1] * b[0]
        if abs(det) < .001 or np.any(low >= high):
            continue
        y, x = np.ogrid[low[1]:high[1], low[0]:high[0]]
        u = ((x - p[0, 0]) * b[1] - (y - p[0, 1]) * b[0]) / det
        v = ((y - p[0, 1]) * a[0] - (x - p[0, 0]) * a[1]) / det
        valid = (u >= -.025) & (v >= -.025) & (u + v <= 1.025)
        target = surface[low[1]:high[1], low[0]:high[0]]
        target[valid] = points[triangle][0] + u[valid, None] * start + v[valid, None] * end
    return surface


def paint_surface(key, surface):
    _, skin, eye_a, eye_b, mouth = PLAYERS[key]
    valid = np.isfinite(surface[:, :, 0])
    x, y, z = surface[valid].T
    # 与 Blender 中用于检查面部比例的正面相机采用相同投影。
    px = 315 + x * (630 / 3.7)
    py = 315 - ((y + .12) * .99757 + (.13 - z) * .06972) * (630 / 3.7)
    front = smooth(.35, .66, z)
    random = np.random.default_rng(74 + list(PLAYERS).index(key))
    color = np.broadcast_to(np.array(skin, dtype=np.float32), (len(x), 3)).copy()

    def paint(rgb, alpha):
        color[:] += (np.asarray(rgb) - color) * np.clip(alpha, 0, 1)[:, None]

    noise = random.normal(0, 1.6, len(x))
    color += (noise + np.sin(x * 16 + y * 7) * np.sin(y * 19 - z * 51) * 1.4)[:, None]
    cheek = np.exp(-((np.abs(px - 315) - 70) / 38)**2 - ((py - 291) / 36)**2)
    paint((184, 117, 101), cheek * front * .23)
    ear = smooth(.65, .89, np.abs(x)) * np.exp(-((py - 286) / 63)**2)
    paint((190, 123, 103), ear * .38)
    if key == "ovtcharov":
        beard = smooth(304, 366, py) * (1 - smooth(418, 450, py)) * front
        paint((103, 83, 72), beard * (.12 + .14 * (noise > 1.35)))

    for eye_x, eye_y, width, height in (eye_a, eye_b):
        u = (px - eye_x) / width
        outer = np.sign(eye_x - 315)
        slope = outer * u * 1.6
        dy = py - eye_y - slope
        curve = np.sqrt(np.maximum(0, 1 - u**2)) * np.clip(1 - .18 * np.abs(u), 0, 1)
        upper = -height * curve
        lower = height * curve * .70
        socket = np.exp(-((u / 1.4)**4) - ((dy + 5) / 12)**2)
        paint((126, 79, 67), front * socket * .16)
        opening = smooth(-.92, .80, dy - upper) * (1 - smooth(-.65, .85, dy - lower))
        opening *= 1 - smooth(.85, 1.03, np.abs(u))
        iris_y = dy + 1.0
        radius = np.hypot(px - eye_x + .5, iris_y)
        iris_color = (124, 102, 75) if key == "ovtcharov" else (85, 58, 44)
        paint((184, 171, 157), opening * front)
        paint(iris_color, opening * front * (1 - smooth(6.1, 8.0, radius)))
        paint((37, 29, 27), opening * front * (1 - smooth(3.3, 4.45, radius)))
        glint = np.hypot(px - eye_x + 2, iris_y + 1.5)
        paint((231, 222, 211), opening * front * (1 - smooth(.55, 1.5, glint)) * .75)
        rim = np.exp(-((dy - upper) / 1.2)**2) * (1 - smooth(.87, 1.02, np.abs(u)))
        paint((104, 68, 59), rim * front * .72)
        brow_u = (px - eye_x - outer * 2.5) / (width * 1.38)
        arch = -22 - 4.8 * (1 - brow_u**2) + outer * brow_u * 2
        brows = np.exp(-((dy - arch) / 3.2)**2) * (1 - smooth(.77, 1.06, np.abs(brow_u)))
        strands = .82 + .18 * np.sin(px * 2.7 + py * 1.5)
        paint((85, 64, 51), front * brows * strands * .78)

    mouth_x, mouth_y, width = mouth
    t = (px - mouth_x) / width
    center = mouth_y - 2.4 * t**2 + 1.7 * np.cos(t * np.pi * 1.3)
    lip = np.exp(-((py - center - 1) / 8.5)**2) * (1 - smooth(.68, 1.06, np.abs(t)))
    paint((177, 103, 99), lip * front * .68)
    line = np.exp(-((py - center) / 1.55)**2) * (1 - smooth(.74, 1.04, np.abs(t)))
    paint((92, 48, 48), line * front * .76)

    pixels = np.empty((SIZE, SIZE, 3), np.uint8)
    pixels[:] = skin
    pixels[valid] = np.clip(color, 0, 255).astype(np.uint8)
    output = io.BytesIO()
    Image.fromarray(pixels, "RGB").save(output, format="JPEG", quality=89, optimize=True)
    return output.getvalue()


def build_head(key, path):
    data = path.read_bytes()
    assert struct.unpack_from("<4sII", data) == (b"glTF", 2, len(data))
    json_size, json_kind = struct.unpack_from("<I4s", data, 12)
    assert json_kind == b"JSON"
    bin_start = 20 + json_size
    bin_size, bin_kind = struct.unpack_from("<I4s", data, bin_start)
    assert bin_kind == b"BIN\0" and bin_start + 8 + bin_size == len(data)
    gltf = json.loads(data[20:bin_start])
    buffer = data[bin_start + 8:]
    assert len(gltf["buffers"]) == len(gltf["images"]) == 1
    image = gltf["images"][0]
    view_target = image["bufferView"]
    texture = paint_surface(key, surface_map(gltf, buffer))
    image.update(mimeType="image/jpeg", name="原创球员肤色纹理")
    packed = bytearray()
    for i, view in enumerate(gltf["bufferViews"]):
        start = view.get("byteOffset", 0)
        value = texture if i == view_target else buffer[start:start + view["byteLength"]]
        view.update(byteOffset=len(packed), byteLength=len(value))
        packed.extend(value)
        packed.extend(b"\0" * (-len(packed) % 4))
    gltf["buffers"][0]["byteLength"] = len(packed)
    header = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode()
    header += b" " * (-len(header) % 4)
    return b"".join((
        struct.pack("<4sII", b"glTF", 2, 28 + len(header) + len(packed)),
        struct.pack("<I4s", len(header), b"JSON"), header,
        struct.pack("<I4s", len(packed), b"BIN\0"), packed,
    ))


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("model_dir", type=Path)
    args = cli.parse_args()
    target = ROOT / "assets" / "heads"
    target.mkdir(parents=True, exist_ok=True)
    for key, (name, *_) in PLAYERS.items():
        model = build_head(key, args.model_dir / f"{name}-头模.glb")
        (target / f"{key}.glb").write_bytes(model)
        print(key, len(model), "bytes")


if __name__ == "__main__":
    main()
