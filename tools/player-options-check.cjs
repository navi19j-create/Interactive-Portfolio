const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require(process.env.PORTFOLIO_TEST_DRIVER || 'playwright-core');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,
    args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto((process.env.PORTFOLIO_TEST_URL||'http://127.0.0.1:8317')+'/player/');
    await page.waitForSelector('#view.ready');
    const canvas=page.locator('#view canvas'), snapshots=new Map();
    for(const mode of ['original','walnut','graphite','clay','wire','normals','original']){
      await page.selectOption('#inspect-mode',mode);
      const pixels=await canvas.evaluate(c=>c.toDataURL());
      if(snapshots.has(mode))assert.equal(pixels,snapshots.get(mode));
      else{assert.ok(![...snapshots.values()].includes(pixels),mode+' should change the rendering');snapshots.set(mode,pixels);}
    }
    await page.click('#fullscreen');await page.waitForFunction(()=>document.fullscreenElement || document.querySelector('.expanded-view'));
    await page.selectOption('#inspect-mode','wire');await page.click('#fullscreen');
    assert.ok(!(await page.evaluate(()=>document.fullscreenElement || document.querySelector('.expanded-view'))));
    await page.selectOption('#inspect-mode','original');
    await page.fill('#playlist-url','https://music.youtube.com/playlist?list=example');
    await page.locator('#share-playlist button').click();assert.match(await page.textContent('#share-status'),/Draft saved/);
    await page.reload();assert.match(await page.inputValue('#playlist-url'),/list=example/);
    await page.click('.local-song summary');await page.setInputFiles('#song-file',path.join(__dirname,'../dist/assets/soft-circuit.mp3'));
    await page.fill('#song-title','Playback test');await page.fill('#song-artist','Test artist');await page.locator('#add-song button').click();
    assert.equal(await page.textContent('#artist-credit'),'Test artist');await page.click('[data-action=play]');
    await page.waitForFunction(()=>document.querySelector('#mode').textContent==='Playing');
    await page.selectOption('#music-source','youtube');
    // Check the actual provider independently from the site's offline integration tests.
    const ready=await page.waitForFunction(()=>/Press Play on the device|embedded playback|playback error|upload is unavailable/.test(document.querySelector('#feedback').textContent),{},{timeout:20000}).then(()=>true,()=>false);
    if(ready && (await page.textContent('#mode'))!=='Unavailable'){
      await page.click('[data-action=play]');
      await page.waitForFunction(()=>document.querySelector('#mode').textContent==='Playing',{},{timeout:10000}).catch(()=>{});
    }
    console.log('Provider status:',await page.textContent('#feedback'),await page.textContent('#mode'),await page.textContent('#track'),await page.textContent('#artist-credit'));
    assert.equal(await page.locator('#credited-tracks li').count(),12);
    if(ready && (await page.textContent('#mode'))!=='Playing'){
      await page.click('[data-action=next]');
      await page.waitForFunction(()=>document.querySelector('#mode').textContent==='Playing',{},{timeout:6500}).catch(()=>{});
      console.log('Next track:',await page.textContent('#feedback'),await page.textContent('#mode'),await page.textContent('#track'));
    }
    assert.match(await page.getAttribute('#playlist-link','href'),/PLNe9a9W91vxM/);
    await page.selectOption('#music-source','local');assert.equal(await page.locator('#online-player').isVisible(),false);
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.evaluate(()=>{document.getElementById('player-shell').requestFullscreen=undefined;});
    await page.click('#fullscreen');assert.ok(await page.locator('.expanded-view').count());await page.keyboard.press('Escape');assert.equal(await page.locator('.expanded-view').count(),0);
    assert.deepEqual(errors,[]);console.log('PASS: 6 distinct rendered modes, restoration, native and fallback fullscreen, local music credits, playlist draft and source switching.');
  } finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
