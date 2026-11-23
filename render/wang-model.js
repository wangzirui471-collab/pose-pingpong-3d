/* Character-specific sculpts, albedo projection and hair for the three athletes. */
;(function (G) {
  'use strict';

  var appearance = {
    wang: {
      center:.537, eyeSpacing:.137, tint: 0xd5a68c,
      width:1.010, jaw:.898, height:1.052, cheek:.0038, nose:.0035,
      temple: .97, chin:.0035, brow:-.0030, smile:.0010, ear:.93,
      scanY:[.998,.923,.830,.730,.624,.474,.418,.297,.022],
      hair:{width:.094,height:.110,depth:.114,edge:1.23,side:1.72,nape:.27,part:.26,sweep:.31,volume:.0065}
    },
    harimoto: {
      center:.520, eyeSpacing:.136, tint: 0xce987e,
      width:1.056, jaw:1.084, height:.979, cheek:.0063, nose:-.0025,
      temple:1.04, chin:-.0018, brow:-.002, smile:.0042, ear:.98,
      scanY:[.998,.912,.836,.724,.628,.479,.420,.308,.050],
      hair:{width:.094,height:.104,depth:.116,edge:1.29,side:1.76,nape:.25,part:.04,sweep:-.64,volume:.0057}
    },
    fan: {
      center:.546, eyeSpacing:.138, tint: 0xc99e83,
      width:1.085, jaw:1.178, height:.936, cheek:.0072, nose:-.0040,
      temple:1.07, chin:.0015, brow:.0013, smile:.0023, ear:.95,
      scanY:[.998,.896,.817,.711,.621,.470,.408,.308,.034],
      hair:{width:.091,height:.100,depth:.109,edge:.94,side:1.53,nape:.16,part:.10,sweep:.78,volume:.0059}
    }
  };
  // 鼻尖、眼睑和唇线单独对齐，避免纹理拉扯五官。
  var modelY = [-.178, -.153, -.135, -.111, -.080, -.037, -.014, .029, .097];
  var prepared = {};
  var source;

  function unpack(encoded, ArrayType) {
    var binary = G.atob(encoded);
    var buffer = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
    return new ArrayType(buffer.buffer);
  }

  function scanV(y, profile) {
    for (var i = 1; i < modelY.length; i++) {
      if (y <= modelY[i]) {
        var fraction = Math.max(0, (y - modelY[i-1]) / (modelY[i] - modelY[i-1]));
        return 1 - (profile.scanY[i-1] + (profile.scanY[i] - profile.scanY[i-1]) * fraction);
      }
    }
    return 1 - profile.scanY[modelY.length - 1];
  }

  function sculpt(T, profile) {
    var pos = source.pos.slice();
    var uv = new Float32Array(pos.length / 3 * 2);
    for (var i = 0; i < pos.length; i += 3) {
      var x = pos[i], y = pos[i+1], z = pos[i+2];
      var neck = T.MathUtils.smoothstep(y, -.168, -.111);
      var jaw = 1 - T.MathUtils.smoothstep(y, -.129, -.040);
      var cheeks = Math.exp(-(((Math.abs(x)-.057)/.033)**2) - ((y+.081)/.052)**2);
      var nose = Math.exp(-((x/.021)**2) - (((y+.071)/.035)**2));
      var front = T.MathUtils.smoothstep(z, .020, .124);
      var temple = T.MathUtils.smoothstep(y,-.027,.070);
      var outerEar = T.MathUtils.smoothstep(Math.abs(x),.079,.095) * (1-front);
      var lowerChin = Math.exp(-((x/.047)**2)-(((y+.139)/.023)**2));
      var brow = Math.exp(-(((Math.abs(x)-.032)/.023)**2)-(((y+.022)/.014)**2));
      var lips = Math.exp(-((x/.032)**4)-(((y+.111)/.011)**2))*front;
      var shape = profile.width + (profile.jaw-profile.width)*jaw + (profile.temple-1)*temple;
      var closeLips = (y+.111)*.76*lips;
      var corners = profile.smile*Math.min(1,(x/.030)**2)*lips;
      var neckBase = 1-T.MathUtils.smoothstep(y,-.178,-.153);
      pos[i] = x*(1+(shape-1)*neck)*(1+(profile.ear-1)*outerEar)*(1-.22*neckBase);
      pos[i+1] = y+(y+.037)*(profile.height-1)*neck-closeLips+corners;
      pos[i+2] = z+(profile.nose*nose+profile.cheek*cheeks+profile.chin*lowerChin+
        profile.brow*brow)*front-.0026*lips;
      uv[i/3*2] = profile.center+(x/.031)*profile.eyeSpacing;
      uv[i/3*2+1] = scanV(y, profile);
    }
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.setIndex(new T.BufferAttribute(source.index, 1));
    geo.computeVertexNormals();
    return geo;
  }

  function scalpSurface(T, skull) {
    var scalp = new T.BufferGeometry();
    var points = skull.attributes.position;
    var index = skull.index.array;
    var filtered = [];
    for (var i = 0; i < index.length; i += 3) {
      var a = index[i], b = index[i+1], c = index[i+2];
      var y = (points.getY(a)+points.getY(b)+points.getY(c))/3;
      var x = (points.getX(a)+points.getX(b)+points.getX(c))/3;
      var z = (points.getZ(a)+points.getZ(b)+points.getZ(c))/3;
      if (y >= -.112 && (y > -.031 || Math.abs(x) < .075 || z < .008)) filtered.push(a,b,c);
    }
    scalp.setAttribute('position', points);
    scalp.setIndex(filtered);
    return scalp;
  }

  function hairstyle(T, profile, skull) {
    var style = profile.hair;
    var strands = 76, rings = 27;
    var pos = [], colors = [], uv = [], hem = [], faces = [];
    var offsetY = -.027, offsetZ = .027;
    var center = new T.Vector3(0, offsetY, offsetZ);
    var radial = new T.Vector3();
    var origin = new T.Vector3();
    var direction = new T.Vector3();
    var ray = new T.Raycaster();
    var scalp = new T.Mesh(scalpSurface(T, skull), new T.MeshBasicMaterial());
    var intersections = [];
    for (var ring = 0; ring <= rings; ring++) {
      var along = .002 + ring/rings * .998;
      for (var strand = 0; strand <= strands; strand++) {
        var turn = strand/strands * Math.PI*2;
        var front = Math.max(0, Math.cos(turn));
        var back = Math.max(0, -Math.cos(turn));
        var fringe = style.edge + .07*Math.sin(turn*9+.7) + .038*Math.sin(turn*18);
        var centerPart = style.part * Math.exp(-((Math.sin(turn-.072)/.30)**2));
        fringe -= centerPart;
        var earArch = .20 * Math.exp(-(((Math.cos(turn)-.02)/.22)**2));
        var nape = back * (style.nape + .026*Math.sin(turn*17+.7));
        var edgeAngle = style.side + nape - (style.side-fringe)*front**1.75 - earArch;
        var theta = along * edgeAngle;
        var angle = turn + style.sweep * (1-along) * Math.sin(theta);
        var wave = Math.sin(turn*9+along*4)*.49 + Math.sin(turn*17-along*3)*.37;
        var grain = .55*Math.sin(turn*29+along*9) + .27*Math.cos(turn*57+along*13);
        var volume = style.volume * (wave + .43*grain) * Math.sin(theta);
        var x = Math.sin(theta) * Math.sin(angle) * (style.width + volume);
        var y = Math.cos(theta) * (style.height + volume) + offsetY;
        var z = Math.sin(theta) * Math.cos(angle) * (style.depth + volume) + offsetZ;
        radial.set(x, y-offsetY, z-offsetZ).normalize();
        origin.copy(center).addScaledVector(radial, .22);
        ray.set(origin, direction.copy(radial).negate());
        intersections.length = 0;
        ray.intersectObject(scalp, false, intersections);
        if (intersections.length) {
          var thickness = .004 + (.007+style.volume+volume) * (1-along*along);
          radial.multiplyScalar(.22 - intersections[0].distance + thickness).add(center);
          x = radial.x;
          y = radial.y;
          z = radial.z;
        }
        pos.push(x, y, z);
        hem.push(along);
        uv.push(profile.center + (x/.031)*profile.eyeSpacing, scanV(y, profile));
        var shade = 1 + wave*.13 + grain*.23 + front*.21;
        colors.push(.0135*shade, .0112*shade, .0100*shade);
        if (ring && strand) {
          var end = ring*(strands+1)+strand, start = end-strands-1;
          faces.push(start-1, end-1, end, start-1, end, start);
        }
      }
    }
    var geo = new T.BufferGeometry();
    scalp.geometry.dispose();
    scalp.material.dispose();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geo.setAttribute('hem', new T.Float32BufferAttribute(hem, 1));
    geo.setIndex(faces);
    geo.computeVertexNormals();
    return geo;
  }

  function projectFace(material, tex, clothingSkin, hair, eyelids) {
    material.customProgramCacheKey = function () { return hair ? 'athlete-hair' : 'athlete-face'; };
    material.onBeforeCompile = function (shader) {
      shader.uniforms.athleteScan = { value: tex };
      shader.uniforms.athleteNeck = { value: clothingSkin };
      shader.vertexShader = 'varying vec3 vAthletePoint; varying vec2 vAthleteScan;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvAthletePoint = position; vAthleteScan = uv;');
      shader.fragmentShader = 'uniform sampler2D athleteScan; uniform vec3 athleteNeck;\n' +
        'varying vec3 vAthletePoint; varying vec2 vAthleteScan;\n' + shader.fragmentShader;
      if (hair) {
        shader.vertexShader = 'attribute float hem; varying float vHairRing;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('vAthleteScan = uv;', 'vAthleteScan = uv; vHairRing = hem;');
        shader.fragmentShader = 'varying float vHairRing;\n' + shader.fragmentShader;
      }
      var photo = 'vec3 scan = sRGBToLinear(texture2D(athleteScan, vAthleteScan)).rgb;\n';
      if (!hair) {
        shader.uniforms.athleteBlink = eyelids;
        shader.fragmentShader = 'uniform float athleteBlink;\n' + shader.fragmentShader;
        photo += 'float eye = (1.0-smoothstep(.014,.022,abs(abs(vAthletePoint.x)-.032))) * ' +
          '(1.0-smoothstep(.0037,.011,abs(vAthletePoint.y+.038)));\n' +
          'vec3 lid = sRGBToLinear(texture2D(athleteScan, vAthleteScan+vec2(0.0,.020))).rgb;\n' +
          'scan = mix(scan,lid,eye*athleteBlink);\n';
      }
      var mix = hair
        ? 'float front = smoothstep(0.028, 0.095, vAthletePoint.z);\n' +
          'float dark = 1.0 - smoothstep(0.064, 0.149, scan.r);\n' +
          'float trim = front * smoothstep(0.79, 0.99, vHairRing);\n' +
          'diffuseColor.a *= 1.0 - trim * smoothstep(0.11, 0.29, scan.r);\n' +
          'diffuseColor.rgb = mix(diffuseColor.rgb, scan, front * dark * 0.88);'
        : 'float frontal = smoothstep(0.040, 0.103, vAthletePoint.z);\n' +
          'float cheeks = 1.0 - smoothstep(0.058, 0.093, abs(vAthletePoint.x));\n' +
          'float neckJoin = smoothstep(-0.173, -0.144, vAthletePoint.y);\n' +
          'diffuseColor.rgb = mix(athleteNeck, diffuseColor.rgb, neckJoin);\n' +
          'diffuseColor.rgb = mix(diffuseColor.rgb, scan, frontal * cheeks * neckJoin * 0.98);';
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\n' + photo + mix);
    };
  }

  function buildHead(T, skin, character) {
    var id = Object.prototype.hasOwnProperty.call(appearance, character) ? character : 'wang';
    var profile = appearance[id];
    var art = G.PP_ARENA_ART;
    if (!source) {
      source = { pos: unpack(art.headMesh.pos, Float32Array), index: unpack(art.headMesh.index, Uint16Array) };
    }
    if (!prepared[id]) {
      var texture = new T.TextureLoader().load(art.faces[id]);
      texture.anisotropy = 4;
      var skull = sculpt(T, profile);
      prepared[id] = { skull: skull, hair: hairstyle(T, profile, skull), texture: texture };
    }
    var asset = prepared[id];
    var faceMat = skin.clone();
    faceMat.color.setHex(profile.tint).convertSRGBToLinear();
    faceMat.roughness = .93;
    faceMat.metalness = 0;
    var lids = {value:0};
    projectFace(faceMat,asset.texture,skin.color,false,lids);
    var hairMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .82, side: T.DoubleSide, alphaTest: .48 });
    projectFace(hairMat, asset.texture, skin.color, true);

    var group = new T.Group();
    group.name = id + ' head';
    group.userData.faceTexture = asset.texture;
    var offset = id === 'fan' ? .74 : id === 'wang' ? 1.51 : 2.62;
    group.userData.updateExpression = function (t) {
      var clock=(t+offset)%4.27;
      var doubleBlink=(Math.floor((t+offset)/4.27)%3)===2;
      var closure=Math.max(0,1-Math.abs(clock-.13)/.095);
      if (doubleBlink) closure=Math.max(closure,Math.max(0,1-Math.abs(clock-.38)/.077));
      lids.value=closure*closure;
    };
    var face = new T.Mesh(asset.skull, faceMat);
    face.name = 'anatomical head and neck';
    face.castShadow = true;
    var hair = new T.Mesh(asset.hair, hairMat);
    hair.name = 'groomed hairstyle';
    hair.castShadow = true;
    group.add(face, hair);
    return group;
  }

  G.PP.wangModel = { buildHead: buildHead };
})(typeof globalThis !== 'undefined' ? globalThis : this);
