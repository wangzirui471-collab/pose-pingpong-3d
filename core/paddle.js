/* 体感乒乓 · 球拍（由手部骨骼驱动）
 * 球拍是"手 -> 球"的唯一接口：输入层给出掌心中位/拍面法线/挥拍速度，
 * 这里把拍面运动转成球的冲量、出球速度与旋转。
 * 击球模型沿用 MIT 项目的冲量-动量框架（反胶 e=0.88, mu=0.45）。
 */
;(function (G) {
  'use strict';
  var NS = (G.PP = G.PP || {});
  var K = NS.constants;
  var V = NS.physics;

  function Paddle(owner) {
    this.owner = owner || 'player';        // 'player' | 'ai'
    var home = K.PADDLE_HOME;
    this.p = owner === 'ai'
      ? [0, K.TABLE.HEIGHT + 0.22, K.AI_Z - 0.28]
      : [home[0], home[1], home[2]];
    this.prevP = V.copy3(this.p);
    this.v = [0, 0, 0];
    this.n = owner === 'ai' ? [0, 0, 1] : [0, 0, -1];  // 拍面朝对手
    this.grip = 1;
    this.quality = 1;
    this.spinBias = [0, 0, 0];
    this.lastHitAt = -10;
    this.swinging = false;
  }

  /* 目标来自 input/hand_tracker（玩家）或 core/ai（人机）。
   * 自适应平滑：手慢时强滤抖，手快时几乎不延迟（沿用 FPS 项目 v6 的结论）。
   */
  Paddle.prototype.update = function (dt, target) {
    if (!target || !target.p) return;
    dt = V.clamp(dt, 1 / 240, 0.05);
    this.prevP = V.copy3(this.p);
    var rawDelta = V.sub(target.p, this.p);
    var rawSpeed = V.len(rawDelta) / dt;
    var alpha = V.clamp(0.32 + rawSpeed * 0.9, 0.32, 0.95);
    for (var i = 0; i < 3; i++) this.p[i] += rawDelta[i] * alpha;
    if (target.n && V.len(target.n) > 1e-6) {
      var nn = V.len(target.n);
      for (var j = 0; j < 3; j++) this.n[j] += (target.n[j] / nn - this.n[j]) * 0.35;
      var nl = V.len(this.n);
      for (var k = 0; k < 3; k++) this.n[k] /= nl;
    }
    var rawV = [(this.p[0] - this.prevP[0]) / dt,
                (this.p[1] - this.prevP[1]) / dt,
                (this.p[2] - this.prevP[2]) / dt];
    for (var m = 0; m < 3; m++) this.v[m] = this.v[m] * 0.45 + rawV[m] * 0.55;
    this.grip = target.grip === undefined ? 1 : target.grip;
    this.quality = target.quality === undefined ? 1 : target.quality;
    this.spinBias = target.spinBias || [0, 0, 0];
    this.swinging = V.len(this.v) > 0.7;
  };

  /* 击球检测：拍面是半径 PADDLE_RADIUS 的圆盘，法线 n。
   * 必须 (1) 球心贴近拍面 (2) 落在圆盘内 (3) 球正朝拍面接近 (4) 过冷却。
   * 返回 null 表示没打到；命中时原地修改 ball。
   */
  Paddle.prototype.tryHit = function (ball, opts) {
    opts = opts || {};
    if (!ball || !ball.alive) return null;
    if ((ball.t - this.lastHitAt) < K.HIT_COOLDOWN) return null;
    if (this.owner === ball.lastTouch) return null;   // 不能连击

    var n = this.n;
    var d = V.dot(V.sub(ball.p, this.p), n);
    var R = K.BALL.RADIUS;
    var reach = K.PADDLE_RADIUS * (1 + (opts.aimAssist || 0));
    if (Math.abs(d) > R + 0.018) return null;
    var radial = V.sub(V.sub(ball.p, this.p), [d * n[0], d * n[1], d * n[2]]);
    if (V.len(radial) > reach) return null;

    var vrel = V.sub(ball.v, this.v);
    var vn = V.dot(vrel, n);
    if (vn > -0.15) return null;                    // 球不是朝拍面来

    var e = K.PADDLE_RESTITUTION;
    var mu = K.PADDLE_FRICTION;
    // 法向反弹 + 拍面运动带球
    var out = [vrel[0] - (1 + e) * vn * n[0] + this.v[0],
               vrel[1] - (1 + e) * vn * n[1] + this.v[1],
               vrel[2] - (1 + e) * vn * n[2] + this.v[2]];

    // 切向摩擦：既改变切向速度，也赋予球旋转
    var vt = V.sub(vrel, [vn * n[0], vn * n[1], vn * n[2]]);
    var vtLen = V.len(vt);
    if (vtLen > 1e-6) {
      var dv = Math.min(mu * (1 + e) * Math.abs(vn), vtLen);
      for (var i = 0; i < 3; i++) out[i] -= dv * vt[i] / vtLen;
    }

    var gesture = opts.gesture;
    if (gesture && out[2] < -.10) {
      if (gesture.kind === 'block') out[2] *= .80;
      if (gesture.kind === 'push' || gesture.kind === 'chop') {
        out[2] *= gesture.kind === 'push' ? .75 : .82;
        out[1] += .30;
      }
      if (gesture.kind === 'topspin' || gesture.kind === 'lob') out[1] += gesture.kind === 'lob' ? .72 : .38;
      if (gesture.kind === 'smash') {
        out[2] -= V.clamp(gesture.speed * .73, .4, 2.5);
        out[1] -= .32;
      }
    }

    // 旋转：拍面切向滑移 + 拍面倾角(主动摩擦) + 来球残余旋转
    var w = V.cross(n, vt);
    var spin = [0, 0, 0];
    for (var j = 0; j < 3; j++) {
      spin[j] = V.clamp(w[j] * (mu / R) * 0.45
                        + this.spinBias[j] * 90
                        + ball.w[j] * 0.25, -320, 320);
    }
    // 球速上限，防止挥拍过猛数值爆炸
    var sp = V.len(out);
    if (sp > K.MAX_BALL_SPEED) {
      var s = K.MAX_BALL_SPEED / sp;
      out = [out[0] * s, out[1] * s, out[2] * s];
    }

    ball.v = out;
    ball.w = spin;
    ball.lastTouch = this.owner;
    ball.bounceCount = 0;
    ball.netTouched = false;
    ball.meta = ball.meta || {};
    ball.meta.lastHitAt = ball.t;
    this.lastHitAt = ball.t;
    return {
      type: 'hit', by: this.owner, p: V.copy3(ball.p),
      speed: V.len(out), spin: V.copy3(spin), paddleSpeed: V.len(this.v)
    };
  };

  NS.paddle = { Paddle: Paddle };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.paddle;
})(typeof globalThis !== 'undefined' ? globalThis : this);
