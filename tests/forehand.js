'use strict';

const assert = require('node:assert/strict');
const { strokeKinematics } = require('../render/scene3d.js');

const sample = (phase, side, facing, kind = 'loop', wing = 'forehand') =>
  strokeKinematics({phase, kind, side: wing}, side, facing);
for (const facing of [-1, 1]) {
  for (const hand of [-1, 1]) {
    const ready = sample(0, hand, facing);
    const wind = sample(.27, hand, facing);
    const impact = sample(.56, hand, facing);
    const finish = sample(.75, hand, facing);
    const reset = sample(1, hand, facing);
    const block = sample(.27, hand, facing, 'block');
    const backhand = sample(.27, hand, facing, 'loop', 'backhand');
    assert(wind.turn * facing * hand > .25, '引拍时持拍肩应向后转');
    assert(finish.turn * facing * hand < -.28, '随挥时肩线应向前转');
    assert(wind.shift * hand > .025 && finish.shift * hand < -.025, '重心先落向持拍侧再转移');
    assert(wind.pole[0] * hand > .9 && impact.pole[0] * hand > .6, '肘部应远离躯干');
    assert(Math.abs(backhand.turn) < Math.abs(wind.turn), '反手转体幅度更小');
    assert(Math.abs(block.turn) < Math.abs(wind.turn), '挡球使用紧凑动作');
    assert(impact.faceForward > .9, '正手击球时拍面应朝向对面');
    assert.deepEqual(reset, ready, '收拍后回到准备姿态');
  }
}
console.log('正手动作测试通过（双侧球场 × 左右手）');
