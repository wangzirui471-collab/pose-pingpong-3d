/* 体感乒乓 · 底层单元测试（node tests/run.js，零依赖）
 * 覆盖：物理 / 碰撞 / 发球求解 / 规则状态机 / 击球 / AI 难度 /
 *       帧解析 / 标定 / 手部与身体追踪 / 全链路集成
 */
'use strict';
var path = require('path');
var ROOT = path.join(__dirname, '..');
[
  'core/constants.js', 'core/physics.js', 'core/paddle.js',
  'core/rules.js', 'core/court.js', 'core/ai.js', 'core/match.js',
  'input/frame.js', 'input/calibrator.js', 'input/hand_tracker.js',
  'input/body_tracker.js', 'input/source.js', 'input/pipeline.js'
].forEach(function (f) { require(path.join(ROOT, f)); });

var PP = globalThis.PP;
var K = PP.constants, V = PP.physics, A = PP.ai, F = PP.frame;
var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')); }
}
function near(a, b, eps) { return Math.abs(a - b) <= eps; }
function finiteVec(v) { return v && v.length === 3 && v.every(function (x) { return isFinite(x); }); }
function section(t) { console.log('\n=== ' + t + ' ==='); }

/* ------------------------------------------------------------------ */
section('1. 常量与难度');
var order = K.DIFFICULTY_ORDER.map(function (k) { return K.DIFFICULTY[k].serveSpeed; });
ok('四档发球速度严格递增', order.every(function (v, i) { return i === 0 || v > order[i - 1]; }), order.join(' -> ') + ' m/s');
ok('球台为 ITTF 尺寸', K.TABLE.LENGTH === 2.74 && K.TABLE.WIDTH === 1.525 && K.TABLE.HEIGHT === 0.76);
ok('球 40mm / 2.7g / 网高 15.25cm', K.BALL.RADIUS === 0.02 && K.BALL.MASS === 0.0027 && K.TABLE.NET_HEIGHT === 0.1525);
ok('物理系数来自 MIT 模型', K.BALL.DRAG_CD === 0.40 && K.BALL.MAGNUS_C_OMEGA === 0.20);

/* ------------------------------------------------------------------ */
section('2. 球体动力学（重力 / 阻力 / 马格努斯）');
// 乒乓球终端速度只有约 8.5 m/s（40mm/2.7g，阻力很大），不能按真空自由落体算
var shortDrop = V.makeBall([0, 2.0, 0], [0, 0, 0], [0, 0, 0]);
for (var sd = 0; sd < 24; sd++) V.integrate(shortDrop, K.FIXED_DT);
ok('短时(0.1s)重力加速度接近 -0.98', near(shortDrop.v[1], -0.98, 0.03), 'vy=' + shortDrop.v[1].toFixed(3));
var b = V.makeBall([0, 2.0, 0], [0, 0, 0], [0, 0, 0]);
for (var i = 0; i < 240; i++) V.integrate(b, K.FIXED_DT);
ok('1s 后趋近乒乓球终端速度(~8.5 m/s)', b.v[1] < -6.5 && b.v[1] > -9.0, 'vy=' + b.v[1].toFixed(3));
ok('有阻力时下落距离小于真空值 4.905m', (2.0 - b.p[1]) < 4.905, 'dy=' + (2.0 - b.p[1]).toFixed(3));

// 球朝 -z 飞时，w=[-x] 是上旋(topsin)，马格努斯力向下
var spinBall = V.makeBall([0, 1.5, 0], [0, 0, -10], [-200, 0, 0]);
var noSpin = V.makeBall([0, 1.5, 0], [0, 0, -10], [0, 0, 0]);
for (var s = 0; s < 60; s++) { V.integrate(spinBall, K.FIXED_DT); V.integrate(noSpin, K.FIXED_DT); }
ok('上旋产生马格努斯下压力', spinBall.p[1] < noSpin.p[1] - 0.001,
   'dy=' + (noSpin.p[1] - spinBall.p[1]).toFixed(4));

var drag = V.makeBall([0, 2, 0], [0, 0, 20], [0, 0, 0]);
V.integrate(drag, K.FIXED_DT);
ok('空气阻力使水平速度衰减', drag.v[2] < 20, 'vz=' + drag.v[2].toFixed(4));

/* ------------------------------------------------------------------ */
section('3. 台面反弹 / 撞网 / 过网');
var drop = V.makeBall([0, 1.60, 0.6], [0, 0, 0], [0, 0, 0]);
var bounceEv = null;
for (var d = 0; d < 600 && !bounceEv; d++) {
  var evs = V.stepBall(drop, K.FIXED_DT);
  for (var e = 0; e < evs.length; e++) if (evs[e].type === 'bounce') bounceEv = evs[e];
}
ok('落到台面产生 bounce 事件', !!bounceEv && bounceEv.side === 'player');
// 直接用碰撞函数测恢复系数，避开离散步进造成的采样误差
var tb = V.makeBall([0, K.TABLE.HEIGHT + K.BALL.RADIUS, 0.6], [0, -3, 0], [0, 0, 0]);
V.bounceOnTable(tb, K.TABLE.HEIGHT + K.BALL.RADIUS);
ok('反弹恢复系数 e≈0.876', near(tb.v[1] / 3, K.BALL.RESTITUTION, 1e-6),
   'e=' + (tb.v[1] / 3).toFixed(4));

var netBall = V.makeBall([0, 0.82, 0.40], [0, 0, -3], [0, 0, 0]);
var netHit = false;
for (var n = 0; n < 200 && netBall.alive; n++) {
  var ne = V.stepBall(netBall, K.FIXED_DT);
  if (ne.some(function (x) { return x.type === 'net'; })) netHit = true;
}
ok('低于网顶的球被判触网', netHit);

var overBall = V.makeBall([0, 1.06, 0.40], [0, 0, -3], [0, 0, 0]);
var bouncedFar = false;
for (var o = 0; o < 260 && overBall.alive; o++) {
  var oe = V.stepBall(overBall, K.FIXED_DT);
  if (oe.some(function (x) { return x.type === 'bounce' && x.side === 'ai'; })) bouncedFar = true;
}
ok('高于网顶的球顺利过网落到对方半台', bouncedFar);

/* ------------------------------------------------------------------ */
section('4. 合法发球求解（四档难度）');
K.DIFFICULTY_ORDER.forEach(function (key) {
  var speed = K.DIFFICULTY[key].serveSpeed;
  var sol = A.solveServe(speed, 'ai');
  ok('[' + K.DIFFICULTY[key].label + '] 找到合法发球', !!sol,
     sol ? ('v=' + sol.v.map(function (x) { return x.toFixed(2); }).join(',') + ' seq=' + sol.seq.join('>')) : 'null');
  if (sol) {
    ok('  水平速度=' + speed + ' m/s', near(Math.abs(sol.v[2]), speed, 1e-9));
    ok('  先落己方半台再落对方', sol.seq[0] === 'ai' && sol.seq[1] === 'player');
  }
});
var playerSol = A.solveServe(6.0, 'player');
ok('玩家发球方向朝对手(-z)', !!playerSol && playerSol.v[2] < 0,
   playerSol ? ('vz=' + playerSol.v[2].toFixed(2)) : 'null');

/* ------------------------------------------------------------------ */
section('5. 规则状态机 / 计分 / 换发');
var R = new PP.rules.Rules({ firstServer: 'player' });
ok('初始玩家发球', R.server === 'player' && R.state === 'ready');
var fake = { p:[0,1,1.40], v:[0,2,0] };
ok('进入抛球阶段', R.beginToss(fake));
R.toss.startY = 0.90; R.toss.maxY = 1.12; R.toss.rising = false;
fake.v = [0, -1.2, 0];
ok('合规抛球后击球进入回合', R.onHit('player', fake) === null && R.state === 'rally');
ok('发球第一落点己方半台', R.onEvent({ type: 'bounce', side: 'player' }) === null);
ok('发球第二落点对方半台', R.onEvent({ type: 'bounce', side: 'ai' }) === null);
ok('发球第二跳后，接球权正确交给 AI', PP.court.receiverReady(R, 'ai'));
ok('AI 回击合法', R.onHit('ai', fake) === null);
ok('球落玩家半台', R.onEvent({ type: 'bounce', side: 'player' }) === null);
var twoBounce = R.onEvent({ type: 'bounce', side: 'player' });
ok('两次弹跳判漏接、AI 得分', !!twoBounce && twoBounce.winner === 'ai', twoBounce && twoBounce.reason);
R.award(twoBounce.winner, twoBounce.reason);
ok('比分 0:1', R.score.player === 0 && R.score.ai === 1);
R.nextPoint(); R.award('player', 'x'); R.nextPoint();
ok('每 2 分换发', R.server === 'ai', 'server=' + R.server);
var R2 = new PP.rules.Rules({ firstServer: 'player' });
for (var q = 0; q < 11; q++) { R2.award('player', 'test'); if (!R2.over) R2.nextPoint(); }
ok('11:0 结束比赛', R2.over && R2.winner === 'player');
var R3 = new PP.rules.Rules({});
fake.v = [0,2,0];
R3.beginToss(fake);
R3.toss.startY = 0.9; R3.toss.maxY = 0.95; R3.toss.rising = false;
fake.v = [0, -1, 0];
var bad = R3.onHit('player', fake);
ok('抛球不足 16cm 判发球违规', !!bad && bad.winner === 'ai');

/* ------------------------------------------------------------------ */
section('6. 球拍击球（冲量 / 方向 / 旋转）');
var pad = new PP.paddle.Paddle('player');
pad.p = [0, 0.98, 1.65];
pad.n = [0, 0, -1];
var incoming = V.makeBall([0, 0.98, 1.65], [1.2, 0, 4.0], [0, 0, 0], { lastTouch: 'ai' });
var hit = pad.tryHit(incoming, { aimAssist: 0 });
ok('命中来球', !!hit);
ok('出球方向反转(vz<0)', !!hit && incoming.v[2] < 0, hit && ('vz=' + incoming.v[2].toFixed(2)));
ok('击球带出旋转', !!hit && V.len(incoming.w) > 0.1, hit && ('|w|=' + V.len(incoming.w).toFixed(1)));
pad.v = [0, 0, -3];
var fast = V.makeBall([0, 0.98, 1.65], [0, 0, 4.0], [0, 0, 0], { lastTouch: 'ai' });
pad.lastHitAt = -10;
var hit2 = pad.tryHit(fast, {});
ok('挥拍加速出球', !!hit2 && V.len(fast.v) > 4.0, hit2 && ('speed=' + V.len(fast.v).toFixed(2)));

/* ------------------------------------------------------------------ */
section('7. 人机难度差异');
var easy = new A.Opponent('novice', { rng: function () { return 0.5; } });
var devil = new A.Opponent('devil', { rng: function () { return 0.5; } });
ok('魔鬼反应更快', devil.cfg.reaction < easy.cfg.reaction);
ok('魔鬼落点更准', devil.cfg.aimError < easy.cfg.aimError);
ok('魔鬼回球更快', devil.cfg.returnSpeed > easy.cfg.returnSpeed);
var aiServe = devil.serve();
ok('AI 能生成合法发球球', !!aiServe && Math.abs(aiServe.v[2]) === devil.cfg.serveSpeed);
ok('AI 发球方向朝玩家(+z)', !!aiServe && aiServe.v[2] > 0);

/* ------------------------------------------------------------------ */
section('8. 感知台帧解析');
function person17(depth, id) {
  var p = [];
  for (var i = 0; i < 17; i++) p.push([0.4 + i * 0.01, 0.3 + i * 0.01, 0.9]);
  return { id: id, pose17: p, range17: Array(17).fill({ valid: true, meters: depth }) };
}
function hand21(part, pid) {
  var pts = [];
  for (var i = 0; i < 21; i++) pts.push([0.5, 0.5, 0.9]);
  return { part: part, person_id: pid, points: pts,
           valid_indices: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],
           state: 'observed' };
}
var raw = { stale: false, people: [person17(1.5, 1), person17(3.2, 2)],
            hands21: [hand21('right', 1), hand21('left', 2)] };
F.resetNearest();
var fr = F.parseFrame(raw, { now: 100 });
ok('只选深度最近的人', fr.ok && fr.personId === 1, 'id=' + fr.personId);
ok('手部按 person_id 关联', Object.keys(fr.hands).length === 1 && !!fr.hands.right);
ok('range17 深度可用', fr.ranges[9] === 1.5);
ok('stale 帧被拒', F.parseFrame({ stale: true, people: [] }).ok === false);

var p33 = [];
for (var z = 0; z < 33; z++) p33.push([0.5, 0.4, 0.123, 0.77]);
var fr33 = F.parseFrame({ stale: false, people: [{ id: 7, pose33: p33,
  range33: Array(33).fill({ valid: true, meters: 1.6 }) }], hands21: [] }, { now: 200 });
ok('33 点置信度取第 4 位(0.77)', !!fr33.ok && fr33.pose17[0][2] === 0.77,
   fr33.ok ? 'conf=' + fr33.pose17[0][2] : fr33.reason);
ok('33->17 映射长度为 17', !!fr33.ok && fr33.pose17.length === 17);

/* ------------------------------------------------------------------ */
section('9. 标定 / 手部追踪 / 身体追踪');
var mock = new PP.source.MockSource({ hz: 60 });
var calib = new PP.calibrator.Calibrator({ frames: 12 });
var ht = new PP.handTracker.HandTracker({ part: 'right' });
var bt = new PP.bodyTracker.BodyTracker({ part: 'right' });
var lastState = null, lastWorld = null;
for (var f = 0; f < 20; f++) {
  var ff = F.parseFrame(mock.makeFrame(f / 60), { now: 300 + f / 60 });
  var st = ht.read(ff, 1 / 60);
  calib.update(ff, st.ok ? st : null);
  lastState = st;
  lastWorld = calib.map(ff, st.ok ? st : null, 1 / 60);
}
ok('12 帧后标定完成', calib.isReady());
ok('掌心中位数可用', lastState.ok && isFinite(lastState.cx) && isFinite(lastState.cy));
ok('握拍程度 0..1', lastState.grip >= 0 && lastState.grip <= 1);
ok('拍面法线为单位向量', finiteVec(lastState.normal) && near(V.len(lastState.normal), 1, 1e-6));
ok('世界坐标有限且在球台附近', finiteVec(lastWorld) &&
   Math.abs(lastWorld[0]) < 1.2 && lastWorld[1] > 0.7 && lastWorld[2] > 0.8,
   lastWorld && lastWorld.map(function (x) { return x.toFixed(3); }).join(','));
var rightFrame = F.parseFrame(mock.makeFrame(0, {}), { now: 400 });
// 手往右：直接构造掌心 x 更大的帧
var rraw = mock.makeFrame(0);
rraw.hands21[0].points.forEach(function (p) { p[0] += 0.08; });
var rf = F.parseFrame(rraw, { now: 401 });
var rs = ht.read(rf, 1 / 60);
var rw = calib.map(rf, rs, 1 / 60);
ok('手往右移动 -> 球拍 x 增大', rw[0] > lastWorld[0], 'x ' + lastWorld[0].toFixed(3) + ' -> ' + rw[0].toFixed(3));
var body = bt.read(ff, calib, 1 / 60);
ok('身体重建肩/肘/腕三点', !!body.arm && finiteVec(body.arm.shoulder) &&
   finiteVec(body.arm.elbow) && finiteVec(body.arm.wrist));
ok('站位偏移有限', finiteVec(body.stanceOffset));

/* ------------------------------------------------------------------ */
section('10. 全链路集成（输入 -> 物理 -> 规则 -> AI）');
var match = new PP.match.Match({ difficulty: 'novice', firstServer: 'ai',
                                 rng: function () { return 0.5; } });
var pipe = new PP.pipeline.Pipeline({ match: match, part: 'right' });
var gotServe = false, gotBounce = false, gotHit = false, gotPoint = false, nan = false;
for (var tick = 0; tick < 60 * 8; tick++) {
  var rawFrame = mock.makeFrame(tick / 60);
  pipe.hub._emit(rawFrame);                 // 直接注入，避免 setInterval
  var out = pipe.step(1 / 60);
  var target = out.target;
  // 模拟"玩家看到球飞过来，把手伸到球位挥拍"：验证击球链路确实能打通
  var pre = match.snapshot();
  if (pre.ball && pre.ball.v[2] > 0 && pre.ball.p[2] > 0.85 && pre.ball.p[2] < 1.95) {
    match.playerPaddle.p = [pre.ball.p[0], pre.ball.p[1], pre.ball.p[2] + 0.03];
    match.playerPaddle.n = [0, 0, -1];
    match.playerPaddle.v = [0, 0, -1.5];
    target = null;                          // 保留手动设置的拍位
  }
  var evs = match.step(1 / 60, target);
  for (var q2 = 0; q2 < evs.length; q2++) {
    var x = evs[q2];
    if (x.type === 'serve') gotServe = true;
    if (x.type === 'bounce') gotBounce = true;
    if (x.type === 'hit') gotHit = true;
    if (x.type === 'point') gotPoint = true;
  }
  var snap = match.snapshot();
  if (snap.ball && (!finiteVec(snap.ball.p) || !finiteVec(snap.ball.v))) nan = true;
  if (!finiteVec(snap.paddle.p)) nan = true;
}
ok('AI 完成发球', gotServe);
ok('球有落台', gotBounce);
ok('产生击球事件', gotHit);
ok('产生得分并进入下一分', gotPoint);
ok('8 秒内无 NaN / 数值爆炸', !nan);
ok('比分正常累加', match.rules.score.player + match.rules.score.ai >= 1,
   JSON.stringify(match.rules.score));
// 回归：曾经 pipeline 先清空 pending 再解析 null，帧全被丢掉却不报错
ok('pipeline 真正解析了注入帧', !!(pipe.lastGood && pipe.lastGood.ok),
   pipe.lastParseError || '');
ok('手部 21 点驱动球拍', !!(pipe.lastOut && pipe.lastOut.hand && pipe.lastOut.hand.ok));
ok('站姿标定完成', pipe.calib.isReady(), 'progress=' + pipe.calib.progress().toFixed(2));

/* ------------------------------------------------------------------ */
section('11. 3D 渲染层 IK / 挥拍包络（不启动 WebGL）');
require(path.join(ROOT, 'render/scene3d.js'));
var R3 = PP.render3d;
function dist3(a, b) {
  return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2) + Math.pow(a[2] - b[2], 2));
}
var sh3 = [0.205, 1.375, 0.012];
[[[0.30, 1.05, 0.35], true], [[0.80, 1.20, 0.40], false],
 [[0, 0.90, 0], true]].forEach(function (c) {
  var ik = R3.solveIK(sh3, c[0], 0.315, 0.285, [0.45, -0.75, 0.25]);
  ok('IK 臂长守恒 W=' + c[0].join(','),
     Math.abs(dist3(sh3, ik.elbow) - 0.315) < 1e-6 &&
     Math.abs(dist3(ik.elbow, ik.wrist) - 0.285) < 1e-6 &&
     ik.reachable === c[1], 'reachable=' + ik.reachable);
});
var se0 = R3.swingEnvelope(-1, 1), se1 = R3.swingEnvelope(0.46, 1),
    se2 = R3.swingEnvelope(0.85, 1);
ok('挥拍包络：未触发时零偏移', finiteVec(se0) && se0[2] === 0);
ok('挥拍包络：击球瞬间向前送拍', se1[2] > 0, 'z=' + se1[2].toFixed(3));
ok('挥拍包络：随挥回落', se2[2] < R3.swingEnvelope(0.60, 1)[2] &&
    Math.abs(R3.swingEnvelope(1, 1)[2]) < 1e-9);

/* ------------------------------------------------------------------ */
section('12. 自动接发球');
function playTicks(match, ticks) {
  var events = [];
  for (var tick = 0; tick < ticks; tick++) events.push(...match.step(1/120));
  return events;
}
var assisted = new PP.match.Match({difficulty:'novice',firstServer:'player',rng:()=>.5});
assisted.setPlayerControl({mode:'keyboard',hand:'right',assist:true,autoServe:true,move:[0,0]});
var played = playTicks(assisted,900);
ok('开局无需按键就能发不转球', played.some(e=>e.by==='player' && e.serveType==='plain'));
ok('新手模式站在中间能打出多个来回', played.filter(e=>e.type==='hit').length>=4);
ok('自动回击带球技', played.some(e=>e.by==='player' && e.assisted && e.kind!=='serve'));

for (var preset of ['plain','side','fast','topspin','backspin']) {
  var serving = new PP.match.Match({difficulty:'novice',firstServer:'player',rng:()=>.5});
  serving.setPlayerControl({mode:'pose',hand:'right',assist:true,move:[0,0]});
  serving.requestServe(preset);
  var actions = playTicks(serving,260);
  var sides = actions.filter(e=>e.type==='bounce').slice(0,2).map(e=>e.side).join('/');
  var served = actions.find(e=>e.by==='player' && e.serveType===preset);
  ok(PP.court.SERVES[preset].label + '先后落在两侧桌面', sides==='player/ai' && !!served);
  if (preset==='side') ok('侧旋使用竖轴旋转', Math.abs(served?.spin[1])>70);
  if (preset==='topspin') ok('上旋使用正确转向', served?.spin[0]<-100);
  if (preset==='backspin') ok('下旋使用相反转向', served?.spin[0]>100);
}
var standing = new PP.pipeline.Pipeline({match:assisted});
var stanceOutput;
for (var f=0;f<15;f++) {
  var bodyOnly = mock.makeFrame(0);
  delete bodyOnly.hands21;
  standing.pending=bodyOnly;
  stanceOutput=standing.step(1/60);
}
ok('只有身体骨骼也能完成自动模式的站姿标定', stanceOutput.stanceReady && !stanceOutput.calibrated && stanceOutput.body.ok);

section('13. 组合发球和体感辅助回球');
var court = PP.court;
var combinations = [
  ['', 'plain'], ['W','topspin'], ['S','backspin'], ['A','leftspin'], ['D','rightspin'],
  ['WA','topspin-leftspin'], ['WD','topspin-rightspin'],
  ['SA','backspin-leftspin'], ['SD','backspin-rightspin'], ['WAD','topspin'], ['WS','plain'], ['WSA','plain']
];
function modifiers(keys) { return new Set(Array.from(keys, key => 'Key' + key)); }
for (var [keys, normal] of combinations) {
  var faster = normal === 'plain' ? 'fast' : normal + '-fast';
  var variants = [court.serveVariant(modifiers(keys)), court.serveVariant(modifiers(keys+'F'))];
  ok('发球组合 ' + (keys || '空格') + ' 可叠加 F', variants[0] === normal && variants[1] === faster);
  var legal = [-.64, 0, .64].every(x => {
    var from = [x,.99,1.40], aim = [0,K.TABLE.HEIGHT,-1];
    var shots = variants.map(variant => court.serveFrom(from, aim, variant));
    return shots.every(Boolean) && shots[0].w.every((w,i) => w === shots[1].w[i])
      && shots[1].v[2] < shots[0].v[2] - .45 && shots.every(shot => {
        var ball = V.makeBall(from, shot.v, shot.w), sides = [];
        for (var step=0; step<200 && ball.alive && sides.length<2; step++)
          for (var event of V.stepBall(ball,1/120)) if (event.type==='bounce') sides.push(event.side);
        return sides.join('/') === 'player/ai';
      });
  });
  ok(court.SERVES[normal].label + '及快版先落己方再过网，F 保留旋转并加快', legal);
}
var upperLeft = court.SERVES['topspin-leftspin'].spin;
var upperRight = court.SERVES['topspin-rightspin'].spin;
ok('上左旋和上右旋都含上旋，侧旋方向相反', upperLeft[0] < 0 && upperRight[0] < 0 && upperLeft[1] > 0 && upperRight[1] < 0);
var testStance = {x:0,z:1.85};
ok('正反手分别只覆盖自己一侧和胸前', court.returnReach(testStance,[.45,1.02,1.48],'forehand','right') &&
  !court.returnReach(testStance,[.45,1.02,1.48],'backhand','right') &&
  court.returnReach(testStance,[-.42,1.02,1.48],'backhand','right') &&
  !court.returnReach(testStance,[-.42,1.02,1.48],'forehand','right') &&
  ['forehand','backhand'].every(side => court.returnReach(testStance,[0,1.04,1.48],side,'right')));
ok('左手持拍时，正反手方向跟随持拍手镜像',
  court.returnReach(testStance,[-.45,1.02,1.48],'forehand','left') &&
  !court.returnReach(testStance,[-.45,1.02,1.48],'backhand','left') &&
  court.returnReach(testStance,[.42,1.02,1.48],'backhand','left'));
var offsetStance = {x:.31,z:1.85};
ok('自动正反手沿身体中线判断，左右手和对手朝向分别镜像',
  ['player','ai'].every(by => ['right','left'].every(hand => {
    var side = (by === 'ai' ? -1 : 1) * (hand === 'left' ? -1 : 1);
    return [.04,.32].every(offset =>
      court.returnWing(offsetStance,[offsetStance.x+side*offset,1.02,1.48],hand,by) === 'forehand' &&
      court.returnWing(offsetStance,[offsetStance.x-side*offset,1.02,1.48],hand,by) === 'backhand');
  })));
ok('轻微偏离身体中线也不应强行用另一侧接球',
  ['right','left'].every(hand => {
    var side = hand === 'left' ? -1 : 1;
    return !court.returnReach(offsetStance,[offsetStance.x+side*.08,1.02,1.48],'backhand',hand) &&
      !court.returnReach(offsetStance,[offsetStance.x-side*.08,1.02,1.48],'forehand',hand);
  }));
ok('过远、过短、身后及太低的球超出伸拍范围',
  !court.returnReach(testStance,[1.01,1.02,1.48],'forehand','right') &&
  !court.returnReach(testStance,[.3,1.02,.72],'forehand','right') &&
  !court.returnReach(testStance,[.3,1.02,2.15],'forehand','right') &&
  !court.returnReach(testStance,[.3,.42,1.48],'forehand','right'));

function synthesizeStroke(start, dx, dy, part, palmBack, flip) {
  var pm = new PP.match.Match({difficulty:'novice',firstServer:'ai',rng:()=>.5});
  var sensor = new PP.pipeline.Pipeline({match:pm,part:part});
  sensor.frameOpts.flipX = flip;
  var now = Date.now(), emitted;
  for (var sample=0; sample<20; sample++) {
    var raw = mock.makeFrame(0);
    var p = raw.people[0].pose17, i = part==='left' ? K.COCO.L_WRIST : K.COCO.R_WRIST;
    var phase = Math.max(0,sample-11)/8;
    var x = start + dx*phase, y = .53 + dy*phase;
    p[i] = [x,y,.98];
    raw.hands21 = [];
    if (palmBack) {
      var sign = part==='left' ? -1 : 1;
      var points = Array.from({length:21}, () => [x,y,1]);
      points[5] = [x+.023*sign,y-.042,1];
      points[17] = [x-.023*sign,y-.042,1];
      raw.hands21 = [{ part:part, person_id:1, state:'observed', points:points }];
    }
    sensor.inbox.push({raw:raw,time:now-200+sample*17});
    emitted = sensor.step(1/60).target.assistTechnique;
  }
  pm.setPlayerControl({mode:'pose',hand:part,assist:true,autoServe:true,move:[0,0]});
  pm.setPlayerTarget({assistTechnique:emitted});
  var handSide = part === 'left' ? -1 : 1;
  setIncomingBall(pm, .23*handSide*(emitted?.side === 'backhand' ? -1 : 1));
  var hit = playTicks(pm,710).find(e => e.type==='hit' && e.by==='player');
  return { gesture:emitted, hit:hit };
}
var poses = [
  [.45,0,0,'right',false,false,'backhand','block'],
  [.63,.016,-.018,'right',false,false,'forehand','topspin'],
  [.45,-.020,-.018,'right',false,true,'backhand','topspin'],
  [.61,.010,.073,'right',false,false,'forehand','cut'],
  [.44,-.012,.073,'right',false,false,'backhand','cut'],
  [.62,-.108,-.077,'right',false,false,'forehand','smash'],
  [.46,-.064,-.080,'right',false,false,'backhand','smash'],
  [.54,0,-.065,'right',true,true,'backhand','smash'],
  [.37,.088,-.074,'left',false,false,'forehand','smash']
];
for (var [start, dx, dy, hand, palm, flip, strokeSide, kind] of poses) {
  var outcome = synthesizeStroke(start, dx, dy, hand, palm, flip);
  var note = strokeSide + ':' + kind + (palm ? '（手背）' : '') + (flip ? '（镜像）' : '');
  ok('骨骼识别 ' + note, outcome.gesture?.kind === kind && outcome.gesture?.side === strokeSide,
    JSON.stringify(outcome.gesture));
  ok('自动回球采用识别到的球技 ' + note, outcome.hit?.kind === kind && outcome.hit?.side === strokeSide && outcome.hit.assisted,
    JSON.stringify(outcome.hit));
}

section('14. 回球组合键');
var returnChords = [
  ['', 'block', null], ['W', 'topspin', null], ['S', 'cut', null], ['F', 'smash', null],
  ['A', 'block', 'backhand'], ['D', 'block', 'forehand'],
  ['WA', 'topspin', 'backhand'], ['WD', 'topspin', 'forehand'],
  ['SA', 'cut', 'backhand'], ['SD', 'cut', 'forehand'],
  ['WFA', 'smash', 'backhand'], ['DF', 'smash', 'forehand'],
  ['WSA', 'block', 'backhand'], ['WAD', 'topspin', null]
];
for (var [keys, kind, wing] of returnChords) {
  var choice = court.returnVariant(modifiers(keys));
  ok('回球组合 ' + (keys || '空格') + ' 对应指定动作', choice.kind === kind && choice.side === wing);
}
ok('左手回球时 A 选左侧正手，D 选右侧反手',
  court.returnVariant(modifiers('WA'),'left').side === 'forehand' &&
  court.returnVariant(modifiers('DF'),'left').side === 'backhand' &&
  court.returnVariant(modifiers('WAD'),'left').side === null);

var returnMatch = new PP.match.Match({difficulty:'novice',firstServer:'ai',rng:()=>.5});
returnMatch.setPlayerControl({mode:'pose',hand:'right',assist:true,move:[0,0]});
returnMatch.setPlayerTarget({assistTechnique:{kind:'block',side:'backhand'}});
setIncomingBall(returnMatch, -.19);
for (var tick=0; tick<300 && !returnMatch.stroke?.fallback; tick++) returnMatch.step(1/120);
ok('已安排自动接球时仍可选动作', !!returnMatch.stroke?.fallback &&
  returnMatch.queueReturn(court.returnVariant(modifiers('WFA'))));
var keyedEvents = playTicks(returnMatch, 450).filter(e=>e.type==='hit' && e.by==='player');
ok('键盘动作覆盖这一拍的姿势并真实出球',
  keyedEvents[0]?.kind === 'smash' && keyedEvents[0]?.side === 'backhand' && keyedEvents[0]?.assisted &&
  keyedEvents[0]?.spin[0] <= -court.PROFILES.smash.spin);
setIncomingBall(returnMatch, .06);
returnMatch.setPlayerTarget({assistTechnique:{kind:'block',side:'forehand'}});
var nextHit = firstReturn(returnMatch).hit;
ok('一次组合仅影响一拍，后续恢复体感动作', nextHit?.kind === 'block' &&
  nextHit?.side === 'forehand' && !returnMatch.returnChoice);

returnMatch.reset('ai');
returnMatch.autoServeDelay = 3;
ok('对方准备发球时可以提前选接球动作', returnMatch.queueReturn(court.returnVariant(modifiers('SA'))));
playTicks(returnMatch, 276);
ok('超过预选窗口清空陈旧的回球组合', !returnMatch.returnChoice);
returnMatch.reset('player');
ok('己方准备发球时，回球组合不接管发球', !returnMatch.queueReturn(court.returnVariant(modifiers('S'))));

section('15. 自动接球受手臂范围和拍面动作限制');
function incomingBall(x, options) {
  var m = new PP.match.Match({difficulty:'novice',firstServer:'ai',rng:()=>.5});
  m.setPlayerControl({mode:options.mode || 'keyboard',hand:options.hand || 'right',
    assist:true,move:[0,0]});
  m.playerStance.x = options.playerX || 0;
  m.playerStance.z = options.playerZ || court.HOME;
  setIncomingBall(m, x);
  return m;
}
function setIncomingBall(m, x) {
  m.rules.firstServer = 'ai';
  m.rules.reset();
  m.stroke = null;
  m.assistScan = 0;
  m.rules.aiServe();
  m.rules.onEvent({type:'bounce',side:'ai'});
  m.rules.onEvent({type:'bounce',side:'player'});
  m.ball = V.makeBall([x,1.02,1.22],[0,.65,3.5],[0,0,0],{lastTouch:'ai'});
}
function firstReturn(m) {
  var actions = playTicks(m,115);
  return { hit:actions.find(e=>e.type==='hit' && e.by==='player'),
    loss:actions.some(e=>e.type==='point' && e.winner==='ai') };
}

var goodForehand = incomingBall(.45, {});
ok('站位合适时，自动正手仍能正常接球', firstReturn(goodForehand).hit?.side==='forehand');
var goodBackhand = incomingBall(-.42, {});
ok('站位合适时，自动反手仍能正常接球', firstReturn(goodBackhand).hit?.side==='backhand');
var missedForehand = incomingBall(.45, {});
missedForehand.queueReturn(court.returnVariant(modifiers('WA')));
var miss = firstReturn(missedForehand);
ok('右侧来球指定反手时，球通过并按正常规则丢分', !miss.hit && miss.loss);
var missedBackhand = incomingBall(-.42, {mode:'pose'});
missedBackhand.setPlayerTarget({assistTechnique:{kind:'smash',side:'forehand'}});
miss = firstReturn(missedBackhand);
ok('左侧来球摆出正手手势时，辅助不跨身补打', !miss.hit && miss.loss);
var farReach = incomingBall(.22, {playerX:-1.15});
miss = firstReturn(farReach);
ok('偏站太远，辅助放过合法来球', !miss.hit && miss.loss);
var lateSide = incomingBall(.45, {});
for (var tick=0; tick<20 && !lateSide.stroke?.fallback; tick++) lateSide.step(1/120);
ok('来球最初有自动挥拍计划', !!lateSide.stroke?.fallback);
lateSide.queueReturn(court.returnVariant(modifiers('A')));
miss = firstReturn(lateSide);
ok('挥拍计划形成后改反手，仍会检查范围与方向', !miss.hit && miss.loss);
var moved = incomingBall(.45, {});
for (var tick=0; tick<20 && !moved.stroke?.fallback; tick++) moved.step(1/120);
moved.playerStance.x = -1.2;
miss = firstReturn(moved);
ok('安排挥拍后离开可接球位置，也会放过来球', !miss.hit && miss.loss);
var leftHanded = incomingBall(-.45,{hand:'left'});
leftHanded.queueReturn(court.returnVariant(modifiers('A'),'left'));
ok('左手持拍可在场地左侧用正手', firstReturn(leftHanded).hit?.side==='forehand');

section('16. 正式发球、擦网和边缘碰撞');
function contacts(ball, limit) {
  var events = [];
  for (var i=0; i<limit && ball.alive; i++) events.push(...V.stepBall(ball,K.FIXED_DT));
  return events;
}
var graze = contacts(V.makeBall([0,K.TABLE.NET_TOP+.013,.05],[0,.1,-4]),240);
ok('碰到网绳的球减速后可以落到对面', graze[0]?.type==='net' &&
  graze.some(e=>e.type==='bounce' && e.side==='ai'));
var edge = contacts(V.makeBall([K.TABLE.HALF_W+.012,1.01,.90],[0,-1,0]),240);
ok('真实擦到上缘才算弹台，且弹向桌外', edge[0]?.type==='bounce' && edge[0]?.edge &&
  edge.find(e=>e.type==='out')?.p[0] > K.TABLE.HALF_W+.04);
var missEdge = contacts(V.makeBall([K.TABLE.HALF_W+.024,1.01,.90],[0,-1,0]),240);
ok('仅接近桌沿或桌子的垂直侧面不会被判落台', missEdge[0]?.type==='out');
var netService = new PP.rules.Rules({firstServer:'ai'});
netService.aiServe();
netService.onEvent({type:'bounce',side:'ai'});
netService.onEvent({type:'net'});
var letServe = netService.onEvent({type:'bounce',side:'player'});
ok('擦网发球合法落台，应重发且不计分', !!letServe?.let);
var netReturn = new PP.rules.Rules({firstServer:'ai'});
netReturn.aiServe();
netReturn.onEvent({type:'bounce',side:'ai'});
netReturn.onEvent({type:'bounce',side:'player'});
var repeatHit = netReturn.onHit('ai');
ok('同一人不能连续击球', repeatHit?.point && repeatHit.winner==='player');
netReturn.onHit('player');
ok('回合擦网后在对方台面落球继续打', netReturn.onEvent({type:'net'})===null &&
  netReturn.onEvent({type:'bounce',side:'ai'})===null && court.receiverReady(netReturn,'ai'));
var low = [0,.83,1.47], lowSmash = court.launchShot(low,'player','smash',[0,.76,-1.08]);
var lowFlight = lowSmash && contacts(V.makeBall(low,lowSmash.v,lowSmash.w),240);
ok('低点击球的扣杀不自动托高过网', !!lowFlight && lowSmash.v[1]<0 &&
  !lowFlight.some(e=>e.type==='bounce' && e.side==='ai'));
var servingAi = new PP.match.Match({firstServer:'ai',difficulty:'novice',rng:()=>.5});
servingAi.setPlayerControl({mode:'keyboard',hand:'right',assist:true,move:[0,0]});
var aiSequence = playTicks(servingAi,230);
ok('AI 先抛球，从本方端线后下落时才击球', aiSequence.findIndex(e=>e.type==='toss' && e.by==='ai')>=0 &&
  aiSequence.findIndex(e=>e.type==='serve' && e.by==='ai')>aiSequence.findIndex(e=>e.type==='toss') &&
  aiSequence.find(e=>e.type==='toss' && e.by==='ai')?.p[2]<-K.TABLE.HALF_L);

var rotation = new PP.rules.Rules({firstServer:'player'});
var sequence = [];
for (var i=0; i<20; i++) {
  sequence.push(rotation.server);
  rotation.award(i%2 ? 'ai' : 'player');
  rotation.nextPoint();
}
ok('10 平前严格每两分换发，10 平后每分换发', sequence.join('') === 'playerplayeraiai'.repeat(5) &&
  rotation.server==='player' && rotation.snapshot().servesPerTurn===1);
rotation.award('player');
rotation.nextPoint();
ok('11 比 10 未结束，改为另一人发一球', !rotation.over && rotation.server==='ai');
rotation.award('player');
ok('12 比 10 领先两分才获胜', rotation.over && rotation.winner==='player');

var realLet = new PP.match.Match({firstServer:'ai',autoServeDelay:2});
realLet.rules.aiServe();
realLet.rules.onEvent({type:'bounce',side:'ai'});
realLet.ball = V.makeBall([0,K.TABLE.NET_TOP+.013,-.05],[0,.1,4],null,{lastTouch:'ai'});
var letTrace = playTicks(realLet,165);
ok('擦网球真实落台后自动安排重发，保留分数及发球顺序',
  letTrace.some(e=>e.type==='let' && e.server==='ai') && letTrace.some(e=>e.type==='next_point' && e.server==='ai') &&
  realLet.rules.score.player===0 && realLet.rules.score.ai===0 && realLet.rules.snapshot().serveNumber===1);

var fault = new PP.match.Match({firstServer:'player'});
fault.setPlayerControl({mode:'keyboard',hand:'right',assist:false,autoServe:false,move:[0,0]});
fault.beginPlayerServe([0,1.0,1.44]);
var faultTrace = playTicks(fault,135);
ok('已经抛球但未击出，算发球失误', faultTrace.some(e=>e.type==='point' && e.winner==='ai') &&
  fault.rules.snapshot().serveNumber===2);
var illegal = new PP.rules.Rules({});
var illegalBall = V.makeBall([0,1.0,1.28],[0,2,0]);
illegal.beginToss(illegalBall);
illegal.toss.maxY = 1.20;
illegal.toss.rising = false;
illegalBall.v[1] = -1;
ok('在球台端线内击球算违例', illegal.onHit('player',illegalBall)?.winner==='ai');

section('17. 主动扣杀和提拉');
function smashBall(from, aim) {
  var shot = court.launchShot(from,'player','smash',aim);
  var trace = contacts(V.makeBall(from,shot.v,shot.w),280);
  return {shot:shot, landing:trace.find(e=>e.type==='bounce'), net:trace.some(e=>e.type==='net')};
}
var attacks = [[.42,1.02,1.72],[-.48,1.08,2.22],[.25,.97,1.60]].map(p=>smashBall(p,[0,.76,-1.10]));
ok('略低但够得着的球可先提拉，再带上旋落到对面', attacks.every(result=>result.shot.v[1]>0 &&
  result.shot.w[0]<-65 && result.landing?.side==='ai'));
var higher = smashBall([.36,1.48,1.75],[-.55,.76,-1.18]);
ok('可及高球使用更快的向下扣杀并落在对方台面', higher.shot.v[1]<0 && higher.shot.v[2]<-10 &&
  higher.landing?.side==='ai' && !higher.net);

var peakAttack = incomingBall(.23,{});
peakAttack.ball = V.makeBall([.23,.91,1.09],[0,3.18,1.65],null,{lastTouch:'ai'});
peakAttack.queueReturn({kind:'block',side:'forehand'});
for (var i=0;i<8 && !peakAttack.stroke;i++) peakAttack.step(1/120);
var previousHeight = peakAttack.stroke?.p[1];
peakAttack.queueReturn({kind:'smash',side:'forehand'});
peakAttack.step(1/120);
ok('扣杀改选更高的可达击球点', Number.isFinite(previousHeight) && peakAttack.stroke?.p[1]>previousHeight+.08,
  '挡球高度=' + previousHeight + '，扣球高度=' + peakAttack.stroke?.p[1]);
var peakHit = firstReturn(peakAttack);
ok('调整击球点后，高弹来球确实用扣杀回击', peakHit.hit?.kind==='smash' && peakHit.hit?.side==='forehand');

section('18. 球员与对手切换');
var rosterMatch = new PP.match.Match({player:'ma',opponent:'ovtcharov'});
ok('马龙与奥恰洛夫可直接开局', rosterMatch.snapshot().player === 'ma' &&
  rosterMatch.snapshot().opponent === 'ovtcharov' && rosterMatch.snapshot().aiHand === 'right');
ok('孙颖莎切换后以右手开局', rosterMatch.setOpponent('sun') &&
  rosterMatch.snapshot().opponent === 'sun' && rosterMatch.snapshot().aiHand === 'right');
rosterMatch.reset('ai');
ok('重开保留出场球员、对手与持拍手', rosterMatch.snapshot().player === 'ma' &&
  rosterMatch.opponent.character === 'sun' && rosterMatch.opponent.hand === 'right');
ok('非法角色键保留原选择，可切回樊振东与左手王楚钦', !rosterMatch.setPlayer('other') &&
  !rosterMatch.setOpponent('toString') && rosterMatch.playerKey === 'ma' && rosterMatch.opponentKey === 'sun' &&
  rosterMatch.setPlayer('fan') && rosterMatch.setOpponent('wang') && rosterMatch.snapshot().aiHand === 'left');

console.log('\n========================================');
console.log('  PASS ' + pass + '   FAIL ' + fail);
console.log('========================================');
process.exit(fail ? 1 : 0);
