/* 体感乒乓 · 人体 -> 球台坐标系标定
 *
 * 现实动作要"完全贴合"：站着不动时球拍在 home 位；手往左/右/上/下/前推，
 * 球拍按身体比例映射到球台空间，而不是按屏幕像素硬缩放。
 *
 * 启动前 15 帧自然站姿自动标定，记录掌心中心 / 肩宽 / 掌宽 / 手腕深度基线。
 * 之后 palm 的像素位移一律除以肩宽归一化 -> 人离镜头远近手感一致。
 * 前后轴：优先用 range17 手腕深度；深度无效时退回"掌宽变化"做相对深度。
 */
;(function (G) {
  'use strict';
  var NS = (G.PP = G.PP || {});
  var K = NS.constants;
  var V = NS.physics;

  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s.length % 2 ? s[(s.length - 1) / 2]
                         : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  }

  function Calibrator(opts) {
    opts = opts || {};
    this.frames = opts.frames || 15;
    this.reachX = opts.reachX || 0.62;      // 左右可达范围 (m)
    this.reachY = opts.reachY || 0.48;      // 上下可达范围 (m)
    this.depthGain = opts.depthGain || 1.0;
    this.deadzone = opts.deadzone === undefined ? 0.012 : opts.deadzone;
    this.samples = [];
    this.base = null;
    this.smooth = null;
  }

  Calibrator.prototype.isReady = function () { return this.base !== null; };
  Calibrator.prototype.progress = function () {
    return Math.min(1, this.samples.length / this.frames);
  };
  Calibrator.prototype.reset = function () {
    this.samples = []; this.base = null; this.smooth = null;
  };

  function shoulderWidth(pose) {
    var a = pose[K.COCO.L_SHOULDER], b = pose[K.COCO.R_SHOULDER];
    return Math.max(0.05, Math.hypot(a[0] - b[0], a[1] - b[1]));
  }

  /* frame: parseFrame 的输出；hand: hand_tracker 的 HandState（掌心中位等） */
  Calibrator.prototype.update = function (frame, hand) {
    if (!frame || !frame.ok) return false;
    if (this.base) return true;
    var sw = shoulderWidth(frame.pose17);
    if (!hand || hand.cx === null) return false;
    var wristIdx = hand.part === 'right' ? K.COCO.R_WRIST : K.COCO.L_WRIST;
    var d = frame.ranges[wristIdx];
    this.samples.push({ cx: hand.cx, cy: hand.cy, sw: sw, pw: hand.palmWidth, depth: d });
    if (this.samples.length < this.frames) return false;

    var pick = function (key) {
      return median(this.samples.map(function (s) { return s[key]; })
        .filter(function (x) { return typeof x === 'number' && isFinite(x); }));
    }.bind(this);
    var d0 = pick('depth');
    this.base = {
      cx: pick('cx'), cy: pick('cy'), sw: pick('sw'), pw: pick('pw'),
      depth: d0,
      // 深度单位自适应：>20 视为毫米/原始值，否则视为米
      depthScale: (d0 !== null && d0 > 20) ? 0.001 : 1.0
    };
    this.smooth = V.copy3(K.PADDLE_HOME);
    return true;
  };

  Calibrator.prototype.setBase = function (base) {
    this.base = {
      cx: base.cx, cy: base.cy, sw: base.sw || 0.22, pw: base.pw || 0.08,
      depth: base.depth === undefined ? null : base.depth,
      depthScale: (base.depth !== null && base.depth !== undefined && base.depth > 20) ? 0.001 : 1.0
    };
    this.smooth = V.copy3(K.PADDLE_HOME);
  };

  /* 把一帧手部状态映射到球台世界坐标 [x,y,z] */
  Calibrator.prototype.map = function (frame, hand, dt, locomotion) {
    if (!this.base || !hand || hand.cx === null) return V.copy3(K.PADDLE_HOME);
    var b = this.base;
    var sw = Math.max(0.05, b.sw);
    var dx = (hand.cx - b.cx - (locomotion ? locomotion.imageDelta[0] : 0)) / sw;
    var dy = (b.cy - hand.cy) / sw;       // 图像 y 向下，抬高 -> dy 为正
    // 死区：静止时不漂移
    dx = Math.abs(dx) < this.deadzone ? 0 : dx - Math.sign(dx) * this.deadzone;
    dy = Math.abs(dy) < this.deadzone ? 0 : dy - Math.sign(dy) * this.deadzone;

    var wristIdx = hand.part === 'right' ? K.COCO.R_WRIST : K.COCO.L_WRIST;
    var d = frame && frame.ranges ? frame.ranges[wristIdx] : null;
    var dz = 0;
    if (d !== null && d !== undefined && isFinite(d) && b.depth !== null) {
      dz = ((d - b.depth) * b.depthScale - (locomotion ? locomotion.depth : 0)) * this.depthGain;
    } else if (b.pw && hand.palmWidth) {
      // 感知台朝向玩家时，手前伸会靠近感知台，z 随距离减小。
      dz = (b.pw / Math.max(1e-6, hand.palmWidth) - 1) * 0.25;
    }
    dz = V.clamp(dz, -0.55, 0.35);

    var home = K.PADDLE_HOME;
    var target = [
      V.clamp(home[0] + dx * this.reachX, -1.05, 1.05),
      V.clamp(home[1] + dy * this.reachY, K.TABLE.HEIGHT + 0.02, K.TABLE.HEIGHT + 0.85),
      V.clamp(home[2] + dz, K.TABLE.HALF_L - 0.45, K.TABLE.HALF_L + 0.75)
    ];
    // 自适应平滑：手快低延迟，手慢强滤抖
    var step = V.clamp(dt || 1 / 60, 1 / 240, 0.05);
    var sp = V.len(V.sub(target, this.smooth)) / step;
    var alpha = V.clamp(0.32 + sp * 0.55, 0.32, 0.95);
    for (var i = 0; i < 3; i++) this.smooth[i] += (target[i] - this.smooth[i]) * alpha;
    return V.copy3(this.smooth);
  };

  NS.calibrator = { Calibrator: Calibrator, shoulderWidth: shoulderWidth };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.calibrator;
})(typeof globalThis !== 'undefined' ? globalThis : this);
