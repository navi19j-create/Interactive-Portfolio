const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require(process.env.PORTFOLIO_TEST_DRIVER || 'playwright-core');
const url = process.env.PORTFOLIO_TEST_URL || 'http://127.0.0.1:8317';
(async()=>{
  const browser = await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:850}});
    const {observeWalk,testTwinWalk}=require('./twin-walk-check.cjs');
    await observeWalk(page);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{
      if(r.status()>=400 && r.url().startsWith(url+'/') && r.request().frame().url().startsWith(url+'/cardboard-gallery/')) errors.push(r.status()+' '+r.url());
    });
    await page.goto(url);await page.getByRole('link',{name:'Explore the gallery'}).click();
    const canvas = page.locator('#walk-canvas');
    async function startUncaptured(){
      assert.equal(await canvas.isVisible(),false,'The walk waits for explicit entry');
      await page.getByRole('link',{name:'Walk in 3D'}).click();
      await page.waitForFunction(()=>document.pointerLockElement?.id==='walk-canvas');
      await page.locator('#walk .aim').waitFor();
      await page.evaluate(()=>document.exitPointerLock());
      await page.waitForFunction(()=>!document.pointerLockElement);
      await page.locator('#mouse-steer').uncheck();
    }
    await page.getByRole('link',{name:'Walk in 3D'}).click();
    await testTwinWalk(page);
    await page.goto(url+'/cardboard-gallery/#walk');
    await page.reload();await startUncaptured();
    await page.screenshot({path:path.join(process.env.PORTFOLIO_TEST_OUTPUT || require('node:os').tmpdir(),'gallery-walk-desktop.jpg'),type:'jpeg'});
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.getElementById('walk').hidden && !document.fullscreenElement && !document.pointerLockElement);
    const {artLabels}=await import('../src/gallery-collection.js');
    for(const [id,model] of Object.entries(artLabels)){
      await page.locator('.room-nav a[href="#rotunda/'+id+'"]').click();
      await page.getByRole('heading',{name:model.title,exact:true}).waitFor();
      await page.locator('#art-view').waitFor();
      await page.locator('#back-room').click();
    }
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await phone.goto(url+'/cardboard-gallery/#walk');await phone.getByRole('link',{name:'Walk in 3D'}).tap();
    await phone.locator('.aim').waitFor();
    const phoneBox=await phone.locator('#walk-canvas').boundingBox();
    await phone.touchscreen.tap(phoneBox.x+phoneBox.width/2,phoneBox.y+phoneBox.height/2);
    await phone.waitForURL('**/#walk/pantheon');
    await phone.locator('#art-view').waitFor();
    await phone.getByRole('link',{name:'Back to walk'}).tap();await phone.locator('.aim').waitFor();
    const fallback=await browser.newPage();
    await fallback.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:get.call(this,type,...args);};});
    await fallback.goto(url+'/cardboard-gallery/');await fallback.getByRole('link',{name:'Walk in 3D'}).click();
    await fallback.getByText('The 3D view is unavailable.',{exact:false}).waitFor();
    for(const id of Object.keys(artLabels)){
      await fallback.locator('.room-nav a[href="#rotunda/'+id+'"]').click();
      await fallback.locator('#scene-image[src="media/'+id+'.webp"]').evaluate(im=>im.decode());
      assert.equal(await fallback.locator('#art-view').isVisible(),false);
    }
    await fallback.goto(url+'/cardboard-gallery/#painting-aisle/monet');
    await fallback.getByRole('heading',{name:'Twin Galleries',exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    const steerPage=await browser.newPage({viewport:{width:1280,height:850}});
    await observeWalk(steerPage);
    await steerPage.clock.install();
    for(const blockCapture of [false,true]){
      if(blockCapture) await steerPage.addInitScript(()=>{
        Element.prototype.requestPointerLock=()=>Promise.reject(new Error('Capture unavailable'));
        const query=window.matchMedia.bind(window);
        window.matchMedia=q=>query(q==='(any-hover:hover)'?'not all':q);
      });
      await steerPage.goto(url+'/cardboard-gallery/#walk');
      assert.equal(await steerPage.locator('#walk-canvas').isVisible(),false);
      const toggle=steerPage.getByRole('checkbox',{name:'Mouse steer'});

      const surface=steerPage.locator('#walk-canvas');
      await steerPage.getByRole('link',{name:'Walk in 3D'}).click();
      await steerPage.waitForFunction(()=>document.fullscreenElement || document.querySelector('.expanded-view'));
      if(!blockCapture) await steerPage.waitForFunction(()=>document.pointerLockElement?.id==='walk-canvas');
      await steerPage.locator('#walk .aim').waitFor();
      assert.ok(await toggle.isChecked());
      assert.ok(await steerPage.evaluate(()=>{
        const {x,y,width,height}=document.querySelector('.aim').getBoundingClientRect();
        return Math.abs(x+width/2-innerWidth/2)<1 && Math.abs(y+height/2-innerHeight/2)<1;
      }),'Aim is in the middle of the fullscreen display');
      const box=await surface.boundingBox();
      const x=Math.round(box.x+box.width*.5), y=Math.round(box.y+box.height*.5);
      await steerPage.mouse.move(x,y);
      await steerPage.clock.pauseAt(new Date(await steerPage.evaluate(()=>Date.now())+100));
      let previous=await surface.screenshot();
      for(const [dx,dy] of [[16,0],[0,0],[0,-16],[0,0]]){
        await steerPage.mouse.move(x+dx,y+dy);
        await steerPage.clock.runFor(32);
        const current=await surface.screenshot();
        assert.ok(!previous.equals(current),'Small mouse movement turns the view on both axes');
        previous=current;
      }
      await steerPage.clock.runFor(250);
      assert.ok(previous.equals(await surface.screenshot()),'Stopping the mouse holds the heading');
      if(blockCapture){
        await steerPage.getByText('Mouse capture unavailable.',{exact:false}).waitFor();
        const external=steerPage.getByRole('link',{name:'Walk in Microsoft Edge'});
        if(await external.isVisible()) assert.equal(await external.getAttribute('href'),'microsoft-edge:'+steerPage.url());
        else await steerPage.getByRole('button',{name:'Enable unlimited mouse look'}).click();
        await steerPage.mouse.move(x,y);
        assert.equal(await surface.evaluate(el=>getComputedStyle(el).cursor),'none');
        for(const edge of [box.x+box.width-1,box.x+1]){
          await steerPage.mouse.move(edge,y);
          await steerPage.clock.runFor(32);
          const atEdge=await surface.screenshot();
          assert.ok(!previous.equals(atEdge),'Moving to the edge turns the camera');
          await steerPage.clock.runFor(2000);
          assert.ok(atEdge.equals(await surface.screenshot()),'A stationary mouse at the edge holds the heading');
          await steerPage.mouse.wheel(0,edge<x?-120:120);
          await steerPage.clock.runFor(100);
          const scrolled=await surface.screenshot();
          assert.ok(!atEdge.equals(scrolled),'Wheel movement continues the turn past the screen limit');
          await steerPage.clock.runFor(300);
          assert.ok(scrolled.equals(await surface.screenshot()),'Wheel turning stops when input stops');
          await steerPage.mouse.move(x,y);
          await steerPage.clock.runFor(32);
          previous=await surface.screenshot();
          assert.ok(scrolled.equals(previous),'Returning to centre preserves the heading');
        }
        const heading=()=>steerPage.evaluate(()=>window.walkCamera.rotation.y);
        for(const direction of [1,-1]){
          const initial=await heading();
          const edge=direction>0?box.x+box.width-1:box.x+1;
          for(let stroke=0;stroke<5;stroke++){
            const before=await heading();
            await steerPage.mouse.move(edge,y,{steps:4});
            const turned=await heading();
            assert.ok((before-turned)*direction>3,'A mouse-only sweep turns about half a revolution');
            await steerPage.mouse.move(x,y,{steps:4});
            assert.ok(Math.abs(await heading()-turned)<1e-7,'Return stroke holds the same heading');
          }
          assert.ok((initial-await heading())*direction>4*Math.PI,'Mouse alone turns beyond two revolutions');
        }
        // Eight quarter-width strokes turn twice. Repositioning the physical
        // cursor between strokes must preserve the accumulated heading.
        const view=()=>steerPage.screenshot({clip:{x:x-160,y:y-100,width:320,height:200}});
        previous=await view();
        for(const direction of [1,-1]){
          for(let stroke=0;stroke<8;stroke++){
            await steerPage.mouse.move(x+direction*box.width/4,y);
            await steerPage.clock.runFor(32);
            const turned=await view();
            assert.ok(!turned.equals(previous),'Another stroke continues the turn');
            await steerPage.keyboard.down('Shift');
            await steerPage.mouse.move(x,y);
            await steerPage.keyboard.up('Shift');
            await steerPage.clock.runFor(32);
            assert.ok(turned.equals(await view()),'Repositioning holds the heading');
            previous=turned;
          }
        }
      }else{
        let deviceX=x;
        for(const direction of [1,-1]){
          for(let step=0;step<8;step++){
            deviceX+=direction*714;
            await steerPage.mouse.move(deviceX,y);
            await steerPage.clock.runFor(32);
            const turned=await surface.screenshot();
            assert.ok(!turned.equals(previous),'Captured mouse keeps turning past two revolutions');
            previous=turned;
          }
        }
      }
      assert.equal(await steerPage.evaluate(()=>!!document.pointerLockElement),!blockCapture);
      await steerPage.clock.resume();
      await steerPage.goto('about:blank');
    }
    console.log('PASS: left and right mouse steering, stationary inspection, first-person toggle, full circuit, architectural models, touch, fullscreen and still-image fallback.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

