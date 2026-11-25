/* 球员头部塑形、面部贴图投影与发型。 */
;(function (G) {
  'use strict';

  var appearance = {
    wang: {
      center:.523, eyeSpacing:.116, tint: 0xd5a68c,
      width:1.010, jaw:.910, height:1.048, cheek:.0048, nose:.0027,
      temple: .99, chin:.0024, brow:-.0024, smile:.0010, ear:.93,
      eye:[.033,-.019,.0140,.0051,.0034,.0004], eyebrows:[.0090,.0019,.0020], iris:0x54403a, mouthWidth:.94, lip:.0019,
      bridge:.0019, back:.0018, lowerFace:.0013, chinWidth:.97, lipClosure:.66,
      scanY:[.998,.916,.847,.751,.638,.514,.459,.331,.047],
      hair:{width:.096,height:.109,depth:.114,edge:1.29,side:1.67,nape:.20,part:.128,split:true,sweep:.26,volume:.0080,fringe:.069}
    },
    harimoto: {
      center:.502, eyeSpacing:.117, tint: 0xce987e,
      width:1.048, jaw:1.010, height:.984, cheek:.0086, nose:-.0041,
      temple:1.04, chin:-.0012, brow:-.002, smile:.0031, ear:.98,
      eye:[.033,-.028,.0143,.0052,.0034,.0011], eyebrows:[.0108,.0025,.0022], iris:0x523b33, mouthWidth:1.07, lip:.0012,
      bridge:.0015, back:.0025, lowerFace:-.0012, chinWidth:.98, lipClosure:.63,
      scanY:[.998,.917,.846,.729,.631,.493,.443,.327,.051],
      hair:{width:.094,height:.107,depth:.114,edge:1.29,side:1.72,nape:.24,part:.025,sweep:-.54,volume:.0067,fringe:.070}
    },
    fan: {
      center:.515, eyeSpacing:.129, tint: 0xc99e83,
      width:1.104, jaw:1.165, height:.929, cheek:.0098, nose:-.0046,
      temple:1.053, chin:.0030, brow:.0008, smile:.0013, ear:.95,
      eye:[.034,-.028,.0144,.0053,.0035,-.0006], eyebrows:[.0114,.0027,.0023], iris:0x563d32, mouthWidth:1.04, lip:.0024,
      bridge:.0014, back:-.0018, lowerFace:.0021, chinWidth:1.012, lipClosure:.65,
      scanY:[.998,.904,.835,.732,.627,.489,.437,.321,.047],
      hair:{width:.092,height:.102,depth:.109,edge:1.10,side:1.59,nape:.11,part:.066,sweep:.50,volume:.0062,lift:.0052,fringe:.059,taper:.15}
    },
    // 正面近景定位五官，侧面及转身镜头校对鼻梁、后脑和发际线。
    ovtcharov: {
      center:.492, eyeSpacing:.097, tint:0xc19a85,
      width:.968, jaw:1.023, height:1.075, cheek:-.0010, nose:.0084,
      temple:1.015, chin:.0038, brow:.0007, smile:.0004, ear:.94,
      eye:[.031,-.035,.0131,.0047,.0034,-.0007], eyebrows:[.0108,.0021,.0026], iris:0x645f53, mouthWidth:1.02, lip:.0006,
      bridge:.0044, back:.0032, lowerFace:.0042, chinWidth:1.03, blinkOffset:.36, lipClosure:.57,textureWidth:.184,
      scanY:[.998,.922,.854,.690,.605,.457,.409,.319,.025],
      hair:{width:.093,height:.108,depth:.110,edge:.90,side:1.38,nape:.12,part:.09,sweep:-.69,
        volume:.0090,lift:.0094,fringe:.045,red:.0260,green:.0190,blue:.0150,taper:.28}
    },
    sun: {
      center:.505, eyeSpacing:.111, tint:0xd4a48c,
      width:1.035, jaw:.943, height:.916, cheek:.0118, nose:-.0078,
      temple:1.024, chin:-.0029, brow:-.0055, smile:.0018, ear:.89,
      eye:[.033,-.033,.0138,.0053,.0037,.0004], eyebrows:[.0098,.0024,.0017], iris:0x50372d, mouthWidth:.89, lip:.0026,
      bridge:-.0042, back:.0018, lowerFace:-.0040, chinWidth:.94, blinkOffset:2.04, lipClosure:.59, neckWidth:.83,textureWidth:.211,
      scanY:[.998,.914,.850,.750,.644,.504,.448,.342,.037],
      hair:{width:.092,height:.105,depth:.111,edge:1.26,side:1.76,nape:.160,part:.035,sweep:.38,
        volume:.0069,lift:.0052,fringe:.092,red:.0146,green:.0114,blue:.0111}
    },
    ma: {
      center:.506, eyeSpacing:.118, tint:0xcda289,
      width:.972, jaw:.936, height:1.041, cheek:.0050, nose:.0044,
      temple:1.006, chin:.0022, brow:-.0021, smile:.0012, ear:1.00,
      eye:[.031,-.036,.0140,.0051,.0035,-.0005], eyebrows:[.0110,.0032,.0018], iris:0x563d32, mouthWidth:.96, lip:.0014,
      bridge:.0018, back:-.0018, lowerFace:.0020, chinWidth:.98, blinkOffset:3.52, lipClosure:.59,
      scanY:[.998,.929,.870,.751,.635,.483,.435,.319,.032],
      hair:{width:.091,height:.104,depth:.107,edge:1.05,side:1.53,nape:.14,part:.060,sweep:.62,
        volume:.0071,lift:.0052,fringe:.074,red:.0148,green:.0128,blue:.0117,taper:.21}
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
    var eyes = new Float32Array(pos.length / 3);
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
      var lips = Math.exp(-((x/(.032*profile.mouthWidth))**4)-(((y+.111)/.011)**2))*front;
      var shape = profile.width + (profile.jaw-profile.width)*jaw + (profile.temple-1)*temple;
      var closeLips = (y+.111)*(profile.lipClosure ?? .76)*lips;
      var corners = profile.smile*Math.min(1,(x/.030)**2)*lips;
      var neckSkirt = 1-T.MathUtils.smoothstep(y,-.178,-.157);
      var bridge = Math.exp(-((x/.016)**2)-(((y+.046)/.031)**2));
      var rear = (1-T.MathUtils.smoothstep(z,-.055,.012))*Math.exp(-(((y+.012)/.078)**2));
      var lowerFace = Math.exp(-(((y+.129)/.038)**2))*front;
      var chinShape = 1+((profile.chinWidth ?? 1)-1)*lowerChin*front;
      var neckWidth = profile.neckWidth ?? 1;
      var ax = Math.abs(x);
      var neckTaper = 1-(1-neckWidth)*(1-T.MathUtils.smoothstep(y,-.151,-.112));
      pos[i] = x*(1+(shape-1)*neck)*(1+(profile.ear-1)*outerEar)*(1-.23*neckSkirt)*chinShape*neckTaper;
      pos[i+1] = y+(y+.037)*(profile.height-1)*neck-closeLips+corners-
        (profile.lowerFace ?? 0)*lowerFace-.032*neckSkirt;
      pos[i+2] = z+(profile.nose*nose+profile.cheek*cheeks+profile.chin*lowerChin+
        profile.brow*brow+(profile.bridge ?? 0)*bridge)*front-.0026*lips-(profile.back ?? 0)*rear;
      var lipBody = Math.exp(-(((y+.117)/.006)**2)-((x/(.022*profile.mouthWidth))**4));
      pos[i+2] += profile.lip*lipBody*front;
      // 底模的闭眼褶皱与睁眼贴图重叠。眼周改为连续的浅眼窝表面。
      var eyeBlend = T.MathUtils.smoothstep(ax,.009,.020) *
        (1-T.MathUtils.smoothstep(ax,.046,.067)) *
        T.MathUtils.smoothstep(y,-.063,-.050) *
        (1-T.MathUtils.smoothstep(y,Math.max(-.021,profile.eye[1]+.005),Math.max(-.008,profile.eye[1]+.014))) *
        T.MathUtils.smoothstep(z,.081,.095);
      var socket = .1354 - 8.4*(ax-.025)**2 + .19*(y+.037);
      var eye = profile.eye;
      var recess = Math.exp(-(((ax-eye[0])/(eye[2]*1.21))**2)-(((y-eye[1])/.0078)**2));
      socket -= .0021*recess;
      pos[i+2] = T.MathUtils.lerp(pos[i+2],socket,eyeBlend);
      pos[i+2] *= 1-.13*neckSkirt;
      eyes[i/3] = eyeBlend;
      uv[i/3*2] = profile.center+(x/.031)*profile.eyeSpacing;
      uv[i/3*2+1] = scanV(y, profile);
    }
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.setIndex(new T.BufferAttribute(source.index, 1));
    geo.computeVertexNormals();
    var normals = geo.getAttribute('normal');
    var smoothed = new T.Vector3();
    for (var v = 0; v < normals.count; v++) {
      var amount = T.MathUtils.smoothstep(eyes[v],.32,.93);
      if (!amount) continue;
      var offset = pos[v*3];
      var nx = 16.8*(Math.abs(offset)-.025)*Math.sign(offset);
      smoothed.set(
        T.MathUtils.lerp(normals.getX(v),nx,amount),
        T.MathUtils.lerp(normals.getY(v),-.19,amount),
        T.MathUtils.lerp(normals.getZ(v),1,amount)
      ).normalize();
      normals.setXYZ(v,smoothed.x,smoothed.y,smoothed.z);
    }
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
    var strands = 106, rings = 33;
    var pos = [], colors = [], flowUV = [], faces = [];
    var offsetY = -.027, offsetZ = .027;
    var center = new T.Vector3(0, offsetY, offsetZ);
    var scalpColor = new T.Color(profile.tint).convertSRGBToLinear();
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
        var fringe = style.edge+.041*Math.sin(turn*3+.9)+.022*Math.sin(turn*6+style.sweep);
        var centerPart = style.part*Math.exp(-((Math.sin(turn-.125)/(style.split ? .24 : .36))**2));
        fringe += (style.fringe ?? .022)*(.49*Math.sin(turn*8+.4)+.19*Math.sin(turn*15+style.sweep))*front-centerPart;
        var earArch = .20*Math.exp(-(((Math.cos(turn)-.02)/.28)**2));
        var nape = back*(style.nape+.012*Math.sin(turn*9+.7));
        var edgeAngle = style.side + nape - (style.side-fringe)*front**1.75 - earArch;
        var theta = along * edgeAngle;
        var sweep = style.split ? style.sweep*Math.tanh(Math.sin(turn-.10)*6.0) : style.sweep;
        var angle = turn+sweep*(1-along)*Math.sin(theta);
        var flow = turn-sweep*(1-along)*1.5;
        var wave = Math.sin(flow*8+along*2.6)*.49+Math.sin(flow*15-along*3.4)*.28;
        var grain = Math.sin(flow*34+Math.sin(along*4+turn)*1.8);
        var volume = style.volume*(wave+.12*grain)*Math.sin(theta)*(1-.76*along**5);
        var x = Math.sin(theta) * Math.sin(angle) * (style.width + volume);
        var y = Math.cos(theta) * (style.height + volume) + offsetY;
        var z = Math.sin(theta) * Math.cos(angle) * (style.depth + volume) + offsetZ;
        radial.set(x, y-offsetY, z-offsetZ).normalize();
        origin.copy(center).addScaledVector(radial, .22);
        ray.set(origin, direction.copy(radial).negate());
        intersections.length = 0;
        ray.intersectObject(scalp, false, intersections);
        if (intersections.length) {
          var forelock = (style.lift ?? 0) * front * Math.sin(theta) * (1-along*along);
          var thickness = .0019+(.008+style.volume+volume)*(1-along*along)+forelock;
          var shell = .22-intersections[0].distance+thickness;
          shell += Math.max(0,Math.hypot(x,y-offsetY,z-offsetZ)-shell)*.27*(1-along*along);
          radial.multiplyScalar(shell).add(center);
          x = radial.x;
          y = radial.y;
          z = radial.z;
        }
        pos.push(x, y, z);
        flowUV.push(flow/(Math.PI*2),along);
        var shade = .88+wave*.23+grain*.11+front*.13+.06*(1-along);
        var taper = (style.taper ?? .06)*(1-front*front)*T.MathUtils.smoothstep(along,.81,1);
        colors.push(
          T.MathUtils.lerp((style.red ?? .0135)*shade,scalpColor.r,taper),
          T.MathUtils.lerp((style.green ?? .0112)*shade,scalpColor.g,taper),
          T.MathUtils.lerp((style.blue ?? .0100)*shade,scalpColor.b,taper)
        );
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
    geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(flowUV, 2));
    geo.setIndex(faces);
    geo.computeVertexNormals();
    return geo;
  }

  // 两个弧面位于眼窝之后，眼睑开口由头部材质裁出。
  function eyeSurface(T,skull,profile) {
    var eye = profile.eye, xSegments=24, ySegments=14;
    var positions=[], uv=[], indices=[];
    var surface=new T.Mesh(skull,new T.MeshBasicMaterial());
    var ray=new T.Raycaster();
    var origin=new T.Vector3(), direction=new T.Vector3(0,0,-1), hits=[];
    for (var side of [-1,1]) {
      var start=positions.length/3;
      for (var row=0;row<=ySegments;row++) for (var col=0;col<=xSegments;col++) {
        var u=col/xSegments, v=row/ySegments;
        var horizontal=(u-.5)*2.17;
        var x=side*eye[0]+horizontal*eye[2];
        var y=eye[1]+(v-.5)*.014+side*horizontal*eye[5];
        origin.set(x,y,.24);
        ray.set(origin,direction);
        hits.length=0;
        ray.intersectObject(surface,false,hits);
        var z=(hits.length ? hits[0].point.z : .116)-.0026-.0014*horizontal**2;
        positions.push(x,y,z);
        uv.push(u,v);
        if (col && row) {
          var a=start+row*(xSegments+1)+col, b=a-xSegments-1;
          indices.push(b-1,b,a,b-1,a,a-1);
        }
      }
    }
    surface.material.dispose();
    var geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function irisTexture(T,profile) {
    var size=96, pixels=new Uint8Array(size*size*4);
    var iris = new T.Color(profile.iris);
    var mix=T.MathUtils.lerp, smooth=T.MathUtils.smoothstep;
    for (var y=0;y<size;y++) for (var x=0;x<size;x++) {
      var u=(x+.5)/size-.50, v=(y+.5)/size-.54;
      var radius=Math.hypot(u*2.15*profile.eye[2],v*.014)/.0049;
      var angle=Math.atan2(v*.014,u*2.15*profile.eye[2]);
      var fibers=.84+.12*Math.cos(angle*27+radius*9)+.08*Math.sin(angle*43-radius*6);
      var rim = 1-.43*smooth(radius,.73,.98);
      var pupil=smooth(radius,.35,.43), ring=1-smooth(radius,.96,1.04);
      var edge=smooth(Math.abs(u),.12,.49), lid=smooth(v,.015,.36);
      var white=1-.20*lid-.14*edge;
      var index=(y*size+x)*4;
      pixels[index]=mix((.067+iris.r*.91*pupil)*fibers*rim,.77*white+.034*edge,1-ring)*255;
      pixels[index+1]=mix((.057+iris.g*.89*pupil)*fibers*rim,.72*white,1-ring)*255;
      pixels[index+2]=mix((.058+iris.b*.90*pupil)*fibers*rim,.70*white,1-ring)*255;
      pixels[index+3]=255;
    }
    var texture=new T.DataTexture(pixels,size,size);
    texture.encoding=T.sRGBEncoding;
    texture.magFilter=T.LinearFilter;
    texture.minFilter=T.LinearFilter;
    texture.needsUpdate=true;
    return texture;
  }

  function projectFace(T, material, texture, profile, eyelids) {
    material.customProgramCacheKey = function () { return 'athlete-face-eyelids'; };
    material.onBeforeCompile = function (shader) {
      shader.uniforms.athleteScan = {value:texture};
      shader.uniforms.athleteCenter = {value:profile.center};
      shader.uniforms.athleteTextureWidth = {value:profile.textureWidth ?? .240};
      shader.uniforms.athleteEye = {value:scanV(profile.eye[1],profile)};
      shader.uniforms.athleteBlink = eyelids;
      shader.uniforms.eyeShape = {value:new T.Vector4(...profile.eye.slice(0,4))};
      shader.uniforms.eyeLower = {value:new T.Vector2(...profile.eye.slice(4))};
      shader.uniforms.eyebrowShape = {value:new T.Vector3(...profile.eyebrows)};
      shader.vertexShader = 'varying vec3 vAthletePoint; varying vec2 vAthleteScan;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvAthletePoint = position; vAthleteScan = uv;');
      shader.fragmentShader = 'uniform sampler2D athleteScan; uniform float athleteCenter; ' +
        'uniform float athleteEye; uniform float athleteBlink; uniform float athleteTextureWidth;\n' +
        'uniform vec4 eyeShape; uniform vec2 eyeLower; uniform vec3 eyebrowShape;\n' +
        'varying vec3 vAthletePoint; varying vec2 vAthleteScan;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\n' +
        'vec3 photo = sRGBToLinear(texture2D(athleteScan,vAthleteScan)).rgb;\n' +
        'float d = abs(vAthleteScan.x-athleteCenter);\n' +
        'float eyeX = (abs(vAthletePoint.x)-eyeShape.x)/eyeShape.z;\n' +
        'float eyeY = vAthletePoint.y-eyeShape.y-eyeX*eyeLower.y;\n' +
        'float almond = sqrt(max(0.0,1.0-eyeX*eyeX))*(1.0-.23*abs(eyeX));\n' +
        'float lower = -eyeLower.x*almond;\n' +
        'float upper = mix(eyeShape.w*almond,lower-.00022,athleteBlink);\n' +
        'float nearEye = smoothstep(.091,.109,vAthletePoint.z);\n' +
        'if (nearEye>.5 && abs(eyeX)<1.0 && eyeY>lower && eyeY<upper) discard;\n' +
        'float eyePatch = (1.0-smoothstep(.96,1.58,abs(eyeX))) * ' +
          '(1.0-smoothstep(.0051,.0110,abs(eyeY-.0004)));\n' +
        'vec2 cheekUV = vec2(vAthleteScan.x,athleteEye-.053);\n' +
        'vec3 cheekTone = (sRGBToLinear(texture2D(athleteScan,cheekUV+vec2(.019,0.0))).rgb + ' +
          'sRGBToLinear(texture2D(athleteScan,cheekUV-vec2(.019,0.0))).rgb) * .5;\n' +
        'vec3 lidSkin = mix(cheekTone,diffuseColor.rgb,.58)*vec3(.98,.94,.92);\n' +
        'photo = mix(photo,lidSkin,eyePatch*nearEye);\n' +
        'float limit = athleteTextureWidth*mix(.72,1.0,smoothstep(.10,.43,vAthleteScan.y));\n' +
        'float skinHue = smoothstep(.013,.068,photo.r-photo.b);\n' +
        'float feather = 1.0-smoothstep(limit*.68,limit+.031,d);\n' +
        'float edge = feather*mix(1.0,skinHue,smoothstep(limit*.67,limit,d));\n' +
        'float front = smoothstep(.028,.094,vAthletePoint.z);\n' +
        'float side = 1.0-smoothstep(.036,.082,abs(vAthletePoint.x));\n' +
        'float jaw = smoothstep(-.176,-.146,vAthletePoint.y);\n' +
        'float lidRim = (1.0-smoothstep(.00026,.00145,abs(eyeY-upper))) * ' +
          '(1.0-smoothstep(.85,1.06,abs(eyeX)))*nearEye;\n' +
        'float lowerRim = (1.0-smoothstep(.00020,.00163,abs(eyeY-lower))) * ' +
          '(1.0-smoothstep(.71,1.03,abs(eyeX)))*nearEye;\n' +
        'float crease = (1.0-smoothstep(.00015,.00095,abs(eyeY-upper-.0024))) * ' +
          '(1.0-smoothstep(.41,.93,abs(eyeX)))*nearEye;\n' +
        'float browU = (eyeX+.12)/1.25;\n' +
        'float browCurve = eyebrowShape.x + eyebrowShape.y*(1.0-browU*browU) - .00095*browU;\n' +
        'float browWidth = eyebrowShape.z*(1.0-.56*max(0.0,browU));\n' +
        'float brow = (1.0-smoothstep(browWidth*.32,browWidth,abs(eyeY-browCurve))) * ' +
          '(1.0-smoothstep(.62,1.0,abs(browU)))*nearEye;\n' +
        'float browGrain = .88+.12*sin(browU*126.0+(eyeY-browCurve)*1250.0);\n' +
        'float noseShade = (1.0-smoothstep(.010,.025,abs(vAthletePoint.x))) * ' +
          '(1.0-smoothstep(.006,.018,abs(vAthletePoint.y+.080)));\n' +
        'photo = mix(photo,max(photo,diffuseColor.rgb*.46),noseShade*.51);\n' +
        'diffuseColor.rgb = mix(diffuseColor.rgb,photo,front*side*jaw*edge*.90);\n' +
        'diffuseColor.rgb *= 1.0-.54*lidRim-.16*crease-.17*lowerRim-.47*brow*browGrain;');
    };
  }

  function groomedMaterial(T, style) {
    var material = new T.MeshStandardMaterial({vertexColors:true,roughness:.78,transparent:true});
    material.customProgramCacheKey = function () { return 'athlete-hair-soft-rim'; };
    material.onBeforeCompile = function (shader) {
      shader.uniforms.taperWidth = {value:style.taper ? .094 : .052};
      shader.vertexShader = 'varying vec2 hairFlow;\n'+shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nhairFlow = uv;');
      shader.fragmentShader = 'varying vec2 hairFlow; uniform float taperWidth;\n'+shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\n' +
        'float fiber = sin(hairFlow.x*440.0 + sin(hairFlow.y*11.0)*1.3);\n' +
        'float cluster = sin(hairFlow.x*130.0-hairFlow.y*4.0);\n' +
        'float rim = 1.0-smoothstep(1.0-taperWidth,1.0,hairFlow.y+fiber*.006+cluster*.004);\n' +
        'diffuseColor.rgb *= 1.0+fiber*.075+cluster*.060;\n' +
        'diffuseColor.a *= rim;');
    };
    return material;
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
      var eyeMat=new T.MeshStandardMaterial({map:irisTexture(T,profile),roughness:.42});
      prepared[id] = {skull:skull,hair:hairstyle(T,profile,skull),texture:texture,
        eyes:eyeSurface(T,skull,profile),eyeMat:eyeMat};
    }
    var asset = prepared[id];
    var faceMat = skin.clone();
    faceMat.color.setHex(profile.tint).convertSRGBToLinear();
    faceMat.roughness = .96;
    faceMat.emissive.copy(faceMat.color);
    faceMat.emissiveIntensity = .033;
    faceMat.metalness = 0;
    var lids = {value:0};
    projectFace(T,faceMat,asset.texture,profile,lids);
    var hairMat = groomedMaterial(T,profile.hair);

    var group = new T.Group();
    group.name = id + ' head';
    group.userData.faceTexture = asset.texture;
    var offset = profile.blinkOffset ?? (id === 'fan' ? .74 : id === 'wang' ? 1.51 : 2.62);
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
    var eyes = new T.Mesh(asset.eyes,asset.eyeMat);
    eyes.name = 'eyes';
    group.add(face,hair,eyes);
    return group;
  }

  G.PP.wangModel = { buildHead: buildHead };
})(typeof globalThis !== 'undefined' ? globalThis : this);
