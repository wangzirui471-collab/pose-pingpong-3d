/* Anatomical body mesh retargeted from its human bind pose to the existing racket-aware IK. */
;(function (G) {
  'use strict';
  function decode(encoded, Type) {
    var bytes = Uint8Array.from(atob(encoded), function (c) { return c.charCodeAt(0); });
    return new Type(bytes.buffer);
  }

  var uniforms = {
    wang:{colors:['#b4222b','#650d1f'],stripe:['#f4be5b','#dc7528','#7c1326'],name:'WANG C.Q.',country:'CHN'},
    harimoto:{colors:['#155491','#121b3d'],stripe:['#61abd8','#2776b5','#1a4282'],name:'HARIMOTO T.',country:'JPN'},
    fan:{colors:['#142235','#10151f'],stripe:['#5a9ed6','#214a95','#a83e75'],name:'FAN Z.D.',country:'CHN'}
  };

  function jerseyAtlas(T,id) {
    var style=uniforms[id];
    var atlas=document.createElement('canvas');
    atlas.width=1024; atlas.height=640;
    var g=atlas.getContext('2d');
    function stripe(points,color) {
      g.beginPath();
      points.forEach(function (p,i) { if (i) g.lineTo(p[0],p[1]); else g.moveTo(p[0],p[1]); });
      g.fillStyle=color; g.fill();
    }
    function star(x,y,r) {
      g.beginPath();
      for (var i=0;i<10;i++) {
        var a=(i*.2-.5)*Math.PI, rr=r*(i%2 ? .40 : 1);
        var px=x+Math.cos(a)*rr, py=y+Math.sin(a)*rr;
        if (i) g.lineTo(px,py); else g.moveTo(px,py);
      }
      g.fill();
    }
    function flag(x,y) {
      g.fillStyle=style.country==='JPN' ? '#f6f2ee' : '#d52832';
      g.fillRect(x,y,44,29);
      if (style.country==='JPN') {
        g.fillStyle='#ae233b';
        g.beginPath(); g.arc(x+22,y+14.5,8,0,Math.PI*2); g.fill();
      } else {
        g.fillStyle='#ffdd63';
        star(x+11,y+10,5.3);
        [[20,5],[25,8],[24,14],[19,17]].forEach(function (q) { star(x+q[0],y+q[1],1.75); });
      }
    }
    for (var pass=0;pass<2;pass++) {
      g.save();
      g.translate(pass*512,0);
      var ground=g.createLinearGradient(0,0,0,640);
      ground.addColorStop(0,style.colors[0]);
      ground.addColorStop(1,style.colors[1]);
      g.fillStyle=ground; g.fillRect(0,0,512,640);
      if (id==='wang') {
        stripe([[0,473],[83,452],[208,545],[512,410],[512,449],[208,618],[64,510],[0,518]],style.stripe[1]);
        stripe([[0,499],[100,484],[232,573],[512,455],[512,472],[218,598],[86,506],[0,525]],style.stripe[0]);
        stripe([[0,0],[202,0],[170,34],[0,125]],style.stripe[2]);
        stripe([[512,0],[314,0],[345,33],[512,116]],style.stripe[2]);
      } else if (id==='harimoto') {
        stripe([[0,0],[184,0],[82,135],[57,381],[0,542]],style.stripe[2]);
        stripe([[512,0],[327,0],[444,116],[471,384],[512,506]],style.stripe[2]);
        stripe([[20,477],[124,422],[213,497],[389,404],[512,365],[512,401],[393,438],[222,536],[122,453],[0,532]],style.stripe[1]);
        stripe([[0,62],[117,12],[91,47],[0,115]],style.stripe[0]);
        stripe([[512,65],[399,14],[425,54],[512,112]],style.stripe[0]);
      } else {
        stripe([[0,398],[179,488],[512,330],[512,386],[183,546],[0,484]],style.stripe[1]);
        stripe([[0,467],[169,533],[512,390],[512,405],[163,561],[0,492]],style.stripe[2]);
        stripe([[0,525],[225,579],[512,442],[512,461],[231,601],[0,556]],style.stripe[0]);
        stripe([[40,0],[116,0],[19,211],[0,232],[0,170]],style.stripe[1]);
        stripe([[392,0],[471,0],[512,134],[512,188]],style.stripe[1]);
      }
      g.lineWidth=1;
      g.strokeStyle='#ffffff11';
      for (var y=2;y<640;y+=6) { g.beginPath();g.moveTo(0,y);g.lineTo(512,y+10);g.stroke(); }
      g.strokeStyle=style.stripe[0];
      g.lineWidth=3.5;
      g.beginPath();g.moveTo(0,178);g.bezierCurveTo(115,113,147,52,175,32);g.stroke();
      g.beginPath();g.moveTo(512,178);g.bezierCurveTo(397,113,365,52,337,32);g.stroke();
      if (!pass) flag(322,152);
      else {
        g.textAlign='center';
        g.fillStyle='#fff4dc';
        g.font='800 28px Arial,sans-serif';
        g.fillText(style.name,256,161);
        g.font='900 42px Arial,sans-serif';
        g.fillText(style.country,256,221);
      }
      g.restore();
    }
    var texture=new T.CanvasTexture(atlas);
    texture.anisotropy=4;
    return texture;
  }

  function build(T,root,skin,jersey,shorts,shoe,facing,style) {
    var asset = G.PP_ATHLETE_MESH;
    var meshGeometry = new T.BufferGeometry();
    var positions = decode(asset.pos,Float32Array);
    meshGeometry.setAttribute('position',new T.BufferAttribute(positions,3));
    meshGeometry.setAttribute('skinIndex', new T.BufferAttribute(decode(asset.joints, Uint8Array), 4));
    meshGeometry.setAttribute('skinWeight', new T.BufferAttribute(decode(asset.weights, Uint8Array), 4, true));
    meshGeometry.setIndex(new T.BufferAttribute(decode(asset.index, Uint16Array), 1));
    var fabric = decode(asset.shade, Uint8Array);
    var regions = decode(asset.regions,Uint8Array);
    var garment = Uint8Array.from(regions,function (region) { return region===1 ? 255 : 0; });
    meshGeometry.setAttribute('jerseyZone',new T.BufferAttribute(garment,1,true));
    var materialColors = [skin.color, jersey.color, shorts.color, new T.Color(0xd4cdd0), shoe.color];
    var colors = new Uint8Array(fabric.length*3);
    var accent = new T.Color(style.trim), cloth = new T.Color();
    var bodyWidth = style.bodyWidth || 1;
    for (var i=0;i<fabric.length;i++) {
      var region = regions[i], j=i*3;
      var x=positions[j], y=positions[j+1], z=positions[j+2];
      var color=materialColors[region];
      if (region===1) {
        var torso = 1-T.MathUtils.smoothstep(Math.abs(x),.18,.27);
        positions[j] *= 1+(bodyWidth-1)*torso;
        positions[j+2] *= 1+(bodyWidth-1)*torso*.38;
        var seam = Math.abs(x)-.095+(y-1.13)*(style.character==='wang' ? .27 : -.28);
        var front = T.MathUtils.smoothstep(z,.017,.075);
        var sleeve = T.MathUtils.smoothstep(Math.abs(x),.190,.242);
        var chest = style.character==='fan' ? y-.96+x*.85 : y-1.24+x*.63;
        var panel = Math.max(Math.exp(-((seam/.018)**2))*.23,
          Math.exp(-((chest/.035)**2))*front*.38,sleeve*.18);
        color=cloth.copy(color).lerp(accent,panel);
      }
      colors[j]=Math.round(color.r*fabric[i]);
      colors[j+1]=Math.round(color.g*fabric[i]);
      colors[j+2]=Math.round(color.b*fabric[i]);
    }
    meshGeometry.setAttribute('color', new T.BufferAttribute(colors, 3, true));
    if (facing < 0) meshGeometry.rotateY(Math.PI);
    meshGeometry.computeVertexNormals();
    var materials = new T.MeshStandardMaterial({
      color:0xffffff, vertexColors:true, skinning:true, roughness:.87
    });
    var holdingBone = {value:-1};
    var jerseyMap = jerseyAtlas(T,style.character);
    materials.customProgramCacheKey = function () { return 'athlete-jersey-grip'; };
    materials.onBeforeCompile = function (shader) {
      shader.uniforms.jerseyMap = {value:jerseyMap};
      shader.uniforms.athleteFacing = {value:facing};
      shader.vertexShader = 'attribute float jerseyZone; uniform float athleteFacing; ' +
        'varying vec3 jerseyPoint; varying float jerseyWeight;\n'+shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\njerseyPoint = position*vec3(athleteFacing,1.0,athleteFacing);\njerseyWeight = jerseyZone;');
      shader.fragmentShader = 'uniform sampler2D jerseyMap; varying vec3 jerseyPoint; varying float jerseyWeight;\n'+shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\n' +
        'vec2 kitUV = clamp(vec2(jerseyPoint.x/.60+.5, 1.0-(1.45-jerseyPoint.y)/.56),.003,.997);\n' +
        'float rear = 1.0-smoothstep(-.035,.035,jerseyPoint.z);\n' +
        'vec3 frontKit = sRGBToLinear(texture2D(jerseyMap,vec2(kitUV.x*.5,kitUV.y))).rgb;\n' +
        'vec3 backKit = sRGBToLinear(texture2D(jerseyMap,vec2(.5+kitUV.x*.5,kitUV.y))).rgb;\n' +
        'diffuseColor.rgb = mix(diffuseColor.rgb,mix(frontKit,backKit,rear),jerseyWeight*.91);');
      clipHoldingHand(shader);
    };
    function clipHoldingHand(shader) {
      shader.uniforms.gripBone = holdingBone;
      // 同一处裁掉原持拍手的蒙皮与阴影，保留腕部连接。
      shader.vertexShader = 'uniform float gripBone; varying float gripMask;\n'+shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvec4 held = 1.0 - step(vec4(.1),abs(skinIndex-vec4(gripBone)));\n' +
        'gripMask = dot(skinWeight,held);');
      shader.fragmentShader = 'varying float gripMask;\n'+shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nif(gripMask > 0.64) discard;');
    }
    var mesh = new T.SkinnedMesh(meshGeometry, materials);
    mesh.name = 'anatomical-athlete';
    mesh.customDepthMaterial = new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,skinning:true});
    mesh.customDepthMaterial.onBeforeCompile = clipHoldingHand;
    mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    var up = new T.Vector3(0, 1, 0);
    var local = function (v) { return new T.Vector3(v[0]*facing, v[1], v[2]*facing); };
    var segments = asset.bind.map(function (pair) {
      var start = local(pair[0]), end = local(pair[1]);
      var direction = end.clone().sub(start).normalize();
      var base = new T.Quaternion().setFromUnitVectors(up, direction);
      var bone = new T.Bone();
      bone.position.copy(start);
      bone.quaternion.copy(base);
      mesh.add(bone);
      return { bone:bone, start:start, direction:direction, length:start.distanceTo(end), base:base };
    });
    root.updateMatrixWorld(true);
    mesh.bind(new T.Skeleton(segments.map(function (segment) { return segment.bone; })));
    var desired = new T.Vector3(), rotation = new T.Quaternion(), direction = new T.Quaternion();

    function line(index, a, b, preserveLength) {
      var segment = segments[index], bone = segment.bone;
      desired.set(b[0]-a[0], b[1]-a[1], b[2]-a[2]);
      var length = Math.max(.001, desired.length());
      desired.multiplyScalar(1/length);
      direction.setFromUnitVectors(segment.direction, desired);
      bone.position.set(a[0], a[1], a[2]);
      bone.quaternion.multiplyQuaternions(direction, segment.base);
      bone.scale.y = preserveLength ? 1 : length / segment.length;
    }

    function sideIndex(side) {
      return side * facing < 0 ? 1 : 7;
    }

    return {
      grip: function (side) {
        holdingBone.value = sideIndex(side)+2;
      },
      torso: function (body) {
        var segment = segments[0];
        segment.bone.position.copy(segment.start).applyQuaternion(body.quaternion).add(body.position);
        segment.bone.quaternion.multiplyQuaternions(body.quaternion, segment.base);
      },
      arm: function (side, shoulder, elbow, wrist, towardKnuckles) {
        var index = sideIndex(side);
        line(index, shoulder, elbow);
        line(index+1, elbow, wrist);
        line(index+2, wrist, towardKnuckles, true);
      },
      leg: function (side, hip, knee, ankle) {
        var index = sideIndex(side);
        line(index+3,hip,knee);
        line(index+4,knee,ankle);
        line(index+5,ankle,[ankle[0]+side*.019,ankle[1]-.048,ankle[2]+facing*.19],true);
      }
    };
  }

  G.PP.athleteRig={ build:build };
})(typeof globalThis !== 'undefined' ? globalThis : this);
