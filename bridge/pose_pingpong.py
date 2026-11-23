#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""红外感知台 -> 体感乒乓：独立 WebSocket 原始骨骼帧转发（零第三方依赖）。

与现有跑酷/FPS 的 8765 服务**完全隔离**，用 8770 端口，不抢服务、不抢相机。
浏览器连 ws://127.0.0.1:8770/?role=game，收到的是感知台原始帧：
    {stale, people:[{id, pose33|pose17, range33|range17}], hands21:[...]}
前端 input/frame.js 负责解析成 COCO-17 + 手部 21 点。

用法：
    python pose_pingpong.py                  # 自动发现 outputs/local_*/latest_keypoints.json
    python pose_pingpong.py --file X.json    # 指定文件（调试/回放）
    python pose_pingpong.py --mock           # 无硬件，合成挥拍帧
    python pose_pingpong.py --mirror         # 左右镜像（画面镜像时）
"""
import argparse
import base64
import glob
import hashlib
import json
import math
import os
import socket
import struct
import sys
import threading
import time
from urllib.parse import urlparse, parse_qs

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
ROOTS = [
    r"D:/MS01_delivery_20261118/files/outputs",
    r"D:/shangweiji/Taihe_TH-MS01/files/outputs",
]
clients = set()
lock = threading.Lock()


def log(msg):
    print("[%s] %s" % (time.strftime("%H:%M:%S"), msg), flush=True)


def recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("连接已关闭")
        buf += chunk
    return buf


def do_handshake(conn):
    raw = b""
    while b"\r\n\r\n" not in raw and len(raw) < 8192:
        chunk = conn.recv(4096)
        if not chunk:
            raise ConnectionError("握手中断")
        raw += chunk
    head, _, rest = raw.partition(b"\r\n\r\n")
    lines = head.decode("utf-8", "ignore").split("\r\n")
    first = lines[0].split()
    if len(first) < 2 or first[0] != "GET":
        raise ValueError("不是 WebSocket GET")
    key = None
    for line in lines[1:]:
        if line.lower().startswith("sec-websocket-key:"):
            key = line.split(":", 1)[1].strip()
            break
    if not key:
        raise ValueError("缺少 Sec-WebSocket-Key")
    accept = base64.b64encode(
        hashlib.sha1((key + GUID).encode("ascii")).digest()).decode("ascii")
    conn.sendall((
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        "Sec-WebSocket-Accept: %s\r\n\r\n" % accept).encode("ascii"))
    return first[1], rest


def send_frame(sock, opcode, data):
    head = bytearray([0x80 | opcode])
    n = len(data)
    if n < 126:
        head.append(n)
    elif n < 65536:
        head.append(126)
        head += struct.pack("!H", n)
    else:
        head.append(127)
        head += struct.pack("!Q", n)
    sock.sendall(bytes(head) + data)


def send_text(sock, text):
    send_frame(sock, 0x1, text.encode("utf-8"))


def read_frame(sock):
    b1, b2 = struct.unpack("!BB", recv_exact(sock, 2))
    opcode = b1 & 0x0F
    masked = bool(b2 & 0x80)
    length = b2 & 0x7F
    if length == 126:
        length = struct.unpack("!H", recv_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", recv_exact(sock, 8))[0]
    mask = recv_exact(sock, 4) if masked else None
    payload = recv_exact(sock, length)
    if mask:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return opcode, payload


def broadcast(obj):
    msg = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    dead = []
    with lock:
        targets = list(clients)
    for c in targets:
        try:
            send_text(c, msg)
        except Exception:
            dead.append(c)
    if dead:
        with lock:
            for c in dead:
                clients.discard(c)
    return len(targets) - len(dead)


def handle_client(conn, addr):
    try:
        conn.settimeout(120)
        path, rest = do_handshake(conn)
        role = parse_qs(urlparse(path).query).get("role", ["game"])[0].lower()
        if role != "game":
            log("%s 以 role=%s 连接（只转发给 game）" % (addr, role))
        with lock:
            clients.add(conn)
        log("game 客户端 %s 已连接（当前 %d 个）" % (addr, len(clients)))
        # 维持连接，处理 ping / close；游戏不需要客户端上行数据
        while True:
            opcode, payload = read_frame(conn)
            if opcode == 0x8:
                break
            if opcode == 0x9:
                send_frame(conn, 0xA, payload)
    except Exception as e:
        log("%s 断开: %s" % (addr, e))
    finally:
        with lock:
            clients.discard(conn)
        try:
            conn.close()
        except Exception:
            pass


def latest_file():
    best, best_m = None, 0
    for root in ROOTS:
        for p in glob.glob(os.path.join(root, "*", "latest_keypoints.json")):
            try:
                m = os.path.getmtime(p)
            except OSError:
                continue
            if m > best_m:
                best, best_m = p, m
    return best, best_m


def mock_frame(t, mirror=False):
    swing = math.sin(t * 1.6)
    lift = math.cos(t * 1.6) * 0.35
    pose = [[0.50, 0.20, .95], [0.48, .19, .9], [0.52, .19, .9],
            [0.46, .20, .9], [0.54, .20, .9], [0.40, .34, .95], [0.60, .34, .95],
            [0.37, .45, .9], [0.63, .45, .9], [0.36, .56, .9], [0.64, .56, .9],
            [0.45, .62, .95], [0.55, .62, .95], [0.45, .80, .9], [0.55, .80, .9],
            [0.45, .96, .9], [0.55, .96, .9]]
    pose[10][0] = 0.64 + swing * 0.10
    pose[10][1] = 0.56 - lift * 0.05
    ranges = [{"valid": True, "meters": 1.70} for _ in range(17)]
    ranges[10] = {"valid": True, "meters": 1.70 + 0.06 * swing}
    px, py = 0.64 + swing * 0.10, 0.56 - lift * 0.05
    src = [
        [px + .035, py + .045], [px - .020, py + .010], [px - .040, py - .010],
        [px - .055, py - .025], [px - .070, py - .040],
        [px - .040, py - .020], [px - .055, py - .045], [px - .065, py - .070],
        [px - .075, py - .095], [px + .000, py - .025], [px + .000, py - .055],
        [px + .000, py - .085], [px + .000, py - .115], [px + .030, py - .020],
        [px + .038, py - .048], [px + .045, py - .075], [px + .052, py - .100],
        [px + .058, py + .000], [px + .075, py - .020], [px + .090, py - .040],
        [px + .105, py - .060]]
    pts = [[x, y, 0.95] for x, y in src]
    if mirror:
        pose = [[1 - x, y, c] for x, y, c in pose]
        pts = [[1 - x, y, c] for x, y, c in pts]
    return {
        "stale": False,
        "people": [{"id": 1, "pose17": pose, "range17": ranges}],
        "hands21": [{"part": "right", "person_id": 1, "state": "observed",
                     "valid_indices": list(range(21)), "points": pts}]
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--file", default=None)
    ap.add_argument("--hz", type=float, default=60)
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--mirror", action="store_true")
    args = ap.parse_args()

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        srv.bind((args.host, args.port))
    except OSError as e:
        log("端口 %d 已被占用（可能已有实例在运行）：%s" % (args.port, e))
        return
    srv.listen(8)
    log("体感乒乓骨骼服务 ws://%s:%d/?role=game" % (args.host, args.port))

    def accept_loop():
        while True:
            conn, addr = srv.accept()
            threading.Thread(target=handle_client, args=(conn, addr), daemon=True).start()

    threading.Thread(target=accept_loop, daemon=True).start()

    last_m, last_path, last_ok = 0, None, time.time()
    t0 = time.time()
    while True:
        if args.mock:
            broadcast(mock_frame(time.time() - t0, args.mirror))
            time.sleep(1.0 / max(1.0, args.hz))
            continue
        if args.file:
            path = args.file
            try:
                m = os.path.getmtime(path)
            except OSError:
                time.sleep(0.05)
                continue
        else:
            path, m = latest_file()
            if not path:
                time.sleep(0.2)
                continue
        if m == 0 or m == last_m:
            time.sleep(1.0 / max(1.0, args.hz))
            continue
        last_m = m
        if path != last_path:
            last_path = path
            log("发现输出：%s" % path)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            time.sleep(0.03)
            continue
        if data.get("stale"):
            time.sleep(0.05)
            continue
        people = data.get("people") or []
        if not people and time.time() - last_ok < 0.30:
            continue                      # 短暂丢帧保持上一帧，不发空包
        data["_ts"] = round(time.time(), 4)
        if args.mirror:
            data["_mirror"] = True
        n = broadcast(data)
        if n:
            last_ok = time.time()
        time.sleep(1.0 / max(1.0, args.hz))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("已停止")
