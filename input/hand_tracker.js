/* 体感乒乓 · 手部 21 点 -> 球拍状态
 *
 * 复用 FPS 项目验证过的精度结论：
 *  - 掌心取 5/9/13/17 四个掌指关节的**中位数**（腕点 0 会随转腕漂移）
 *  - 按 valid_indices 剔掉被红外裁剪/低置信的关节
 *  - tracked（光流预测点）降权，避免抖动
 * 另加：掌平面法线决定拍面倾角 -> 影响出球旋转（现实中的"拍面角度"）。
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
  function norm(a) {
    var l = V.len(a);
    return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, -1];
  }

  function HandTracker(opts) {
    opts = opts || {};
    this.part = opts.part || 'right';       // 持拍手
    this.prev = null;
    this.smooth = null;
    this.tossState = 'idle';
    this.tossTop = null;
  }

  HandTracker.prototype.reset = function () {
    this.prev = null; this.smooth = null;
    this.tossState = 'idle'; this.tossTop = null;
  };

  /* 返回 HandState；frame 来自 frame.parseFrame */
  HandTracker.prototype.read = function (frame, dt) {
    var empty = { ok: false, part: this.part, cx: null, cy: null,
                  palmWidth: null, grip: 0, normal: [0, 0, -1],
                  swingSpeed: 0, swingDir: [0, 0, 0], spinBias: [0, 0, 0],
                  quality: 0, validCount: 0 };
    if (!frame || !frame.ok) return empty;
    var h = frame.hands && frame.hands[this.part];
    if (!h) return empty;
    var pts = h.points, valid = {};
    for (var i = 0; i < h.valid.length; i++) valid[h.valid[i]] = true;
    var mcp = [5, 9, 13, 17].filter(function (i) { return valid[i]; });
    if (mcp.length < 3) return empty;

    var xs = mcp.map(function (i) { return pts[i][0]; });
    var ys = mcp.map(function (i) { return pts[i][1]; });
    var cx = median(xs), cy = median(ys);
    var pw = (valid[5] && valid[17])
      ? Math.hypot(pts[5][0] - pts[17][0], pts[5][1] - pts[17][1])
      : Math.max(0.02, 0.08 * (xs.length / 4));

    // 握拍程度：四指尖到掌心的平均距离 / 掌宽，越小越像握拍
    var tips = [8, 12, 16, 20].filter(function (i) { return valid[i]; });
    var grip = 0.5;
    if (tips.length && pw > 1e-6) {
      var s = 0;
      for (var t = 0; t < tips.length; t++) {
        s += Math.hypot(pts[tips[t]][0] - cx, pts[tips[t]][1] - cy);
      }
      grip = V.clamp(1 - (s / tips.length) / pw / 1.15, 0, 1);
    }

    // 掌平面：u = 食指根 - 拇指侧根, v = 中指方向
    var u = valid[9] && valid[5]
      ? [pts[9][0] - pts[5][0], pts[9][1] - pts[5][1], 0] : [0.04, 0, 0];
    var finger = valid[12] && valid[9]
      ? [pts[12][0] - pts[9][0], pts[12][1] - pts[9][1], 0] : [0, -0.08, 0];
    var tilt = Math.atan2(finger[0], -finger[1]);          // 左右倾腕
    var roll = Math.atan2(u[1], u[0] + 1e-6);              // 拍面前倾/后仰
    // 玩家拍面朝 -z；倾腕改变 x 分量，roll 改变 y 分量
    var normal = norm([Math.sin(tilt) * 0.75, Math.sin(roll) * 0.45, -1]);

    // 自适应平滑的掌心位置与挥拍速度
    var raw = [cx, cy];
    if (!this.smooth) this.smooth = raw.slice();
    var step = V.clamp(dt || 1 / 60, 1 / 240, 0.05);
    var d = [raw[0] - this.smooth[0], raw[1] - this.smooth[1]];
    var inst = Math.hypot(d[0], d[1]) / step;
    var alpha = V.clamp(0.32 + inst * 0.35, 0.32, 0.95);
    this.smooth[0] += d[0] * alpha;
    this.smooth[1] += d[1] * alpha;
    var vx = (this.smooth[0] - (this.prev ? this.prev[0] : this.smooth[0])) / step;
    var vy = (this.smooth[1] - (this.prev ? this.prev[1] : this.smooth[1])) / step;
    this.prev = this.smooth.slice();
    var swingSpeed = Math.hypot(vx, vy);

    // 拍面角 + 挥拍方向 -> 主动旋转（上旋/侧旋）
    var spinBias = [
      V.clamp(-vy * 0.25 + Math.sin(roll) * 0.4, -1, 1),
      V.clamp(Math.sin(tilt) * 0.35, -1, 1),
      V.clamp(vx * 0.3, -1, 1)
    ];

    return {
      ok: true, part: this.part,
      cx: cx, cy: cy, palmWidth: pw, grip: grip,
      normal: normal, tilt: tilt, roll: roll,
      swingSpeed: swingSpeed,
      swingDir: norm([vx, -vy, -0.35]),
      spinBias: spinBias,
      quality: h.quality * (mcp.length / 4),
      validCount: mcp.length,
      points: pts
    };
  };

  /* 抛球手势：掌心快速上抬后开始下落。返回 true 表示可以进入发球抛球。 */
  HandTracker.prototype.detectToss = function (state) {
    if (!state || !state.ok) { this.tossState = 'idle'; return false; }
    var y = state.cy;
    if (this.tossState === 'idle') {
      if (state.swingDir && state.swingDir[1] > 0.45 && state.swingSpeed > 0.5) {
        this.tossState = 'rising'; this.tossTop = y;
      }
      return false;
    }
    if (this.tossState === 'rising') {
      if (y < this.tossTop) this.tossTop = y;
      else if (y - this.tossTop > 0.02) {
        this.tossState = 'idle';
        return true;                 // 上抬后回落 = 完成抛球
      }
    }
    return false;
  };

  /* 组装给 core.Paddle 的目标：位置由 calibrator 给，法线/旋转由这里给 */
  HandTracker.prototype.paddleTarget = function (state, worldPos) {
    if (!state || !state.ok || !worldPos) {
      return { p: V.copy3(K.PADDLE_HOME), n: [0, 0, -1], grip: 0, quality: 0 };
    }
    return {
      p: worldPos,
      n: state.normal,
      grip: state.grip,
      quality: state.quality,
      spinBias: state.spinBias
    };
  };

  NS.handTracker = { HandTracker: HandTracker };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.handTracker;
})(typeof globalThis !== 'undefined' ? globalThis : this);
