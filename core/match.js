/* 体感乒乓 · 主循环装配
 * 把 输入层 -> 球拍 -> 物理 -> 规则 -> AI 串起来，纯逻辑、可 node 测试。
 * 渲染层只消费 step() 返回的事件与 snapshot()，不参与任何判定。
 */
;(function (G) {
  'use strict';
  var NS = (G.PP = G.PP || {});
  var K = NS.constants;
  var V = NS.physics;
  var R = NS.rules;
  var A = NS.ai;
  var P = NS.paddle;
  var C = NS.court;

  var SERVE_TOSS_TIME = 80 * K.FIXED_DT;

  function makeToss(p) {
    return V.makeBall(p,[0,2,0],[0,0,0],{lastTouch:'toss',serve:true});
  }

  function Match(opts) {
    opts = opts || {};
    this.difficulty = opts.difficulty || 'normal';
    this.rules = new R.Rules({ firstServer: opts.firstServer || 'player' });
    this.opponentKey = Object.hasOwn(A.CHARACTERS,opts.opponent) ? opts.opponent : 'wang';
    this.playerKey = opts.player === 'ma' ? 'ma' : 'fan';
    this.rng = opts.rng;
    this.opponent = new A.Opponent(this.difficulty, { rng: this.rng, character: this.opponentKey });
    this.playerPaddle = new P.Paddle('player');
    this.ball = null;
    this.playerTarget = null;
    this.playerStance = C.stance();
    this.control = null;
    this.stroke = null;
    this.strokeRequest = null;
    this.returnChoice = null;
    this.autoServe = this.aiDelivery = null;
    this.assistScan = 0;
    this.assistGuide = null;
    this.lastTechnique = { player: null, ai: null };
    this.time = 0;
    this.acc = 0;
    this.pointHold = 0;
    this.autoServeDelay = opts.autoServeDelay === undefined ? 0.7 : opts.autoServeDelay;
    this.playerServeDelay = 2.8;
    this.readyClock = 0;
    this.stats = { rallies: 0, hits: { player: 0, ai: 0 }, maxSpeed: 0 };
    this.log = [];
  }

  Match.prototype.setDifficulty = function (key) {
    if (!K.DIFFICULTY[key]) return false;
    this.difficulty = key;
    this.opponent.setDifficulty(key);
    return true;
  };

  Match.prototype.setOpponent = function (key) {
    if (!Object.hasOwn(A.CHARACTERS,key)) return false;
    this.opponentKey = key;
    this.opponent = new A.Opponent(this.difficulty, { rng:this.rng, character:key });
    return true;
  };

  Match.prototype.setPlayer = function (key) {
    if (key !== 'fan' && key !== 'ma') return false;
    this.playerKey = key;
    return true;
  };

  function readyPaddle(feet,side) {
    return [feet.x+side*.18,1.02,feet.z-.34];
  }

  Match.prototype.setPlayerTarget = function (target) { this.playerTarget = target; };
  Match.prototype.setPlayerControl = function (control) {
    if (!control || !this.control || this.control.mode !== control.mode || this.control.hand !== control.hand || this.control.assist !== control.assist) {
      this.stroke = this.strokeRequest = this.returnChoice = null;
      this.assistGuide = null;
      this.assistScan = 0;
    }
    if (control && this.control?.hand !== control.hand) {
      var p = readyPaddle(this.playerStance,control.hand === 'left' ? -1 : 1);
      this.playerPaddle.p = p;
      this.playerPaddle.prevP = V.copy3(p);
      this.playerPaddle.v = [0,0,0];
      this.playerPaddle.n = [0,0,-1];
    }
    this.control = control;
  };

  Match.prototype.queueReturn = function (choice) {
    var rules = this.rules;
    if (!this.control?.assist || !Object.hasOwn(C.PROFILES, choice.kind) ||
        !(rules.state === 'rally' || ((rules.state === 'ready' || rules.state === 'toss') && rules.server === 'ai'))) return false;
    this.returnChoice = { kind:choice.kind, side:choice.side, expires:this.time + 1.85 };
    return true;
  };

  Match.prototype.requestStroke = function (side, kind, aim, fromChord) {
    var canReplace = fromChord && (this.strokeRequest?.fromChord || (this.stroke?.fromChord && !this.stroke.checked));
    if (!this.control || this.control.mode !== 'keyboard' || ((this.stroke || this.strokeRequest) && !canReplace) ||
        (this.rules.state !== 'toss' && this.rules.state !== 'rally') || (this.rules.state === 'toss' && this.rules.server !== 'player')) return false;
    this.stroke = null;
    this.strokeRequest = {
      side: side === 'backhand' ? 'backhand' : 'forehand',
      kind: C.PROFILES[kind] ? kind : 'drive', aim: V.copy3(aim || [0, K.TABLE.HEIGHT, -0.91]),
      expires: this.time + 0.43, scanAt: this.time, fromChord:!!fromChord
    };
    return true;
  };

  Match.prototype.beginKeyboardServe = function () {
    var feet = this.playerStance;
    var x = V.clamp(feet.x + (this.control.hand === 'left' ? -.17 : .17), -.64, .64);
    var z = 1.40;
    if (Math.abs(x - feet.x) > .58 || Math.abs(feet.z - z) > .79) return false;
    return this.beginPlayerServe([x, K.TABLE.HEIGHT + .23, z]);
  };

  Match.prototype.requestServe = function (variant, aim) {
    if (this.autoServe || this.rules.state !== 'ready' || this.rules.server !== 'player') return false;
    var hand = this.control && this.control.hand === 'left' ? -1 : 1;
    var x = V.clamp(this.playerStance.x, -.50, .50);
    var z = V.clamp(this.playerStance.z, 1.70, 1.86);
    var kind = Object.hasOwn(C.SERVES, variant) ? variant : 'plain';
    this.autoServe = {
      kind:kind, aim:V.copy3(aim || [0, K.TABLE.HEIGHT, -.9]),
      stance:{ x:x, z:z }, origin:[V.clamp(x + hand*.14,-.64,.64), K.TABLE.HEIGHT+.23, 1.40],
      readyTime:this.time+.15, contactTime:null
    };
    this.stroke = this.strokeRequest = null;
    return true;
  };

  Match.prototype.reset = function (firstServer) {
    this.rules.firstServer = firstServer || this.rules.firstServer;
    this.rules.reset();
    this.opponent = new A.Opponent(this.difficulty, { rng:this.rng, character:this.opponentKey });
    this.playerPaddle = new P.Paddle('player');
    this.ball = null;
    this.playerStance = C.stance();
    this.stroke = this.strokeRequest = this.returnChoice = null;
    this.autoServe = this.aiDelivery = this.assistGuide = null;
    this.assistScan = 0;
    this.lastTechnique = { player: null, ai: null };
    this.acc = 0; this.readyClock = 0; this.pointHold = 0;
    this.stats = { rallies: 0, hits: { player: 0, ai: 0 }, maxSpeed: 0 };
  };

  function strokePhase(stroke, time) {
    if (!stroke || time < stroke.start) return null;
    var prep = Math.max(.018,stroke.at-stroke.start);
    var recovery = Math.max(.04,stroke.start+stroke.duration-stroke.at);
    var phase = time <= stroke.at ? .56*V.clamp((time-stroke.start)/prep,0,1)
      : .56 + .44*V.clamp((time-stroke.at)/recovery,0,1);
    return {kind:stroke.kind,side:stroke.side,phase:phase};
  }

  Match.prototype.snapshot = function () {
    return {
      time: this.time,
      difficulty: this.difficulty,
      rules: this.rules.snapshot(),
      ball: this.ball ? {
        p: V.copy3(this.ball.p), v: V.copy3(this.ball.v),
        w: V.copy3(this.ball.w), alive: this.ball.alive,
        lastTouch: this.ball.lastTouch, speed: V.len(this.ball.v)
      } : null,
      paddle: { p: V.copy3(this.playerPaddle.p), v: V.copy3(this.playerPaddle.v),
                n: V.copy3(this.playerPaddle.n) },
      aiPaddle: { p: V.copy3(this.opponent.paddle.p), n: V.copy3(this.opponent.paddle.n) },
      opponent: this.opponentKey,
      player: this.playerKey,
      aiHand: this.opponent.hand,
      serveWaiting: !!this.autoServe,
      serveIn: this.control?.autoServe && !this.autoServe && this.rules.state === 'ready' && this.rules.server === 'player'
        ? Math.max(0, this.playerServeDelay - this.readyClock) : null,
      assistGuide: this.assistGuide,
      returnChoice: this.returnChoice,
      aiStance: this.opponent.stance,
      aiPlan: this.opponent.plan,
      aiServeProgress: this.aiDelivery ? V.clamp(this.ball.t / SERVE_TOSS_TIME,0,1) : null,
      playerStance: Object.assign({}, this.playerStance),
      playerHand: this.control ? this.control.hand : 'right',
      playerStroke: strokePhase(this.stroke,this.time),
      lastTechnique: Object.assign({}, this.lastTechnique),
      stats: this.stats
    };
  };

  /* 玩家发球：把球放到掌心世界坐标，给一个向上的抛球初速。
   * 之后每帧由物理自由落体，玩家在下落阶段挥拍命中才算合规发球。
   */
  Match.prototype.beginPlayerServe = function (handWorld) {
    if (this.rules.state !== 'ready' || this.rules.server !== 'player') return false;
    var p = handWorld || K.PADDLE_HOME;
    var ball = makeToss([p[0],Math.max(p[1],K.TABLE.HEIGHT+.18),p[2]]);
    if (!this.rules.beginToss(ball,'player')) return false;
    this.ball = ball;
    return true;
  };

  Match.prototype._beginAiServe = function () {
    var delivery = this.opponent.serve(!!this.control?.assist);
    if (!delivery) return false;
    var flight = makeToss(delivery.p);
    for (var t = 0; t < SERVE_TOSS_TIME-K.FIXED_DT/2; t += K.FIXED_DT) V.integrate(flight,K.FIXED_DT);
    var p = [delivery.p[0], 2*delivery.p[1]-flight.p[1], delivery.p[2]];
    var toss = makeToss(p);
    if (!this.rules.beginToss(toss,'ai')) return false;
    this.aiDelivery = delivery;
    this.ball = toss;
    return true;
  };

  Match.prototype._advanceAiServe = function (dt, events) {
    var ball = this.ball, delivery = this.aiDelivery;
    var feet = this.opponent.stance, hand = this.opponent.hand === 'left' ? 1 : -1;
    var ready = [feet.x + hand*.17,1,feet.z+.34];
    var phase = V.clamp((ball.t-.13)/(SERVE_TOSS_TIME-.13),0,1);
    var target = ready.map(function (p,i) { return p + (delivery.p[i]-p)*phase; });
    this.opponent.paddle.update(dt,{p:target,n:[0,.05,1]});
    if (ball.t < SERVE_TOSS_TIME-K.FIXED_DT/2) return;
    var contactVy = ball.v[1];
    C.applyShot(ball,'ai',delivery);
    this.aiDelivery = null;
    this._handleHit(events,'ai',ball,{kind:'serve',side:'forehand'},contactVy);
  };

  Match.prototype._emit = function (events, e) {
    events.push(e);
    this.log.push(e);
    if (this.log.length > 200) this.log.shift();
  };

  Match.prototype._award = function (events, winner, reason) {
    this.rules.award(winner, reason);
    this.strokeRequest = this.returnChoice = null;
    this.autoServe = this.aiDelivery = this.assistGuide = null;
    this._emit(events, { type: 'point', winner: winner, reason: reason,
                         score: { player: this.rules.score.player, ai: this.rules.score.ai } });
    this.pointHold = 0;
    if (this.rules.over) this._emit(events, { type: 'over', winner: this.rules.winner });
  };

  Match.prototype._handleHit = function (events, by, ball, technique, contactVy) {
    var serving = this.rules.state === 'toss';
    var res = this.rules.onHit(by, ball, contactVy);
    if (serving && !res) this.stats.rallies++;
    if (by === 'player' && technique?.assisted && !technique.serveType) this.returnChoice = null;
    var kind = technique && technique.kind || 'drive';
    var side = technique && technique.side || 'forehand';
    this.lastTechnique[by] = { kind:kind, side:side, serveType:technique?.serveType, lifted:!!technique?.lifted };
    this.stats.hits[by]++;
    var sp = V.len(ball.v);
    if (sp > this.stats.maxSpeed) this.stats.maxSpeed = sp;
    this._emit(events, { type: serving && by === 'ai' ? 'serve' : 'hit', by: by, speed: sp, spin: V.copy3(ball.w),
      kind:kind, side:side, assisted:!!technique?.assisted, serveType:technique?.serveType, lifted:!!technique?.lifted });
    if (res && res.point) this._award(events, res.winner, res.reason);
  };

  Match.prototype._assistedTechnique = function (fallback) {
    var choice = this.returnChoice;
    if (choice) return { kind:choice.kind, side:choice.side || fallback.side };
    return (this.control.mode === 'pose' && this.playerTarget?.assistTechnique) || fallback;
  };

  Match.prototype._planAssistedReturn = function () {
    var rules = this.rules, ball = this.ball, feet = this.playerStance;
    if (rules.state !== 'rally' || !ball || !ball.alive || ball.lastTouch !== 'ai' || ball.v[2] < .05) {
      this.assistGuide = null;
      return;
    }
    if (this.returnChoice) this.returnChoice.expires = null;
    if (this.time < this.assistScan || this.stroke || this.strokeRequest) return;
    this.assistScan = this.time + .052;
    var match = this, hand = this.control.hand;
    var best = null, guide = null;
    C.sampleContact(ball, rules, 'player', .82, function (probe, eta) {
      var p = probe.p;
      if (eta < .023) return null;
      var info = C.chooseAssistedStroke(probe, feet, hand);
      var technique = match._assistedTechnique(info);
      var heightCost = technique.kind === 'smash'
        ? Math.abs(p[1] - 1.41) * 1.22 : Math.abs(p[1] - 1.06) * .82;
      var ease = heightCost + Math.abs(p[2] - feet.z + .34) * .82 + eta * .32;
      var inRange = C.returnReach(feet, p, technique.side, hand);
      var other = technique.side === 'forehand' ? 'backhand' : 'forehand';
      var switchSide = !inRange && C.returnReach(feet, p, other, hand) ? other : null;
      if (!guide || (switchSide && !guide.switchSide) ||
          (!!switchSide === !!guide.switchSide && ease < guide.cost)) {
        guide = { p:V.copy3(p), cost:ease, switchSide:switchSide };
      }
      if (inRange && (!best || ease < best.cost)) {
        best = { p:V.copy3(p), eta:eta, cost:ease, info:info, technique:technique };
      }
      return null;
    });
    this.assistGuide = best ? { p:best.p, inRange:true }
      : guide && { p:guide.p, inRange:false, switchSide:guide.switchSide };
    if (!best) return;
    var technique = best.technique;
    var prep = C.strokeWindup(technique.kind);
    var corner = this.opponent.stance.x > 0 ? -.55 : .55;
    var aimed = technique.kind === 'smash' || (rules.rally.hits > 4 && rules.rally.hits % 3 === 0);
    var aim = this.control.aim || [aimed ? corner : 0, K.TABLE.HEIGHT, aimed ? -1.17 : -.92];
    this.stroke = {
      kind:technique.kind, side:technique.side,
      fallback:best.info, aim:V.copy3(aim), p:best.p,
      start:this.time + Math.max(0, best.eta-prep), at:this.time+best.eta,
      duration: Math.min(prep,best.eta) + (technique.kind === 'smash' ? .225 : .17), checked:false, assisted:true
    };
  };

  Match.prototype._advanceAutoServe = function () {
    var serve = this.autoServe, now = this.time;
    if (!serve || serve.contactTime !== null || now < serve.readyTime) return;
    if (!this.beginPlayerServe(serve.origin)) {
      this.autoServe = null;
      return;
    }
    serve.contactTime = now + SERVE_TOSS_TIME;
    var estimate = V.makeBall(this.ball.p, this.ball.v, this.ball.w);
    for (var t = 0; t < SERVE_TOSS_TIME-K.FIXED_DT/2; t += K.FIXED_DT) V.stepBall(estimate, K.FIXED_DT);
    this.stroke = {
      kind:'serve', side:'forehand', p:V.copy3(estimate.p), aim:serve.aim,
      start:serve.contactTime-.145, at:serve.contactTime, duration:.31,
      checked:false, assisted:true, serveType:serve.kind
    };
  };

  Match.prototype._keyboardUpdate = function (dt, events) {
    var feet = this.playerStance, hand = this.control.hand === 'left' ? -1 : 1;
    var ball = this.ball, rules = this.rules, now = this.time;
    if (this.control.assist) this._planAssistedReturn();
    var request = this.strokeRequest;
    if (request && now >= request.scanAt) {
      var contact = C.sampleContact(ball, rules, 'player', .40, function (probe, eta) {
        var reachable = rules.state === 'toss' ? C.reachable(feet, probe.p, 'player', request.side, this.control.hand)
          : C.returnReach(feet, probe.p, request.side, this.control.hand);
        if (eta < .032 || !reachable) return null;
        return { p: V.copy3(probe.p), eta: eta };
      }.bind(this));
      request.scanAt = now + .055;
      if (contact) {
        var kind = rules.state === 'toss' ? 'serve' : request.kind;
        var prep = C.strokeWindup(kind);
        this.stroke = {
          kind: kind, side: request.side, aim: request.aim, p: contact.p,
          start: now + Math.max(0, contact.eta - prep), at: now + contact.eta,
          duration: Math.min(prep, contact.eta) + C.PROFILES[kind].duration * .55,
          checked: false, fromChord:request.fromChord
        };
        this.strokeRequest = null;
      } else if (now >= request.expires || (rules.state !== 'toss' && rules.state !== 'rally')) {
        this.strokeRequest = null;
        this._emit(events, { type: 'swing_miss' });
      }
    }

    var ready = readyPaddle(feet,hand);
    var target = { p: ready, n: [0, 0, -1], quality: 1, grip: 1 };
    var swing = this.stroke;
    if (swing?.fallback && !swing.checked) {
      var naturalSide = C.returnWing(feet, swing.p, this.control.hand);
      var intent = this._assistedTechnique({ kind:swing.fallback.kind, side:naturalSide });
      if (!C.returnReach(feet, swing.p, intent.side, this.control.hand)) {
        swing = this.stroke = this.assistGuide = null;
        this.assistScan = now;
      } else if (now + .028 < swing.at && intent.kind !== swing.kind &&
          (intent.kind === 'smash' || swing.kind === 'smash')) {
        // 临时改扣杀时重新选点，避免沿用挡球的低点击球位置。
        this.stroke = null;
        this.assistScan = now;
        this._planAssistedReturn();
        swing = this.stroke;
      } else {
        swing.kind = intent.kind;
        swing.side = intent.side;
      }
    }
    var swinging = swing && now >= swing.start;
    if (swinging) {
      var backhand = swing.side === 'backhand';
      var profile = C.PROFILES[swing.kind], wing = backhand ? -hand : hand;
      var powerStroke = swing.kind === 'smash';
      var lifts = powerStroke && (swing.lifted || (!swing.checked && swing.p[1] < 1.19));
      var lift = lifts ? .25 : powerStroke ? -.23 : profile.lift;
      var t, p;
      if (now <= swing.at) {
        t = V.clamp((now - swing.start) / Math.max(.018, swing.at - swing.start), 0, 1);
        var drive = t*t*(2-t);
        p = swing.p.map(function (v,axis) { return ready[axis]+(v-ready[axis])*drive; });
        var arc = Math.sin(t*Math.PI);
        var width = swing.kind === 'block' ? .027 : backhand ? .095 : powerStroke ? .205 : .16;
        p[0] += wing*arc*width;
        p[1] -= lift*arc*(powerStroke ? .70 : .50);
        p[2] += arc*(backhand ? .060 : powerStroke ? .143 : .095);
      } else {
        t = V.clamp((now - swing.at) / Math.max(.04, swing.start + swing.duration - swing.at), 0, 1);
        p = swing.p.map(function (v, axis) { return v + (ready[axis] - v) * t; });
        var follow = Math.sin(t * Math.PI);
        p[0] -= wing*follow*(swing.kind === 'block' ? .027 : backhand ? .10 : powerStroke ? .193 : .15);
        p[1] += lift*follow;
        p[2] -= follow*(powerStroke ? .143 : .10);
      }
      target.p = p;
      var faceTilt = lifts ? .20 : swing.kind === 'push' || swing.kind === 'cut' ? .28
        : swing.kind === 'block' ? -.035 : -.14;
      target.n = [.15 * wing, faceTilt, -1];
    }
    this.playerPaddle.update(dt, target);

    if (swinging) {
      if (!swing.checked && now + dt * .5 >= swing.at) {
        swing.checked = true;
        var toss = rules.state === 'toss';
        var inRange = ball && ball.alive &&
          (swing.serveType || (toss ? C.reachable(feet, ball.p, 'player', swing.side, this.control.hand)
            : C.returnReach(feet, ball.p, swing.side, this.control.hand))) &&
          V.len(V.sub(ball.p, this.playerPaddle.p)) < (toss ? .15 : K.PADDLE_RADIUS + K.BALL.RADIUS);
        if (inRange && (toss ? rules.tossLegal(ball) : C.receiverReady(rules, 'player'))) {
          var contactVy = ball.v[1];
          var shot = toss ? C.serveFrom(ball.p, swing.aim, swing.serveType) : C.launchShot(ball.p, 'player', swing.kind, swing.aim);
          this.autoServe = this.assistGuide = null;
          if (shot) {
            C.applyShot(ball, 'player', shot);
            swing.lifted = swing.kind === 'smash' && shot.v[1] > .10;
            this._handleHit(events, 'player', ball, swing, contactVy);
          } else if (!swing.assisted) this._emit(events, { type: 'swing_miss' });
        } else if (!swing.assisted) this._emit(events, { type: 'swing_miss' });
        if (swing.serveType) this.autoServe = null;
        if (swing.assisted && !swing.serveType && ball && ball.lastTouch !== 'player') this.stroke = null;
      }
      if (now > swing.start + swing.duration) this.stroke = null;
    }
  };

  Match.prototype._fixed = function (h, events) {
    if (Number.isFinite(this.returnChoice?.expires) && this.time >= this.returnChoice.expires) this.returnChoice = null;
    var rules = this.rules;
    C.movePlayer(this.playerStance, this.autoServe || (this.control && this.control.pausedInput ? null : this.control), h);
    this._advanceAutoServe();

    // --- 准备发球 ---
    if (rules.state === 'ready') {
      if (rules.server === 'player') {
        if (this.control?.autoServe && !this.control.servePicking && !this.autoServe) {
          this.readyClock += h;
          if (this.readyClock >= this.playerServeDelay) this.requestServe('plain');
        }
      } else {
        this.readyClock += h;
        if (this.readyClock >= this.autoServeDelay) {
          this.readyClock = 0;
          if (!this._beginAiServe()) {
            this._emit(events, { type: 'error', reason: '发球求解失败' });
            this.readyClock = -2;
          }
        }
      }
    }

    // --- 抛球 / 回合积分 ---
    if (this.ball && this.ball.alive && (rules.state === 'toss' || rules.state === 'rally')) {
      if (rules.state === 'toss') {
        if (this.ball.t === 0) this._emit(events,{type:'toss',by:rules.server,p:V.copy3(this.ball.p)});
        rules.noteToss(this.ball);
      }
      var evs = V.stepBall(this.ball, h);
      for (var i = 0; i < evs.length; i++) {
        var ev = evs[i];
        this._emit(events, ev);
        if (ev.type === 'bounce') {
          this._emit(events,{type:'sound',name:'bounce',side:ev.side});
        }
        if (rules.state === 'rally') {
          var res = rules.onEvent(ev);
          if (res?.point) { this._award(events,res.winner,res.reason); break; }
          if (res?.let) {
            rules.state = 'let';
            rules.lastReason = res.reason;
            this.ball.alive = false;
            this.stroke = this.strokeRequest = this.returnChoice = this.assistGuide = null;
            this.pointHold = 0;
            this._emit(events,{type:'let',reason:res.reason,server:rules.server});
            break;
          }
        } else if (rules.state === 'toss' && (ev.type === 'out' || ev.type === 'bounce' || ev.type === 'net')) {
          this._award(events,rules.server === 'player' ? 'ai' : 'player','抛球后未合规击球');
          break;
        }
      }
    }

    var aiToss = rules.state === 'toss' && rules.server === 'ai';
    if (aiToss && this.aiDelivery) this._advanceAiServe(h,events);

    if (this.control && (this.control.mode === 'keyboard' || this.control.assist || this.autoServe || this.stroke?.serveType)) {
      this._keyboardUpdate(h, events);
    } else {
      var target = this.playerTarget;
      var poseActive = !this.control || (target && target.relative && target.quality > .14);
      if (target && target.relative && this.control) {
        var feet = this.playerStance;
        target = Object.assign({}, target, {
          p: [feet.x + target.relative[0], target.relative[1], feet.z + target.relative[2]]
        });
      }
      this.playerPaddle.update(h, poseActive ? target : { p: [this.playerStance.x, 1.01, this.playerStance.z - .3] });
      var activeBall = !aiToss && this.ball && this.ball.alive && (rules.state === 'toss' || rules.state === 'rally');
      var legalStroke = activeBall && (!this.control || rules.state === 'toss' || (C.receiverReady(rules, 'player') &&
        C.returnReach(this.playerStance, this.ball.p, target?.technique?.side, this.control.hand)));
      if (poseActive && legalStroke) {
        var vyBefore = this.ball.v[1];
        var hit = this.playerPaddle.tryHit(this.ball, {
          aimAssist: K.DIFFICULTY[this.difficulty].playerAimAssist,
          gesture: this.control && rules.state === 'rally' ? target?.technique : null
        });
        if (hit) this._handleHit(events, 'player', this.ball, rules.state === 'toss'
          ? { kind: 'serve', side: target?.technique?.side } : target?.technique, vyBefore);
      }
    }

    if (!aiToss && rules.state === 'rally' && this.ball && this.ball.alive) {
      var aiOut = this.opponent.update(h, this.ball, rules, this.playerStance, !!this.control?.assist);
      if (aiOut.hit) this._handleHit(events, 'ai', this.ball, aiOut);
    } else if (!aiToss) {
      this.opponent.update(h, null, rules, this.playerStance);
    }

    // 得分或合法擦网后再开始下一次发球。
    if (rules.state === 'point' || rules.state === 'let') {
      this.pointHold += h;
      if (this.pointHold > (rules.state === 'let' ? .85 : 1.2)) {
        rules.nextPoint();
        this.ball = null;
        this.readyClock = 0;
        this._emit(events, { type: 'next_point', server: rules.server });
      }
    }
  };

  /* 外部每帧调用。dt 可变，内部按 FIXED_DT 固定步长积分，保证物理稳定。
   * 返回本帧事件数组供渲染/HUD/音效消费。
   */
  Match.prototype.step = function (dt, playerTarget) {
    if (playerTarget !== undefined) this.playerTarget = playerTarget;
    var events = [];
    this.acc += Math.min(Math.max(dt, 0), 0.10);
    var guard = 0;
    while (this.acc >= K.FIXED_DT && guard++ < 64) {
      this.time += K.FIXED_DT;
      this._fixed(K.FIXED_DT, events);
      this.acc -= K.FIXED_DT;
    }
    return events;
  };

  NS.match = { Match: Match };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.match;
})(typeof globalThis !== 'undefined' ? globalThis : this);
