/* 体感乒乓 · 人机对手 + 发球求解
 *
 * 难度四档的核心差异是"对手发球球速"（水平分量 serveSpeed）：
 * 新手 5.0 / 普通 6.5 / 困难 8.0 / 魔鬼 9.5 m/s，单调递增。
 *
 * 为什么用水平速度而不是合速度：合法发球必须先落己方半台再弹起过网，
 * 这需要一定的向下分量；若把 4 m/s 当合速度，物理上根本过不了 15.25 cm 的网。
 * solveServe() 用真实动力学反解出垂直分量，保证"慢球"依然合法。
 *
 * 物理上限：实测合法发球水平速度约 10.5 m/s 封顶（2.74m 台 + 15.25cm 网），
 * 再快球必然飞出对方端线，无法完成"己方半台一跳 -> 对方半台二跳"。
 * 所以高速难度主要靠 returnSpeed / reaction / aimError / spin 拉开差距。
 */
;(function (G) {
  'use strict';
  var NS = (G.PP = G.PP || {});
  var K = NS.constants;
  var V = NS.physics;
  var P = NS.paddle;
  var C = NS.court;

  /* 搜索一个合法发球的出球向量：给定水平速度，反解垂直分量与发球点。
   * 合法 = 事件序列 [bounce 发球方半台, bounce 对方半台]，中间无触网/出界。
   */
  function solveServe(horizontalSpeed, server, opts) {
    opts = opts || {};
    var sign = server === 'player' ? 1 : -1;
    var ownSide = server === 'player' ? 'player' : 'ai';
    var otherSide = server === 'player' ? 'ai' : 'player';
    var contactY = K.TABLE.HEIGHT + K.BALL.RADIUS;
    var netTop = K.TABLE.NET_TOP + K.BALL.RADIUS;
    var e = K.BALL.RESTITUTION, g = K.G;
    // 发球点可高于台面 0.28~0.52m（抛球后下落阶段的击球点）
    var y0s = [K.TABLE.HEIGHT + 0.28, K.TABLE.HEIGHT + 0.40, K.TABLE.HEIGHT + 0.52];
    var z0s = [1.40, 1.46, 1.52];
    var vxs = [0, -0.25, 0.25];
    var tried = 0;

    // 用真实动力学验证事件序列（阻力/马格努斯/摩擦都在里面）
    function verify(p, v) {
      var ball = V.makeBall(p, v, [0, 0, 0], { lastTouch: server });
      var seq = [], receiverDepth = 0;
      for (var step = 0; step < 900 && ball.alive && seq.length < 2; step++) {
        var evs = V.stepBall(ball, K.FIXED_DT);
        for (var i = 0; i < evs.length; i++) {
          var ev = evs[i];
          if (ev.type === 'bounce') {
            seq.push(ev.side);
            if (seq.length === 2) receiverDepth = Math.abs(ev.p[2]);
          }
          else if (ev.type === 'net' || ev.type === 'out') return null;
        }
      }
      return (seq.length >= 2 && seq[0] === ownSide && seq[1] === otherSide && receiverDepth >= (opts.minDepth || 0))
        ? { p: p, v: v, seq: seq } : null;
    }

    /* 先用解析弹道做毫秒级预筛，只对少数候选跑完整积分。
     * 水平速度越快，第一落点必须越靠近端线、向下分量越大，
     * 球弹起后才有足够高度越过 15.25cm 的网 —— 这是真实发球的物理约束。
     */
    for (var yi = 0; yi < y0s.length; yi++) {
      var y0 = y0s[yi], h = y0 - contactY;
      for (var zi = 0; zi < z0s.length; zi++) {
        var z0 = sign * z0s[zi];
        var vz = -sign * horizontalSpeed;
        for (var vy = -1.0; vy >= -18; vy -= 0.25) {
          var disc = vy * vy + 2 * g * h;
          if (disc < 0) continue;
          var t1 = (vy + Math.sqrt(disc)) / g;      // 落到台面接触高度的时间
          if (t1 <= 0 || t1 > 1.2) continue;
          var z1 = z0 + vz * t1;                    // 第一落点
          if (sign > 0 ? (z1 <= 0.10 || z1 > K.TABLE.HALF_L)
                       : (z1 >= -0.10 || z1 < -K.TABLE.HALF_L)) continue;
          var vy2 = -e * (vy - g * t1);              // 反弹后的上升速度
          var t2 = Math.abs(z1) / Math.abs(vz);     // 从落点到球网的时间
          var yNet = contactY + vy2 * t2 - 0.5 * g * t2 * t2;
          if (yNet < netTop + 0.015) continue;      // 过不了网，跳过
          for (var xi = 0; xi < vxs.length; xi++) {
            var res = verify([0, y0, z0], [vxs[xi], vy, vz]);
            if (res) return res;
            if (++tried > 600) return null;
          }
        }
      }
    }
    return null;
  }

  /* 给定当前球位和目标落点，反解回球速度（抛物线解析解 + 一次数值校正） */
  function solveShot(from, target, horizontalSpeed) {
    var dz = target[2] - from[2];
    var t = Math.max(0.08, Math.abs(dz) / horizontalSpeed);
    var v = [(target[0] - from[0]) / t,
             (target[1] - from[1] + 0.5 * K.G * t * t) / t,
             dz / t];
    // 用带阻力/马格努斯的积分校正一次，让落点更接近目标
    var probe = V.makeBall(from, v, [0, 0, 0]);
    var land = V.predictLanding(probe, t * 2.2);
    if (land) {
      v[0] += (target[0] - land.p[0]) / Math.max(0.08, land.t);
      v[2] += (target[2] - land.p[2]) / Math.max(0.08, land.t);
    }
    return v;
  }

  var CHARACTERS = Object.freeze({
    wang: { hand:'left', smash:.76, block:.62, topspin:.62, sideSpin:1, pace:1 },
    harimoto: { hand:'right', smash:.78, block:.73, topspin:.64, sideSpin:.90, pace:1 },
    ovtcharov: { hand:'right', smash:.72, block:.44, topspin:.84, sideSpin:1.28, pace:1.035 },
    sun: { hand:'right', smash:.82, block:.48, topspin:.72, sideSpin:.84, pace:1.04 }
  });

  function Opponent(key, opts) {
    opts = opts || {};
    this.key = K.DIFFICULTY[key] ? key : 'normal';
    this.cfg = K.DIFFICULTY[this.key];
    this.paddle = new P.Paddle('ai');
    this.rng = opts.rng || Math.random;
    this.character = Object.hasOwn(CHARACTERS,opts.character) ? opts.character : 'wang';
    this.style = CHARACTERS[this.character];
    this.hand = this.style.hand;
    this.stance = C.stance(-1.88);
    this.reactionClock = 0;
    this.scanIn = 0;
    this.plan = null;
    this.recovery = 0;
    this.shotNumber = 0;
    this.reading = false;
  }

  Opponent.prototype.setDifficulty = function (key) {
    if (!K.DIFFICULTY[key]) return;
    this.key = key;
    this.cfg = K.DIFFICULTY[key];
  };

  Opponent.prototype.serve = function (assisted) {
    var gentle = assisted && this.key === 'novice';
    var s = (gentle ? solveServe(4.6, 'ai', {minDepth:.87}) || solveServe(4.85, 'ai', {minDepth:.87}) : null)
      || solveServe(this.cfg.serveSpeed, 'ai');
    if (!s) return null;
    var direction = this.rng() < .5 ? -1 : 1;
    var p = [gentle ? 0 : V.clamp(this.stance.x - direction * .21, -.44, .44), s.p[1], s.p[2]];
    var candidate = [direction * (gentle ? .12 : .35 + .56 * this.rng()), s.v[1], s.v[2]];
    var sidespin = [this.rng() < .5 ? -22 : 19, direction * 26 * this.style.sideSpin, 0].map(function (n) {
      return n * this.cfg.spin;
    }, this);
    var ball = V.makeBall(p, candidate, sidespin, { lastTouch: 'ai', serve: true });
    var probe = V.makeBall(p, candidate, sidespin);
    var bounces = [];
    for (var t = 0; t < 1.5 && probe.alive && bounces.length < 2; t += 1 / 120) {
      var events = V.stepBall(probe, 1 / 120);
      for (var event of events) if (event.type === 'bounce') bounces.push(event.side);
    }
    if (bounces[0] !== 'ai' || bounces[1] !== 'player') {
      ball = V.makeBall(s.p, s.v, [0, 0, 0], { lastTouch: 'ai', serve: true });
    }
    this.strokeFrom = V.copy3(ball.p);
    this.recovery = .22;
    return ball;
  };

  Opponent.prototype.suggestPlayerServe = function () {
    return solveServe(Math.max(5.0, this.cfg.serveSpeed * 0.8), 'player');
  };

  function chooseKind(ai, ball, side, stance) {
    var high = ball.p[1] >= 1.17, low = ball.p[1] < .96;
    var quick = Math.abs(ball.v[2]) > 6.2;
    var short = ball.p[2] > -1.27, backspin = ball.w[0] * Math.sign(ball.v[2]) < -53;
    var roll = ai.rng();
    if (high && roll < ai.style.smash) return 'smash';
    if (short && low && (backspin || roll < .68)) return 'push';
    if (stance.z < -2.23 && low && (quick || roll < .40)) return 'chop';
    if (quick && (side === 'backhand' ? roll < ai.style.block : roll < .43)) return 'block';
    if (stance.z < -2.38 && roll < .28) return 'lob';
    if (backspin || (roll < ai.style.topspin && (!low || ai.key === 'devil'))) return 'topspin';
    return 'drive';
  }

  Opponent.prototype.update = function (dt, ball, rules, playerStance, assisted) {
    var out = { hit: null, shaped: false, target: null };
    var feet = this.stance, palm = this.hand === 'left' ? 1 : -1;
    var gentle = assisted && this.key === 'novice';
    this.recovery = Math.max(0, this.recovery - dt);
    var incoming = ball && ball.alive && ball.lastTouch !== 'ai' && ball.v[2] < -.10;
    if (!incoming) {
      this.reading = false;
      this.reactionClock = 0;
      this.scanIn = 0;
      this.plan = null;
    } else {
      if (!this.reading) {
        this.reading = true;
        this.scanIn = 0;
      }
      this.reactionClock += dt;
    }

    var rallyHits = rules?.rally?.hits || 0;
    // 多拍后留出还原步伐的时间，普通难度比新手恢复快。
    var recoveryDelay = gentle ? Math.min(.91, Math.max(0, rallyHits - 4) * .113)
      : assisted && this.key === 'normal' ? Math.min(.26, Math.max(0, rallyHits - 8) * .030)
      : assisted && this.key === 'hard' ? Math.min(.18, Math.max(0, rallyHits - 11) * .018) : 0;
    var ready = incoming && this.reactionClock >= this.cfg.reaction + recoveryDelay;
    if (ready) {
      this.scanIn -= dt;
      if (this.plan) this.plan.eta -= dt;
      if (this.scanIn <= 0 && (!this.plan || this.plan.eta > .07)) {
        this.scanIn = .067;
        var ai = this;
        this.plan = C.sampleContact(ball, rules, 'ai', .84, function (probe, eta) {
          if (probe.p[1] < .62 || probe.p[1] > 1.68) return null;
          var p = V.copy3(probe.p);
          var side = C.returnWing(feet, p, ai.hand, 'ai');
          var x = V.clamp(p[0] + (side === 'forehand' ? -.21 : .20) * palm, -1.45, 1.45);
          var z = V.clamp(p[2] - .31, -2.73, Math.abs(x) < .96 ? -1.68 : -1.18);
          var destination = { x: x, z: z };
          var travel = Math.min(1, Math.max(0, (eta - ai.recovery * .48) * ai.cfg.moveSpeed /
            Math.max(.01, Math.hypot(x-feet.x,z-feet.z))));
          var projected = { x: feet.x + (x-feet.x)*travel, z: feet.z+(z-feet.z)*travel };
          if (!C.reachable(projected, p, 'ai', side, ai.hand)) return null;
          var locked = ai.plan && ai.plan.eta < .22 && ai.plan.side === side;
          return { p: p, eta: eta, side: side, kind: locked ? ai.plan.kind : gentle ? (probe.p[1] > .99 ? 'drive' : 'block') : chooseKind(ai, probe, side, destination), x: x, z: z };
        });
      }
    }

    var plan = this.plan;
    var destX = plan ? plan.x : incoming ? feet.x : V.clamp((ball ? ball.p[0] : 0) * .20, -.28, .28);
    var destZ = plan ? plan.z : incoming ? feet.z : -1.86;
    var speed = this.cfg.moveSpeed * (this.recovery > 0 && !plan ? .60 : 1);
    var dx = V.clamp((destX - feet.x) * 8, -speed, speed), dz = V.clamp((destZ - feet.z) * 8, -speed*.82, speed*.82);
    var smooth = 1 - Math.exp(-dt * 14);
    feet.vx += (dx - feet.vx) * smooth;
    feet.vz += (dz - feet.vz) * smooth;
    feet.x = V.clamp(feet.x + feet.vx * dt, -1.48, 1.48);
    feet.z = V.clamp(feet.z + feet.vz * dt, -2.78, Math.abs(feet.x) < .96 ? -1.66 : -1.17);

    var home = [feet.x + .17 * palm, 1.00, feet.z + .34];
    var paddlePos = home;
    var n = [0, 0, 1];
    var prep = plan ? C.strokeWindup(plan.kind) : 0;
    if (plan && plan.eta < prep) {
      var u = V.clamp(1 - plan.eta / prep,0,1);
      var lift = C.PROFILES[plan.kind].lift;
      var swing = Math.sin(u * Math.PI), wing = (plan.side === 'forehand' ? 1 : -1) * palm;
      paddlePos = home.map(function (value, axis) { return value + (plan.p[axis] - value) * u; });
      paddlePos[0] += wing*(plan.kind === 'smash' ? .19 : .13)*swing;
      paddlePos[1] -= lift * .55 * swing;
      paddlePos[2] -= (plan.kind === 'smash' ? .147 : .095)*swing;
      n = [wing * .10, plan.kind === 'push' || plan.kind === 'chop' ? .24 : -.09, 1];
    } else if (this.recovery > 0 && this.strokeFrom) {
      var follow = V.clamp(this.recovery / .24, 0, 1);
      paddlePos = home.map(function (value, axis) { return value + (this.strokeFrom[axis] - value)*follow; }, this);
      var curve = Math.sin(follow * Math.PI);
      var previous = this.lastPlan;
      if (previous) {
        paddlePos[1] += C.PROFILES[previous.kind].lift * curve;
        paddlePos[0] += (previous.side === 'forehand' ? -.16 : .13) * curve * palm;
        paddlePos[2] += .11 * curve;
      }
    }
    this.paddle.update(dt, { p: paddlePos, n: n, grip: 1, quality: 1 });
    out.target = V.copy3(this.paddle.p);
    if (!ready || !plan || plan.eta > .019 || !C.receiverReady(rules, 'ai') ||
        V.len(V.sub(ball.p, plan.p)) > .16 || !C.reachable(feet, ball.p, 'ai', plan.side, this.hand)) return out;

    var place = this.rng();
    var playerX = playerStance ? playerStance.x : 0;
    var edge = Math.abs(playerX) > .18 ? -Math.sign(playerX) : (this.shotNumber % 2 ? -1 : 1);
    var tx = place < .21 ? playerX * .54 : edge * (.39 + .20 * this.rng());
    tx += (this.rng() - .5) * this.cfg.aimError * 1.5;
    var gentleAngle = gentle && rallyHits >= 4 && place < .22;
    if (gentle) tx = gentleAngle ? edge * .51 : V.clamp(playerX * .44 + (this.rng() - .5) * .32,-.33,.33);
    var short = plan.kind === 'push' || (plan.kind === 'block' && playerStance && playerStance.z > 2.10);
    var depth = gentle ? (gentleAngle ? .84 : 1.05) + this.rng() * .16
      : short ? .43 + this.rng() * .25 : .91 + this.rng() * .31;
    var aim = [tx, K.TABLE.HEIGHT, depth];
    var paceScale = { novice:.76, normal:.94, hard:1.06, devil:1.16 }[this.key] * (gentle ? 1 : this.style.pace);
    var shot = C.launchShot(ball.p, 'ai', plan.kind, aim, paceScale);
    var kind = plan.kind;
    if (!shot) {
      kind = 'lob';
      shot = C.launchShot(ball.p, 'ai', kind, [0, K.TABLE.HEIGHT, .99], paceScale);
    }
    if (!shot) return out;
    this.strokeFrom = V.copy3(ball.p);
    C.applyShot(ball, 'ai', shot);
    this.lastPlan = { kind: kind, side: plan.side };
    this.shotNumber++;
    this.recovery = .24;
    this.plan = null;
    out.hit = out.shaped = true;
    out.kind = kind;
    out.side = plan.side;
    return out;
  };

  NS.ai = {
    Opponent: Opponent,
    CHARACTERS: CHARACTERS,
    solveServe: solveServe,
    solveShot: solveShot
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.ai;
})(typeof globalThis !== 'undefined' ? globalThis : this);
