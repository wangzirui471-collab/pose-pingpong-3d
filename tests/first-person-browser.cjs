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
      await page.locator('[data-player=ma]').click();
      await page.locator('[data-opponent=sun]').click();
      await page.locator('#b_start').click();
      await page.evaluate(()=>{__PP3D.match.playerServeDelay=100;});
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
          ['drive','backhand',.56,-.21,1.14,-.41],
          ['push','forehand',.56,.33,.83,-.47],
        ];
        const world = new T.Vector3();
        for(const player of ['ma','fan']) {
          scene.setPlayer(player);
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
            results.push({viewport:[innerWidth,innerHeight],player,hand,x,kind,phase,near,occlusion,anchorY:anchor.y});
          }
        }
        return results;
      }));
      await page.close();
    }
    const blocked=cases.filter(row=>row.occlusion>0 || row.near<.14 || row.anchorY>-.95);
    console.log(JSON.stringify({samples:cases.length,blocked:blocked.length,first:blocked[0]}));
    assert.deepEqual(errors,[]);
    assert.equal(blocked.length,0,'袖管在击球中盖住球场或进入相机近裁剪面');
  } finally {await browser.close();}
})().catch(error=>{ console.error(error); process.exitCode=1;});
