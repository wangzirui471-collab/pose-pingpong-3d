/* Court movement, stroke geometry and spin-aware flight planning. */
;(function (G) {
  'use strict';
  var NS = G.PP, K = NS.constants, V = NS.physics, T = K.TABLE;
  var HOME = 1.85;
  var PROFILES = {
    block:   { label: '挡球', speed: 3.9, spin: 17, lift: 0.015, duration: 0.27 },
    drive:   { label: '快攻', speed: 6.4, spin: 49, lift: 0.075, duration: 0.36 },
    topspin: { label: '弧圈', speed: 6.0, spin: 152, lift: 0.28, duration: 0.43 },
    push:    { label: '搓球', speed: 3.35, spin: -91, lift: -0.068, duration: 0.33 },
    smash:   { label: '扣杀', speed: 10.6, spin: 25, lift: -0.15, duration: 0.40 },
    cut:     { label: '切球', speed: 3.65, spin: -121, lift: -0.12, duration: 0.37 },
    chop:    { label: '削球', speed: 4.05, spin: -144, lift: -0.23, duration: 0.44 },
    lob:     { label: '放高球', speed: 2.45, spin: 37, lift: 0.36, duration: 0.46 },
    serve:   { label: '发球', speed: 4.9, spin: 24, lift: -0.055, duration: 0.35 }
  };

  function strokeWindup(kind) {
    var profile = PROFILES[kind] || PROFILES.drive;
    return profile.duration * (kind === 'smash' ? .74 : kind === 'topspin' ? .60 : .46);
  }

  function stance(z) { return { x: 0, z: z === undefined ? HOME : z, vx: 0, vz: 0 }; }

  function movePlayer(feet, control, dt) {
    if (!control) return;
    var stick = control.move || [0, 0];
    var length = Math.max(1, Math.hypot(stick[0], stick[1]));
    var dx = stick[0] / length * 2.8, dz = stick[1] / length * 2.45;
    if (control.stance) {
      dx = V.clamp((control.stance.x - feet.x) * 9, -3.3, 3.3);
      dz = V.clamp((control.stance.z - feet.z) * 9, -2.7, 2.7);
    }
    var blend = 1 - Math.exp(-dt * 19);
    var x = V.clamp(feet.x + (feet.vx + (dx - feet.vx) * blend) * dt, -1.60, 1.60);
    var nearTable = Math.abs(x) < T.HALF_W + 0.26 ? 1.66 : 1.12;
    var z = V.clamp(feet.z + (feet.vz + (dz - feet.vz) * blend) * dt, nearTable, 3.16);
    feet.vx = (x - feet.x) / dt;
    feet.vz = (z - feet.z) / dt;
    feet.x = x;
    feet.z = z;
  }

  function receiverReady(rules, receiver) {
    return rules && rules.rally && rules.rally.expectSide === receiver && rules.rally.landed;
  }

  // Samples carry the court's actual bounce/drag/spin, including a future legal bounce.
  function sampleContact(ball, rules, receiver, maxTime, visit) {
    if (!ball || !ball.alive || ball.lastTouch === receiver) return null;
    var sign = receiver === 'player' ? 1 : -1;
    var toss = rules.state === 'toss';
    var legal = receiverReady(rules, receiver);
    var ghost = V.makeBall(ball.p, ball.v, ball.w);
    ghost.netTouched = ball.netTouched;
    var playerTurn = receiver === 'player';
    var step = playerTurn ? K.FIXED_DT : 1 / 120;
    for (var i = 0; i * step <= maxTime && ghost.alive; i++) {
      var t = i * step;
      if ((!playerTurn || i % 2 === 0) && sign * ghost.p[2] > 0.21 && ((legal && ghost.v[2] * sign > 0.03) ||
          (toss && ghost.v[1] < -0.08 && (rules.toss.maxY >= rules.toss.startY + K.SERVE_TOSS_MIN || t > 0.02)))) {
        var result = visit(ghost, t);
        if (result) return result;
      }
      var events = V.stepBall(ghost, step);
      for (var event of events) {
        if (event.type === 'net') continue;
        if (event.type !== 'bounce') return null;
        if (event.side === receiver && !legal) {
          if (rules.servePending && ghost.netTouched) return null;
          legal = true;
        }
        else if (legal || !rules.servePending) return null;
      }
    }
    return null;
  }

  function reachable(feet, p, receiver, side, hand) {
    var sign = receiver === 'player' ? 1 : -1;
    var handed = (hand === 'left' ? -1 : 1) * sign;
    var lateral = (p[0] - feet.x) * handed;
    var forward = (feet.z - p[2]) * sign;
    var preferred = side === 'backhand' ? -0.21 : 0.29;
    var width = side === 'backhand' ? 0.60 : 0.62;
    var height = Math.max(0, Math.abs(p[1] - 1.12) - 0.20);
    return p[1] >= 0.53 && p[1] <= 1.72 &&
      ((lateral - preferred) / width) ** 2 + ((forward - 0.34) / 0.52) ** 2 + (height / 0.44) ** 2 <= 1;
  }

  function firstLanding(from, velocity, spin) {
    var probe = V.makeBall(from, velocity, spin);
    for (var t = 0; t < 1.8 && probe.alive; t += 1 / 120) {
      var events = V.stepBall(probe, 1 / 120);
      for (var event of events) if (event.type !== 'net') return event;
    }
    return null;
  }

  function launchShot(from, by, kind, aim, pace) {
    var profile = PROFILES[kind] || PROFILES.drive, sign = by === 'player' ? -1 : 1;
    var goal = [V.clamp(aim[0], -T.HALF_W + 0.07, T.HALF_W - 0.07), T.HEIGHT + K.BALL.RADIUS,
                sign * V.clamp(Math.abs(aim[2]), 0.25, T.HALF_L - 0.075)];
    var smash = kind === 'smash';
    var height = V.clamp((from[1] - (T.NET_TOP - .025)) / .42, 0, 1);
    var tooLow = smash && from[1] < T.NET_TOP - .047;
    var topSpin = smash && !tooLow ? 142 - 113 * height : profile.spin;
    var spin = [topSpin * sign, V.clamp((goal[0] - from[0]) * 28, -38, 38), 0];
    var dz = goal[2] - from[2], dx = goal[0] - from[0];
    // 接近网高时收力提拉，高点击球逐渐加速下压。
    var power = smash ? .66 + .44 * height : 1;
    var maxLift = smash ? (tooLow ? -.27 : 2.65 - 2.91 * height) : Infinity;
    var fallback = null;

    for (var speedScale of [1, 0.90, 0.78, 0.67, 0.57]) {
      var speed = profile.speed * (pace || 1) * power * speedScale;
      var duration = Math.abs(dz) / speed;
      var v = [dx / duration, Math.min(maxLift,(goal[1] - from[1]) / duration + K.G * duration / 2), sign * speed];
      if (!fallback) fallback = {v:V.copy3(v), w:spin};
      if (tooLow) return fallback;
      for (var fit = 0; fit < 5; fit++) {
        // 先按真实阻力与旋转校准落点，再验证是否过网。
        var landed = V.predictLanding(V.makeBall(from, v, spin), 1.75);
        if (!landed) {
          if (v[1] >= maxLift) break;
          v[1] = Math.min(maxLift, v[1] + .45);
          continue;
        }
        var ex = goal[0] - landed.p[0], ez = goal[2] - landed.p[2];
        v[0] += ex / Math.max(0.12, landed.t) * 0.85;
        v[1] = Math.min(maxLift, v[1] + ez * sign * Math.max(.60, Math.abs(v[1] - K.G * landed.t)) / speed * .74);
      }
      var event = firstLanding(from, v, spin);
      if (event && event.type === 'bounce' && event.side === (by === 'player' ? 'ai' : 'player')) {
        return { v: v, w: spin };
      }
    }
    return by === 'player' || smash ? fallback : null;
  }

  var SERVES = {
    plain:    { label: '不转发球', speed: [4.3, 4.7, 4.0], spin: [0, 0, 0] },
    side:     { label: '侧旋发球', speed: [4.6, 4.2, 5.0], spin: [0, 98, 0] },
    fast:     { label: '快球发球', speed: [7.4, 7.0, 6.6, 6.2, 5.9, 5.6], spin: [0, 0, 0] },
    topspin:  { label: '上旋发球', speed: [4.8, 4.3, 4.0], spin: [-125, 0, 0] },
    backspin: { label: '下旋发球', speed: [4.2, 4.6, 3.8], spin: [115, 0, 0] }
  };

  var verticalSpins = [['topspin', '上旋', -125], ['backspin', '下旋', 115]];
  for (var [sideKey, sideLabel, rotation] of [['leftspin', '左侧旋', 98], ['rightspin', '右侧旋', -98]]) {
    SERVES[sideKey] = { label:sideLabel + '发球', speed:SERVES.side.speed, spin:[0, rotation, 0] };
    for (var [verticalKey, verticalLabel, verticalSpin] of verticalSpins) {
      SERVES[verticalKey + '-' + sideKey] = {
        label:verticalLabel[0] + sideLabel + '发球',
        speed:SERVES[verticalKey].speed, spin:[verticalSpin, rotation, 0]
      };
    }
  }
  for (var [serveKey, profile] of Object.entries(SERVES)) {
    if (serveKey === 'plain' || serveKey === 'fast' || serveKey === 'side') continue;
    SERVES[serveKey + '-fast'] = {
      label:'快速' + profile.label, speed:SERVES.fast.speed, spin:profile.spin
    };
  }

  function serveVariant(keys) {
    var up = keys.has('KeyW'), down = keys.has('KeyS');
    var left = keys.has('KeyA'), right = keys.has('KeyD');
    var vertical = up === down ? '' : up ? 'topspin' : 'backspin';
    var horizontal = (up && down) || left === right ? '' : left ? 'leftspin' : 'rightspin';
    var spin = [vertical, horizontal].filter(Boolean).join('-');
    return keys.has('KeyF') ? (spin ? spin + '-fast' : 'fast') : spin || 'plain';
  }

  function returnVariant(keys, hand) {
    var up = keys.has('KeyW'), down = keys.has('KeyS');
    var left = keys.has('KeyA'), right = keys.has('KeyD');
    var kind = keys.has('KeyF') ? 'smash' : up === down ? 'block' : up ? 'topspin' : 'cut';
    var wing = left === right ? null : (left === (hand === 'left') ? 'forehand' : 'backhand');
    return { kind:kind, side:wing };
  }

  function serveFrom(from, aim, variant) {
    var profile = SERVES[variant];
    var spin = profile ? V.copy3(profile.spin) : [-16, V.clamp((aim[0] - from[0]) * 11, -14, 14), 0];
    if (variant === 'side' && from[0] > .10) spin[1] *= -1;
    var speeds = profile ? profile.speed : [5.0, 4.5, 4.0, 3.5, 5.6];
    for (var speed of speeds) {
      var desiredX = V.clamp((aim[0] - from[0]) * speed / (from[2] + .69), -1.45, 1.45);
      var inwardX = -from[0] * speed * .39;
      for (var vx of [desiredX, inwardX, 0]) {
        for (var vy = -.35; vy >= -17; vy -= .28) {
          var v = [vx, vy, -speed];
          var estimate = V.predictLanding(V.makeBall(from, v, spin), .7);
          if (!estimate || estimate.p[2] < .18 || estimate.p[2] > 1.374 ||
              Math.abs(estimate.p[0]) > T.HALF_W) continue;
          var ball = V.makeBall(from, v, spin);
          var first = false;
          for (var t = 0; t < 1.8 && ball.alive; t += 1 / 120) {
            var events = V.stepBall(ball, 1 / 120);
            if (!events.length) continue;
            if (events[0].type !== 'bounce') break;
            if (first && events[0].side === 'ai') return { v: v, w: spin };
            if (first || events[0].side !== 'player') break;
            first = true;
          }
        }
      }
    }
    return null;
  }

  var CHEST_OVERLAP = .035;

  function returnWing(feet, p, hand, by) {
    var lateral = (p[0] - feet.x) * (hand === 'left' ? -1 : 1);
    if (by === 'ai') lateral = -lateral;
    return lateral < 0 ? 'backhand' : 'forehand';
  }

  function returnReach(feet, p, side, hand) {
    if (p[2] < .34 || p[1] < .59 || p[1] > 1.77) return false;
    var lateral = (p[0] - feet.x) * (hand === 'left' ? -1 : 1);
    var forward = feet.z - p[2];
    var backhand = side === 'backhand';
    // 只在身体中线附近允许两种动作，避免勉强用错侧接球。
    if (backhand ? lateral > CHEST_OVERLAP : lateral < -CHEST_OVERLAP) return false;
    if (forward < .055) return false;
    var wing = (lateral - (backhand ? -.23 : .29)) / (backhand ? .455 : .505);
    var depth = (forward - .36) / .42;
    var height = Math.max(0, Math.abs(p[1] - 1.11) - .12) / .58;
    return wing * wing + depth * depth + height * height <= 1;
  }

  function chooseAssistedStroke(ball, feet, hand) {
    var p = ball.p;
    var side = returnWing(feet, p, hand);
    var kind = p[1] > 1.41 ? 'smash'
      : p[1] < .90 && (p[2] < 1.14 || ball.w[0] < -45) ? 'push'
      : ball.w[0] < -30 || p[1] > 1.11 ? 'topspin'
      : ball.v[2] > 5.1 ? 'block' : 'drive';
    return { kind:kind, side:side };
  }

  function applyShot(ball, by, shot) {
    ball.v = shot.v;
    ball.w = shot.w;
    ball.lastTouch = by;
    ball.bounceCount = 0;
    ball.netTouched = false;
    ball.meta.lastHitAt = ball.t;
  }

  function classify(v, normal, height, depth) {
    var speed = V.len(v);
    var horizontal = Math.hypot(v[0], v[2]);
    if (height > 1.15 && speed > 1.42 && normal[1] < .28 && (v[1] < -.30 || v[2] < -1.16)) return 'smash';
    if (v[1] > .62 && (normal[1] < .26 || horizontal > .62)) return 'topspin';
    if (v[1] > .56 && normal[1] > .26 && depth > 2.27) return 'lob';
    if (v[1] < -.37 && normal[1] > .065) return depth > 2.10 && v[1] < -.77 ? 'chop' : 'push';
    if (horizontal > .72 && (v[2] < -.19 || Math.abs(v[0]) > .72)) return 'drive';
    return 'block';
  }

  NS.court = {
    HOME: HOME, PROFILES: PROFILES, SERVES: SERVES, serveVariant: serveVariant, returnVariant: returnVariant,
    returnWing:returnWing, returnReach:returnReach, strokeWindup:strokeWindup,
    chooseAssistedStroke: chooseAssistedStroke, stance: stance, movePlayer: movePlayer, reachable: reachable,
    receiverReady: receiverReady, sampleContact: sampleContact, launchShot: launchShot,
    serveFrom: serveFrom, applyShot: applyShot, classify: classify
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
