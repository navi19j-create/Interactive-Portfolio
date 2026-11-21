const { chromium } = require(process.env.PORTFOLIO_TEST_DRIVER || 'playwright-core');
const assert = require('node:assert/strict');
const tracks = require('../src/playlist-credits.json');
const url=(process.env.PORTFOLIO_TEST_URL||'http://127.0.0.1:8317')+'/player/';

async function verifyMixedQueue(browser){
  const page=await browser.newPage();
  try{
    // Exercise a playable successor even in regions where the live playlist is entirely restricted.
    await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'text/javascript',body:`
      window.testPlays=[];
      window.YT={ Player:class{
        constructor(el,options){this.options=options;this.seconds=0;this.timer=setTimeout(()=>options.events.onReady({target:this}),0);}
        playVideo(){
          window.testPlays.push(this.options.videoId);
          const events=this.options.events;
          if(window.testPlays.length===1)events.onError({data:150});
          else{events.onStateChange({data:1});this.tick=setInterval(()=>this.seconds+=.25,250);}
        }
        pauseVideo(){clearInterval(this.tick);this.options.events.onStateChange({data:2});}
        seekTo(t){this.seconds=t;}
        getCurrentTime(){return this.seconds;}
        setVolume(){}
        destroy(){clearInterval(this.tick);clearTimeout(this.timer);}
      }};
      window.onYouTubeIframeAPIReady();
    `}));
    await page.goto(url);await page.selectOption('#music-source','youtube');
    await page.click('[data-action=play]');
    await page.waitForFunction(()=>document.querySelector('#credited-tracks li:nth-child(2) small').textContent.includes('confirmed'));
    assert.deepEqual(await page.evaluate(()=>window.testPlays),tracks.slice(0,2).map(t=>t.id));
    await page.click('[data-action=stop]');assert.equal(await page.locator('#clock').textContent(),'00:00');
    console.log('Simulated mixed queue: skipped one blocked track and stayed on the playable successor.');
  }finally{await page.close();}
}

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_BIN, headless:true,
    args:['--mute-audio','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
  try{
    await verifyMixedQueue(browser);
    const page=await browser.newPage({viewport:{width:1440,height:1100}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);
    await page.waitForSelector('#view.ready');
    await page.selectOption('#music-source','youtube');
    // Click the physical Play mesh using the default three-quarter camera.
    const THREE=await import('three');
    const canvas=page.locator('#view canvas');await canvas.scrollIntoViewIfNeeded();
    const box=await canvas.boundingBox();
    const camera=new THREE.PerspectiveCamera(32,box.width/box.height,1,1500);
    camera.position.set(86,89,Math.max(320,205/Math.max(.4,camera.aspect)));camera.lookAt(0,-4,0);camera.updateMatrixWorld();
    const p=new THREE.Vector3(-21.5,12.5,15.5).project(camera);
    await page.mouse.click(box.x+(p.x+1)*box.width/2,box.y+(1-p.y)*box.height/2);
    const verdicts=new Map();
    let lastTitle='',lastChange=Date.now(), previousMode='';
    const deadline=Date.now()+220000;
    while(Date.now()<deadline && verdicts.size<tracks.length){
      const state=await page.evaluate(()=>({
        rows:[...document.querySelectorAll('#credited-tracks li')].map(li=>[li.querySelector('a').textContent,li.querySelector('small').textContent]),
        title:document.querySelector('#track').textContent,mode:document.querySelector('#mode').textContent,feedback:document.querySelector('#feedback').textContent
      }));
      for(const [title,result] of state.rows){
        if(result && !verdicts.has(title)){verdicts.set(title,result);console.log(title+' | '+result);}
      }
      if(state.title!==lastTitle || state.mode!==previousMode){
        lastChange=Date.now();lastTitle=state.title;previousMode=state.mode;
      }
      if(verdicts.size===tracks.length)break;
      if(state.mode==='Playing' && verdicts.has(state.title)){await page.click('[data-action=next]');lastChange=Date.now();}
      else if(Date.now()-lastChange>12000){
        if(!verdicts.has(state.title)){const reason='Unconfirmed: '+state.mode+' · '+state.feedback;verdicts.set(state.title,reason);console.log(state.title+' | '+reason);}
        await page.click('[data-action=next]');lastChange=Date.now();
      }
      await page.waitForTimeout(250);
    }
    const summary=await page.locator('#feedback').textContent();
    console.log('Final feedback:',summary);
    if(verdicts.size===tracks.length && [...verdicts.values()].every(s=>s.startsWith('Unavailable'))){
      assert.match(summary,/None of the 12 tracks/);
      assert.equal(await page.locator('#youtube-slot iframe').count(),0);
      await page.waitForTimeout(1700);
      assert.equal(await page.locator('#feedback').textContent(),summary);
      await page.getByRole('button',{name:'Play local audio'}).click();
      await page.waitForFunction(()=>document.querySelector('#clock').textContent!=='00:00' && document.querySelector('#mode').textContent==='Playing');
      console.log('Verified local audio fallback.');
    }
    assert.deepEqual(errors,[]);assert.equal(verdicts.size,tracks.length);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
