# -*- coding: utf-8 -*-
# 把 体感乒乓 3D 工程打包成单个自包含 HTML。
# 内联: vendor/three.min.js + core/*.js + input/*.js + render/scene3d.js
# 输出: 工程根/体感乒乓3D.html，并同步一份到桌面（双击即玩，可直接发给别人）。
import argparse
import io
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "render", "index.html")
OUT = os.path.join(ROOT, "体感乒乓3D.html")
DESKTOP = os.path.join(os.path.expanduser("~"), "Desktop", "体感乒乓3D.html")


def build(output=None):
    html = io.open(PAGE, encoding="utf-8", newline="").read()
    inlined = []

    def inline(m):
        src = m.group(1)
        path = os.path.normpath(os.path.join(ROOT, "render", src))
        if not os.path.isfile(path):
            raise IOError("找不到脚本: %s (src=%s)" % (path, src))
        code = io.open(path, encoding="utf-8", newline="").read()
        if re.search(r"</\s*script", code, re.I):
            raise ValueError("脚本内含 </script，会截断 HTML: %s" % src)
        inlined.append((src, len(code)))
        return "<script>\n" + code.rstrip("\n") + "\n</script>"

    html, n = re.subn(r'<script\s+src="([^"]+)"></script>', inline, html)
    if n == 0:
        raise ValueError("没有匹配到任何 <script src=...>，页面结构可能已改变")

    destination = output or OUT
    with io.open(destination, "w", encoding="utf-8", newline="") as target:
        target.write(html)
    if output is None:
        shutil.copy2(destination, DESKTOP)

    print("内联脚本 %d 个:" % n)
    for src, size in inlined:
        print("  %-34s %8d B" % (src, size))
    print("输出: %s (%d B)" % (destination, os.path.getsize(destination)))
    if output is None:
        print("桌面版: %s (%d B)" % (DESKTOP, os.path.getsize(DESKTOP)))
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="打包体感乒乓")
    parser.add_argument("--output", help="指定输出的独立 HTML 文件")
    args = parser.parse_args()
    try:
        build(args.output)
    except Exception as e:
        print("打包失败:", e)
        sys.exit(1)
