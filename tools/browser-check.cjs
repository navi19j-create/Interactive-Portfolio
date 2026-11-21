const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PORTFOLIO_TEST_DRIVER || 'playwright-core');
const url = process.env.PORTFOLIO_TEST_URL || 'http://127.0.0.1:8317';
const out = process.env.PORTFOLIO_TEST_OUTPUT || require('node:os').tmpdir();
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN, headless:true,
   args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
 try{
 const page=await browser.newPage({viewport:{width:1280,height:850}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url+'/frame-study/');await page.waitForSelector('#game.ready',{timeout:20000});
 const ref=await page.locator('#reference').getAttribute('src');
 if(process.env.PORTFOLIO_MAKE_COVER==='1'){
   assert.ok(ref.startsWith('data:image/webp;'));
   fs.writeFileSync(path.resolve(__dirname,'../dist/assets/frame.webp'),Buffer.from(ref.split(',')[1],'base64'));
 }
 await page.getByRole('button',{name:'Turn camera right'}).click();
 await page.locator('#shutter').click();assert.match(await page.locator('#result').textContent(),/framing match/);
 assert.equal(await page.locator('#comparison').isVisible(),true);await page.locator('#shutter').click();
 assert.equal(await page.locator('#comparison').isVisible(),false);
 await page.goto(url);await page.screenshot({path:path.join(out,'portfolio-home.jpg'),type:'jpeg'});
 await page.getByRole('link',{name:'Inspect & play'}).click();await page.waitForSelector('#view.ready',{timeout:20000});
 await page.screenshot({path:path.join(out,'portfolio-player.jpg'),type:'jpeg'});
 const box=await page.locator('#view canvas').boundingBox();
 const THREE=await import('three');
 const camera=new THREE.PerspectiveCamera(32,box.width/box.height,1,1500);
 camera.position.set(86,89,Math.max(320,205/Math.max(.4,camera.aspect)));camera.lookAt(0,-4,0);camera.updateMatrixWorld();
 async function pressModel(x,y){
   const press=new THREE.Vector3(x,y,15.5).project(camera);
   await page.mouse.click(box.x+(press.x+1)*box.width/2,box.y+(1-press.y)*box.height/2);
 }
 await pressModel(-21.5,12.5);
 await page.waitForFunction(()=>document.querySelector('#mode').textContent==='Playing');
 await page.waitForFunction(()=>document.querySelector('#clock').textContent!=='00:00');
 const action=name=>page.locator('[data-action="'+name+'"]').click();
 await pressModel(-8.9,-11.5);assert.equal(await page.locator('#track').textContent(),'Afterimage');
 await pressModel(-26.8,-11.2);assert.equal(await page.locator('#track').textContent(),'Soft Circuit');
 await pressModel(24.4,12);assert.equal(await page.locator('#menu-list').isVisible(),true);
 await pressModel(24.4,12);await pressModel(8.9,-11.7);
 assert.equal(await page.locator('#feedback').textContent(),'Volume 70%');
 await pressModel(26.9,-11.7);await pressModel(2.4,12);
 assert.equal(await page.locator('#mode').textContent(),'Stopped');
 await pressModel(-21.5,12.5);
 await action('next');assert.equal(await page.locator('#track').textContent(),'Afterimage');
 await action('play');assert.equal(await page.locator('#mode').textContent(),'Paused');
 await action('menu');await action('prev');await action('play');assert.equal(await page.locator('#track').textContent(),'Soft Circuit');
 await action('up');assert.equal(await page.locator('#feedback').textContent(),'Volume 70%');
 await action('down');await action('stop');assert.equal(await page.locator('#clock').textContent(),'00:00');
 await page.locator('[data-view=left]').click();await page.locator('[data-view=reset]').click();
 await page.goBack();assert.equal(await page.title(),'Selected works · Navidev Studios');
 await page.setViewportSize({width:390,height:844});
 for(const section of ['/','/player/','/frame-study/']){
   await page.goto(url+section);
   if(section==='/player/')await page.waitForSelector('#view.ready');
   if(section==='/frame-study/')await page.waitForSelector('#game.ready');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.equal(await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>i.complete && !i.naturalWidth && i.hasAttribute('src')).length),0);
 }
 await page.screenshot({path:path.join(out,'portfolio-game-mobile.jpg'),type:'jpeg'});
 await page.route('**/player.glb',r=>r.abort());await page.goto(url+'/player/');
 await page.waitForFunction(()=>document.querySelector('#load').textContent.includes('Studio render'));
 await action('play');await page.waitForFunction(()=>document.querySelector('#mode').textContent==='Playing');
 assert.deepEqual(errors,[]);console.log('PASS: rendered model button, clock, menu, tracks, volume, stop, framing, retry, navigation, mobile layout and fallback.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
