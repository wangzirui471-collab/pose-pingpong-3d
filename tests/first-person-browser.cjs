'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const target = process.argv[2] || pathToFileURL(path.resolve(__dirname,'../index.html')).href;
const sizes = [
  {width:574,height:857,mobile:false},
  {width:390,height:844,mobile:true},
  {width:844,height:390,mobile:true},
  {width:1280,height:800,mobile:false}
];

(async () => {
  const browser = await chromium.launch({
    executablePath:process.env.CHROME_PATH,
    args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader',
      ...(process.env.PP_PAGES_EDGE ? ['--no-proxy-server','--disable-quic',
        '--host-resolver-rules=MAP wangzirui471-collab.github.io ' + process.env.PP_PAGES_EDGE] : [])]
  });
  try {
    const cases = [];
    const errors = [];
    for (const {width,height,mobile} of sizes) {
      const page = await browser.newPage({viewport:{width,height},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
      page.on('pageerror',e=>errors.push(e.message));
      page.on('console',e=>{if (e.type()==='error') errors.push(e.text());});
      await page.goto(target,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.__PP3D?.status().ready);
      await page.evaluate(()=>{__PP3D.scene.render=()=>{};});
      await page.locator('[data-player=ma]').click();
      await page.locator('[data-opponent=sun]').click();
      await page.locator('#b_start').click();
      await page.evaluate(()=>{__PP3D.match.playerServeDelay=100;});
      if (width===1280) {
        await page.evaluate(()=>{
          __PP3D.match.reset('ai');
          __PP3D.match.autoServeDelay=100;
        });
        await page.waitForFunction(()=>document.getElementById('hint').textContent.includes('A 反手 / D 正手'));
        await page.locator('#b_hand').click();
        await page.waitForFunction(()=>document.getElementById('hint').textContent.includes('A 正手 / D 反手'));
        await page.keyboard.down('Space');
        await page.keyboard.press('a');
        await page.keyboard.up('Space');
        await page.waitForFunction(()=>__PP3D.match.returnChoice?.side==='forehand');
      }
      cases.push(...await page.evaluate(() => {
        const {scene,match} = __PP3D;
        const results = [];
        const T=THREE;
        const viewPoint=new T.Vector3(), ndc=new T.Vector3();
        const strokes=[
          [null,'forehand',0,.18,1.02,-.34],
          ['topspin','forehand',.27,.31,1.07,-.17],
          ['topspin','forehand',.56,.31,1.21,-.34],
          ['smash','forehand',.32,.41,1.47,-.18],
          ['smash','forehand',.56,.37,1.49,-.34],
          ['smash','forehand',.76,-.16,1.42,-.44],
          ['drive','backhand',.25,-.16,1.12,-.32],
          ['drive','backhand',.56,-.21,1.14,-.41],
          ['drive','backhand',.79,-.14,1.18,-.43],
          ['push','forehand',.56,.33,.83,-.47],
        ];
        const world = new T.Vector3();
        for(const player of ['ma','fan']) for(const gripMode of ['athlete','penhold']) {
          scene.setPlayer(player);
          scene.setPlayerGrip(gripMode);
          for(const hand of ['right','left']) for(const x of [-.77,0,.77]) for(const [kind,wing,phase,px,y,pz] of strokes) {
            const side=hand==='right'?1:-1;
            const snap=match.snapshot();
            snap.playerHand=hand;
            snap.playerStance={x,z:1.85,vx:0,vz:0};
            snap.paddle={p:[x+px*side,y,1.85+pz],n:[.10*side,-.13,-1],v:[0,0,0]};
            snap.playerStroke=kind&&{kind,side:wing,phase};
            scene.firstPerson.camX=x;
            scene.firstPerson.camZ=2.56;
            scene.firstPerson.camY=1.59;
            scene._updateCamera(snap,null,1/60);
            scene._updateFirstPersonArm(snap,null,1/60);
            const {arm,camera}=scene;
            const index=arm.hand.getObjectByName('index-tip').position;
            const thumb=arm.hand.getObjectByName('thumb-tip').position;
            const middle=arm.hand.getObjectByName('middle-tip').position;
            const contact=arm.penhold
              ? thumb.z>0 && index.z>0 && middle.z<0 && Math.abs(thumb.x-index.x)>.026
              : index.z<0 && index.x>.020 && index.y>-.065 && Math.abs(middle.x)<.015 && middle.z<0;
            const sleeve=arm.upper;
            let occlusion=0, near=Infinity;
            for (const part of [sleeve,arm.upperSkin,arm.elbow].filter(Boolean)) {
              part.updateWorldMatrix(true,false);
              const points=part.geometry.attributes.position;
              for(let i=0;i<points.count;i++){
                world.fromBufferAttribute(points,i).applyMatrix4(part.matrixWorld);
                viewPoint.copy(world).applyMatrix4(camera.matrixWorldInverse);
                near=Math.min(near,-viewPoint.z);
                ndc.copy(world).project(camera);
                if(Math.abs(ndc.x)<.54 && ndc.y<1.02 && ndc.y>.08) occlusion++;
              }
            }
            const anchor=new T.Vector3(0,-.5,0).applyMatrix4(sleeve.matrixWorld).project(camera);
            const wrist=new T.Vector3(...arm.hand.userData.wrist);
            wrist.x*=side;
            const localPalm=arm.hand.getObjectByName('palm').position.clone();
            localPalm.x*=side;
            const palmAxis=localPalm.sub(wrist).applyQuaternion(arm.racket.quaternion);
            wrist.applyQuaternion(arm.racket.quaternion).add(arm.racket.position);
            const foreAxis=wrist.clone().sub(arm.elbow.position);
            const bend=palmAxis.angleTo(foreAxis)*180/Math.PI;
            results.push({viewport:[innerWidth,innerHeight],player,gripMode,hand,x,kind,wing,phase,
              near,occlusion,anchorY:anchor.y,bend,contact,handSide:(wrist.x-x)*side});
          }
        }
        return results;
      }));
      await page.close();
    }
    const blocked=cases.filter(row=>row.occlusion>0 || row.near<.14 || row.anchorY>-.95);
    const worstBend=cases.reduce((a,b)=>a.bend>b.bend?a:b);
    const crossed=cases.filter(row=>row.wing==='forehand' && row.phase<=.56 && row.handSide<=0);
    console.log(JSON.stringify({samples:cases.length,blocked:blocked.length,first:blocked[0],worstBend}));
    assert.deepEqual(errors,[]);
    assert.equal(blocked.length,0,'袖管在击球中盖住球场或进入相机近裁剪面');
    assert(worstBend.bend<15,'第一人称手腕应自然接近伸直');
    assert(cases.every(row=>row.contact),'直拍捏拍肩与横拍绕拍柄的指位错误');
    assert.equal(crossed.length,0,'正手引拍或触球时手腕没有留在持拍侧');
  } finally {await browser.close();}
})().catch(error=>{ console.error(error); process.exitCode=1;});
