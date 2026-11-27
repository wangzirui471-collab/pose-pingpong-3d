"""为公开网页打包球员几何，并把对齐后的原创参考投影成面部贴图。"""

import argparse
import io
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SIZE = 1024
# 非正面区域的肤色基准。面部五官由对齐后的参考图投影。
PLAYERS = {
    "fan": ("樊振东", (203, 158, 133)),
    "ma": ("马龙", (199, 151, 128)),
    "wang": ("王楚钦", (205, 157, 139)),
    "harimoto": ("张本智和", (205, 158, 132)),
    "sun": ("孙颖莎", (214, 167, 140)),
    "ovtcharov": ("奥恰洛夫", (211, 165, 145)),
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


def project_portrait(color, portrait, px, py, front):
    # 照片参考已离线对准模型相机。只投影脸部正面，颈部、耳后继续使用程序材质。
    with Image.open(portrait) as image:
        if image.size != (630, 630):
            raise ValueError(f"面部参考须对齐到 630×630：{portrait}")
        pixels = np.asarray(image.convert("RGB"), dtype=np.float32)
    low = np.asarray(Image.fromarray(pixels.astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(26)), dtype=np.float32)
    u = np.clip(px - .5, 0, 628.999)
    v = np.clip(py - .5, 0, 628.999)
    i, j = u.astype(int), v.astype(int)
    du, dv = (u - i)[:, None], (v - j)[:, None]
    sampled = (pixels[j, i] * (1 - du) + pixels[j, i + 1] * du) * (1 - dv)
    sampled += (pixels[j + 1, i] * (1 - du) + pixels[j + 1, i + 1] * du) * dv
    # 柔化参考图中大面积的亮暗变化，眼睑、眉毛和唇纹的局部细节仍留在贴图中。
    luma = low[j, i].mean(axis=1)
    tone = np.clip((151 / np.maximum(55, luma))**.36, .88, 1.13)
    sampled = np.clip(sampled * tone[:, None], 0, 255)
    brow_to_chin = smooth(180, 211, py) * (1 - smooth(402, 434, py))
    cheeks = 1 - smooth(101, 140, np.abs(px - 315))
    # 额头从发型几何接收轮廓，避免把参考里的旧刘海又画在皮肤上。
    hair_shadow = (1 - smooth(39, 91, sampled.mean(axis=1))) * (1 - smooth(202, 230, py))
    weight = front * brow_to_chin * cheeks * (1 - hair_shadow)
    color += (sampled - color) * weight[:, None]


def paint_surface(key, surface, portrait):
    _, skin = PLAYERS[key]
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

    project_portrait(color, portrait, px, py, front)

    pixels = np.empty((SIZE, SIZE, 3), np.uint8)
    pixels[:] = skin
    pixels[valid] = np.clip(color, 0, 255).astype(np.uint8)
    output = io.BytesIO()
    Image.fromarray(pixels, "RGB").save(output, format="JPEG", quality=89, optimize=True)
    return output.getvalue()


def build_head(key, path, portrait):
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
    texture = paint_surface(key, surface_map(gltf, buffer), portrait)
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
    cli.add_argument("--portraits", type=Path, default=ROOT / "assets" / "face-paint",
                     help="已对齐到模型相机的原创正脸参考目录")
    args = cli.parse_args()
    target = ROOT / "assets" / "heads"
    target.mkdir(parents=True, exist_ok=True)
    for key, (name, _) in PLAYERS.items():
        portrait = args.portraits / f"{key}.jpg"
        model = build_head(key, args.model_dir / f"{name}-头模.glb", portrait)
        (target / f"{key}.glb").write_bytes(model)
        print(key, len(model), "bytes")


if __name__ == "__main__":
    main()
