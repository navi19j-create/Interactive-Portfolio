const assert=require('node:assert/strict');

// Observe the rendered camera through Three's development hook. All movement and
// picking still go through the normal first-person DOM input handlers.
async function observeWalk(page){
  await page.addInitScript(()=>{
    window.__THREE_DEVTOOLS__=new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe',({detail})=>{
      if(detail.domElement?.id!=='walk-canvas')return;
      const render=detail.render.bind(detail);
      detail.render=(scene,camera)=>{window.walkCamera=camera;return render(scene,camera);};
    });
    window.aimAt=(x,y,z)=>{
      const c=window.walkCamera,dx=x-c.position.x,dz=z-c.position.z;
      const turn=Math.atan2(-dx,-dz)-c.rotation.y;
      document.dispatchEvent(new MouseEvent('mousemove',{
        movementX:Math.round(-Math.atan2(Math.sin(turn),Math.cos(turn))/.0022),
        movementY:Math.round((c.rotation.x-Math.atan2(y-c.position.y,Math.hypot(dx,dz)))/.0022)
      }));
    };
  });
}

async function walkTo(page,point){
  await page.evaluate(async([x,z])=>{
    const canvas=document.querySelector('#walk-canvas'),c=window.walkCamera;
    if(document.pointerLockElement!==canvas)throw Error('Mouse capture lost during lap');
    window.aimAt(x,c.position.y,z);
    canvas.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true}));
    const distance=()=>Math.hypot(x-c.position.x,z-c.position.z);
    let nearest=distance(),lastProgress=performance.now();
    try{
      while(distance()>.14){
        await new Promise(requestAnimationFrame);
        if(distance()<nearest-.04){nearest=distance();lastProgress=performance.now();}
        if(performance.now()-lastProgress>4500)throw Error('Blocked before '+[x,z]+' at '+c.position.toArray());
        window.aimAt(x,c.position.y,z);
      }
    }finally{window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW'}));}
  },point);
}

async function inspect(page,id,target){
  await page.evaluate(pos=>window.aimAt(...pos),target);
  const {artLabels}=await import('../src/gallery-collection.js');
  const label=artLabels[id];
  await page.locator('.model-popup strong').getByText(label.title,{exact:true}).waitFor();
  assert.equal(await page.locator('.model-popup span').innerText(),label.place);
  const walk=page.locator('#walk-canvas');
  await walk.dispatchEvent('pointerdown',{button:0,pointerType:'mouse'});
  await page.waitForURL('**/#walk/'+id,{timeout:4000});
  const art=page.locator('#art-view');await art.waitFor();
  if(id==='samrat-yantra'){
    await page.locator('#sun-time').press('End');
    assert.equal(await page.locator('#solar-time').innerText(),'17:00');
  }
  if(id==='rani-ki-vav')await page.locator('#miniature-range').press('End');
  const before=await art.screenshot();await art.press('ArrowRight');
  assert(!before.equals(await art.screenshot()),'Rotated '+id);
  await page.getByRole('link',{name:'Back to walk'}).click();
  await page.waitForFunction(()=>document.pointerLockElement?.id==='walk-canvas');
}

async function testTwinWalk(page){
  const {lap,plinths,galleryBlocks,crossing}=await import('../src/twin-layout.js');
  const points=lap.getSpacedPoints(60).map(p=>p.toArray());
  const stops=points.map(()=>[]);
  function addStop(x,y,z,viewX,viewZ,id){
    const dist=p=>Math.hypot(p[0]-viewX,p[1]-viewZ);
    const i=points.reduce((best,p,index)=>dist(p)<dist(points[best])?index:best,0);
    stops[i].push([id,[x,y,z]]);
  }
  for(const [i,stand] of plinths.entries()){
    const {x,z}=stand;
    for(const other of plinths.slice(i+1).filter(p=>p.wing===stand.wing)){
      const gap=Math.hypot(x-other.x,z-other.z)-stand.r-other.r-.16;
      assert.ok(gap>2,'Walkable aisle between '+stand.id+' and '+other.id);
      assert.ok(!galleryBlocks((x+other.x)/2,(z+other.z)/2,.24),'Aisle midpoint is accessible');
    }
    const distance=Math.hypot(stand.dx,stand.dz);
    addStop(x,.32+stand.h*.60,z,x+3*stand.dx/distance,z+3*stand.dz/distance,stand.id);
  }
  await page.waitForFunction(()=>window.walkCamera && document.pointerLockElement?.id==='walk-canvas');
  assert(await page.evaluate(()=>!!document.fullscreenElement||document.querySelector('#tour').classList.contains('expanded-view')));
  const jumped=await page.evaluate(async()=>{
    document.querySelector('#walk-canvas').dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true}));
    for(let i=0;i<12;i++){
      await new Promise(requestAnimationFrame);
      if(walkCamera.position.y>1.7)return true;
    }
    return false;
  });
  assert(jumped,'Space lifts the viewpoint at '+await page.evaluate(()=>JSON.stringify([walkCamera.position.toArray(),document.activeElement.id,document.pointerLockElement?.id])));
  await page.waitForFunction(()=>window.walkCamera.position.y===1.65);
  let previous,metres=0;
  for(let i=0;i<points.length;i++){
    await walkTo(page,points[i]);
    const position=await page.evaluate(()=>[walkCamera.position.x,walkCamera.position.z]);
    if(previous)metres+=Math.hypot(position[0]-previous[0],position[1]-previous[1]);
    previous=position;
    for(const [id,target] of stops[i])await inspect(page,id,target);
  }
  assert(metres>105 && metres<111,'Walked entire figure eight: '+metres);
  assert(Math.hypot(previous[0]-crossing.x,previous[1]-crossing.y)<.16);
  // From the central crossing, click a floor point and let the normal walk
  // controller carry the visitor there.
  await page.evaluate(()=>window.aimAt(0,0,13));
  await page.locator('.model-popup').waitFor({state:'hidden'});
  await page.locator('#walk-canvas').dispatchEvent('pointerdown',{button:0,pointerType:'mouse'});
  await page.waitForFunction(()=>Math.hypot(walkCamera.position.x,walkCamera.position.z-13)<.15);
  console.log('Walked '+metres.toFixed(1)+' m, checked all six model popups and close-ups, and walked to a clicked floor point.');

}
module.exports={observeWalk,testTwinWalk};
