/* 体感乒乓 · 规则状态机（11 分制 / 发球 / 落点合法性 / 换发）
 * 纯逻辑，不碰物理与渲染，方便 node 单测。
 *
 * 状态：ready -> toss -> rally -> point / let -> ready ... -> over
 * 合法发球：端线后抛球至少 16 cm，下落时击球，先落己方再落对方。合法擦网球重发。
 * 回合擦网有效，最终按落点及是否被接回计分。
 */
;(function (G) {
  'use strict';
  var NS = (G.PP = G.PP || {});
  var K = NS.constants;

  function Rules(opts) {
    opts = opts || {};
    this.gameTo = opts.gameTo || K.GAME_TO;
    this.winBy = opts.winBy || K.WIN_BY;
    this.firstServer = opts.firstServer || 'player';
    this.reset();
  }

  Rules.prototype.reset = function () {
    this.state = 'ready';
    this.server = this.firstServer;
    this.score = { player: 0, ai: 0 };
    this.pointsPlayed = 0;
    this.over = false;
    this.winner = null;
    this.lastReason = '';
    this.rally = null;
    this.toss = null;
    this.servePending = false;
  };

  Rules.prototype.snapshot = function () {
    return {
      state: this.state, server: this.server,
      serveNumber: this._deuce() ? 1 : this.pointsPlayed % 2 + 1,
      servesPerTurn: this._deuce() ? 1 : 2,
      score: { player: this.score.player, ai: this.score.ai },
      over: this.over, winner: this.winner, reason: this.lastReason,
      rally: this.rally ? {
        lastHit: this.rally.lastHit,
        expectSide: this.rally.expectSide,
        landed: this.rally.landed,
        serveBounces: this.rally.serveBounces.slice()
      } : null
    };
  };

  Rules.prototype._newRally = function (server) {
    this.rally = {
      server: server,
      lastHit: server,
      expectSide: server,          // 发球第一落点必须在发球方半台
      landed: false,
      serveBounces: [],
      serveNet: false,
      hits: 1
    };
    this.servePending = true;
    this.state = 'rally';
  };

  // 直接设置发球后的回合，用于加载回放和规则测试。
  Rules.prototype.aiServe = function () {
    if (this.state !== 'ready') return false;
    this._newRally(this.server);
    return true;
  };

  Rules.prototype.beginToss = function (ball, by) {
    by = by || 'player';
    if (this.state !== 'ready' || this.server !== by || !ball) return false;
    this.state = 'toss';
    this.toss = {
      startY:ball.p[1], maxY:ball.p[1], rising:true,
      valid:behindEndLine(ball, by) && ball.v[1] > 0 &&
        Math.hypot(ball.v[0],ball.v[2]) <= ball.v[1]*.25 &&
        Math.hypot(...(ball.w || [0,0,0])) < .001
    };
    return true;
  };

  function behindEndLine(ball, by) {
    var ownSide = by === 'player' ? 1 : -1;
    return ball.p[2] * ownSide >= K.TABLE.HALF_L && ball.p[1] > K.TABLE.HEIGHT;
  }

  // 持续检查端线位置和抛球高度。
  Rules.prototype.noteToss = function (ball) {
    if (this.state !== 'toss' || !ball) return;
    if (!behindEndLine(ball, this.server)) this.toss.valid = false;
    if (ball.p[1] > this.toss.maxY) this.toss.maxY = ball.p[1];
    if (ball.v[1] < -0.05) this.toss.rising = false;
  };

  Rules.prototype.tossLegal = function (ball, contactVy) {
    if (!this.toss || !ball) return false;
    return this.toss.valid && behindEndLine(ball, this.server) &&
        (this.toss.maxY - this.toss.startY) >= K.SERVE_TOSS_MIN
        && !this.toss.rising && (contactVy === undefined ? ball.v[1] : contactVy) < 0;
  };

  /* 击球事件。返回 {point, winner, reason} 或 null（正常继续）。 */
  Rules.prototype.onHit = function (by, ball, contactVy) {
    if (this.state === 'toss') {
      if (by !== this.server) return { point:true, winner:this.server, reason:'接发球方提前触球' };
      if (!this.tossLegal(ball, contactVy)) {
        return { point:true, winner:by === 'player' ? 'ai' : 'player', reason:'发球违例：须在端线后抛够 16 厘米并在下落时击球' };
      }
      this._newRally(by);
      this.toss = null;
      return null;
    }
    if (this.state !== 'rally' || !this.rally) return null;
    if (by === this.rally.lastHit) {
      return { point: true, winner: by === 'player' ? 'ai' : 'player', reason: '连击' };
    }
    // 必须在己方半台弹起后才能回击（拦击未落台的球判失分）
    if (!this.rally.landed) {
      return { point: true, winner: by === 'player' ? 'ai' : 'player', reason: '球未落台即回击' };
    }
    this.rally.lastHit = by;
    this.rally.expectSide = (by === 'player' ? 'ai' : 'player');
    this.rally.landed = false;
    this.rally.serveBounces = [];
    this.rally.hits++;
    return null;
  };

  /* 物理事件（bounce / net / out）转判分 */
  Rules.prototype.onEvent = function (ev) {
    if (this.state !== 'rally' || !this.rally) return null;
    var r = this.rally;
    var hitter = r.lastHit;
    var opponent = hitter === 'player' ? 'ai' : 'player';

    if (ev.type === 'net') {
      if (this.servePending) r.serveNet = true;
      return null;
    }
    if (ev.type === 'out') {
      if (!r.landed && r.serveNet) return {point:true, winner:opponent, reason:'发球擦网后未落到对方台面'};
      return r.landed
        ? { point:true, winner:hitter, reason:'对方漏接' }
        : { point:true, winner:opponent, reason:'出界/落地' };
    }
    if (ev.type !== 'bounce') return null;

    if (this.servePending) {
      r.serveBounces.push(ev.side);
      if (r.serveBounces.length === 1) {
        if (ev.side !== r.server) {
          return { point: true, winner: opponent, reason: '发球第一落点未在己方半台' };
        }
        return null;
      }
      if (r.serveBounces.length === 2) {
        var other = r.server === 'player' ? 'ai' : 'player';
        if (ev.side !== other) {
          return { point: true, winner: opponent, reason: '发球未越过球网落到对方半台' };
        }
        if (r.serveNet) return {let:true, reason:'发球擦网，原发球方重发'};
        this.servePending = false;
        r.expectSide = other;
        r.landed = true;
        return null;
      }
      return null;
    }

    if (!r.landed) {
      if (ev.side === r.expectSide) {
        r.landed = true;
        return null;
      }
      return { point:true, winner:opponent, reason:'回球未落到对方半台' };
    }
    // 已经落过一次台，再次弹跳 = 接球方没接到
    return { point: true, winner: hitter, reason: '对方漏接（两次弹跳）' };
  };

  Rules.prototype._deuce = function () {
    return this.score.player >= this.gameTo - 1 && this.score.ai >= this.gameTo - 1;
  };

  Rules.prototype.award = function (winner, reason) {
    if (this.over || this.state === 'point') return;
    winner = winner === 'player' ? 'player' : 'ai';
    this.score[winner]++;
    this.pointsPlayed++;
    this.lastReason = reason || '';
    this.state = 'point';
    this.rally = null;
    this.servePending = false;

    var p = this.score.player, a = this.score.ai;
    if ((p >= this.gameTo || a >= this.gameTo) && Math.abs(p - a) >= this.winBy) {
      this.over = true;
      this.winner = winner;
      this.state = 'over';
      return;
    }
    // 换发：每 2 分换一次；10:10 后每分换发
    var swap = this._deuce() || this.pointsPlayed % 2 === 0;
    if (swap) this.server = this.server === 'player' ? 'ai' : 'player';
  };

  Rules.prototype.nextPoint = function () {
    if (this.over) return false;
    this.state = 'ready';
    this.rally = null;
    this.toss = null;
    this.servePending = false;
    return true;
  };

  NS.rules = { Rules: Rules };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.rules;
})(typeof globalThis !== 'undefined' ? globalThis : this);
