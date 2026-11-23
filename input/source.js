/* 体感乒乓 · 数据源（可插拔）
 *
 * 浏览器端统一走 ws://127.0.0.1:8770/?role=game（bridge/pose_pingpong.py 提供），
 * 与现有跑酷/FPS 的 8765 端口隔离，不会抢服务或相机。
 * 无硬件时用 MockSource 生成合成骨骼帧，物理/规则/输入全链路照常开发调试。
 */
;(function (G) {
  'use strict';
  var NS = (G.PP = G.PP || {});

  function PoseHub(opts) {
    opts = opts || {};
    this.listeners = [];
    this.source = null;
    this.connected = false;
    this.frames = 0;
    this.lastAt = 0;
    this.lastRaw = null;
    this.holdMs = opts.holdMs || 300;
    this.statusText = '未连接';
  }
  PoseHub.prototype.onFrame = function (cb) {
    this.listeners.push(cb);
    return this;
  };
  PoseHub.prototype._emit = function (raw) {
    this.lastRaw = raw;
    this.frames++;
    this.lastAt = Date.now();
    for (var i = 0; i < this.listeners.length; i++) this.listeners[i](raw);
  };
  PoseHub.prototype.use = function (source) {
    var self = this;
    if (this.source && this.source.stop) this.source.stop();
    this.source = source;
    this.lastRaw = null;
    this.lastAt = 0;
    this.connected = false;
    this.statusText = '连接中';
    if (!source) return;
    source.onData(function (raw) {
      if (self.source !== source) return;
      self.connected = true;
      self.statusText = source.label || '已连接';
      self._emit(raw);
    });
    source.onStatus(function (text, ok) {
      if (self.source !== source) return;
      self.statusText = text;
      self.connected = !!ok;
    });
    source.start();
  };
  // Pipeline holds the most recent valid frame briefly. Replayed frames cannot count as new calibration samples.
  PoseHub.prototype.tick = function () {
    if (Date.now() - this.lastAt >= this.holdMs) {
      this.connected = false;
      this.statusText = '等待感知台数据';
    }
  };
  PoseHub.prototype.status = function () {
    return { connected: this.connected, frames: this.frames,
             ageMs: Date.now() - this.lastAt, text: this.statusText };
  };

  /* ------------------------------------------------------------------ */
  function WebSocketSource(url) {
    this.url = url || 'ws://127.0.0.1:8770/?role=game';
    this.label = '红外感知台 8770';
    this.ws = null;
    this.cb = function () {};
    this.statusCb = function () {};
    this.retry = null;
    this.closed = false;
  }
  WebSocketSource.prototype.onData = function (cb) { this.cb = cb; };
  WebSocketSource.prototype.onStatus = function (cb) { this.statusCb = cb; };
  WebSocketSource.prototype.start = function () {
    var self = this;
    if (typeof WebSocket === 'undefined') {
      this.statusCb('浏览器不支持 WebSocket', false);
      return;
    }
    this.closed = false;
    var connect = function () {
      if (self.closed) return;
      try {
        var ws = new WebSocket(self.url);
        self.ws = ws;
        ws.onopen = function () { self.statusCb('红外感知台 8770 已连接', true); };
        ws.onmessage = function (e) {
          try { self.cb(JSON.parse(e.data)); } catch (err) { /* 忽略坏帧 */ }
        };
        ws.onclose = function () {
          self.statusCb('连接断开，重连中', false);
          if (!self.closed) self.retry = setTimeout(connect, 1000);
        };
        ws.onerror = function () { try { ws.close(); } catch (err) {} };
      } catch (err) {
        self.statusCb('连接失败，重连中', false);
        self.retry = setTimeout(connect, 1000);
      }
    };
    connect();
  };
  WebSocketSource.prototype.stop = function () {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.ws) { try { this.ws.close(); } catch (err) {} }
  };

  /* ------------------------------------------------------------------ */
  /* 合成帧：站直 + 一只挥动的手。可注入 script(t) 覆盖手掌位置/深度/手势 */
  function MockSource(opts) {
    opts = opts || {};
    this.label = '模拟骨骼（无硬件）';
    this.hz = opts.hz || 60;
    this.t = 0;
    this.script = opts.script || null;
    this.timer = null;
    this.cb = function () {};
    this.statusCb = function () {};
  }
  MockSource.prototype.onData = function (cb) { this.cb = cb; };
  MockSource.prototype.onStatus = function (cb) { this.statusCb = cb; };
  MockSource.prototype.start = function () {
    var self = this;
    this.statusCb(this.label, true);
    var iv = 1000 / this.hz;
    this.timer = setInterval(function () {
      self.t += 1 / self.hz;
      self.cb(self.makeFrame(self.t));
    }, iv);
  };
  MockSource.prototype.stop = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  };
  MockSource.prototype.makeFrame = function (t) {
    var s = this.script ? this.script(t) : {};
    var swing = s.swing === undefined ? Math.sin(t * 1.6) : s.swing;
    var lift = s.lift === undefined ? Math.cos(t * 1.6) * 0.35 : s.lift;
    var baseDepth = s.depth === undefined ? 1.70 : s.depth;

    // COCO-17 站姿（归一化 0..1）
    var pose = [
      [0.50, 0.20, 0.95], [0.48, 0.19, 0.9], [0.52, 0.19, 0.9],
      [0.46, 0.20, 0.9], [0.54, 0.20, 0.9],
      [0.40, 0.34, 0.95], [0.60, 0.34, 0.95],
      [0.37, 0.45, 0.9], [0.63, 0.45, 0.9],
      [0.36, 0.56, 0.9], [0.64, 0.56, 0.9],
      [0.45, 0.62, 0.95], [0.55, 0.62, 0.95],
      [0.45, 0.80, 0.9], [0.55, 0.80, 0.9],
      [0.45, 0.96, 0.9], [0.55, 0.96, 0.9]
    ];
    // 持拍手随挥拍动作移动（肩/肘/腕联动，让身体看起来是同步的）
    pose[6][0] = 0.60 + swing * 0.02;
    pose[8][0] = 0.63 + swing * 0.05;
    pose[10][0] = 0.64 + swing * 0.10;
    pose[10][1] = 0.56 - lift * 0.05;

    var ranges = [];
    for (var i = 0; i < 17; i++) {
      ranges.push({ valid: true, meters: baseDepth });
    }
    // 让手腕深度随手前推变化（s.push 单位米，往前为负）
    if (s.push) ranges[10] = { valid: true, meters: baseDepth + s.push };

    // 21 点手：掌心落在 (px,py)，四指伸开
    var px = 0.64 + swing * 0.10, py = 0.56 - lift * 0.05;
    var closed = !!s.closed;
    var pts = [
      [px + 0.035, py + 0.045],
      [px - 0.020, py + 0.010], [px - 0.040, py - 0.010],
      [px - 0.055, py - 0.025], [px - 0.070, py - 0.040],
      [px - 0.040, py - 0.020], [px - 0.055, py - 0.045],
      [px - 0.065, py - 0.070], [px - 0.075, py - 0.095],
      [px + 0.000, py - 0.025], [px + 0.000, py - 0.055],
      [px + 0.000, py - 0.085], [px + 0.000, py - 0.115],
      [px + 0.030, py - 0.020], [px + 0.038, py - 0.048],
      [px + 0.045, py - 0.075], [px + 0.052, py - 0.100],
      [px + 0.058, py + 0.000], [px + 0.075, py - 0.020],
      [px + 0.090, py - 0.040], [px + 0.105, py - 0.060]
    ];
    if (closed) {
      // 握拍：四指尖收回掌心
      pts[8] = [px - 0.030, py + 0.005]; pts[12] = [px + 0.005, py + 0.005];
      pts[16] = [px + 0.035, py + 0.010]; pts[20] = [px + 0.060, py + 0.020];
    }
    var hand = [];
    for (var j = 0; j < 21; j++) hand.push([pts[j][0], pts[j][1], 0.95]);

    return {
      stale: false,
      people: [{ id: 1, pose17: pose, range17: ranges }],
      hands21: [{
        part: 'right', person_id: 1, state: 'observed',
        valid_indices: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],
        points: hand
      }]
    };
  };

  NS.source = {
    PoseHub: PoseHub,
    WebSocketSource: WebSocketSource,
    MockSource: MockSource
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.source;
})(typeof globalThis !== 'undefined' ? globalThis : this);
