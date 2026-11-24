/* 体感乒乓 · 3D 第一视角渲染层
 * ------------------------------------------------------------------
 * 依赖：Three.js r128（UMD，全局 THREE）+ PP.constants / PP.physics
 *
 * 设计原则：
 *  1) 纯渲染。不写物理、不写规则，只消费 match.snapshot()、pipeline 输出与事件数组。
 *  2) 坐标系与物理层完全一致：x 右 / y 上 / z 朝玩家；玩家在 +z，对手在 -z。
 *     Three.js 相机默认朝 -z，因此第一视角无需任何坐标换算。
 *  3) 真实比例：ITTF 2.74 x 1.525 m 球台、0.76 m 台高、0.1525 m 网高、40 mm 球。
 *  4) 玩家第一视角只画一条手臂（肩-肘-腕两点 IK，末端严格跟随手部骨骼驱动的球拍）。
 *  5) 对面是完整的 3D 人形（头/躯干/双臂/双腿/球拍），由 aiPaddle 与
 *     hit / serve 事件驱动站位、挥拍、抛球、步态、重心与视线 —— 不是浮空的拍子。
 *
 * 顶层不触碰 DOM / THREE 属性，因此 node 里可以 require 本文件单测 solveIK()。
 */
;(function (G) {
  'use strict';

  var NS = (G.PP = G.PP || {});
  var K = NS.constants;
  var T = null;
  var UP = null;
  var _dir = null;
  var _v = null;
  var ZAXIS = null;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function arr(p) {
    if (p && p.isVector3) return [p.x, p.y, p.z];
    return p;
  }
  function V3(a) { a = arr(a); return new T.Vector3(a[0], a[1], a[2]); }
  function len3(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function norm3(a) {
    var l = len3(a);
    return l > 1e-9 ? mul3(a, 1 / l) : [0, 0, 1];
  }
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  /* 两点 IK：已知肩 S、目标腕 W、上臂 L1、前臂 L2，求肘 E。
   * pole 是肘部偏好凸出方向（会投影到垂直于 S->W 的平面）。
   * 返回 {elbow, wrist, reachable}；够不到时 wrist 收敛到最大可达点，
   * 视觉上就是"伸直手臂去够"，不会把前臂拉长穿模。
   */
  function solveIK(S, W, L1, L2, pole) {
    S = arr(S); W = arr(W);
    var d = sub3(W, S);
    var dist = len3(d);
    var u = dist > 1e-9 ? mul3(d, 1 / dist) : [0, 0, 1];
    var maxReach = L1 + L2 - 1e-4;
    var minReach = Math.abs(L1 - L2) + 1e-4;
    var cd = clamp(dist, minReach, maxReach);
    var a = (L1 * L1 - L2 * L2 + cd * cd) / (2 * cd);
    var h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    var p = pole || [0, -1, 0];
    var proj = sub3(p, mul3(u, dot3(p, u)));
    if (len3(proj) < 1e-6) proj = sub3([0, -1, 0], mul3(u, dot3([0, -1, 0], u)));
    if (len3(proj) < 1e-6) proj = sub3([1, 0, 0], mul3(u, dot3([1, 0, 0], u)));
    proj = norm3(proj);
    return {
      elbow: add3(add3(S, mul3(u, a)), mul3(proj, h)),
      wrist: add3(S, mul3(u, cd)),
      reachable: dist <= maxReach + 1e-6
    };
  }

  /* ---------------------------- 材质 / 几何工具 ---------------------------- */
  function mat(color, o) {
    o = o || {};
    return new T.MeshStandardMaterial({
      color: color,
      roughness: o.roughness === undefined ? 0.78 : o.roughness,
      metalness: o.metalness === undefined ? 0.02 : o.metalness,
      transparent: !!o.transparent,
      opacity: o.opacity === undefined ? 1 : o.opacity,
      side: o.side === undefined ? T.FrontSide : o.side,
      depthWrite: o.depthWrite === undefined ? true : o.depthWrite
    });
  }

  function limb(radius, material, seg) {
    var m = new T.Mesh(new T.CylinderGeometry(radius*.81, radius*1.07, 1, seg || 14, 1), material);
    m.castShadow = true;
    return m;
  }
  function joint(radius, material) {
    var m = new T.Mesh(new T.SphereGeometry(radius, 12, 10), material);
    m.castShadow = true;
    return m;
  }
  /* 圆柱默认沿 +y、长度 1；把两端点写进去即可（缩放 y 不改半径） */
  function setLimb(mesh, a, b) {
    a = arr(a); b = arr(b);
    var d = sub3(b, a);
    var l = Math.max(1e-4, len3(d));
    mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    _dir.set(d[0] / l, d[1] / l, d[2] / l);
    mesh.quaternion.setFromUnitVectors(UP, _dir);
    mesh.scale.set(1, l, 1);
  }
  function put(mesh, p) { p = arr(p); mesh.position.set(p[0], p[1], p[2]); }

  function box(w, h, d, material, parent, pos) {
    var m = new T.Mesh(new T.BoxGeometry(w, h, d), material);
    if (pos) put(m, pos);
    m.castShadow = true; m.receiveShadow = true;
    if (parent) parent.add(m);
    return m;
  }

  /* 程序化网面纹理：白细网格 + 上沿白布，不依赖外部图片 */
  function netTexture() {
    var c = document.createElement('canvas');
    c.width = 512; c.height = 64;
    var g = c.getContext('2d');
    g.clearRect(0, 0, 512, 64);
    g.strokeStyle = 'rgba(226,238,250,0.62)';
    g.lineWidth = 1;
    for (var x = 0; x <= 512; x += 8) {
      g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, 64); g.stroke();
    }
    for (var y = 0; y <= 64; y += 8) {
      g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(512, y + 0.5); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fillRect(0, 0, 512, 7);
    var tex = new T.CanvasTexture(c);
    if (T.sRGBEncoding !== undefined) tex.encoding = T.sRGBEncoding;
    return tex;
  }

  /* 地板细网格纹理 */
  function floorTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = '#242029'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(120,140,165,0.10)'; g.lineWidth = 1;
    for (var i = 0; i <= 256; i += 32) {
      g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, 256); g.stroke();
      g.beginPath(); g.moveTo(0, i + 0.5); g.lineTo(256, i + 0.5); g.stroke();
    }
    var tex = new T.CanvasTexture(c);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.repeat.set(10, 10);
    if (T.sRGBEncoding !== undefined) tex.encoding = T.sRGBEncoding;
    return tex;
  }

  /* ---------------------------- 球拍 ---------------------------- */
  /* local +z 是击球面法线；用 lookAt 对齐可保证拍柄始终朝下（不会整只翻转） */
  function buildRacket(penhold) {
    var g = new T.Group();
    var edge = mat(0x2a2118, { roughness: 0.8 });
    var red = mat(0xc22a2a, { roughness: 0.62, side: T.DoubleSide });
    var black = mat(0x15181e, { roughness: 0.62, side: T.DoubleSide });
    var wood = mat(0xc9a06a, { roughness: 0.85 });
    var outline = new T.Shape();
    outline.moveTo(0,.083);
    outline.bezierCurveTo(.044,.083,.077,.057,.078,.010);
    outline.bezierCurveTo(.080,-.029,.049,-.064,.020,-.073);
    outline.quadraticCurveTo(.014,-.076,.014,-.082);
    outline.lineTo(-.014,-.082);
    outline.quadraticCurveTo(-.014,-.076,-.020,-.073);
    outline.bezierCurveTo(-.049,-.064,-.080,-.029,-.078,.010);
    outline.bezierCurveTo(-.077,.057,-.044,.083,0,.083);
    var blade = new T.Mesh(new T.ExtrudeGeometry(outline, {
      depth:.006, bevelEnabled:true, bevelSize:.0013, bevelThickness:.0014, bevelSegments:2, curveSegments:18
    }), edge);
    blade.position.z = -.003;
    blade.castShadow = true;
    g.add(blade);
    var rubber = new T.ShapeGeometry(outline,18);
    var faceR = new T.Mesh(rubber,penhold ? black : red);
    faceR.position.z = .0045;
    var faceB = new T.Mesh(rubber,penhold ? red : black);
    faceB.position.z = -.0045;
    faceB.rotation.y = Math.PI;
    g.add(faceR,faceB);
    var handle = new T.Mesh(new T.CylinderGeometry(.014,.017,penhold ? .077 : .104,16),wood);
    handle.position.y = penhold ? -.112 : -.126;
    handle.scale.z = .62;
    handle.castShadow = true;
    g.add(handle);
    var inlay = box(.006,penhold ? .068 : .088,.003,mat(0x654639,{roughness:.81}),g,
      [0,handle.position.y,-.0098]);
    inlay.castShadow = false;
    inlay.receiveShadow = false;
    g.userData.lookTarget = new T.Vector3();
    return g;
  }
  function aimRacket(g, normal) {
    /* lookAt 需要世界坐标。球拍挂在会移动的人形 root 下，用 g.position
     * （局部坐标）当世界点会把拍面拧歪，之前对手的拍几乎侧着看不见。 */
    var n = norm3(arr(normal || [0, 0, 1]));
    g.updateWorldMatrix(true, false);
    var wp = g.userData.worldPos || (g.userData.worldPos = new T.Vector3());
    g.getWorldPosition(wp);
    g.lookAt(wp.x + n[0], wp.y + n[1], wp.z + n[2]);
  }

  function buildGrip(skin,penhold,relaxed) {
    var grip = new T.Group();
    grip.name = relaxed ? 'balance-hand' : penhold ? 'penhold-grip' : 'shakehand-grip';
    function cushion(name,p,r,angle) {
      var mesh = new T.Mesh(new T.SphereGeometry(1,20,14),skin);
      mesh.name = name;
      put(mesh,p);
      mesh.scale.set(r[0],r[1],r[2]);
      mesh.rotation.z = angle || 0;
      grip.add(mesh);
    }
    function finger(name,joints,radius) {
      var curve = new T.CatmullRomCurve3(joints.map(V3));
      var segments = 16, sides = 10, positions = [], triangles = [];
      var axes = curve.computeFrenetFrames(segments,false);
      for (var i=0;i<=segments;i++) {
        var t=i/segments, p=curve.getPointAt(t);
        var width=radius*(1-.31*t)*Math.sqrt(Math.max(.045,1-Math.max(0,(t-.89)/.11)**2));
        for (var j=0;j<sides;j++) {
          var angle=j/sides*Math.PI*2;
          var q=p.clone().addScaledVector(axes.normals[i],Math.cos(angle)*width)
            .addScaledVector(axes.binormals[i],Math.sin(angle)*width);
          positions.push(q.x,q.y,q.z);
          if (i<segments) {
            var a=i*sides+j, b=i*sides+(j+1)%sides;
            triangles.push(a,b,a+sides,b,b+sides,a+sides);
          }
        }
      }
      var surface=new T.BufferGeometry();
      surface.setAttribute('position',new T.Float32BufferAttribute(positions,3));
      surface.setIndex(triangles);
      surface.computeVertexNormals();
      var digit = new T.Mesh(surface,skin);
      digit.name = name;
      grip.add(digit);
      var tip=joints[joints.length-1];
      cushion(name+'-tip',tip,[radius*.42,radius*.40,radius*.41]);
    }
    if (relaxed) {
      cushion('wrist-pad',[0,.004,0],[.023,.019,.017]);
      cushion('palm',[0,.038,0],[.035,.044,.017]);
      finger('thumb',[[.024,.023,-.002],[.039,.038,.009],[.036,.056,.022],[.021,.066,.025]],.011);
      var fingers = [
        ['index',.023,.112,.010],
        ['middle',.007,.121,.010],
        ['ring',-.010,.117,.009],
        ['little',-.024,.102,.008]
      ];
      for (var digit of fingers) {
        var x = digit[1], end = digit[2];
        finger(digit[0],[[x,.063,0],[x,end-.025,.005],
          [x*.94,end-.009,.016],[x*.81,end-.008,.031]],digit[3]);
      }
    } else if (penhold) {
      cushion('wrist-pad',[-.066,-.116,-.025],[.025,.019,.021],-.21);
      cushion('palm',[-.046,-.105,-.023],[.027,.027,.020],-.28);
      cushion('thumb-pad',[-.039,-.096,.001],[.017,.018,.019],-.31);
      // 拇指和食指绕过拍肩再捏柄，后三指贴在背面。
      finger('thumb',[[-.057,-.097,-.012],[-.046,-.089,.004],[-.027,-.075,.020],[-.009,-.078,.017]],.0101);
      finger('index',[[-.043,-.095,.003],[-.029,-.094,.020],[-.006,-.092,.023],[.020,-.096,.018],[.022,-.109,.009]],.0088);
      finger('middle',[[-.035,-.097,-.027],[-.019,-.081,-.025],[.004,-.066,-.018],[.024,-.060,-.010]],.0084);
      finger('ring',[[-.034,-.111,-.031],[-.016,-.097,-.030],[.004,-.088,-.025],[.026,-.085,-.015]],.0077);
      finger('little',[[-.041,-.124,-.030],[-.024,-.115,-.030],[-.007,-.109,-.026],[.009,-.109,-.018]],.0068);
    } else {
      cushion('wrist-pad',[-.057,-.145,-.012],[.023,.019,.020],-.12);
      cushion('palm',[-.036,-.130,-.010],[.019,.032,.022],-.12);
      cushion('thumb-pad',[-.032,-.112,.009],[.014,.021,.013],-.30);
      // 横板食指沿背面，其他三指分开绕过拍柄。
      finger('thumb',[[-.042,-.122,.012],[-.025,-.102,.021],[-.014,-.084,.020],[-.007,-.074,.016]],.0090);
      finger('index',[[-.038,-.115,-.025],[-.018,-.092,-.022],[.009,-.076,-.019],[.035,-.058,-.011]],.0078);
      finger('middle',[[-.029,-.115,.019],[-.009,-.116,.022],[.019,-.119,.020],[.025,-.120,.004],[.022,-.122,-.014]],.0084);
      finger('ring',[[-.032,-.131,.017],[-.010,-.133,.023],[.018,-.135,.020],[.025,-.137,.006],[.022,-.139,-.012]],.0078);
      finger('little',[[-.032,-.145,.014],[-.010,-.151,.022],[.017,-.153,.018],[.024,-.154,.005],[.023,-.156,-.014]],.0070);
    }
    return grip;
  }

  function strokeKinematics(stroke, side, facing) {
    var phase = stroke ? clamp(stroke.phase, 0, 1) : 0;
    var kind = stroke?.kind;
    var backhand = stroke?.side === 'backhand';
    var strength = kind === 'block' ? .27 : kind === 'push' || kind === 'cut' ? .43
      : kind === 'smash' ? 1 : .78;
    var coil = Math.sin(Math.PI * clamp(phase / .50, 0, 1));
    var follow = Math.sin(Math.PI * clamp((phase - .43) / .57, 0, 1));
    if (phase === 1) coil = follow = 0;
    var turn = facing * side * strength * (coil*.52 - follow*.54);
    var shift = side * strength * (coil*.057 - follow*.060);
    var faceForward = backhand || !kind || kind === 'serve'
      ? 0 : .96 * Math.sin(Math.PI/2*Math.min(phase/.56,(1-phase)/.44))**2;
    if (phase === 1) faceForward = 0;
    return {
      coil:coil, follow:follow, strength:strength, faceForward:faceForward,
      turn:backhand ? -turn*.36 : turn, shift:backhand ? -shift*.31 : shift,
      pole:backhand ? [side*.15,-.93,-facing*.10]
        : [side*(.66+.39*coil+.20*follow),-.68+.16*coil,-facing*(.13+.23*coil)]
    };
  }

  function placeGrip(racket,normal,side,facing,stroke,grip,penhold,motion) {
    var n = arr(normal || [0,0,facing]);
    var blend = stroke?.tracked ? 0 : motion.faceForward;
    // 预测挥拍击球时把拍面转向对方半台，同时沿用来球所需的拍面开合。
    var forward = norm3([n[0]*.45,clamp(n[1],-.34,.32),facing]);
    aimRacket(racket,n.map(function (v,i) { return lerp(v,forward[i],blend); }));
    var backhand = stroke?.side === 'backhand';
    var mirror = -facing*side;
    var tilt = penhold ? (backhand ? .44 : -.19) : (backhand ? .26 : -.10);
    var wind = (backhand ? -.15 : -.24)*motion.coil;
    racket.rotateZ(mirror*(tilt + wind + .15*motion.follow));
    grip.scale.x = mirror;
    var wrist = penhold ? [-.081*mirror,-.118,-.028] : [-.069*mirror,-.145,-.012];
    return arr(V3(wrist).applyQuaternion(racket.quaternion).add(racket.position));
  }

  /* ---------------------------- 3D 人形 ---------------------------- */
  /* 尺寸单位米，站立身高约 1.76 m。
   * root 只做平移；所有肢体用 root 局部坐标 + setLimb 直接摆放，
   * 这样 IK 解算不受父级旋转影响，稳定且容易验证。
   */
  function buildHuman(cfg) {
    cfg = cfg || {};
    var skin = mat(cfg.skin || 0xe9b98f, { roughness: 0.88 });
    var shirt = mat(cfg.shirt || 0xb8332f, { roughness: 0.9 });
    var pants = mat(cfg.pants || 0x202838, { roughness: 0.92 });
    var shoe = mat(cfg.shoe || 0xf0f2f5, { roughness: 0.65 });
    var hair = mat(cfg.hair || 0x241c18, { roughness: 0.98 });
    var dark = mat(0x1b1f27, { roughness: 0.9 });

    var root = new T.Group();
    var body = new T.Group();      // 躯干/头/骨盆
    var limbs = new T.Group();     // 四肢（IK 直接写局部坐标）
    // 对手面向 +z（玩家），玩家面向 -z（球台）；只转躯干组，
    // 四肢仍用 root 局部坐标解 IK，不受朝向影响。
    if (cfg.facing === -1) body.rotation.y = Math.PI;
    root.add(body); root.add(limbs);

    var torso = new T.Mesh(new T.LatheGeometry([[0,.875],[.105,.895],[.155,.96],[.176,1.10],[.183,1.28],[.169,1.34],[.114,1.39],[.056,1.41],[0,1.41]].map(function (p) { return new T.Vector2(p[0],p[1]-1.16); }), 24), shirt);
    torso.scale.set(1.13, 1, .63);
    torso.position.y = 1.16;
    torso.castShadow = true;
    body.add(torso);
    var facing = cfg.facing === -1 ? -1 : 1;
    var stature = cfg.stature || 1;
    var penhold = cfg.grip === 'penhold';
    var pelvis = new T.Mesh(new T.SphereGeometry(.16,16,10), pants);
    pelvis.scale.set(1.02,.65,.68);
    pelvis.position.y = .915;
    pelvis.castShadow = true;
    body.add(pelvis);
    var head = new T.Group(), neck;
    var headHeight = (cfg.headHeight || 1.60)*stature;
    put(head,[0,headHeight,cfg.headDepth || 0]);
    body.add(head);
    if (cfg.character) {
      var face = NS.wangModel.buildHead(T,skin,cfg.character);
      var scale = cfg.headScale || 1;
      // 把旋转中心落在颈根，转头时下缘一直留在领口里面。
      var neckPivot = .162*scale;
      head.position.y -= neckPivot;
      face.position.y = neckPivot;
      face.scale.multiplyScalar(scale);
      head.add(face);
    } else {
      neck = new T.Mesh(new T.CylinderGeometry(.047,.053,.084,24),skin);
      neck.scale.y = stature;
      put(neck,[0,1.435*stature,.003]);
      neck.castShadow = true;
      body.add(neck);
      var skull = new T.Mesh(new T.SphereGeometry(0.113, 20, 16), skin);
      skull.scale.set(1, 1.13, 0.96); skull.castShadow = true; head.add(skull);
      var cap = new T.Mesh(new T.SphereGeometry(0.116, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), hair);
      cap.position.y = 0.012; cap.castShadow = true; head.add(cap);
      // 脸朝 +z（面向玩家）：眼、眉、鼻
      var eyeGeo = new T.SphereGeometry(0.012, 8, 8);
      [-1, 1].forEach(function (s) {
        var e = new T.Mesh(eyeGeo, dark);
        put(e, [s * 0.043, 0.018, 0.105]); head.add(e);
        var brow = box(0.038, 0.008, 0.008, hair, head, [s * 0.043, 0.048, 0.104]);
        brow.castShadow = false;
        var ear = new T.Mesh(new T.SphereGeometry(0.022, 8, 8), skin);
        put(ear, [s * 0.113, 0.0, 0]); head.add(ear);
      });
      var nose = new T.Mesh(new T.SphereGeometry(0.016, 8, 8), skin);
      put(nose, [0, -0.012, 0.112]); head.add(nose);

    }

    var parts = {
      root: root, body: body, limbs: limbs, head: head, torso: torso, pelvis: pelvis, neck: neck, facing: facing,
      upperR: limb(0.049, shirt), foreR: limb(0.040, skin),
      upperL: limb(0.049, shirt), foreL: limb(0.040, skin),
      elbowR: joint(0.043, skin), elbowL: joint(0.043, skin),
      handR: joint(.027,skin), handL: joint(.027,skin),
      shoulderR: joint(0.058, shirt), shoulderL: joint(0.058, shirt),
      thighR: limb(0.070, pants), shinR: limb(0.052, pants),
      thighL: limb(0.070, pants), shinL: limb(0.052, pants),
      kneeR: joint(0.060, pants), kneeL: joint(0.060, pants),
      shoeR: box(0.11, 0.055, 0.245, shoe, null), shoeL: box(0.11, 0.055, 0.245, shoe, null),
      racket: buildRacket(penhold)
    };
    ['upperR','foreR','upperL','foreL','elbowR','elbowL','handR','handL',
     'shoulderR','shoulderL','thighR','shinR','thighL','shinL','kneeR','kneeL',
     'shoeR','shoeL','racket'].forEach(function (k) { limbs.add(parts[k]); });
    // 关节球 / 前臂 / 鞋不参与阴影投射，软件渲染与核显下能省掉近一半 pass
    ['foreR','foreL','elbowR','elbowL','handR','handL','shoulderR','shoulderL',
     'kneeR','kneeL','shoeR','shoeL'].forEach(function (k) { parts[k].castShadow = false; });

    parts.grip = buildGrip(skin,penhold);
    if (penhold) parts.penhold = parts.grip;
    parts.racket.add(parts.grip);
    parts.balanceHand = buildGrip(skin,false,true);
    root.add(parts.balanceHand);
    parts.rig = NS.athleteRig.build(T,root,skin,shirt,pants,shoe,facing,cfg);
    parts.torso.visible = parts.pelvis.visible = false;
    for (var part of limbs.children) if (part !== parts.racket) part.visible = false;

    parts.mats = { skin: skin, shirt: shirt, pants: pants, hair: hair };
    parts.shoulderWidth = cfg.shoulders || .179;
    parts.stature = stature;
    parts.hipWidth = cfg.hipWidth || 1;
    parts.stanceDrop = cfg.stanceDrop || .075;
    parts.stanceSpread = cfg.stanceSpread || .18;
    parts.stanceLean = cfg.stanceLean || .085;
    parts.stanceStagger = cfg.stanceStagger || .075;
    parts.balance = cfg.balance || [.23,.98,.23];
    parts.handFrame = new T.Matrix4();
    parts.weightTurn = cfg.weightTurn || 1;
    parts.armLength = cfg.armLength || stature;
    parts.L1 = .315*parts.armLength;
    parts.L2 = .285*parts.armLength;
    parts.state = {
      t: 0, swing: 999, toss: 999, step: 0, rootX: 0, rootZ: 0,
      lastX: 0, crouch: 0, headYaw: 0
    };
    return parts;
  }

  /* 挥拍包络：引拍 -> 前冲击球 -> 随挥，返回世界坐标偏移 */
  function swingEnvelope(phase, side) {
    if (phase < 0 || phase > 1) return [0, 0, 0];
    var z, x, y;
    if (phase < 0.32) {
      var u = phase / 0.32;
      z = -0.14 * u; x = 0.10 * side * u; y = 0.02 * u;
    } else if (phase < 0.60) {
      var v = (phase - 0.32) / 0.28;
      z = lerp(-0.14, 0.30, v); x = lerp(0.10 * side, -0.16 * side, v);
      y = lerp(0.02, 0.09, v);
    } else {
      var w = (phase - 0.60) / 0.40;
      z = lerp(0.30, 0.0, w); x = lerp(-0.16 * side, 0, w); y = lerp(0.09, 0, w);
    }
    return [x, y, z];
  }

  function updateFeet(h, stance, dt, drop, reach, hand) {
    var st = h.state, direction = h.facing;
    var speed = Math.hypot(stance.vx || 0, stance.vz || 0);
    if (!st.feet) st.feet = [-1, 1].map(function (side) {
      return { x: stance.x + side * h.stanceSpread, z: stance.z - side * hand * direction * h.stanceStagger, y: .068 };
    });
    var gait = st.gait;
    var spread = h.stanceSpread + Math.min(.045, speed * .014) + reach * .035;
    if (!gait) {
      var preferred = stance.vx > .12 ? 1 : stance.vx < -.12 ? 0 : st.swingFoot || 0;
      var order = [preferred, 1 - preferred];
      for (var index of order) {
        var side = index ? 1 : -1, foot = st.feet[index];
        var x = stance.x + side * spread, z = stance.z - side * hand * direction * h.stanceStagger;
        if (Math.hypot(x - foot.x, z - foot.z) <= (speed > .18 ? .11 : .063)) continue;
        var duration = clamp(.29 - speed * .041, .14, .26);
        st.gait = { index: index, elapsed: 0, duration: duration, x0: foot.x, z0: foot.z,
          x: x + (stance.vx || 0) * duration * .62, z: z + (stance.vz || 0) * duration * .66 };
        break;
      }
    } else {
      gait.elapsed += dt;
      var u = clamp(gait.elapsed / gait.duration, 0, 1);
      var weight = u * u * (3 - 2*u), stepping = st.feet[gait.index];
      stepping.x = lerp(gait.x0, gait.x, weight);
      stepping.z = lerp(gait.z0, gait.z, weight);
      stepping.y = .068 + Math.sin(Math.PI*u) * (.057 + Math.min(.035, speed * .01));
      if (u >= 1) { st.swingFoot = 1 - gait.index; st.gait = null; }
    }
    for (var i = 0; i < 2; i++) {
      var leg = i > 0 ? 'R' : 'L', sign = i > 0 ? 1 : -1;
      var point = st.feet[i];
      var hip = [.108*sign*h.hipWidth+h.body.position.x*.62,.878*h.stature-drop,-direction*.02];
      var ankle = [point.x - stance.x, point.y, point.z - stance.z];
      var joint = solveIK(hip, ankle, .423*h.stature, .405*h.stature, [sign*.17, 0, direction]);
      setLimb(h['thigh'+leg], hip, joint.elbow);
      setLimb(h['shin'+leg], joint.elbow, joint.wrist);
      put(h['knee'+leg], joint.elbow);
      put(h['shoe'+leg], [joint.wrist[0], joint.wrist[1] - .038, joint.wrist[2] + direction*.041]);
      h['shoe'+leg].rotation.y = (direction < 0 ? Math.PI : 0) + sign*.13;
      h.rig.leg(sign,hip,joint.elbow,joint.wrist);
    }
  }

  // 球拍以模拟触球点为中心，手腕由拍柄反解。
  function poseHuman(h, o) {
    var st = h.state, dt = o.dt, side = o.side, dir = h.facing;
    var stance = o.stance, move = Math.hypot(stance.vx || 0, stance.vz || 0);
    st.t += dt;
    var stroke = o.stroke;
    var kind = stroke?.kind;
    var profile = NS.court.PROFILES[kind];
    var motion = strokeKinematics(stroke,side,dir);
    var brace = (motion.coil*.52 + motion.follow*.49)*motion.strength;
    st.turn = lerp(st.turn || 0,motion.turn*h.weightTurn,1-Math.exp(-dt*34));
    st.stance = lerp(st.stance ?? 1,o.relaxed ? .50 : 1,1-Math.exp(-dt*12));
    var drop = h.stanceDrop*st.stance + st.crouch*.14 + Math.min(.055,move*.015) + (kind === 'push' ? brace*.054 : 0);
    var breath = Math.sin(st.t * 1.8) * .004;
    var shift = clamp((stance.vx || 0)*.026 + motion.shift,-.09,.09);
    var pitch = h.stanceLean*st.stance + motion.strength*(motion.follow*.16 + motion.coil*.065);
    h.body.rotation.set(dir * pitch, (dir < 0 ? Math.PI : 0) + st.turn, -shift*.52);
    h.body.position.set(shift, -drop + breath + .007, -dir * pitch * .92);
    put(h.racket,o.racketLocal);
    var hand = placeGrip(h.racket,o.normal,side,dir,stroke,h.grip,!!h.penhold,motion);
    // 肩关节与球衣一起转动。
    var shoulders = [side,-side].map(function (armSide) {
      var shoulder = new T.Vector3(armSide*dir*h.shoulderWidth,1.362*h.stature,.032);
      return arr(shoulder.applyQuaternion(h.body.quaternion).add(h.body.position));
    });
    var maxArm = h.L1 + h.L2 - .014;
    var stretch = sub3(hand, shoulders[0]);
    var distance = len3(stretch);
    if (distance > maxArm) {
      var lunge = mul3(stretch, Math.min(.153, distance-maxArm)/distance);
      var shiftBody = mul3(lunge,.83);
      shoulders[0] = add3(shoulders[0], shiftBody);
      shoulders[1] = add3(shoulders[1], shiftBody);
      h.body.position.add(V3(shiftBody));
    }
    var hands = h.balance;
    var openHand = o.toss || st.toss < .40;
    var balance = [-side*(hands[0]+.07*motion.coil+.03*motion.follow)+shift*.48,
      hands[1]*h.stature-drop*.41+(profile ? profile.lift*brace*.18 : 0),
      dir*(hands[2]-.085*motion.follow)];
    if (openHand) {
      var tossLift = Math.sin(Math.PI*clamp(st.toss/.44,0,1));
      balance[0] = lerp(balance[0],-side*.14,.32+.25*tossLift);
      balance[1] += .21*tossLift;
      balance[2] += dir*.07;
    }
    h.balanceHand.visible = h.handL.visible = !openHand;
    h.handR.visible = true;
    for (var i = 0; i < 2; i++) {
      var arm = i === 0 ? 'R' : 'L';
      var pole = i === 0 ? motion.pole : [-side*.19,-.94,-dir*.20];
      var ik = solveIK(shoulders[i], i === 0 ? hand : balance, h.L1, h.L2, pole);
      if (i === 0 && !ik.reachable) h.racket.position.add(V3(sub3(ik.wrist,hand)));
      setLimb(h['upper'+arm], shoulders[i], ik.elbow);
      setLimb(h['fore'+arm], ik.elbow, ik.wrist);
      put(h['elbow'+arm], ik.elbow);
      put(h['shoulder'+arm], shoulders[i]);
      var wristJoint = h['hand'+arm];
      put(wristJoint,add3(ik.wrist,mul3(norm3(sub3(ik.elbow,ik.wrist)),.009)));
      wristJoint.scale.setScalar(h.armLength);
      var orientation = i === 0
        ? new T.Vector3(-dir*side*.55,.78,-.17).applyQuaternion(h.racket.quaternion)
        : V3(sub3(ik.wrist,ik.elbow)).normalize();
      var goal = add3(ik.wrist,[orientation.x*.065,orientation.y*.065,orientation.z*.065]);
      h.rig.arm(i===0 ? side : -side,shoulders[i],ik.elbow,ik.wrist,goal);
      if (i === 1 && !openHand) {
        // 空闲手顺着前臂自然弯曲，掌心略朝身体，用于随挥时平衡。
        var fingers = orientation.clone().add(new T.Vector3(0,-.22,0)).normalize();
        var palm = new T.Vector3(side*.71,-.64,dir*.22);
        var handRight = new T.Vector3().crossVectors(fingers,palm).normalize();
        palm.crossVectors(handRight,fingers);
        h.balanceHand.quaternion.setFromRotationMatrix(h.handFrame.makeBasis(handRight,fingers,palm));
        h.balanceHand.scale.set(-dir*side*h.armLength,h.armLength,h.armLength);
        put(h.balanceHand,ik.wrist);
      }
    }
    h.rig.grip(side,!openHand);
    h.rig.torso(h.body);
    h.head.children[0]?.userData.updateExpression?.(st.t);
    updateFeet(h, stance, dt, drop, brace, side);
    var ball = o.ballLocal;
    var look = 1-Math.exp(-dt*10);
    var yaw = ball ? Math.atan2(ball[0]*dir,Math.max(.45,ball[2]*dir))*.78 : 0;
    var pitchToBall = ball
      ? Math.atan2(1.49*h.stature-drop-ball[1],Math.max(.55,Math.hypot(ball[0],ball[2])))*.62
      : .035;
    // 抵消准备姿态的大部分躯干前倾，让眼睛朝向来球与球桌前方。
    st.headYaw = lerp(st.headYaw,clamp(yaw-st.turn,-.45,.45),look);
    st.headPitch = lerp(st.headPitch || 0,clamp(pitchToBall,-.12,.17)-pitch*.74,look);
    h.head.rotation.y = st.headYaw;
    h.head.rotation.x = st.headPitch;
  }

  /* ---------------------------- 场景 ---------------------------- */
  function Scene3D(canvas, opts) {
    opts = opts || {};
    T = G.THREE;
    if (!T) throw new Error('需要先加载 vendor/three.min.js');
    UP = new T.Vector3(0, 1, 0);
    ZAXIS = new T.Vector3(0, 0, 1);
    _dir = new T.Vector3();
    _v = new T.Vector3();
    K = NS.constants;

    this.canvas = canvas;
    this.opts = opts;
    this.view = opts.view || 'first';
    this.time = 0;
    this.firstPerson = { swing: 999, camX: 0, camY: 0, lean: 0 };
    this.pending = [];
    this.perf = { slow: 0, fast: 0, degraded: false, label: '标准' };

    this.renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    this.touchScreen = !!G.matchMedia?.('(pointer: coarse)').matches;
    this.renderer.setPixelRatio(Math.min(G.devicePixelRatio||1,this.touchScreen ? 1.3 : 1.5));
    if (T.sRGBEncoding !== undefined) this.renderer.outputEncoding = T.sRGBEncoding;
    // 不开 ACES：它会把深蓝台面整体提亮成浅蓝，与真实球台色差太大。
    // 只做 sRGB 输出编码，材质颜色所见即所得。
    this.renderer.toneMapping = T.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;

    this.scene = new T.Scene();
    this.scene.background = new T.Color(0x100e16);
    this.scene.fog = new T.Fog(0x100e16, 8.6, 24);

    this.camera = new T.PerspectiveCamera(62, 1, 0.02, 60);
    this._buildLights();
    this._buildHall();
    this._buildTable();
    this._buildBall();
    this._buildAim();
    this._buildOpponent();
    this._buildPlayerAvatar();
    this.resize();
    this.setView(this.view);
  }

  Scene3D.prototype._buildLights = function () {
    this.scene.add(new T.AmbientLight(0xdabaad, 0.27));
    this.scene.add(new T.HemisphereLight(0xf6e5de, 0x1b1828, 0.33));
    var key = new T.DirectionalLight(0xffe8e0, 0.82);
    key.position.set(2.6, 5.2, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(768, 768);
    var c = key.shadow.camera;
    c.left = -3.6; c.right = 3.6; c.top = 3.6; c.bottom = -3.6;
    c.near = 0.5; c.far = 14;
    key.shadow.bias = -0.0008;
    this.scene.add(key);
    this.keyLight = key;
    var fill = new T.DirectionalLight(0x8aabff, 0.41);
    fill.position.set(-3.2, 3.0, -3.0);
    this.scene.add(fill);
    // 顶部灯带（发光面 + 少量点光）
    var lampMat = new T.MeshBasicMaterial({ color: 0xe8f2ff });
    for (var i = -1; i <= 1; i += 2) {
      var lamp = new T.Mesh(new T.BoxGeometry(1.9, 0.05, 0.42), lampMat);
      lamp.position.set(i * 1.35, 4.25, -0.2);
      this.scene.add(lamp);
      var pl = new T.PointLight(0xffe3d8, 0.33, 9, 2);
      pl.position.set(i * 1.35, 4.0, -0.2);
      this.scene.add(pl);
    }
  };

  Scene3D.prototype._buildHall = function () {
    var floorMat = mat(0xffffff, { roughness: 0.86 });
    floorMat.map = floorTexture();
    var floor = new T.Mesh(new T.PlaneGeometry(24, 24), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    var court = new T.Mesh(new T.PlaneGeometry(5.55, 7.14), mat(0x3b2834,{ roughness:.86 }));
    court.rotation.x = -Math.PI/2;
    court.position.y = .002;
    court.receiveShadow = true;
    this.scene.add(court);
    var wallMat = mat(0x1a141d, { roughness: .97 });
    var standsTex = new T.TextureLoader().load(G.PP_ARENA_ART.stands);
    standsTex.encoding = T.sRGBEncoding;
    var stands = new T.Mesh(new T.PlaneGeometry(19,10.69),
      new T.MeshBasicMaterial({map:standsTex,color:0xfff2ed,fog:false}));
    stands.position.set(0,3.64,-6.35);
    this.scene.add(stands);
    this.venueTexture = standsTex;

    var lineMat = new T.MeshBasicMaterial({ color: 0x825969 });
    [[-2.6, 0, 0.018, 7.0], [2.6, 0, 0.018, 7.0],
     [0, -3.35, 5.2, 0.018], [0, 3.35, 5.2, 0.018]].forEach(function (q) {
      var m = new T.Mesh(new T.PlaneGeometry(q[2], q[3]), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(q[0], 0.004, q[1]);
      this.scene.add(m);
    }, this);
    var board = mat(0x311922, { roughness: .82 });
    var trim = new T.MeshBasicMaterial({color:0xc64d59});
    for (var side of [-1,1]) {
      box(.12,5.2,16,wallMat,this.scene,[side*7.5,2.6,-.5]).castShadow=false;
      for (var j=0;j<4;j++) {
        var at=-2.29+j*1.14;
        box(.046,.50,1.08,board,this.scene,[side*2.42,.25,at]).castShadow=false;
        box(.054,.012,1.08,trim,this.scene,[side*2.42,.506,at]).castShadow=false;
      }
      for (var column=0;column<4;column++) {
        box(.024,.065,.83,trim,this.scene,[side*5.7,.19,-4.85+column*1.67]).castShadow=false;
      }
    }
    var desk = box(8.85,.56,.11,board,this.scene,[0,.28,-4.55]);
    desk.castShadow=false;
    box(8.85,.015,.12,trim,this.scene,[0,.563,-4.55]).castShadow=false;
  };

  Scene3D.prototype._buildTable = function () {
    var TB = K.TABLE;
    var topMat = mat(0x1b2c40, { roughness: 0.88 });
    var edgeMat = mat(0x0c2b45, { roughness: 0.85 });
    var white = new T.MeshStandardMaterial({ color: 0xf2f7fb, roughness: 0.7 });

    var top = box(TB.WIDTH, 0.028, TB.LENGTH, topMat, this.scene,
                  [0, TB.HEIGHT - 0.014, 0]);
    top.receiveShadow = true;
    // 台面边框（深色包边）
    var skirt = box(TB.WIDTH + 0.03, 0.045, TB.LENGTH + 0.03, edgeMat, this.scene,
                    [0, TB.HEIGHT - 0.052, 0]);
    skirt.castShadow = false;

    var y = TB.HEIGHT + 0.0015;
    var lw = 0.020;
    // 两条边线（沿 z）
    [-1, 1].forEach(function (s) {
      box(lw, 0.0016, TB.LENGTH, white, this.scene, [s * (TB.HALF_W - lw / 2), y, 0]);
    }, this);
    // 两条端线（沿 x）
    [-1, 1].forEach(function (s) {
      box(TB.WIDTH, 0.0016, lw, white, this.scene, [0, y, s * (TB.HALF_L - lw / 2)]);
    }, this);
    // 双打中线
    box(0.003, 0.0016, TB.LENGTH, white, this.scene, [0, y, 0]);

    // 球台支架
    var legMat = mat(0x2a3442, { roughness: 0.7, metalness: 0.25 });
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        box(0.055, TB.HEIGHT - 0.07, 0.055, legMat, this.scene,
            [sx * (TB.HALF_W - 0.16), (TB.HEIGHT - 0.07) / 2, sz * (TB.HALF_L - 0.22)]);
      }, this);
      box(0.05, 0.05, TB.LENGTH - 0.4, legMat, this.scene,
          [sx * (TB.HALF_W - 0.16), 0.18, 0]);
    }, this);

    // 球网 + 白上沿 + 网柱
    var netMat = new T.MeshBasicMaterial({
      map: netTexture(), transparent: true, opacity: 0.9,
      side: T.DoubleSide, depthWrite: false, alphaTest: 0.04
    });
    var netW = TB.WIDTH + 0.305;
    var net = new T.Mesh(new T.PlaneGeometry(netW, TB.NET_HEIGHT), netMat);
    net.position.set(0, TB.HEIGHT + TB.NET_HEIGHT / 2, 0);
    this.scene.add(net);
    var tape = new T.MeshStandardMaterial({ color: 0xf7fbff, roughness: 0.7, side: T.DoubleSide });
    box(netW, 0.015, 0.006, tape, this.scene, [0, TB.NET_TOP - 0.006, 0]);
    var postMat = mat(0x39485a, { roughness: 0.65, metalness: 0.3 });
    [-1, 1].forEach(function (s) {
      var p = new T.Mesh(new T.CylinderGeometry(0.013, 0.013, TB.NET_HEIGHT + 0.055, 12), postMat);
      p.position.set(s * (TB.HALF_W + 0.1525), TB.HEIGHT + (TB.NET_HEIGHT + 0.055) / 2 - 0.01, 0);
      p.castShadow = true;
      this.scene.add(p);
    }, this);
  };

  Scene3D.prototype._buildBall = function () {
    var R = K.BALL.RADIUS;
    this.ballMesh = new T.Mesh(
      new T.SphereGeometry(R, 24, 16),
      mat(0xfff6dc, { roughness: 0.45 })
    );
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);
    // 极淡的接缝标记，让旋转可见（真实球的印刷标记，不是特效）
    var mark = new T.Mesh(new T.SphereGeometry(R * 0.20, 8, 8),
                          new T.MeshBasicMaterial({ color: 0xc8cbd2 }));
    mark.position.set(0, 0, R * 0.97);
    this.ballMesh.add(mark);
    this.ballQuat = new T.Quaternion();

    this.ballShadow = new T.Mesh(
      new T.CircleGeometry(1, 24),
      new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24,
                                depthWrite: false, side: T.DoubleSide })
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);
  };

  /* 第一视角使用同角色的持拍手、袖色和上肢比例。 */
  Scene3D.prototype._buildFirstPersonArm = function (cfg) {
    var sleeve = mat(cfg.shirt,{roughness:.91});
    var skin = mat(cfg.skin,{roughness:.84});
    var penhold = cfg.grip === 'penhold';
    var section = [[0,-.50],[.029,-.50],[.033,-.37],[.033,-.21],[.030,-.02],
      [.026,.18],[.023,.34],[.022,.50],[0,.50]];
    var forearm = new T.Mesh(new T.LatheGeometry(section.map(function (row) {
      return new T.Vector2(row[0],row[1]);
    }),26),skin);
    var racket = buildRacket(penhold), hand = buildGrip(skin,penhold);
    racket.add(hand);
    var group = new T.Group();
    var upper = limb(.041,sleeve,24);
    upper.castShadow = false;
    var upperSkin = new T.Mesh(new T.CylinderGeometry(.029,.034,1,24),skin);
    var elbow = joint(.030,skin);
    elbow.scale.set(.98,.95,.98);
    elbow.castShadow = false;
    var arm = {upper:upper,upperSkin:upperSkin,elbow:elbow,fore:forearm,
      hand:hand,racket:racket,group:group,penhold:penhold};
    group.add(upper,upperSkin,elbow,forearm,racket);
    this.scene.add(group);
    return arm;
  };

  var roster = {
    wang: {character:'wang',shirt:0xbb212b,trim:0xe8a750,pants:0x1b1822,skin:0xd8a183,hair:0x171219,
      bodyWidth:.98,shoulders:.173,headHeight:1.600,stanceDrop:.113,stanceLean:.151,stanceSpread:.198,
      stanceStagger:.098,balance:[.255,.965,.205],shoe:0xf6eeeb,shoeTrim:0x953a40},
    harimoto: {character:'harimoto',shirt:0x405ab1,trim:0xc9cedd,pants:0x263d8a,skin:0xd9a98e,hair:0x21191a,
      bodyWidth:1.015,shoulders:.184,headHeight:1.605,stanceDrop:.129,stanceSpread:.208,stanceLean:.194,
      stanceStagger:.044,balance:[.249,.971,.25],
      shortTrim:0x465c9b,shoe:0xf1eee9,shoeTrim:0x8498ae},
    fan: {character:'fan',shirt:0x202124,trim:0xab935b,pants:0x181a1e,skin:0xdca989,hair:0x1e1b20,
      facing:-1,grip:'penhold',bodyWidth:1.085,shoulders:.193,headHeight:1.595,stanceDrop:.135,stanceLean:.174,
      stanceSpread:.206,stanceStagger:.068,balance:[.272,.972,.240],
      shortTrim:0x38372f,shoe:0xf4efe9,shoeTrim:0x84888b},
    ma: {character:'ma',shirt:0x1c48a0,trim:0xcc3d97,pants:0x181b31,skin:0xd5a287,hair:0x221c1d,
      facing:-1,grip:'shakehand',bodyWidth:.99,hipWidth:.98,shoulders:.18,headHeight:1.606,
      stanceDrop:.116,stanceSpread:.225,stanceLean:.153,stanceStagger:.102,weightTurn:1.10,
      balance:[.255,.984,.208],shortTrim:0x35496a,
      shoe:0xf3eeef,shoeTrim:0x8e3e87,sole:0xe3d7d5},
    sun: {character:'sun',shirt:0x1b477d,trim:0x51acc1,sleeveColor:0x459fba,pants:0x181c29,skin:0xe1ac92,hair:0x232022,
      bodyWidth:.89,hipWidth:.98,shoulders:.156,headHeight:1.606,stature:.924,headScale:.95,armLength:.90,neckWidth:.86,
      stanceDrop:.137,stanceSpread:.177,stanceLean:.181,stanceStagger:.047,weightTurn:.96,
      balance:[.217,.981,.244],shortTrim:0x35436b,shoe:0xcbdc4e,shoeTrim:0x768328,sole:0xb7c940},
    ovtcharov: {character:'ovtcharov',shirt:0x183e75,trim:0xdbaa47,pants:0x181b26,skin:0xe0a88b,hair:0x3b2a24,
      bodyWidth:1.09,hipWidth:1.035,shoulders:.203,headHeight:1.604,stature:1.056,headScale:1.01,
      armLength:1.073,stanceDrop:.146,stanceSpread:.247,stanceLean:.193,stanceStagger:.087,weightTurn:1.12,
      balance:[.289,.957,.216],shortTrim:0x36496b,
      shoe:0xf0f1ef,shoeTrim:0x63758b,sole:0xd5d5d2}
  };

  Scene3D.prototype._buildOpponent = function () {
    this.opponents = {};
    this.setOpponent('wang');
  };

  Scene3D.prototype.setOpponent = function (key) {
    if (!['wang','harimoto','ovtcharov','sun'].includes(key)) return;
    if (this.ai && this.ai === this.opponents[key]) return;
    if (this.ai) this.ai.root.visible = false;
    if (!this.opponents[key]) {
      var actor = buildHuman(roster[key]);
      actor.root.position.set(0,0,K.AI_Z-.62);
      this.opponents[key] = actor;
      this.scene.add(actor.root);
    }
    this.ai = this.opponents[key];
    this.ai.root.visible = true;
  };

  Scene3D.prototype._buildPlayerAvatar = function () {
    this.players = {};
    this.setPlayer('fan');
  };

  Scene3D.prototype.setPlayer = function (key) {
    if (!['fan','ma'].includes(key) || this.playerKey === key) return;
    if (this.avatar) this.avatar.root.visible = this.armGroup.visible = false;
    if (!this.players[key]) {
      var avatar = buildHuman(roster[key]);
      avatar.root.position.set(0,0,K.PLAYER_Z+.62);
      this.scene.add(avatar.root);
      this.players[key] = {avatar:avatar,arm:this._buildFirstPersonArm(roster[key])};
    }
    this.playerKey = key;
    this.avatar = this.players[key].avatar;
    this.arm = this.players[key].arm;
    this.armGroup = this.arm.group;
    this.setView(this.view);
  };

  Scene3D.prototype.setView = function (mode) {
    this.view = ['court','spectator','first'].includes(mode) ? mode : 'court';
    this.armGroup.visible = this.view === 'first' && !this.intro;
    this.avatar.root.visible = this.view !== 'first' && !this.intro;
    var portrait = this.camera.aspect < .9;
    this.camera.fov = this.intro ? 45 : this.view === 'first' ? 62+clamp((.88-this.camera.aspect)*14,0,6)
      : this.view === 'court' ? (portrait ? 59 : 51) : (portrait ? 64 : 55);
    this.camera.updateProjectionMatrix();
  };
  Scene3D.prototype.setIntro = function (on) {
    this.intro = on;
    this.setView(this.view);
  };

  Scene3D.prototype.toggleView = function () {
    this.setView(this.view === 'court' ? 'first' : this.view === 'first' ? 'spectator' : 'court');
    return this.view;
  };

  Scene3D.prototype.resize = function () {
    var w = this.canvas.clientWidth || G.innerWidth || 960;
    var h = this.canvas.clientHeight || G.innerHeight || 540;
    if (w < 2 || h < 2) { w = 960; h = 540; }
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w/h;
    this.setView(this.view);
  };

  Scene3D.prototype._buildAim = function () {
    this.aim = new T.Group();
    var material = new T.MeshBasicMaterial({ color:0xf2c78f, transparent:true, opacity:.68, depthWrite:false, side:T.DoubleSide });
    var ring = new T.Mesh(new T.RingGeometry(.054,.064,28),material);
    ring.rotation.x = -Math.PI/2;
    this.aim.add(ring);
    var marker = new T.Mesh(new T.CircleGeometry(.011,12),material);
    marker.rotation.x = -Math.PI/2;
    this.aim.add(marker);
    this.scene.add(this.aim);
    this.aim.visible = false;
    this.receiveMarker = new T.Group();
    var guide = new T.MeshBasicMaterial({color:0x88dcff,transparent:true,opacity:.85,depthWrite:false,side:T.DoubleSide});
    var spot = new T.Mesh(new T.RingGeometry(.087,.101,40), guide);
    spot.rotation.x = -Math.PI/2;
    this.receiveMarker.add(spot);
    this.scene.add(this.receiveMarker);
    this.receiveMarker.visible = false;
  };

  Scene3D.prototype._updateReceiveMarker = function (info) {
    this.receiveMarker.visible = !!info && !this.intro;
    if (!this.receiveMarker.visible) return;
    this.receiveMarker.position.set(clamp(info.p[0],-.675,.675),K.TABLE.HEIGHT+.007,clamp(info.p[2],.44,1.265));
    var ring = this.receiveMarker.children[0];
    ring.material.color.setHex(info.inRange ? 0x8be8ff : 0xffbd92);
    ring.material.opacity = .60+Math.sin(this.time*7)*.16;
  };

  Scene3D.prototype.setAim = function (aim) {
    this.aim.visible = !!aim;
    if (aim) this.aim.position.set(aim[0], K.TABLE.HEIGHT+.005, aim[2]);
  };

  Scene3D.prototype._consume = function (events) {
    for (var e of events) {
      if (e.type !== 'hit' && e.type !== 'serve' && e.type !== 'toss') continue;
      var h = e.by === 'ai' ? this.ai : this.avatar;
      if (e.type === 'toss') {
        h.state.toss = 0;
        continue;
      }
      h.state.stroke = { kind: e.kind || 'drive', side: e.side || 'forehand' };
      h.state.swing = 0;
    }
  };

  Scene3D.prototype._updateBall = function (snap, dt) {
    var b = snap.ball;
    var on = !!(b && b.alive);
    this.ballMesh.visible = on;
    this.ballShadow.visible = on;
    if (!on) return;

    put(this.ballMesh, b.p);
    // 旋转积分：omega 方向为轴，模长 rad/s
    var w = b.w || [0, 0, 0];
    var wl = len3(w);
    if (wl > 1e-4) {
      _v.set(w[0] / wl, w[1] / wl, w[2] / wl);
      var q = new T.Quaternion().setFromAxisAngle(_v, wl * dt);
      this.ballMesh.quaternion.premultiply(q);
    }
    // 落点影：投到台面或地板，按离面高度衰减
    var TB = K.TABLE;
    var overTable = Math.abs(b.p[0]) <= TB.HALF_W + 0.12 &&
                    Math.abs(b.p[2]) <= TB.HALF_L + 0.12;
    var groundY = overTable ? TB.HEIGHT + 0.003 : 0.006;
    var dh = Math.max(0, b.p[1] - groundY);
    this.ballShadow.position.set(b.p[0], groundY, b.p[2]);
    var s = clamp(0.026 + dh * 0.10, 0.022, 0.11);
    this.ballShadow.scale.set(s, s, 1);
    this.ballShadow.material.opacity = clamp(0.30 - dh * 0.22, 0.04, 0.30);
  };

  Scene3D.prototype._updateCamera = function (snap, input, dt) {
    var stance = snap.playerStance || { x:0, z:1.85, vx:0, vz:0 };
    var fp = this.firstPerson;
    var body = input && input.body;
    var tilt = body && body.ok ? body.leanX : 0;
    var shift = 1 - Math.exp(-dt * 12);
    var headY = 1.59*this.avatar.stature - Math.min(.09, Math.hypot(stance.vx, stance.vz)*.019);
    if (this.intro) {
      var portrait = this.camera.aspect < .88;
      var slide = Math.sin(this.time*.52)*.08;
      this.camera.up.set(0,1,0);
      this.camera.position.set((portrait ? .14 : .18)+slide, 1.47, portrait ? -.26 : -.52);
      this.camera.lookAt(portrait ? .015 : -.67, portrait ? 1.105 : 1.213, -1.89);
      this.camera.updateMatrixWorld(true);
      return;
    }
    if (this.view === 'court') {
      var narrow = this.camera.aspect < .9;
      this.camera.position.set((narrow ? 1.62 : 2.8)+stance.x*.14, narrow ? 3.01 : 2.48,
        (narrow ? 5.15 : 4.44)+(stance.z-1.85)*.22);
      this.camera.up.set(0,1,0);
      this.camera.lookAt(0,.78,narrow ? .12 : -.06);
      this.camera.updateMatrixWorld(true);
      return;
    }
    if (this.view === 'spectator') {
      this.camera.position.set(3.85 + stance.x*.20, 2.80, 4.36 + (stance.z-1.85)*.31);
      this.camera.lookAt(0, .79, -.09);
      return;
    }
    fp.camX = lerp(fp.camX, stance.x + tilt*.050, shift);
    fp.camY = lerp(fp.camY || 1.59, headY, shift);
    fp.camZ = lerp(fp.camZ || 2.56, stance.z+.71, shift);
    fp.lean = lerp(fp.lean, tilt - stance.vx*.064, shift);
    this.camera.position.set(fp.camX, fp.camY, fp.camZ);
    this.camera.up.set(0,1,0);
    this.camera.lookAt(fp.camX*.19, .87, -.51);
    this.camera.rotation.z = fp.lean*.033;
    this.camera.updateMatrixWorld(true);
  };

  Scene3D.prototype._updateFirstPersonArm = function (snap, input, dt) {
    if (!this.armGroup.visible) return;
    var stance = snap.playerStance || { x:0,z:1.85 };
    var side = snap.playerHand === 'left' ? -1 : 1;
    var bb = input && input.body && input.body.ok ? input.body : null;
    var h = this.avatar, arm = this.arm;
    var stroke = activeStroke(h.state,playerStroke(snap,input,side),dt);
    var motion = strokeKinematics(stroke,side,-1);
    var shoulder = [stance.x+side*h.shoulderWidth+(bb ? bb.leanX*.06 : 0)+motion.shift,
      1.335*h.stature+.028*motion.coil-.020*motion.follow,
      stance.z+.042+.084*motion.coil-.105*motion.follow];
    put(arm.racket,snap.paddle.p);
    var wrist = placeGrip(arm.racket,snap.paddle.n,side,-1,stroke,arm.hand,arm.penhold,motion);
    var stretch = sub3(wrist,shoulder), distance = len3(stretch);
    var armReach = h.L1 + h.L2 - .013;
    if (distance > armReach) shoulder = add3(shoulder,mul3(stretch,(distance-armReach)/distance));
    var ik = solveIK(shoulder,wrist,h.L1,h.L2,motion.pole);
    // 袖口从持拍侧画面下缘入镜，固定深度避免肩肘外推时横穿球场。
    var sleeveDepth = .34;
    var halfHeight = sleeveDepth * Math.tan(this.camera.fov*Math.PI/360);
    var sleeveStart = this.camera.localToWorld(new T.Vector3(
      side*halfHeight*this.camera.aspect*1.35, -halfHeight*1.55, -sleeveDepth
    ));
    var sleeveHem = sleeveStart.clone().lerp(V3(ik.elbow),.61);
    setLimb(arm.upper,sleeveStart,sleeveHem);
    setLimb(arm.upperSkin,sleeveHem,ik.elbow);
    put(arm.elbow,ik.elbow);
    setLimb(arm.fore,ik.elbow,ik.wrist);
  };

  function playerStroke(snap, input, side) {
    if (snap.playerStroke) return snap.playerStroke;
    var target = input?.calibrated && input.target;
    var technique = target?.technique;
    if (!technique || target.quality <= .14 || technique.kind === 'block' || technique.speed < .62)
      return null;
    // 实时体感只用来推断肩肘阶段，拍面继续由标定过的手骨骼控制。
    var v = snap.paddle.v;
    var handVelocity = side*v[0];
    var wind = v[2] > .29 || (handVelocity > .28 && v[2] > -.15);
    var phase = wind ? .26 : clamp(.56-handVelocity*.034-v[2]*.04,.46,.78);
    return {kind:technique.kind,side:technique.side,phase:phase,tracked:true};
  }

  function activeStroke(state, planned, dt) {
    state.swing += dt;
    if (planned) return planned;
    if (state.swing < .27 && state.stroke) {
      return {kind:state.stroke.kind,side:state.stroke.side,phase:.56+.44*state.swing/.27};
    }
    return null;
  }

  Scene3D.prototype._posePlayer = function (hum, stance, paddle, snap, stroke, side, dt, toss) {
    var state = hum.state;
    stroke = activeStroke(state,stroke,dt);
    state.toss = toss ? Math.max(0, state.toss > .45 ? 0 : state.toss + dt) : state.toss + dt;
    var p = paddle.p;
    hum.root.position.set(stance.x, 0, stance.z);
    state.crouch = lerp(state.crouch, clamp((1.08 - p[1]) * 1.35, 0, .60), 1-Math.exp(-dt*9));
    var ball = snap.ball;
    poseHuman(hum, {
      dt:dt, side:side, stance:stance, stroke:stroke, toss:toss,
      relaxed:['point','let','over'].includes(snap.rules.state),
      racketLocal:[p[0]-stance.x,p[1],p[2]-stance.z],
      normal:paddle.n || [0,0,hum.facing],
      ballLocal:ball && ball.alive ? [ball.p[0]-stance.x,ball.p[1],ball.p[2]-stance.z] : null
    });
  };

  Scene3D.prototype._updateOpponent = function (snap, dt) {
    var stance = snap.aiStance || {x:0,z:-1.88,vx:0,vz:0};
    var plan = snap.aiPlan;
    var lead = plan ? NS.court.strokeWindup(plan.kind) : 0;
    var stroke = plan && plan.eta < lead
      ? {kind:plan.kind,side:plan.side,phase:.56*clamp(1-plan.eta/lead,0,1)} : null;
    var tossing = snap.aiServeProgress !== null;
    if (tossing) stroke = {kind:'serve',side:'forehand',phase:.56*snap.aiServeProgress};
    var hand = snap.aiHand === 'right' ? -1 : 1;
    if (this.intro) {
      var breath = Math.sin(this.time*1.75)*.018;
      this._posePlayer(this.ai, stance, {p:[hand*.25,1.05+breath,stance.z+.355],n:[hand*.16,.14,1]}, snap, null, hand, dt, false);
      this.ai.head.rotation.x = -.055;
      this.ai.head.rotation.y = .065 + Math.sin(this.time*.82)*.105;
      return;
    }
    this._posePlayer(this.ai, stance, snap.aiPaddle, snap, stroke, hand, dt, tossing);
  };

  Scene3D.prototype._updatePlayerAvatar = function (snap, input, dt) {
    if (!this.avatar.root.visible) return;
    var side = snap.playerHand === 'left' ? -1 : 1;
    this._posePlayer(this.avatar,snap.playerStance,snap.paddle,snap,playerStroke(snap,input,side),side,dt,snap.rules.state === 'toss' && snap.rules.server === 'player');
  };

  /* 每帧调用：snap = match.snapshot()，input = pipeline.step(dt)，events = match.step() */
  Scene3D.prototype.update = function (snap, input, events, dt) {
    dt = clamp(dt || 1 / 60, 0, 0.05);
    this.time += dt;
    this._consume(events || []);
    this._updateCamera(snap, input, dt);
    this._updateBall(snap, dt);
    this._updateReceiveMarker(snap.assistGuide);
    this._updateFirstPersonArm(snap, input, dt);
    this._updateOpponent(snap, dt);
    this._updatePlayerAvatar(snap, input, dt);
    // 连续掉帧（核显 / 软件渲染）时自动降级，保住可玩帧率
    if (!this.perf.degraded) {
      this.perf.slow = dt > 0.042 ? this.perf.slow + 1 : Math.max(0, this.perf.slow - 2);
      if (this.perf.slow > 12) this._degrade();
    } else {
      // 帧率稳定恢复后再开回阴影，避免偶发卡顿后画质一直降级
      this.perf.fast = dt < 0.025 ? this.perf.fast + 1 : 0;
      if (this.perf.fast > 180) this._restore();
    }
  };

  Scene3D.prototype._degrade = function () {
    this.perf.degraded = true;
    this.perf.label = '性能';
    this.renderer.shadowMap.enabled = false;
    this.renderer.setPixelRatio(1.0);
    if (this.audience) this.audience.visible = false;
    this.resize();
  };
  Scene3D.prototype._restore = function () {
    this.perf.degraded = false;
    this.perf.label = '标准';
    this.perf.slow = 0; this.perf.fast = 0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.setPixelRatio(Math.min(G.devicePixelRatio||1,this.touchScreen ? 1.3 : 1.5));
    if (this.audience) this.audience.visible = true;
    this.resize();
  };
  Scene3D.prototype.quality = function () { return this.perf.label; };

  Scene3D.prototype.render = function () { this.renderer.render(this.scene, this.camera); };

  Scene3D.prototype.dispose = function () {
    try { this.renderer.dispose(); } catch (e) {}
  };

  NS.render3d = {
    Scene3D: Scene3D,
    solveIK: solveIK,
    swingEnvelope: swingEnvelope,
    strokeKinematics: strokeKinematics,
    VERSION: '1.0.0'
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.render3d;
})(typeof globalThis !== 'undefined' ? globalThis : this);
