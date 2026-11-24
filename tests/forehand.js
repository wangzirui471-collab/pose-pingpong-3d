'use strict';

const assert = require('node:assert/strict');
const { strokeKinematics, gripKinematics } = require('../render/scene3d.js');

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

for (const penhold of [true,false]) {
  for (const facing of [-1,1]) {
    for (const hand of [-1,1]) {
      const mirror=-facing*hand;
      const grip = (phase,side) =>
        gripKinematics({phase,kind:'topspin',side},hand,facing,penhold);
      const forehand=grip(.56,'forehand');
      const backhand=grip(.56,'backhand');
      assert(grip(.27,'forehand').roll*mirror>.70,'正手引拍时拍头朝持拍侧展开');
      assert(forehand.roll*mirror>.25,'正手触球时仍能看出向外拿拍');
      assert.equal(forehand.turnover,0,'正手使用正面胶皮');
      assert(Math.abs(backhand.turnover-Math.PI*mirror)<1e-7,'反手触球时应换到反面胶皮');
      assert(backhand.roll*mirror<0,'反手拍头转向身体中线');
      assert.equal(grip(0,'backhand').turnover,0,'反手从准备动作平滑开始');
      assert.equal(grip(1,'backhand').turnover,0,'完成动作后回到准备拍面');
    }
  }
}
console.log('两种持拍和左右手的正反手拍面测试通过');
