'use strict';

const assert = require('node:assert/strict');
const THREE = require('../vendor/three.min.js');
globalThis.window = globalThis;
globalThis.PP = {};
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
require('../render/arena-art.js');
require('../render/wang-model.js');

const roster = ['wang','harimoto','fan','ovtcharov','sun','ma'];
const skin = new THREE.MeshStandardMaterial({color:0xd5a088});
const eyeShapes = new Set();

for (const athlete of roster) {
  const head = PP.wangModel.buildHead(THREE,skin,athlete);
  const [face,hair] = head.children;
  const positions = face.geometry.getAttribute('position');
  const depth = [];
  for (let i=0;i<positions.count;i++) {
    const x=Math.abs(positions.getX(i)), y=positions.getY(i), z=positions.getZ(i);
    if (x>.026 && x<.039 && y>-.044 && y<-.030 && z>.085) depth.push(z);
  }
  assert(depth.length>100,athlete+' 的眼周采样不足');
  assert(Math.max(...depth)-Math.min(...depth)<.014,athlete+' 仍保留闭眼眼褶造成的深度断层');
  assert.equal(hair.material.alphaTest,0,athlete+' 的发际线仍通过硬裁剪生成');
  face.geometry.computeBoundingBox();
  assert(face.geometry.boundingBox.min.y<-.201,athlete+' 的颈网格没有延伸到领口内');
  const eyes = head.getObjectByName('eyes');
  assert(eyes?.isMesh,athlete+' 缺少独立的眼球网格');
  const eyePoints = eyes.geometry.getAttribute('position');
  assert(eyePoints.count>100);
  assert(eyePoints.getX(0)<0 && eyePoints.getX(eyePoints.count-1)>0);
  eyeShapes.add(Array.from(eyePoints.array.slice(0,12)).join(','));
}

assert.equal(eyeShapes.size,6,'每名球员应有独立的眼部轮廓');
console.log('六名球员的眼部网格、发际线和领口通过检查');
