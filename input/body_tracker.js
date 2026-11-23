/* 体感乒乓 · 身体骨骼 -> 站位 / 重心 / 第一视角手臂
 *
 * 用户要求"其他骨骼点控制身体，完全贴合现实的运动"：
 *  - 肩髋横向偏移 -> 重心左右移动，带动球拍可达范围
 *  - 肩部相对髋部的深度差 -> 身体前倾（前压）/ 后仰
 *  - 肩 -> 肘 -> 腕 三点重建持拍手臂，渲染层只画这一条手臂（第一视角）
 */
;(function (G) {
  'use strict';
  var NS = (G.PP = G.PP || {});
  var K = NS.constants;
  var V = NS.physics;

  function BodyTracker(opts) {
    opts = opts || {};
    this.part = opts.part || 'right';
    this.baseTorso = null;
    this.baseDepth = null;
    this.feetBase = null;
    this.smoothStance = [0, 0, 0];
  }

  BodyTracker.prototype.reset = function () {
    this.baseTorso = null; this.baseDepth = null; this.feetBase = null; this.smoothStance = [0, 0, 0];
  };

  function conf(pose, i) { return pose[i] && pose[i][2] > 0.15; }

  BodyTracker.prototype.read = function (frame, calib, dt) {
    var empty = { ok: false, leanX: 0, leanForward: 0, weightShift: 0,
                  stanceOffset: [0, 0, 0], arm: null };
    if (!frame || !frame.ok || !frame.pose17) return empty;
    var p = frame.pose17, C = K.COCO;
    if (!conf(p, C.L_SHOULDER) || !conf(p, C.R_SHOULDER) ||
        !conf(p, C.L_HIP) || !conf(p, C.R_HIP)) return empty;

    var sc = [(p[C.L_SHOULDER][0] + p[C.R_SHOULDER][0]) / 2,
              (p[C.L_SHOULDER][1] + p[C.R_SHOULDER][1]) / 2];
    var hc = [(p[C.L_HIP][0] + p[C.R_HIP][0]) / 2,
              (p[C.L_HIP][1] + p[C.R_HIP][1]) / 2];
    var sw = Math.max(0.05, Math.hypot(
      p[C.L_SHOULDER][0] - p[C.R_SHOULDER][0],
      p[C.L_SHOULDER][1] - p[C.R_SHOULDER][1]));
    var torsoX = sc[0] - hc[0];
    var torsoY = sc[1] - hc[1];

    // 前倾：肩深度相对髋深度变近 = 身体往前压
    var r = frame.ranges || [];
    function avg2(a, b) {
      var x = r[a], y = r[b];
      if (x === null || x === undefined || y === null || y === undefined) return null;
      if (!isFinite(x) || !isFinite(y)) return null;
      return (x + y) / 2;
    }
    var dS = avg2(C.L_SHOULDER, C.R_SHOULDER);
    var dH = avg2(C.L_HIP, C.R_HIP);
    var depthDelta = (dS !== null && dH !== null) ? (dH - dS) : null;
    if (this.baseTorso === null) { this.baseTorso = [torsoX, torsoY]; this.baseDepth = depthDelta; }

    var leanX = (torsoX - this.baseTorso[0]) / sw;
    var leanForward = 0;
    if (depthDelta !== null && this.baseDepth !== null) {
      var scale = Math.abs(this.baseDepth) > 20 ? 0.001 : 1.0;
      leanForward = (depthDelta - this.baseDepth) * scale * 2.0;
    } else {
      leanForward = (torsoY - this.baseTorso[1]) / sw * 0.5;
    }
    leanForward = V.clamp(leanForward, -1, 1);
    leanX = V.clamp(leanX, -1, 1);

    // 身体带动球拍基准：重心右移 -> 拍基准右移；前压 -> 拍更靠近球台
    var target = [leanX * 0.16, Math.abs(leanX) * -0.02, -leanForward * 0.12];
    var alpha = 0.18;
    for (var i = 0; i < 3; i++) {
      this.smoothStance[i] += (target[i] - this.smoothStance[i]) * alpha;
    }

    // 持拍手臂：肩 -> 肘 -> 腕（世界坐标，供第一视角只画这一条手臂）
    var side = this.part === 'right'
      ? { s: C.R_SHOULDER, e: C.R_ELBOW, w: C.R_WRIST }
      : { s: C.L_SHOULDER, e: C.L_ELBOW, w: C.L_WRIST };
    var base = (calib && calib.base) ? calib.base : { cx: sc[0], cy: sc[1], sw: sw };
    var home = K.PADDLE_HOME;
    function toWorld(q) {
      return [
        V.clamp(home[0] + (q[0] - base.cx) / Math.max(0.05, base.sw) * 0.62, -1.2, 1.2),
        V.clamp(home[1] + (base.cy - q[1]) / Math.max(0.05, base.sw) * 0.48,
                K.TABLE.HEIGHT - 0.20, K.TABLE.HEIGHT + 0.95),
        home[2] + 0.22
      ];
    }
    var arm = {
      shoulder: toWorld(p[side.s]),
      elbow: conf(p, side.e) ? toWorld(p[side.e]) : null,
      wrist: conf(p, side.w) ? toWorld(p[side.w]) : null
    };

    if (!this.feetBase) this.feetBase = { x: hc[0], y: hc[1], depth: dH, shoulder: sw };
    var baseFeet = this.feetBase;
    var depthMove = dH !== null && baseFeet.depth !== null
      ? (dH - baseFeet.depth) * (baseFeet.depth > 20 ? 0.001 : 1)
      : (baseFeet.shoulder / sw - 1) * 1.4;
    var delta = [hc[0] - baseFeet.x, 0];
    return {
      locomotion: {
        x: V.clamp(delta[0] / baseFeet.shoulder * 1.38, -1.60, 1.60),
        z: V.clamp(NS.court.HOME + depthMove * 1.85 - leanForward * .10, 1.12, 3.16),
        depth: depthMove, imageDelta: delta
      },
      ok: true, leanX: leanX, leanForward: leanForward,
      weightShift: (p[C.L_HIP][0] - p[C.R_HIP][0]) / sw,
      stanceOffset: V.copy3(this.smoothStance),
      shoulderWidth: sw, shoulderCenter: sc, hipCenter: hc,
      arm: arm
    };
  };

  NS.bodyTracker = { BodyTracker: BodyTracker };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.bodyTracker;
})(typeof globalThis !== 'undefined' ? globalThis : this);
