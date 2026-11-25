;(function () {
  'use strict';
  var PP = window.PP, K = PP.constants, V = PP.physics, shots = PP.court.PROFILES;
  var $ = function (id) { return document.getElementById(id); };
  var match = new PP.match.Match({ difficulty: 'novice', firstServer: 'player' });
  var playerHand = 'right', playerGrip = 'athlete';
  try {
    if (localStorage.getItem('pp3d-player-hand') === 'left') playerHand = 'left';
    if (localStorage.getItem('pp3d-player-grip') === 'penhold') playerGrip = 'penhold';
  } catch (_) {}
  var pipe = new PP.pipeline.Pipeline({match:match,part:playerHand});
  var mock = new PP.source.MockSource({ hz: 60 });
  var input = { mode: 'keyboard', hand: playerHand, move: [0, 0], stance: null, assist: true, autoServe:true, servePicking:false };
  var players = { fan:'樊振东', ma:'马龙' };
  var opponents = { wang:'王楚钦', harimoto:'张本智和', ovtcharov:'奥恰洛夫', sun:'孙颖莎' };
  var opponent = 'wang';
  var chordTimer = null, chord = null, serveOptionsOpen = false;
  var chordKeys = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyF']);
  var touchServe = new Set();
  var serveButtons = Array.from(document.querySelectorAll('[data-serve-key]'));
  var aim = [0, K.TABLE.HEIGHT, -.93], selected = 'drive', usesSensor = false;
  var pressed = new Set(), spaceHeld = false;
  var stick = {pointer:null,x:0,y:0};
  var touchSide = null;
  var touchInput = matchMedia('(pointer: coarse)');
  var isPlaying = false;
  var last = performance.now(), updateAt = 0, frameCount = 0, toastTimer = null, scene;
  var panel = $('settings'), help = $('help');
  var difficulties = Array.from(document.querySelectorAll('[data-diff]'));
  var handOptions = Array.from(document.querySelectorAll('[data-player-hand]'));
  var gripOptions = Array.from(document.querySelectorAll('[data-grip-style]'));
  var handQuick = $('b_hand');
  var techniqueButtons = Array.from(document.querySelectorAll('[data-stroke]'));
  var movementKeys = {
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down'
  };
  var techniqueKeys = { KeyQ: 'block', KeyE: 'drive', KeyR: 'topspin', KeyF: 'push', KeyG: 'smash' };

  function setText(id, value) {
    var element = $(id);
    var message = String(value);
    if (element.textContent !== message) element.textContent = message;
  }

  function toast(title, detail) {
    var box = $('toast');
    box.textContent = title;
    if (detail) {
      var note = document.createElement('small');
      note.className = 'toast-body';
      note.textContent = detail;
      box.append(note);
    }
    box.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove('show'); }, 1750);
  }

  function log(line) {
    var el = $('log');
    el.textContent = (line + '\n' + el.textContent).split('\n').slice(0, 5).join('\n');
  }

  function held(key) {
    return chord?.action !== 'serve' && Array.from(pressed).some(function (code) {
      return movementKeys[code] === key && (!(spaceHeld || chord) || !chordKeys.has(code));
    });
  }

  function clearChord() {
    clearTimeout(chordTimer);
    chordTimer = chord = null;
    input.servePicking = serveOptionsOpen;
  }

  function addChordKey(selection, code) {
    if (selection.action === 'return') {
      // 回球只能选择来球的一侧，后按的方向覆盖前一个。
      if (code === 'KeyA') selection.keys.delete('KeyD');
      if (code === 'KeyD') selection.keys.delete('KeyA');
    }
    selection.keys.add(code);
  }

  function startChord(action) {
    clearChord();
    chord = {action:action, keys:new Set(), submitted:false};
    for (var key of pressed) if (chordKeys.has(key)) addChordKey(chord,key);
    if (action === 'serve') input.servePicking = true;
  }

  function clearKeys() {
    pressed.clear();
    resetStick();
    spaceHeld = false;
    clearChord();
    match.returnChoice = null;
  }

  function storeFits() {
    try { localStorage.setItem('pp3d-fit-' + input.hand + (pipe.frameOpts.flipX ? '-mirrored' : ''), JSON.stringify(pipe.strokeFits)); } catch (_) {}
  }

  function loadFits() {
    try {
      var saved = JSON.parse(localStorage.getItem('pp3d-fit-' + input.hand + (pipe.frameOpts.flipX ? '-mirrored' : '')));
      for (var side of ['forehand', 'backhand']) {
        var value = saved && saved[side];
        if (Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) pipe.strokeFits[side] = value;
      }
    } catch (_) {}
  }

  function handSwitchAvailable() {
    return !match.autoServe && !(match.rules.state === 'toss' && match.rules.server === 'player');
  }

  function refreshHandButtons() {
    var left = input.hand === 'left';
    var label = left ? '左手持拍' : '右手持拍';
    setText('hand-label',label);
    handQuick.setAttribute('aria-label','当前'+label+'，点击切换为'+(left ? '右手' : '左手'));
    for (var button of handOptions) button.setAttribute('aria-pressed',button.dataset.playerHand===input.hand);
  }

  function setHand(hand) {
    if (hand === input.hand || !handSwitchAvailable()) return;
    input = Object.assign({},input,{hand:hand,stance:null,move:[0,0]});
    match.setPlayerControl(input);
    pipe.setPart(hand);
    loadFits();
    clearKeys();
    try { localStorage.setItem('pp3d-player-hand',hand); } catch (_) {}
    refreshHandButtons();
  }

  function refreshGripButtons() {
    for (var button of gripOptions) button.setAttribute('aria-pressed',button.dataset.gripStyle===playerGrip);
  }

  function selectGrip(mode) {
    playerGrip = mode;
    scene.setPlayerGrip(mode);
    try { localStorage.setItem('pp3d-player-grip',mode); } catch (_) {}
    refreshGripButtons();
  }

  function updateControls() {
    refreshHandButtons();
    pipe.autoServeGesture = input.mode === 'pose' && usesSensor && !input.assist;
    var keyboard = input.mode === 'keyboard';
    setText('b_input', keyboard ? '键鼠' : '体感');
    setText('s_mode', keyboard ? '键鼠控制' : '体感控制');
    $('b_assist').setAttribute('aria-pressed', input.assist);
    $('b_auto_serve').setAttribute('aria-pressed', input.autoServe);
    setText('b_assist', input.assist ? '自动接球' : '自主挥拍');
    setText('assist_settings', input.assist ? '走进接球范围就会自动挥拍。' : '由键鼠按键或实际挥拍决定击球。');
    setText('hint', input.assist
      ? (keyboard ? 'WASD 走位 · 到位自动接球' : '身体走位 · 到位自动接球')
      : (keyboard ? 'WASD 走位 · J 正手 / K 反手' : '身体走位 · 实际挥拍'));
    $('target-label').hidden = !keyboard || input.assist;
    if (keyboard && !input.assist) setTechnique(selected);
  }

  function setMode(mode) {
    input = Object.assign({},input,{mode:mode,move:[0,0],stance:null});
    match.setPlayerControl(input);
    if (mode === 'pose') pipe.recalibrate();
    else mock.script = null;
    clearKeys();
    updateControls();
  }

  function setAssist(on) {
    input = Object.assign({}, input, {assist:on});
    match.setPlayerControl(input);
    clearKeys();
    updateControls();
  }

  function setDifficulty(key) {
    if (!match.setDifficulty(key)) return;
    for (var button of difficulties) {
      var active = button.dataset.diff === key;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active);
    }
    setText('s_diff', K.DIFFICULTY[key].label);
    setText('s_serve', key === 'novice' && input.assist ? '慢速长球' : K.DIFFICULTY[key].serveSpeed.toFixed(1) + ' m/s');
  }

  function setTechnique(kind) {
    if (input.mode !== 'keyboard') return;
    selected = kind;
    setText('s_tech', shots[kind].label);
    for (var button of techniqueButtons) button.setAttribute('aria-pressed', button.dataset.stroke === kind);
  }

  function stroke(side) {
    if (input.mode !== 'keyboard' || input.assist || !help.hidden) return;
    if (match.requestStroke(side, selected, aim)) return;
    if (match.rules.state === 'ready' && match.rules.server === 'player') toast('轮到你发球', '按空格发球');
  }

  function updateTouchServe() {
    for (var button of serveButtons) button.setAttribute('aria-pressed', touchServe.has(button.dataset.serveKey));
    var variant = PP.court.serveVariant(touchServe);
    var message = PP.court.SERVES[variant].label;
    setText('b_serve_commit',message);
    setText('touch-serve-commit',variant === 'plain' ? '发不转球' : message);
  }

  function setServeOptions(open) {
    serveOptionsOpen = open;
    input.servePicking = open || chord?.action === 'serve';
    $('serve-options').hidden = !open;
    $('b_serve_options').setAttribute('aria-pressed', open);
    if (!open) touchServe.clear();
    updateTouchServe();
  }

  function canServe() {
    return isPlaying && help.hidden && !match.autoServe && match.rules.state === 'ready' && match.rules.server === 'player';
  }

  function canReturn() {
    var rules = match.rules;
    return isPlaying && help.hidden && !match.autoServe &&
      (input.assist || input.mode === 'keyboard') &&
      (rules.state === 'rally' || (input.assist && rules.server === 'ai' && (rules.state === 'ready' || rules.state === 'toss')));
  }

  function confirmReturn(keys) {
    return submitReturn(PP.court.returnVariant(keys,input.hand),true);
  }

  function submitReturnChord(selection) {
    clearTimeout(chordTimer);
    if (input.assist) {
      selection.submitted = confirmReturn(selection.keys);
    } else {
      // 给叠加 W、S 或 F 留一小段时间，仍可在按住空格时出拍。
      selection.submitted = false;
      chordTimer = setTimeout(function () {
        selection.submitted = confirmReturn(selection.keys);
      },35);
    }
  }

  function submitReturn(choice, fromChord) {
    if (!canReturn()) return false;
    if (input.assist) return match.queueReturn(choice);
    var ball = match.ball;
    var side = choice.side || (ball && PP.court.chooseAssistedStroke(ball, match.playerStance, input.hand).side);
    return match.requestStroke(side, choice.kind, aim, fromChord);
  }

  function serve(kind) {
    clearChord();
    if (!canServe()) return;
    var variant = kind || 'plain';
    var target = input.assist ? [0,K.TABLE.HEIGHT,-1] : aim;
    if (match.requestServe(variant, target)) {
      setServeOptions(false);
      toast(PP.court.SERVES[variant].label);
    }
  }

  function selectPlayer(key) {
    if (!Object.hasOwn(players,key) || !match.setPlayer(key)) return;
    scene.setPlayer(key);
    for (var button of document.querySelectorAll('[data-player]')) {
      button.setAttribute('aria-pressed',button.dataset.player === key);
    }
    setText('s_player',players[key]);
  }

  function selectOpponent(key) {
    if (!Object.hasOwn(opponents, key) || !match.setOpponent(key)) return;
    opponent = key;
    scene.setOpponent(key);
    for (var button of document.querySelectorAll('[data-opponent]')) {
      button.setAttribute('aria-pressed', button.dataset.opponent === key);
    }
    setText('s_opponent', opponents[key]);
  }

  function showLobby() {
    isPlaying = false;
    $('over').hidden = true;
    $('lobby').hidden = false;
    document.body.classList.add('lobby');
    panel.open = false;
    setServeOptions(false);
    clearKeys();
    scene.setIntro(true);
    match.reset('player');
  }

  function capture(side) {
    if (input.mode !== 'pose') setMode('pose');
    if (!pipe.captureStroke(side)) {
      toast('准备姿势尚未标定', '站稳并让感知台看清持拍手');
      return;
    }
    if (!usesSensor) mock.script = function () {
      return { swing: side === 'forehand' ? .76 : -.68, lift: .10 };
    };
    toast(side === 'forehand' ? '保持正手姿势' : '保持反手姿势', '把拍面朝向对手');
  }

  function beginMatch() {
    isPlaying = true;
    document.body.classList.remove('lobby');
    $('lobby').hidden = true;
    scene.setIntro(false);
    restart();
  }

  function restart() {
    panel.open = false;
    setServeOptions(false);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    match.reset('player');
    $('over').hidden = true;
    clearKeys();
    setText('s_last', '空格发球');
  }

  function toggleHelp() {
    help.hidden = !help.hidden;
    clearKeys();
    if (!help.hidden) {
      panel.open = false;
      $('b_closehelp').focus();
    }
  }

  try {
    scene = new PP.render3d.Scene3D($('gl'), { view: 'first' });
    scene.setPlayerGrip(playerGrip);
    refreshGripButtons();
    setText('s_view', '第一人称');
    scene.setIntro(true);
  } catch (error) {
    $('err').hidden = false;
    setText('err', '无法启动 WebGL。请使用支持硬件加速的浏览器。' + error.message);
    return;
  }

  $('b_start').onclick = beginMatch;
  $('b_lobby').onclick = showLobby;
  $('b_assist').onclick = function () { setAssist(!input.assist); setDifficulty(match.difficulty); };
  $('b_auto_serve').onclick = function () {
    input.autoServe = !input.autoServe;
    match.readyClock = 0;
    updateControls();
  };
  $('b_serve_options').onclick = function () { setServeOptions(!serveOptionsOpen); };
  for (var button of serveButtons) {
    var pickServe = function () {
      var key = this.dataset.serveKey;
      if (touchServe.has(key)) touchServe.delete(key);
      else touchServe.add(key);
      if (touchInput.matches) setServeOptions(touchServe.size > 0);
      else updateTouchServe();
    };
    if (button.closest('#touch-controls')) bindTouchButton(button,pickServe);
    else button.onclick = pickServe;
  }
  $('b_serve_commit').onclick = function () { serve(PP.court.serveVariant(touchServe)); this.blur(); };
  for (var pick of document.querySelectorAll('[data-player]')) {
    pick.onclick = function () { selectPlayer(this.dataset.player); };
  }
  for (var button of document.querySelectorAll('[data-opponent]')) {
    button.onclick = function () { selectOpponent(this.dataset.opponent); };
  }
  for (var button of document.querySelectorAll('[data-serve]')) {
    button.onclick = function () { serve(this.dataset.serve); this.blur(); };
  }
  $('b_toss').onclick = function () {
    if (!canServe() || input.assist) return;
    var started = input.mode === 'keyboard' ? match.beginKeyboardServe() : pipe.requestServe();
    if (started) toast('已手动抛球', input.mode === 'keyboard' ? '下落时按 J 或 K' : '下落时挥拍');
  };
  $('b_live').onclick = function () {
    if (!usesSensor) $('b_source').click();
    else if (input.mode !== 'pose') setMode('pose');
    panel.open = true;
  };
  $('b_mirror').onclick = function () {
    pipe.frameOpts.flipX = !pipe.frameOpts.flipX;
    this.setAttribute('aria-pressed', pipe.frameOpts.flipX);
    pipe.strokeFits = {};
    loadFits();
    pipe.recalibrate();
  };
  $('b_input').onclick = function () { setMode(input.mode === 'pose' ? 'keyboard' : 'pose'); };
  $('b_source').onclick = function () {
    usesSensor = !usesSensor;
    pipe.use(usesSensor ? new PP.source.WebSocketSource('ws://127.0.0.1:8770/?role=game') : mock);
    pipe.strokeFits = {};
    if (usesSensor) loadFits();
    setMode(usesSensor ? 'pose' : 'keyboard');
    setText('b_source', usesSensor ? '切到模拟源' : '切到感知台');
    setText('b_live', usesSensor ? '体感标定' : '连接感知台');
  };
  bindTouchButton(handQuick,function () { setHand(input.hand === 'left' ? 'right' : 'left'); });
  for (var button of handOptions) {
    bindTouchButton(button,function () { setHand(this.dataset.playerHand); });
  }
  for (var button of gripOptions) {
    bindTouchButton(button,function () { selectGrip(this.dataset.gripStyle); });
  }
  $('b_calib').onclick = function () { pipe.recalibrate(); toast('站姿标定', '站直并保持自然准备姿势'); };
  $('b_forefit').onclick = function () { capture('forehand'); };
  $('b_backfit').onclick = function () { capture('backhand'); };
  $('b_reset').onclick = beginMatch;
  $('b_rematch').onclick = restart;
  $('b_help').onclick = toggleHelp;
  $('b_closehelp').onclick = toggleHelp;
  function bindTouchButton(button,action) {
    var touchAt = -Infinity;
    button.onpointerdown = function (event) {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      // 摇杆占用第一个触点时，第二个触点不一定会产生 click。
      event.preventDefault();
      touchAt = performance.now();
      action.call(button);
    };
    button.onclick = function (event) {
      if (event.detail && performance.now()-touchAt < 600) return;
      action.call(button);
    };
  }
  bindTouchButton($('touch-serve-commit'),function () { serve(PP.court.serveVariant(touchServe)); });
  var sideButtons = Array.from(document.querySelectorAll('[data-touch-side]'));
  for (var button of sideButtons) {
    bindTouchButton(button,function () {
      touchSide = this.dataset.touchSide === 'auto' ? null : this.dataset.touchSide;
      for (var option of sideButtons) option.setAttribute('aria-pressed',option === this);
    });
  }
  for (var button of document.querySelectorAll('[data-touch-stroke]')) {
    bindTouchButton(button,function () { submitReturn({kind:this.dataset.touchStroke,side:touchSide}); });
  }
  function toggleView() {
    var view = scene.toggleView();
    var names = { court:'对战视角', first:'第一人称', spectator:'全景' };
    $('b_view').firstChild.nodeValue = names[view] + ' ';
    setText('s_view', names[view]);
  }
  for (var button of difficulties) button.onclick = function () { setDifficulty(this.dataset.diff); };
  for (var button of techniqueButtons) button.onclick = function () { setTechnique(this.dataset.stroke); };

  $('gl').addEventListener('pointermove', function (event) {
    if (input.mode !== 'keyboard') return;
    aim[0] = V.clamp((event.clientX / innerWidth - .5) * 3.25, -.68, .68);
    aim[2] = -V.clamp(1.12 - (event.clientY / innerHeight - .35) * 1.35, .34, 1.26);
  });
  $('gl').addEventListener('pointerdown', function (event) {
    if (event.pointerType === 'touch' && input.mode === 'keyboard') {
      aim[0] = V.clamp((event.clientX / innerWidth - .5) * 3.25, -.68, .68);
      aim[2] = -V.clamp(1.12 - (event.clientY / innerHeight - .35) * 1.35, .34, 1.26);
    }
  });
  var joystick = $('walk');
  function resetStick() {
    var id = stick.pointer;
    stick.pointer = null;
    stick.x = stick.y = 0;
    if (id !== null && joystick?.hasPointerCapture(id)) joystick.releasePointerCapture(id);
    if (joystick) paintStick(0,0);
  }
  function paintStick(x,y) {
    joystick.style.setProperty('--stick-x',x + 'px');
    joystick.style.setProperty('--stick-y',y + 'px');
  }
  function steer(event) {
    var bounds = joystick.getBoundingClientRect();
    var radius = bounds.width*.31;
    var x = (event.clientX-bounds.left-bounds.width/2)/radius;
    var y = (event.clientY-bounds.top-bounds.height/2)/radius;
    var length = Math.hypot(x,y);
    var magnitude = V.clamp((length-.12)/.88,0,1);
    stick.x = length ? x*magnitude/length : 0;
    stick.y = length ? y*magnitude/length : 0;
    paintStick(stick.x*radius,stick.y*radius);
  }
  joystick.addEventListener('pointerdown',function (event) {
    if (stick.pointer !== null || !isPlaying || !help.hidden) return;
    event.preventDefault();
    if (input.mode !== 'keyboard') setMode('keyboard');
    stick.pointer = event.pointerId;
    joystick.setPointerCapture(event.pointerId);
    steer(event);
  });
  joystick.addEventListener('pointermove',function (event) { if (stick.pointer === event.pointerId) steer(event); });
  for (var name of ['pointerup','pointercancel','lostpointercapture']) {
    joystick.addEventListener(name,function (event) { if (stick.pointer === event.pointerId) resetStick(); });
  }
  window.addEventListener('blur', clearKeys);
  window.addEventListener('resize', function () { scene.resize(); });
  window.addEventListener('keydown', function (event) {
    var code = event.code;
    if (code === 'Escape' && (!help.hidden || panel.open)) {
      if (!help.hidden) toggleHelp();
      panel.open = false;
      return;
    }
    if (!help.hidden && code !== 'KeyH') return;
    if (!isPlaying && code === 'Space' && !(event.target instanceof HTMLElement && event.target.closest('button,summary'))) {
      event.preventDefault();
      beginMatch();
      spaceHeld = true;
      return;
    }
    if (event.target instanceof HTMLElement && event.target.matches('select,input,textarea')) return;
    if (code === 'Space') spaceHeld = true;
    if (chordKeys.has(code)) {
      pressed.add(code);
      if (spaceHeld && !chord && !event.repeat && canReturn()) startChord('return');
      if (spaceHeld || chord) {
        event.preventDefault();
        if (chord && !event.repeat) {
          addChordKey(chord,code);
          if (chord.action === 'return') submitReturnChord(chord);
        }
        return;
      }
      if (code === 'KeyF' && canServe()) return;
    }
    if (movementKeys[code] && input.mode === 'keyboard') {
      event.preventDefault();
      pressed.add(code);
      return;
    }
    if (event.repeat) return;
    if (code === 'Space' && (canServe() || canReturn())) {
      event.preventDefault();
      startChord(canServe() ? 'serve' : 'return');
      if (chord.action === 'return' && chord.keys.size) submitReturnChord(chord);
    }
    else if (code === 'KeyJ') stroke('forehand');
    else if (code === 'KeyK') stroke('backhand');
    else if (code === 'KeyV') toggleView();
    else if (code === 'KeyH') toggleHelp();
    else if (techniqueKeys[code]) setTechnique(techniqueKeys[code]);
    else if (/^Digit[1-4]$/.test(code)) setDifficulty(K.DIFFICULTY_ORDER[Number(code.slice(-1)) - 1]);
  });
  window.addEventListener('keyup', function (event) {
    pressed.delete(event.code);
    if (event.code !== 'Space') return;
    spaceHeld = false;
    if (!chord) return;
    var selection = chord;
    if (selection.action === 'return') {
      clearChord();
      if (!selection.submitted) confirmReturn(selection.keys);
      return;
    }
    clearTimeout(chordTimer);
    chordTimer = setTimeout(function () {
      clearChord();
      serve(PP.court.serveVariant(selection.keys));
    }, selection.keys.size ? 35 : 115);
  });

  function label(info) {
    if (!info) return '';
    if (info.kind === 'serve') return PP.court.SERVES[info.serveType]?.label || '发球';
    var side = info.side === 'backhand' ? '反手' : info.side === 'forehand' ? '正手' : '';
    return side + (info.lifted ? '提拉进攻' : info.kind === 'topspin' ? '拉球' : (shots[info.kind] || shots.drive).label);
  }

  function positionHint(guide, stance) {
    if (guide.switchSide) return guide.switchSide === 'forehand' ? '来球在正手侧 · 换正手' : '来球在反手侧 · 换反手';
    var sideways = guide.p[0] - stance.x, forward = stance.z - guide.p[2];
    if (Math.abs(sideways) > .48) return sideways < 0 ? '超出范围 · 往左补位' : '超出范围 · 往右补位';
    if (forward > .65) return '超出范围 · 往前补位';
    if (forward < .12) return '超出范围 · 后退补位';
    return '来球超出接球范围';
  }

  function present(snapshot, out, events, now) {
    var rules = snapshot.rules;
    var handLocked = !handSwitchAvailable();
    handQuick.disabled = handLocked;
    for (var option of handOptions) option.disabled = handLocked;
    setText('sp', rules.score.player);
    setText('sa', rules.score.ai);
    var serverName = rules.server === 'player' ? '你' : opponents[opponent];
    setText('s_server', serverName + ' · ' + rules.serveNumber + '/' + rules.servesPerTurn);
    var ready = rules.state === 'ready' && rules.server === 'player';
    $('serve-tray').hidden = !ready || snapshot.serveWaiting;
    $('touch-serve').hidden = !ready || snapshot.serveWaiting;
    $('touch-rally').hidden = ready && !snapshot.serveWaiting;
    if (!ready && input.servePicking) {
      if (chord?.action === 'serve') clearChord();
      setServeOptions(false);
    }
    if (chord?.action === 'return' && !canReturn()) clearChord();
    setText('touch-serve-status', serveOptionsOpen ? '已选组合，点发球' :
      snapshot.serveIn === null ? '' : Math.max(1,Math.ceil(snapshot.serveIn)) + ' 秒后自动发球');
    setText('serve_countdown', chord?.action === 'serve' ? PP.court.SERVES[PP.court.serveVariant(chord.keys)].label
      : serveOptionsOpen ? '选择旋转和速度'
      : snapshot.serveIn === null || poseWaiting(out) ? '' : Math.max(1,Math.ceil(snapshot.serveIn)) + ' 秒后自动发球');
    $('b_toss').hidden = input.assist || !ready || snapshot.serveWaiting;
    $('manual-strokes').hidden = input.assist || input.mode !== 'keyboard' || ready || rules.state === 'toss' && snapshot.serveWaiting;
    var status = rules.state === 'rally' ? '回合进行中' : rules.state === 'point' ? '一分结束'
      : rules.state === 'toss' ? serverName + '抛球中' : rules.state === 'let' ? '擦网重发'
      : rules.state === 'over' ? '比赛结束' : ready ? '轮到你发球' : serverName + '准备发球';
    if (snapshot.serveWaiting && rules.state === 'ready') status = '准备抛球';
    if (poseWaiting(out)) status = '等待体感标定';
    setText('s_state', status);
    $('s_tech').classList.toggle('outside', input.assist && snapshot.assistGuide && !snapshot.assistGuide.inRange);
    var returnChoice = chord?.action === 'return' ? PP.court.returnVariant(chord.keys,input.hand) : snapshot.returnChoice;
    var returnStatus = returnChoice ? '下一拍 · ' + label(returnChoice) : '';
    var touchGuide = snapshot.assistGuide;
    setText('touch-return-status', touchGuide && !touchGuide.inRange
      ? positionHint(touchGuide,snapshot.playerStance)
      : returnStatus || (input.assist ? '到位自动回球' : '点按挥拍'));
    var wingKeys = input.hand === 'left' ? 'A 正手 / D 反手' : 'A 反手 / D 正手';
    var keyHint = '回球：空格挡球 · W 拉 / S 切 / F 扣 · '+wingKeys;
    if (input.assist) {
      var guide = snapshot.assistGuide;
      var guidance = guide ? (guide.inRange ? '已进入接球范围' : positionHint(guide, snapshot.playerStance)) : '';
      var sensed = input.mode === 'pose' ? label(out.target?.assistTechnique) : '';
      setText('s_tech', ready && !snapshot.serveWaiting ? (input.autoServe ? '准备自动发球' : '空格发球')
        : guide && !guide.inRange ? guidance : returnStatus || sensed || guidance || '自动接球');
      setText('hint', (guide && !guide.inRange ? guidance : '') || returnStatus ||
        (canReturn() ? keyHint : input.mode === 'pose' ? '身体走位 · 到位自动接球' : 'WASD 走位 · 到位自动接球'));
    } else if (input.mode === 'pose') {
      setText('s_tech', label(out.target && out.target.technique) || '等待手部识别');
    } else {
      setText('hint', returnStatus || (canReturn() ? keyHint : 'WASD 走位 · J 正手 / K 反手'));
    }

    for (var event of events) {
      if (event.type === 'hit' || event.type === 'serve') {
        if (event.type === 'hit' && event.by === 'player' && !event.serveType && chord?.action === 'return') clearChord();
        var hitLabel = (event.by === 'player' ? players[match.playerKey] : opponents[opponent]) + ' · ' + label(event);
        setText('s_last', hitLabel);
        log(hitLabel);
      } else if (event.type === 'swing_miss') {
        setText('s_last', '未击中 · 调整步法和挥拍时机');
      } else if (event.type === 'let') {
        toast('擦网重发', '原发球方继续发球');
      } else if (event.type === 'net') {
        setText('s_last', event.crossed ? '擦网过球' : '球碰网后落回');
      } else if (event.type === 'bounce' && event.edge) {
        setText('s_last', '有效擦边球');
      } else if (event.type === 'point') {
        toast((event.winner === 'player' ? players[match.playerKey] : opponents[opponent]) + '得分',
          event.winner === 'ai' ? event.reason.replace('对方漏接', '你漏接') : event.reason);
      } else if (event.type === 'over') {
        setText('over_title', event.winner === 'player' ? '你赢了' : opponents[opponent] + '获胜');
        setText('over_sub', '最终比分 ' + rules.score.player + ' 比 ' + rules.score.ai);
        $('over').hidden = false;
      }
    }

    if (now < updateAt) return;
    updateAt = now + 110;
    var connection = pipe.status();
    setText('s_link', usesSensor ? connection.connected ? '感知台已连接' : '等待感知台' : '模拟骨骼');
    setText('s_frames', connection.frames + ' / ' + connection.ageMs + ' ms');
    setText('s_hand',(input.hand === 'left' ? '左手' : '右手')+
      (input.mode === 'pose' ? (out.hand?.ok ? ' · 有效点 '+out.hand.validCount+'/4' : ' · 未识别') : ''));
    var stanceReady = input.assist ? out.stanceReady : out.calibrated;
    var stanceProgress = input.assist ? out.stanceProgress : out.calibrationProgress;
    setText('s_cal', stanceReady ? '已就绪' : Math.round(stanceProgress * 100) + '%');
    setText('s_render', 'WebGL · ' + scene.quality());
    setText('s_speed', snapshot.ball ? snapshot.ball.speed.toFixed(1) + ' m/s' : '—');
    setText('s_spin', snapshot.ball ? Math.round(V.len(snapshot.ball.w)) + ' rad/s' : '—');
    setText('s_pad', snapshot.paddle.p.map(function (v) { return v.toFixed(2); }).join(', '));
    setText('s_move', snapshot.playerStance.x.toFixed(2) + ', ' + snapshot.playerStance.z.toFixed(2));
    setText('s_rally', snapshot.stats.rallies + ' / ' + snapshot.stats.hits.player + ':' + snapshot.stats.hits.ai);
    var fit = pipe.strokeFits;
    var message = out.calibrated ? '正手' + (fit.forehand ? '已记录' : '待记录') + ' · 反手' + (fit.backhand ? '已记录' : '待记录')
      : '站姿标定中 ' + Math.round(out.calibrationProgress * 100) + '%';
    if (input.assist && !out.calibrated) message = stanceReady ? '站位已就绪，可以上台' : '站姿标定中 ' + Math.round(stanceProgress * 100) + '%';
    if (pipe.recording) message = (pipe.recording.side === 'forehand' ? '正手' : '反手') + '取样 ' + pipe.recording.samples.length + '/12';
    setText('s_fit', message);
  }

  pipe.use(mock);
  loadFits();
  setMode('keyboard');
  setDifficulty('novice');
  selectOpponent('wang');
  window.__PP3D = {
    match: match, pipe: pipe, scene: scene, restart: restart, setDifficulty: setDifficulty,
    status: function () {
      return {
        ready: true, lobby: !isPlaying, view: scene.view, frame: frameCount, score: match.rules.score,
        state: match.rules.state, webgl: true, three: window.THREE.REVISION,
        humanVisible: scene.ai.root.visible, ballVisible: scene.ballMesh.visible
      };
    }
  };

  function poseWaiting(out) {
    return input.mode === 'pose' && usesSensor && (!(input.assist ? out.stanceReady : out.calibrated) || !out.frame || !out.body?.ok);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = V.clamp((now - last) / 1000, 0, .05);
    last = now;
    frameCount++;
    var recording = pipe.recording;
    var out = pipe.step(dt);
    if (recording && !pipe.recording && pipe.strokeFits[recording.side]) {
      if (usesSensor) storeFits();
      else mock.script = null;
      toast(recording.side === 'forehand' ? '正手已记录' : '反手已记录');
    }
    input.stance = input.mode === 'pose' ? out.stance : null;
    input.aim = input.assist ? null : aim;
    input.move[0] = V.clamp(Number(held('right'))-Number(held('left'))+stick.x,-1,1);
    input.move[1] = V.clamp(Number(held('down'))-Number(held('up'))+stick.y,-1,1);
    match.setPlayerControl(input);
    var events = match.step(help.hidden && isPlaying && (!poseWaiting(out) || match.autoServe) ? dt : 0, out.target);
    var snapshot = match.snapshot();
    scene.setAim(isPlaying && input.mode === 'keyboard' && !input.assist ? aim : null);
    scene.update(snapshot, input.mode === 'pose' ? out : null, events, dt);
    scene.render();
    present(snapshot, out, events, now);
  }
  requestAnimationFrame(frame);
})();
