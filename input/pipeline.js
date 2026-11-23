/* 体感乒乓 · 输入装配
 * raw 帧 -> 帧解析 -> 标定 -> 手部/身体追踪 -> 球拍目标 -> Match
 * 这是输入层唯一的对外出口：渲染层完全不需要知道骨骼格式。
 */
;(function (G) {
  'use strict';
  var NS = (G.PP = G.PP || {});
  var V = NS.physics;
  var COCO = NS.constants.COCO;
  var F = NS.frame;
  var S = NS.source;
  var C = NS.calibrator;
  var H = NS.handTracker;
  var B = NS.bodyTracker;
  var Court = NS.court;

  function Pipeline(opts) {
    opts = opts || {};
    this.match = opts.match;
    if (!this.match) throw new Error('Pipeline 需要 match 实例');
    this.part = opts.part || 'right';
    this.mirror = !!opts.mirror;
    this.autoServeGesture = !!opts.autoServeGesture;
    this.hub = new S.PoseHub({ holdMs: opts.holdMs || 300 });
    this.calib = new C.Calibrator(opts.calibrator || {});
    this.hand = new H.HandTracker({ part: this.part });
    this.body = new B.BodyTracker({ part: this.part });
    this.freeHand = new H.HandTracker({ part: this.part === 'right' ? 'left' : 'right' });
    this.strokeFits = {};
    this.recording = null;
    this.currentSide = 'forehand';
    this.previousRelative = null;
    this.swingVelocity = [0, 0, 0];
    this.technique = 'block';
    this.techniqueHold = 0;
    this.assistMotion = null;
    this.frameOpts = { mirror: this.mirror };
    this.pending = null;
    this.inbox = [];
    this.stanceFrames = 0;
    this.lastGood = null;
    this.lastGoodAt = 0;
    this.lastOut = null;
    var self = this;
    this.hub.onFrame(function (raw) {
      self.inbox.push({ raw: raw, time: Date.now() });
      if (self.inbox.length > 8) self.inbox.shift();
    });
  }

  Pipeline.prototype.use = function (source) {
    this.hub.use(source);
    this.pending = this.lastGood = this.lastOut = null;
    this.inbox.length = 0;
    this.lastGoodAt = 0;
    this.recalibrate();
  };
  Pipeline.prototype.status = function () { return this.hub.status(); };
  Pipeline.prototype.recalibrate = function () {
    this.calib.reset(); this.hand.reset(); this.body.reset(); this.freeHand.reset();
    this.inbox.length = 0;
    this.stanceFrames = 0;
    this.recording = this.previousRelative = this.lastOut = null;
    this.swingVelocity = [0, 0, 0];
    this.technique = 'block';
    this.techniqueHold = 0;
    this.assistMotion = null;
  };

  Pipeline.prototype.setPart = function (part) {
    this.part = part === 'left' ? 'left' : 'right';
    this.hand.part = this.body.part = this.part;
    this.freeHand.part = this.part === 'right' ? 'left' : 'right';
    this.currentSide = 'forehand';
    this.strokeFits = {};
    this.recalibrate();
  };

  Pipeline.prototype.captureStroke = function (side) {
    if (!this.calib.isReady() || !this.lastOut || !this.lastOut.hand || !this.lastOut.hand.ok) return false;
    this.recording = { side: side === 'backhand' ? side : 'forehand', samples: [] };
    return true;
  };

  Pipeline.prototype.recordSample = function (state, lateral) {
    var record = this.recording;
    if (!record) return;
    var value = [state.normal[0], state.normal[1], lateral];
    var first = record.samples[0];
    if (first && (Math.hypot(value[0]-first[0], value[1]-first[1]) > .17 || Math.abs(value[2]-first[2]) > .18)) {
      record.samples.length = 0;
    }
    record.samples.push(value);
    if (record.samples.length < 12) return;
    var fitted = value.map(function (_, axis) {
      return record.samples.reduce(function (sum, sample) { return sum + sample[axis]; }, 0) / record.samples.length;
    });
    this.strokeFits[record.side] = fitted;
    this.recording = null;
  };

  Pipeline.prototype.requestServe = function () {
    var out = this.lastOut;
    if (!out || !out.position || !out.hand || !out.hand.ok) return false;
    return this.tossFrom(out.tossPosition || out.position);
  };

  Pipeline.prototype.tossFrom = function (position) {
    var x = V.clamp(position[0], -.69, .69);
    if (Math.abs(position[0] - x) > .22 || position[2] > 2.05) return false;
    return this.match.beginPlayerServe([x, V.clamp(position[1], .97, 1.27), Math.max(1.39,position[2])]);
  };

  Pipeline.prototype.readAssistGesture = function (frame, body, dt, time) {
    var pose = frame.pose17, left = this.part === 'left';
    var wristIndex = left ? COCO.L_WRIST : COCO.R_WRIST;
    var shoulderIndex = left ? COCO.L_SHOULDER : COCO.R_SHOULDER;
    var hand = frame.hands[this.part];
    var skeletalWrist = body.arm?.wrist ? pose[wristIndex] : null;
    var wrist = skeletalWrist || (hand?.valid.includes(0) ? hand.points[0] : null);
    if (!body.ok || !wrist || !Number.isFinite(wrist[0]) || !Number.isFinite(wrist[1])) {
      this.assistMotion = null;
      return null;
    }

    // 距离以肩宽为单位。相对肩中心的轨迹会滤掉整体走位。
    var width = body.shoulderWidth, center = body.shoulderCenter;
    var wingSign = Math.sign(pose[shoulderIndex][0] - center[0]) || (left ? 1 : -1);
    var lateral = (wrist[0] - center[0]) * wingSign / width;
    var x = (wrist[0] - center[0]) / width;
    var y = (center[1] - wrist[1]) / width;
    var ranges = frame.ranges, wristDepth = ranges[wristIndex], shoulderDepth = ranges[shoulderIndex];
    var hasDepth = !!skeletalWrist && Number.isFinite(wristDepth) && Number.isFinite(shoulderDepth);
    var depthScale = shoulderDepth > 20 ? .001 : 1;
    var depth = hasDepth ? (shoulderDepth - wristDepth) * depthScale / .42 : 0;
    var side = lateral < -.10 ? 'backhand' : 'forehand';
    if (hand && hand.ageMs <= 130 && [0, 5, 17].every(function (i) { return hand.valid.includes(i); })) {
      var heel = hand.points[0], index = hand.points[5], pinky = hand.points[17];
      var ix = index[0] - heel[0], iy = index[1] - heel[1];
      var px = pinky[0] - heel[0], py = pinky[1] - heel[1];
      var area = (ix * py - iy * px) * wingSign;
      var palmSize = Math.hypot(ix, iy) * Math.hypot(px, py);
      if (palmSize > .0002 && area < -.27 * palmSize && lateral < .43) side = 'backhand';
    }

    var track = this.assistMotion;
    if (!track || time - track.time > 220 || track.person !== frame.personId ||
        track.skeletal !== !!skeletalWrist || track.depth !== hasDepth) {
      track = this.assistMotion = { history:[], elapsed:0, last:null, hold:0,
        person:frame.personId, skeletal:!!skeletalWrist, depth:hasDepth, side:side };
    }
    track.time = time;
    track.elapsed += dt;
    var recent = track.history;
    var previous = recent[recent.length - 1];
    var alpha = Math.min(1, 1 - Math.exp(-dt / .035));
    var p = previous
      ? [x, y, depth].map(function (value, i) { return previous.p[i] + (value - previous.p[i]) * alpha; })
      : [x, y, depth];
    recent.push({ at:track.elapsed, p:p });
    while (recent.length > 1 && recent[1].at <= track.elapsed - .12) recent.shift();
    var duration = track.elapsed - recent[0].at;
    var displacement = V.sub(p, recent[0].p);
    var travel = V.len(displacement);
    var speed = duration >= .045 ? travel / duration : 0;
    var vertical = speed ? displacement[1] / duration : 0;
    var kind = 'block';
    if (vertical <= -.40 && -vertical >= speed * .45) kind = 'cut';
    else if (speed >= 1.48 || (travel > .205 && vertical >= .30)) kind = 'smash';
    else if (speed >= .30) kind = 'topspin';
    if (kind !== 'block') {
      // 挥拍可以早于触球，短暂保留动作并避免跨胸时突然换正反手。
      var startsSwing = !track.last || track.elapsed > track.hold;
      if (startsSwing) track.side = side;
      if (startsSwing || kind === 'cut' || kind === 'smash' || track.last.kind !== 'smash') {
        track.last = { kind:kind, side:track.side, speed:speed };
        track.hold = track.elapsed + .16;
      }
    }
    return track.elapsed <= track.hold && track.last ? track.last : { kind:'block', side:side, speed:speed };
  };

  Pipeline.prototype.step = function (dt) {
    this.hub.tick();
    var frames = this.inbox.splice(0);
    if (this.pending) {
      frames.push({ raw:this.pending, time:Date.now() });
      this.pending = null;
    }
    for (var sample of frames) {
      var frame = F.parseFrame(sample.raw, this.frameOpts);
      if (!frame.ok) { this.lastParseError = frame.reason; continue; }
      this.lastGood = frame;
      this.sensorStep = this.lastGoodAt ? V.clamp((sample.time - this.lastGoodAt) / 1000 || dt, 1/120, .06) : dt;
      this.lastGoodAt = sample.time;
      var state = this.hand.read(frame, this.sensorStep);
      this.calib.update(frame, state.ok ? state : null);
      var body = this.body.read(frame, this.calib, this.sensorStep);
      if (body.ok) this.stanceFrames = Math.min(12, this.stanceFrames + 1);
      else if (this.stanceFrames < 12) this.stanceFrames = 0;
      var stance = body.locomotion || { x: 0, z: Court.HOME };
      var world = this.calib.map(frame, state.ok ? state : null, this.sensorStep, body.locomotion);
      var relative = [world[0], world[1] + body.stanceOffset[1], world[2] - Court.HOME];
      var position = [stance.x + relative[0], relative[1], stance.z + relative[2]];
      var free = this.freeHand.read(frame, this.sensorStep);
      var tossPosition = null;
      if (free.ok && state.ok && this.calib.base) {
        var shoulder = Math.max(.05, this.calib.base.sw);
        tossPosition = [position[0] + (free.cx-state.cx)/shoulder*.62,
          position[1] + (state.cy-free.cy)/shoulder*.48, position[2]];
      }
      var target = this.hand.paddleTarget(state, position);
      target.assistTechnique = this.readAssistGesture(frame, body, this.sensorStep, sample.time);
      var calibrated = this.calib.isReady();
      if (state.ok && calibrated) {
        var lateral = relative[0] * (this.part === 'left' ? -1 : 1);
        this.recordSample(state, lateral);
        var fh = this.strokeFits.forehand, bh = this.strokeFits.backhand;
        var split = fh && bh && fh[2] - bh[2] > .12 ? (fh[2] + bh[2]) * .5 : -.085;
        if (lateral > split + .055) this.currentSide = 'forehand';
        if (lateral < split - .055) this.currentSide = 'backhand';
        var fit = this.strokeFits[this.currentSide];
        var normal = state.normal.slice();
        if (fit) {
          normal[0] -= fit[0];
          normal[1] -= fit[1];
        }
        var len = V.len(normal);
        target.n = normal.map(function (component) { return component / len; });
        if (this.previousRelative) {
          this.swingVelocity = relative.map(function (value, axis) {
            var velocity = (value - this.previousRelative[axis]) / Math.max(this.sensorStep, 1/120);
            return (velocity * .66 + this.swingVelocity[axis] * .34);
          }, this);
        }
        this.previousRelative = relative;
        var kind = Court.classify(this.swingVelocity, target.n, relative[1], stance.z);
        this.techniqueHold = Math.max(0, this.techniqueHold - this.sensorStep);
        if (kind !== 'block' || !this.techniqueHold) {
          this.technique = kind;
          this.techniqueHold = kind === 'block' ? 0 : .095;
        }
        target.relative = relative;
        target.technique = { kind: this.technique, side: this.currentSide, speed: V.len(this.swingVelocity) };
        target.spinBias = [
          V.clamp((Court.PROFILES[this.technique].spin * -1) / 90, -1.8, 1.8),
          V.clamp(target.n[0] * .27, -.4, .4),
          V.clamp(state.spinBias[2] * .42, -.48, .48)
        ];
      } else {
        this.previousRelative = null;
        this.swingVelocity = [0, 0, 0];
      }

      if (this.autoServeGesture && calibrated && this.match.rules.state === 'ready' &&
          this.match.rules.server === 'player' && tossPosition && this.freeHand.detectToss(free)) {
        this.tossFrom(tossPosition);
      }
      this.lastOut = {
        frame: frame, hand: state, body: body, stance: stance,
        position: position, tossPosition: tossPosition, target: target,
        stanceReady:this.stanceFrames >= 12, stanceProgress:this.stanceFrames / 12,
        calibrated: calibrated, calibrationProgress: this.calib.progress()
      };
    }
    if (this.lastOut && Date.now() - this.lastGoodAt < 260) return this.lastOut;
    return {
      frame: null, hand: null, body: null, stance: null, position: null,
      target: null, stanceReady:false, stanceProgress:0, calibrated: this.calib.isReady(), calibrationProgress: this.calib.progress()
    };
  };

  NS.pipeline = { Pipeline: Pipeline };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.pipeline;
})(typeof globalThis !== 'undefined' ? globalThis : this);
