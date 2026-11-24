/* Anatomical body mesh retargeted from its human bind pose to the existing racket-aware IK. */
;(function (G) {
  'use strict';
  function decode(encoded, Type) {
    var bytes = Uint8Array.from(atob(encoded), function (c) { return c.charCodeAt(0); });
    return new Type(bytes.buffer);
  }

  var uniforms = {
    wang:{colors:['#c72432','#8c1829'],stripe:['#f1b659','#e95d51','#ae2034'],name:'WANG C.Q.',country:'CHN'},
    harimoto:{colors:['#4564ba','#283b8d'],stripe:['#e5e6eb','#5169b6','#3a55a5'],name:'HARIMOTO T.',country:'JPN'},
    fan:{colors:['#222427','#121317'],stripe:['#b29b62','#3e3b32','#655838'],name:'FAN Z.D.',country:'CHN'},
    ma:{colors:['#1d4da9','#152e69'],stripe:['#f059b0','#a82582','#2154b0'],name:'MA LONG',country:'CHN'},
    sun:{colors:['#24569b','#121d46'],stripe:['#70b9d3','#254477','#284b92'],name:'SUN YINGSHA',country:'CHN'},
    ovtcharov:{colors:['#25538b','#172b54'],stripe:['#e2b755','#315e9a','#172f5a'],name:'D. OVTCHAROV',country:'GER'}
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
      if (style.country==='GER') {
        ['#171719','#d33135','#edbc39'].forEach(function (color, i) {
          g.fillStyle=color; g.fillRect(x,y+10*i,44,10);
        });
        return;
      }
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
        stripe([[0,0],[185,0],[151,40],[70,80],[0,105]],style.stripe[2]);
        stripe([[512,0],[326,0],[354,46],[439,82],[512,112]],style.stripe[2]);
        stripe([[0,483],[121,488],[218,551],[512,429],[512,480],[214,615],[83,528],[0,524]],style.stripe[1]);
        for (var line=0;line<7;line++) {
          g.strokeStyle=line%3===0 ? '#ffe66d8c' : '#ef9e6188'; g.lineWidth=2;
          g.beginPath(); g.moveTo(15,476+line*10);
          g.bezierCurveTo(150,422+line*12,210,630+line*3,492,447+line*9); g.stroke();
        }
      } else if (id==='harimoto') {
        stripe([[0,0],[188,0],[99,108],[72,219],[0,240]],style.stripe[2]);
        stripe([[512,0],[330,0],[423,110],[448,220],[512,242]],style.stripe[2]);
        stripe([[0,158],[64,177],[82,202],[0,187]],style.stripe[0]);
        stripe([[512,158],[448,177],[430,202],[512,187]],style.stripe[0]);
        stripe([[0,430],[190,521],[512,361],[512,396],[185,546],[0,457]],style.stripe[1]);
      } else if (id==='ma') {
        stripe([[0,0],[190,0],[120,72],[48,212],[0,207]],style.stripe[2]);
        var magenta=g.createLinearGradient(472,6,142,402);
        magenta.addColorStop(0,style.stripe[0]); magenta.addColorStop(.38,style.stripe[1]);
        magenta.addColorStop(1,'#253e92');
        stripe([[512,0],[321,0],[270,128],[92,306],[240,412],[400,264],[512,218]],magenta);
        for (var thread=0;thread<7;thread++) {
          var dy=thread*11;
          g.strokeStyle='rgba(249,151,226,.23)'; g.lineWidth=2.5;
          g.beginPath(); g.moveTo(156,329+dy);
          g.bezierCurveTo(311,240+dy,384,118+dy,497,89+dy); g.stroke();
        }
      } else if (id==='sun') {
        stripe([[0,0],[194,0],[114,56],[67,188],[0,229]],style.stripe[2]);
        stripe([[512,0],[319,0],[407,58],[447,194],[512,229]],style.stripe[2]);
        stripe([[0,107],[135,52],[203,84],[512,65],[512,123],[194,135],[128,106],[0,158]],style.stripe[1]);
        stripe([[0,126],[123,70],[186,96],[512,85],[512,92],[182,105],[125,80],[0,139]],style.stripe[0]);
      } else if (id==='ovtcharov') {
        stripe([[0,0],[164,0],[117,51],[50,183],[0,207]],style.stripe[1]);
        stripe([[512,0],[348,0],[395,51],[462,183],[512,207]],style.stripe[1]);
        stripe([[0,159],[55,146],[62,161],[0,179]],style.stripe[0]);
        stripe([[512,159],[457,146],[450,161],[512,179]],style.stripe[0]);
        stripe([[0,317],[72,353],[194,640],[140,640],[46,424],[0,401]],style.stripe[2]);
        stripe([[512,317],[440,353],[318,640],[372,640],[466,424],[512,401]],style.stripe[2]);
      } else {
        stripe([[0,0],[187,0],[113,51],[0,116]],style.stripe[1]);
        stripe([[512,0],[324,0],[402,51],[512,116]],style.stripe[1]);
        stripe([[0,38],[177,6],[165,16],[0,51]],style.stripe[0]);
        stripe([[512,39],[335,7],[347,17],[512,53]],style.stripe[0]);
        stripe([[0,389],[184,497],[512,369],[512,391],[186,520],[0,416]],style.stripe[2]);
        stripe([[0,448],[181,548],[512,414],[512,427],[180,564],[0,465]],style.stripe[1]);
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
    var stature = style.stature || 1;
    var hipWidth = style.hipWidth || 1;
    var shoulderWidth = (style.shoulders || .1866) / .1866;
    var shortTrim = new T.Color(style.shortTrim || shorts.color);
    var sole = new T.Color(style.sole || 0xd3d5d6);
    var shoeTrim = new T.Color(style.shoeTrim || 0xa1afbf);

    // 顶点和绑定点共用比例变换，保持肩、髋、腕部连续。
    function shape(x, y, z) {
      var torso = 1-T.MathUtils.smoothstep(Math.abs(x),.185,.30);
      var upper = T.MathUtils.smoothstep(y,1.16,1.33);
      var hips = T.MathUtils.smoothstep(y,.57,.83)*(1-T.MathUtils.smoothstep(y,.96,1.07));
      var waist = T.MathUtils.smoothstep(y,.86,1.10);
      var width = ((bodyWidth-1)*waist*(1-upper)+(shoulderWidth-1)*upper)*torso;
      return [x*(1+width+(hipWidth-1)*hips),y*stature,z*(1+(bodyWidth-1)*torso*waist*.47)];
    }
    for (var i=0;i<fabric.length;i++) {
      var region = regions[i], j=i*3;
      var x=positions[j], y=positions[j+1], z=positions[j+2];
      var color=materialColors[region];
      var point = shape(x,y,z);
      positions[j] = point[0];
      positions[j+1] = point[1];
      positions[j+2] = point[2];
      if (region===1) {
        var seam = Math.abs(x)-.095+(y-1.13)*(style.character==='wang' ? .27 : -.28);
        var front = T.MathUtils.smoothstep(z,.017,.075);
        var sleeve = T.MathUtils.smoothstep(Math.abs(x),.190,.242);
        var chest = style.character==='fan' ? y-.96+x*.85 : y-1.24+x*.63;
        var panel = Math.max(Math.exp(-((seam/.018)**2))*.23,
          Math.exp(-((chest/.035)**2))*front*.38,sleeve*.18);
        color=cloth.copy(color).lerp(accent,panel);
      } else if (region===2) {
        var piping = T.MathUtils.smoothstep(Math.abs(x),.165,.208)*.72;
        var hem = 1-T.MathUtils.smoothstep(y,.64,.662);
        color=cloth.copy(color).lerp(shortTrim,Math.max(piping,hem*.53));
      } else if (region===4) {
        var outsole = 1-T.MathUtils.smoothstep(y,.017,.027);
        var sidePanel = T.MathUtils.smoothstep(Math.abs(Math.abs(x)-.191),.030,.053);
        var saddle = Math.exp(-(((z-.059)/.047)**2)) * sidePanel;
        color=cloth.copy(color).lerp(shoeTrim,saddle*.81).lerp(sole,outsole);
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
      shader.uniforms.athleteStature = {value:stature};
      shader.vertexShader = 'attribute float jerseyZone; uniform float athleteFacing; uniform float athleteStature; ' +
        'varying vec3 jerseyPoint; varying float jerseyWeight;\n'+shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\njerseyPoint = position*vec3(athleteFacing,1.0/athleteStature,athleteFacing);\njerseyWeight = jerseyZone;');
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
    var local = function (v) {
      var p = shape(v[0],v[1],v[2]);
      return new T.Vector3(p[0]*facing,p[1],p[2]*facing);
    };
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
    var undoFacing = new T.Quaternion().setFromAxisAngle(up,facing < 0 ? -Math.PI : 0);

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
        // 躯干网格与绑定骨骼已转过基准朝向，只施加准备姿势后的旋转。
        rotation.multiplyQuaternions(body.quaternion,undoFacing);
        segment.bone.position.copy(segment.start).applyQuaternion(rotation).add(body.position);
        segment.bone.quaternion.multiplyQuaternions(rotation,segment.base);
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
