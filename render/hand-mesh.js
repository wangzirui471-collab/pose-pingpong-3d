/* 握拍手以拍心为原点，正面为 +Z。左手沿 X 镜像。 */
(function (root) {
  'use strict';
  var PP = root.PP = root.PP || {};
  var meshCache = new Map();
  var grips = {
    shakehand: {
      wrist:[-.079,-.146,-.010], palm:[-.043,-.132,-.003],
      pads:[
        [[-.076,-.145,-.010],[.021,.021,.0145],.28],
        [[-.051,-.133,-.004],[.026,.033,.016],.22],
        [[-.040,-.121,.005],[.018,.021,.014],.08],
        [[-.044,-.142,-.008],[.017,.025,.014],.16]
      ],
      digits:{
        // 食指沿反面下缘舒展，后三指以不同高度绕过拍柄。
        thumb:[[-.052,-.124,.010,.011],[-.037,-.111,.020,.009],[-.024,-.094,.018,.008],[-.014,-.077,.013,.007]],
        index:[[-.049,-.110,-.014,.009],[-.035,-.076,-.017,.009],[-.018,-.059,-.013,.008],[.008,-.054,-.011,.007],[.034,-.052,-.010,.0058]],
        middle:[[-.046,-.111,.009,.010],[-.025,-.110,.018,.009],[0,-.109,.017,.008],[.022,-.111,.010,.007],[.025,-.113,-.002,.007],[.017,-.114,-.014,.0067],[.005,-.116,-.016,.0058]],
        ring:[[-.043,-.130,.009,.009],[-.024,-.129,.020,.0085],[0,-.129,.018,.0078],[.023,-.131,.009,.0073],[.025,-.134,-.004,.0068],[.016,-.135,-.015,.0065],[.004,-.134,-.017,.0058]],
        little:[[-.047,-.148,.006,.008],[-.024,-.148,.017,.0077],[0,-.150,.017,.0073],[.023,-.151,.008,.0065],[.025,-.153,-.005,.0062],[.017,-.153,-.014,.0058],[.006,-.152,-.016,.0048]]
      }
    },
    penhold: {
      wrist:[-.082,-.128,-.027], palm:[-.046,-.112,-.021],
      pads:[
        [[-.078,-.126,-.026],[.022,.021,.0145],.34],
        [[-.055,-.115,-.021],[.026,.027,.0155],.30],
        [[-.039,-.106,-.015],[.017,.020,.013],.38],
        [[-.051,-.100,-.002],[.016,.017,.013],.38]
      ],
      digits:{
        // 拇指和食指在正面分开扣住拍肩，其余三指向拍背收拢。
        thumb:[[-.056,-.113,-.007,.011],[-.045,-.091,.013,.010],[-.038,-.073,.015,.009],[-.023,-.061,.012,.0075]],
        index:[[-.043,-.102,.002,.009],[-.025,-.105,.016,.0085],[-.001,-.103,.019,.008],[.018,-.095,.015,.007],[.020,-.081,.010,.006]],
        middle:[[-.041,-.106,-.025,.009],[-.026,-.079,-.020,.0085],[-.008,-.055,-.016,.008],[.007,-.046,-.012,.0068],[.020,-.046,-.010,.0058]],
        ring:[[-.041,-.121,-.025,.0085],[-.024,-.097,-.022,.008],[-.006,-.074,-.017,.0075],[.007,-.064,-.012,.0066],[.023,-.063,-.010,.0055]],
        little:[[-.048,-.134,-.021,.008],[-.034,-.119,-.025,.0075],[-.014,-.095,-.023,.007],[.002,-.086,-.020,.006],[.015,-.083,-.019,.0048]]
      }
    }
  };

  var step = .0028, base = [-.112,-.184,-.060];
  var nx = 62, ny = 57, nz = 42, plane = nx*ny;
  var tetrahedra = [[0,1,3,7],[0,3,2,7],[0,2,6,7],[0,6,4,7],[0,4,5,7],[0,5,1,7]];

  function sampleVolume(field, min, max, distance) {
    var bounds = [nx,ny,nz];
    var lo = min.map(function (v,i) { return Math.max(1,Math.floor((v-base[i])/step)-2); });
    var hi = max.map(function (v,i) { return Math.min(bounds[i]-2,Math.ceil((v-base[i])/step)+2); });
    for (var z=lo[2]; z<=hi[2]; z++) for (var y=lo[1]; y<=hi[1]; y++) for (var x=lo[0]; x<=hi[0]; x++) {
      var id = z*plane+y*nx+x;
      var d = distance(base[0]+x*step,base[1]+y*step,base[2]+z*step);
      // 在相交处融合掌垫和指根，留下完整的皮肤表面。
      var blend = Math.max(0,.0025-Math.abs(d-field[id]))/.0025;
      field[id] = Math.min(d,field[id])-.000625*blend*blend;
    }
  }

  function pad(field, p, radius, angle) {
    var extent = Math.max(radius[0],radius[1]), c = Math.cos(angle), s = Math.sin(angle);
    sampleVolume(field,[p[0]-extent,p[1]-extent,p[2]-radius[2]],[p[0]+extent,p[1]+extent,p[2]+radius[2]],
      function (x,y,z) {
        x -= p[0]; y -= p[1]; z -= p[2];
        return (Math.sqrt(((x*c+y*s)/radius[0])**2+((y*c-x*s)/radius[1])**2+(z/radius[2])**2)-1)*radius[2];
      });
  }

  function digit(T, field, joints, lift) {
    var points = joints.map(function (row,i) {
      return new T.Vector3(row[0],row[1]+lift*(i/(joints.length-1))**2,row[2]);
    });
    var curve = new T.CatmullRomCurve3(points);
    var segments = (joints.length-1)*3;
    var flatten = .77;
    var last = points[0], r0 = joints[0][3];
    for (var i=1; i<=segments; i++) {
      var point = curve.getPoint(i/segments);
      var segment = Math.floor((i-1)/3), fraction = i/3-segment;
      var r1 = joints[segment][3]*(1-fraction)+joints[segment+1][3]*fraction;
      var dx=point.x-last.x, dy=point.y-last.y, dz=(point.z-last.z)/flatten;
      var along = 1/(dx*dx+dy*dy+dz*dz);
      var extent = Math.max(r0,r1);
      var a=last.toArray(), b=point.toArray();
      sampleVolume(field,a.map(function (v,k) { return Math.min(v,b[k])-extent; }),
        a.map(function (v,k) { return Math.max(v,b[k])+extent; }),function (x,y,z) {
          x-=a[0]; y-=a[1]; z=(z-a[2])/flatten;
          var t=Math.max(0,Math.min(1,(x*dx+y*dy+z*dz)*along));
          return Math.sqrt((x-dx*t)**2+(y-dy*t)**2+(z-dz*t)**2)-(r0+(r1-r0)*t);
        });
      last=point; r0=r1;
    }
    return points.at(-1);
  }

  function surface(T, field) {
    var positions=[], normals=[], indices=[], crossings=new Map();
    var offsets=[0,1,nx,nx+1,plane,plane+1,plane+nx,plane+nx+1];
    function xyz(id) {
      return [base[0]+(id%nx)*step,base[1]+(Math.floor(id/nx)%ny)*step,base[2]+Math.floor(id/plane)*step];
    }
    function crossing(a,b) {
      var key=Math.min(a,b)*field.length+Math.max(a,b);
      var found=crossings.get(key);
      if (found!==undefined) return found;
      var t=field[a]/(field[a]-field[b]), p=xyz(a), q=xyz(b);
      var normal=[1,nx,plane].map(function (offset) {
        return (field[a+offset]-field[a-offset])*(1-t)+(field[b+offset]-field[b-offset])*t;
      });
      var length=Math.hypot.apply(null,normal)||1;
      var index=positions.length/3;
      for (var axis=0; axis<3; axis++) {
        positions.push(p[axis]+(q[axis]-p[axis])*t);
        normals.push(normal[axis]/length);
      }
      crossings.set(key,index);
      return index;
    }
    function triangle(a,b,c) {
      var ia=a*3, ib=b*3, ic=c*3;
      var ux=positions[ib]-positions[ia], uy=positions[ib+1]-positions[ia+1], uz=positions[ib+2]-positions[ia+2];
      var vx=positions[ic]-positions[ia], vy=positions[ic+1]-positions[ia+1], vz=positions[ic+2]-positions[ia+2];
      var winding=(uy*vz-uz*vy)*normals[ia]+(uz*vx-ux*vz)*normals[ia+1]+(ux*vy-uy*vx)*normals[ia+2];
      if (winding>=0) indices.push(a,b,c); else indices.push(a,c,b);
    }
    // 每个体素拆成六个四面体，复用交点以缝合表面。
    for (var z=0; z<nz-1; z++) for (var y=0; y<ny-1; y++) for (var x=0; x<nx-1; x++) {
      var id=z*plane+y*nx+x, mask=0;
      for (var i=0; i<8; i++) if (field[id+offsets[i]]<0) mask|=1<<i;
      if (mask===0 || mask===255) continue;
      for (var tetra of tetrahedra) {
        var inside=[], outside=[];
        for (var corner of tetra) ((mask&(1<<corner)) ? inside : outside).push(id+offsets[corner]);
        if (!inside.length || !outside.length) continue;
        if (inside.length===2) {
          var a=crossing(inside[0],outside[0]), b=crossing(inside[0],outside[1]);
          var c=crossing(inside[1],outside[0]), d=crossing(inside[1],outside[1]);
          triangle(a,b,c); triangle(b,d,c);
        } else {
          var single=inside.length===1 ? inside[0] : outside[0];
          var other=inside.length===1 ? outside : inside;
          triangle(crossing(single,other[0]),crossing(single,other[1]),crossing(single,other[2]));
        }
      }
    }
    var result=new T.BufferGeometry();
    result.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    result.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
    result.setIndex(indices);
    return result;
  }

  function build(T,skin,penhold,style) {
    var name=penhold ? 'penhold' : 'shakehand', profile=grips[name];
    var key=[name,style?.thumb||0,style?.index||0].join(':');
    var data=meshCache.get(key);
    if (!data) {
      var field=new Float32Array(nx*ny*nz).fill(.015);
      for (var spec of profile.pads) pad(field,...spec);
      var tips={};
      for (var finger in profile.digits) tips[finger]=digit(T,field,profile.digits[finger],style?.[finger]||0);
      data={surface:surface(T,field),tips:tips};
      meshCache.set(key,data);
    }
    var grip=new T.Group();
    grip.name=name+'-grip';
    grip.userData.style=style;
    grip.userData.wrist=profile.wrist;
    var mesh=new T.Mesh(data.surface,skin);
    mesh.name='hand-skin';
    grip.add(mesh);
    var palm=new T.Object3D();
    palm.name='palm';
    palm.position.fromArray(profile.palm);
    grip.add(palm);
    for (var finger in data.tips) {
      var marker=new T.Object3D();
      marker.name=finger+'-tip';
      marker.position.copy(data.tips[finger]);
      grip.add(marker);
    }
    return grip;
  }

  PP.handMesh={build:build};
})(typeof globalThis !== 'undefined' ? globalThis : this);
