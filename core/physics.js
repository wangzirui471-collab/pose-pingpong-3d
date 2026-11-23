/* 体感乒乓 · 球体动力学
 *
 * 物理模型（公式与系数取自 MIT 许可的 2005Andy/pingpong-simulation，
 * 见 third_party/pingpong-simulation-MIT/physics_model.md）：
 *
 *   m dv/dt = m g + F_drag + F_magnus
 *   F_drag   = -1/2 rho |v|^2 S Cd * vhat = -1/2 rho S Cd |v| v
 *   F_magnus = rho R^3 C_Omega (omega x v)
 *
 * 该仓库坐标系以 z 为竖直轴，本项目以 y 为竖直轴，公式已做轴变换。
 * 数值积分用 RK4；台面/球拍碰撞用冲量-动量 + 库仑摩擦（MIT 文档第 4 节）。
 *
 * 本文件为独立移植实现，不复制其 Python 源码；MIT 声明随 LICENSE 一并留存。
 */
;(function (G) {
  'use strict';
  var NS = (G.PP = G.PP || {});
  var K = NS.constants;

  function len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function copy3(a) { return [a[0], a[1], a[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]];
  }

  // RK4 系数：阻力 / 马格努斯 / 重力都只依赖 v 与常量 w
  var KD = 0.5 * K.BALL.AIR_RHO * K.BALL.AREA * K.BALL.DRAG_CD / K.BALL.MASS;
  var KM = K.BALL.AIR_RHO * Math.pow(K.BALL.RADIUS, 3) * K.BALL.MAGNUS_C_OMEGA / K.BALL.MASS;

  function acceleration(v, w) {
    var sp = len(v);
    var m = cross(w, v);
    return [-KD * sp * v[0] + KM * m[0],
            -K.G - KD * sp * v[1] + KM * m[1],
            -KD * sp * v[2] + KM * m[2]];
  }

  // 只积分，不处理碰撞（AI 预测落点时使用）
  function integrate(ball, dt) {
    var v0 = ball.v, w = ball.w;
    var k1v = acceleration(v0, w);
    var k1p = copy3(v0);
    var v2 = [v0[0] + 0.5 * dt * k1v[0], v0[1] + 0.5 * dt * k1v[1], v0[2] + 0.5 * dt * k1v[2]];
    var k2v = acceleration(v2, w), k2p = copy3(v2);
    var v3 = [v0[0] + 0.5 * dt * k2v[0], v0[1] + 0.5 * dt * k2v[1], v0[2] + 0.5 * dt * k2v[2]];
    var k3v = acceleration(v3, w), k3p = copy3(v3);
    var v4 = [v0[0] + dt * k3v[0], v0[1] + dt * k3v[1], v0[2] + dt * k3v[2]];
    var k4v = acceleration(v4, w), k4p = copy3(v4);
    for (var i = 0; i < 3; i++) {
      ball.p[i] += dt / 6 * (k1p[i] + 2 * k2p[i] + 2 * k3p[i] + k4p[i]);
      ball.v[i] += dt / 6 * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]);
    }
    var decay = Math.pow(K.BALL.SPIN_DECAY, dt / K.FIXED_DT);
    ball.w[0] *= decay;
    ball.w[1] *= decay;
    ball.w[2] *= decay;
    ball.t += dt;
    return ball;
  }

  function makeBall(p, v, w, meta) {
    return {
      p: copy3(p), v: copy3(v),
      w: w ? copy3(w) : [0, 0, 0],
      t: 0,
      alive: true,
      lastTouch: (meta && meta.lastTouch) || null,
      bounceCount: 0,
      netTouched: false,
      meta: meta || {}
    };
  }

  function sideOf(z) {
    if (Math.abs(z) > K.TABLE.HALF_L + K.BALL.RADIUS + 1e-5) return 'off';
    return z > 0 ? 'player' : 'ai';
  }

  /* 台面反弹：法向冲量 J_n = -(1+e) m v_rel_n，
   * 切向按库仑摩擦 J_t = -mu |J_n| u_t/|u_t|，
   * 接触点相对速度 u = v_rel + omega x r_vec，r_vec = (0,-R,0)。
   * 用速度形式写：u_t = (v_x + R*w_z, v_z - R*w_x)
   */
  function bounceOnTable(ball, contactY) {
    var R = K.BALL.RADIUS;
    var vy = ball.v[1];
    var e = K.BALL.RESTITUTION;
    var mu = K.BALL.FRICTION;
    ball.v[1] = -e * vy;
    var utx = ball.v[0] + R * ball.w[2];
    var utz = ball.v[2] - R * ball.w[0];
    var ut = Math.hypot(utx, utz);
    var dvT = Math.min(mu * (1 + e) * Math.abs(vy), ut);
    if (ut > 1e-9) {
      ball.v[0] -= dvT * utx / ut;
      ball.v[2] -= dvT * utz / ut;
      // 切向冲量同时改变旋转：薄球壳 I = 2/3 m R^2，这里取一阶近似
      ball.w[2] -= (dvT / R) * 0.32 * utx / ut;
      ball.w[0] += (dvT / R) * 0.32 * utz / ut;
    }
    ball.p[1] = contactY + 1e-6;
    ball.bounceCount++;
    return {
      type: 'bounce',
      side: sideOf(ball.p[2]),
      p: copy3(ball.p),
      speed: len(ball.v),
      spin: copy3(ball.w)
    };
  }

  function pointBetween(a, b, f) {
    return [a[0] + f*(b[0]-a[0]), a[1] + f*(b[1]-a[1]), a[2] + f*(b[2]-a[2])];
  }

  function tableOffset(p, table) {
    return [
      p[0] - clamp(p[0], -table.HALF_W, table.HALF_W),
      p[1] - table.HEIGHT,
      p[2] - clamp(p[2], -table.HALF_L, table.HALF_L)
    ];
  }

  function tableContact(a, b, table, radius) {
    var deltaY = a[1] - b[1];
    var top = table.HEIGHT + radius;
    if (deltaY <= 0 || a[1] <= table.HEIGHT || b[1] > top) return null;
    var lo = Math.max(0, (a[1]-top)/deltaY), hi = Math.min(1, (a[1]-table.HEIGHT)/deltaY);
    var face = pointBetween(a, b, lo);
    if (a[1] >= top && Math.abs(face[0]) <= table.HALF_W && Math.abs(face[2]) <= table.HALF_L) {
      return { fraction:lo, p:face, normal:null };
    }
    // 只检测上表面及其边缘，竖直侧面不算上台。
    if (Math.abs(face[0]) > table.HALF_W + radius + Math.abs(b[0]-a[0]) ||
        Math.abs(face[2]) > table.HALF_L + radius + Math.abs(b[2]-a[2])) return null;
    function distanceAt(f) {
      var offset = tableOffset(pointBetween(a,b,f),table);
      return dot(offset,offset);
    }
    var left = lo, right = hi;
    for (var i = 0; i < 12; i++) {
      var m1 = (2*left + right)/3, m2 = (left + 2*right)/3;
      if (distanceAt(m1) < distanceAt(m2)) right = m2;
      else left = m1;
    }
    var nearest = (left + right)*.5;
    if (distanceAt(hi) < distanceAt(nearest)) nearest = hi;
    if (distanceAt(nearest) >= radius*radius) return null;
    for (var j = 0; j < 14; j++) {
      var middle = (lo + nearest)*.5;
      if (distanceAt(middle) > radius*radius) lo = middle;
      else nearest = middle;
    }
    var p = pointBetween(a,b,nearest);
    var offset = tableOffset(p,table), length = len(offset);
    if (length < 1e-7) return null;
    return { fraction:nearest, p:p, normal:offset.map(function (d) { return d/length; }) };
  }

  function netContact(a, b, table, radius) {
    if (a[2] * b[2] > 0 || a[2] === 0 || a[2] === b[2]) return null;
    var f = -a[2] / (b[2]-a[2]), impact = pointBetween(a,b,f);
    var xGap = Math.max(0, Math.abs(impact[0]) - table.HALF_W - .1525);
    var yGap = Math.max(0, impact[1] - table.NET_TOP);
    if (impact[1] < table.HEIGHT - radius || Math.hypot(xGap,yGap) >= radius) return null;
    return { fraction:f, p:impact, from:Math.sign(a[2]), clearance:impact[1]-table.NET_TOP };
  }

  /* 推进一帧。返回事件数组。采用按速度自适应的子步，
   * 每子步位移不超过 MAX_SUBSTEP_DIST，避免 20 m/s 扣杀穿透台面/网。
   */
  function stepBall(ball, dt) {
    var events = [];
    if (!ball || !ball.alive) return events;
    var T = K.TABLE;
    var R = K.BALL.RADIUS;
    var contactY = T.HEIGHT + R;
    var speed = len(ball.v);
    var nSub = Math.max(1, Math.min(64, Math.ceil(speed * dt / K.MAX_SUBSTEP_DIST)));
    var h = dt / nSub;

    for (var s = 0; s < nSub && ball.alive; s++) {
      var p0 = copy3(ball.p);
      integrate(ball, h);

      var tableHit = tableContact(p0, ball.p, T, R);
      var netHit = !ball.netTouched && netContact(p0, ball.p, T, R);
      if (netHit && (!tableHit || netHit.fraction < tableHit.fraction)) {
        ball.p = netHit.p;
        var crosses = netHit.clearance > 0;
        ball.p[2] = netHit.from * (crosses ? -.001 : .001);
        ball.netTouched = true;
        if (crosses) {
          var bite = 1 - netHit.clearance / R;
          ball.v[1] = ball.v[1] * (1 - .28*bite) + .48*bite;
          ball.v[2] *= 1 - .57*bite;
        } else {
          ball.v[2] *= -.19;
          ball.v[1] *= .54;
        }
        ball.v[0] *= crosses ? .89 : .48;
        events.push({ type:'net', p:copy3(ball.p), side:sideOf(p0[2]), crossed:crosses });
        continue;
      }

      if (tableHit) {
        var normal = tableHit.normal;
        if (!normal) {
          ball.p = tableHit.p;
          events.push(bounceOnTable(ball, contactY));
          continue;
        }
        var approach = dot(ball.v, normal);
        if (approach < 0) {
          ball.p = tableHit.p.map(function (v,i) { return v + normal[i]*1e-5; });
          ball.v = ball.v.map(function (v,i) { return v - (1+K.BALL.RESTITUTION)*approach*normal[i]; });
          ball.bounceCount++;
          events.push({type:'bounce',side:sideOf(ball.p[2]),p:copy3(ball.p),
            speed:len(ball.v),spin:copy3(ball.w),edge:true});
          continue;
        }
      }

      // --- 落地 / 飞出场地 ---
      if (ball.p[1] - R <= 0) {
        ball.alive = false;
        events.push({ type: 'out', reason: 'floor', p: copy3(ball.p), side: sideOf(ball.p[2]) });
        break;
      }
      if (Math.abs(ball.p[0]) > T.HALF_W + 1.2 || Math.abs(ball.p[2]) > T.HALF_L + 1.8) {
        ball.alive = false;
        events.push({ type: 'out', reason: 'wide', p: copy3(ball.p), side: sideOf(ball.p[2]) });
        break;
      }
      if (len(ball.v) > K.MAX_BALL_SPEED) {
        var k = K.MAX_BALL_SPEED / len(ball.v);
        ball.v[0] *= k; ball.v[1] *= k; ball.v[2] *= k;
      }
    }
    return events;
  }

  // AI 预测：只积分不碰撞，求第一次落到台面高度的 {p, t, side}
  function predictLanding(ball, maxT) {
    var b = makeBall(ball.p, ball.v, ball.w, ball.meta);
    b.t = ball.t || 0;
    var T = K.TABLE;
    var contactY = T.HEIGHT + K.BALL.RADIUS;
    var h = K.FIXED_DT * 2;
    var limit = maxT || 3.0;
    var prev = copy3(b.p);
    while (b.t - (ball.t || 0) < limit) {
      prev = copy3(b.p);
      integrate(b, h);
      if (prev[1] > contactY && b.p[1] <= contactY && b.v[1] < 0) {
        var f = (prev[1] - contactY) / Math.max(1e-9, prev[1] - b.p[1]);
        var x = prev[0] + f * (b.p[0] - prev[0]);
        var z = prev[2] + f * (b.p[2] - prev[2]);
        return { p: [x, contactY, z], t: b.t - (ball.t || 0), side: sideOf(z), speed: len(b.v) };
      }
      if (b.p[1] - K.BALL.RADIUS <= 0) break;
    }
    return null;
  }

  NS.physics = {
    len: len, clamp: clamp, copy3: copy3, sub: sub, dot: dot, cross: cross,
    acceleration: acceleration,
    integrate: integrate,
    makeBall: makeBall,
    stepBall: stepBall,
    bounceOnTable: bounceOnTable,
    predictLanding: predictLanding,
    sideOf: sideOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.physics;
})(typeof globalThis !== 'undefined' ? globalThis : this);
