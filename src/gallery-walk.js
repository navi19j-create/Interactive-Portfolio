import * as THREE from 'three';
import {addTwinGalleries} from './gallery-hall.js';
import {galleryBlocks,floorRoute} from './twin-layout.js';
import {artLabels} from './gallery-collection.js';

const movement = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);

export async function createWalk(host, inspect, captureMouse) {
  const canvas = host.querySelector('canvas');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb8c9d3);
  const camera = new THREE.PerspectiveCamera(60, 1, .035, 64);
  camera.rotation.order = 'YXZ';
  camera.position.set(0, 1.65, 7.35);
  camera.lookAt(-6.2,1.46,16.54);
  const grain=await new THREE.TextureLoader().loadAsync('media/paper-grain.webp');
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.colorSpace=THREE.SRGBColorSpace;
  grain.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),4);
  const meshes=[];
  scene.add(new THREE.HemisphereLight(0xfff1db,0xe7b893,1.15));
  // Window light crosses the room below the roofline. Bake its static shadow map once.
  const daylight = new THREE.DirectionalLight(0xffedce, 2.1);
  daylight.position.set(-4,6.5,-10);
  daylight.target.position.set(1,0,3);
  daylight.castShadow = true;
  Object.assign(daylight.shadow.camera,{left:-12,right:12,top:9,bottom:-9,near:.1,far:32});
  daylight.shadow.camera.updateProjectionMatrix();
  daylight.shadow.mapSize.set(2048,2048);
  daylight.shadow.normalBias = .008;
  scene.add(daylight,daylight.target);
  addTwinGalleries(scene,grain,meshes);
  scene.updateMatrixWorld(true);

  const keys = new Set();
  const held = new Map();
  const activeKey = code => keys.has(code) || [...held.values()].includes(code);
  const pick = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let running = false, frame = 0, lastTime = 0, drag = null, dirty = true;
  let verticalSpeed = 0;
  let mouseSteer=true, lastMouse=null;
  let edgeSide=0;
  const locked = () => document.pointerLockElement === canvas;
  function updateCapture() {
    canvas.classList.toggle('centre-aim',mouseSteer || locked());
    if (!locked()) clearInput();
  }
  document.addEventListener('pointerlockchange',updateCapture);
  function look(dx,dy,sensitivity) {
    camera.rotation.y-=dx*sensitivity;
    camera.rotation.x=THREE.MathUtils.clamp(camera.rotation.x-dy*sensitivity,-1.4,1.4);
    redraw();
  }
  document.addEventListener('mousemove',event=>{
    if (running && locked()) look(event.movementX,event.movementY,.0022);
  });
  const popup=host.querySelector('.model-popup');
  const hoverPoint=new THREE.Vector2();
  let route=[],focusedId=null;
  function hitAt(x,y){
    pointer.set(x,y);camera.updateMatrixWorld();pick.setFromCamera(pointer,camera);
    return pick.intersectObjects(meshes,false)[0];
  }
  function updatePopup(){
    const centred=locked()||mouseSteer;
    const hit=hitAt(centred?0:hoverPoint.x,centred?0:hoverPoint.y);
    const id=hit?.object.userData.exhibit;
    if(id===focusedId)return;
    focusedId=id;
    popup.hidden=!id;
    if(id){
      popup.querySelector('strong').textContent=artLabels[id].title;
      popup.querySelector('span').textContent=artLabels[id].place;
    }
  }
  function inspectAt(x,y){
    const hit=hitAt(x,y);
    const id=hit?.object.userData.exhibit;
    if(id){inspect(id);return true;}
    if(!hit?.object.userData.walkable)return false;
    const pos=camera.position;
    route=floorRoute(pos.x,pos.z,hit.point.x,hit.point.z);
    lastTime=performance.now();schedule();
    return true;
  }
  function clearInput(){
    keys.clear();held.clear();drag=null;lastTime=0;lastMouse=null;edgeSide=0;route=[];
  }
  const blocked=(x,z)=>galleryBlocks(x,z,.24);
  function move(dt) {
    const front = Number(activeKey('KeyW') || activeKey('ArrowUp')) - Number(activeKey('KeyS') || activeKey('ArrowDown'));
    const side = Number(activeKey('KeyD'))-Number(activeKey('KeyA'));
    camera.rotation.y += (Number(activeKey('ArrowLeft'))-Number(activeKey('ArrowRight')))*1.65*dt;
    const distance = dt*3.5/Math.max(1,Math.hypot(front,side));
    const pos = camera.position;
    const sin=Math.sin(camera.rotation.y),cos=Math.cos(camera.rotation.y);
    if(front||side)route=[];
    let dx=(side*cos-front*sin)*distance,dz=-(side*sin+front*cos)*distance;
    if(route.length){
      const [x,z]=route[0],remaining=Math.hypot(x-pos.x,z-pos.z);
      const fraction=remaining?Math.min(1,distance/remaining):1;
      dx=(x-pos.x)*fraction;dz=(z-pos.z)*fraction;
      if(fraction===1)route.shift();
    }
    if(!blocked(pos.x+dx,pos.z+dz)){pos.x+=dx;pos.z+=dz;}
    else{
      route=[];
      if(!blocked(pos.x+dx,pos.z))pos.x+=dx;
      if(!blocked(pos.x,pos.z+dz))pos.z+=dz;
    }
    if (verticalSpeed || pos.y>1.65) {
      verticalSpeed -= 15*dt;
      pos.y=Math.max(1.65,pos.y+verticalSpeed*dt);
      if(pos.y===1.65 && verticalSpeed<0) verticalSpeed=0;
    }
  }
  function draw(time) {
    frame = 0;
    if (!running) return;
    const moving = route.length || keys.size || held.size || verticalSpeed || camera.position.y>1.65;
    if (moving) move(THREE.MathUtils.clamp((time-(lastTime || time))/1000,0,.05));
    if (dirty || moving){renderer.render(scene,camera);updatePopup();}
    dirty = false;
    lastTime = time;
    if (moving) schedule();
  }
  function schedule() { if (running && !frame) frame = requestAnimationFrame(draw); }
  function redraw() { dirty = true; schedule(); }
  function resize() {
    if (!running || !host.clientWidth || !host.clientHeight) return;
    renderer.setSize(host.clientWidth,host.clientHeight,false);
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
    redraw();
  }
  new ResizeObserver(resize).observe(host);
  canvas.addEventListener('keydown',event => {
    if (!running || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === 'Enter') { event.preventDefault(); if (!event.repeat) inspectAt(0,0); }
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat && camera.position.y===1.65 && !verticalSpeed) {
        verticalSpeed=4.5;lastTime=performance.now();schedule();
      }
    }
    if (movement.has(event.code)) {
      route=[];
      event.preventDefault();
      if (!keys.size) lastTime = performance.now();
      keys.add(event.code); schedule();
    }
  });
  window.addEventListener('keyup',event => keys.delete(event.code));
  canvas.addEventListener('blur',clearInput);
  window.addEventListener('blur',clearInput);
  document.addEventListener('visibilitychange',() => { if (document.hidden) clearInput(); });
  canvas.addEventListener('pointerdown',event => {
    if (drag || event.button !== 0) return;
    canvas.focus({preventScroll:true});
    if (locked()) { inspectAt(0,0); return; }
    canvas.setPointerCapture(event.pointerId);
    drag = {id:event.pointerId,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,looking:false};
  });
  const tour=host.closest('.tour');
  tour.addEventListener('mousemove',event => {
    if (!running || !mouseSteer || locked() || event.sourceCapabilities?.firesTouchEvents) return;
    const bounds=canvas.getBoundingClientRect();
    if(event.clientY<bounds.top || event.clientY>bounds.bottom)return;
    if(event.shiftKey)edgeSide=0;
    if (lastMouse && !event.shiftKey){
      const x=event.clientX,centre=bounds.left+bounds.width/2;
      let dx=x-lastMouse.x || event.movementX || 0;
      // Returning from an edge acts like lifting the mouse between strokes.
      if(edgeSide && dx*edgeSide<0){
        if((x-centre)*edgeSide<=0){dx=x-centre;edgeSide=0;}
        else dx=0;
      }else if(dx!==0){
        edgeSide=0;
      }
      if(dx>0 && x>=bounds.right-8)edgeSide=1;
      if(dx<0 && x<=bounds.left+8)edgeSide=-1;
      const dy=event.clientY-lastMouse.y || event.movementY || 0;
      if(dx || dy)look(dx*2*Math.PI/Math.max(1,bounds.width),dy*.0035,1);
    }
    lastMouse={x:event.clientX,y:event.clientY};
  });
  tour.addEventListener('mouseleave',event=>{
    if(!running || locked())return;
    const bounds=canvas.getBoundingClientRect();
    if(event.clientX>=bounds.right-1)edgeSide=1;
    else if(event.clientX<=bounds.left+1)edgeSide=-1;
    lastMouse=null;
  });
  // An embedded browser can stop delivering mouse deltas at a screen edge.
  // Wheel input remains relative, so visitors can finish a turn with the mouse.
  canvas.addEventListener('wheel',event=>{
    if(!running || locked() || !mouseSteer || event.ctrlKey || !host.closest('.desktop-walk')) return;
    const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if(!delta) return;
    event.preventDefault();
    const unit=event.deltaMode===1 ? 16 : event.deltaMode===2 ? canvas.clientWidth : 1;
    look(delta*unit,0,.0035);
  },{passive:false});
  canvas.addEventListener('pointermove',event => {
    if(running && !mouseSteer && !locked()){
      const b=canvas.getBoundingClientRect();
      hoverPoint.set((event.clientX-b.left)/b.width*2-1,1-(event.clientY-b.top)/b.height*2);
      redraw();
    }
    if (drag?.id !== event.pointerId) return;
    if (!drag.looking && Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY) < 5) return;
    drag.looking = true;
    if(!mouseSteer || event.pointerType!=='mouse') look(event.clientX-drag.x,event.clientY-drag.y,.0045);
    drag.x = event.clientX; drag.y = event.clientY;
  });
  canvas.addEventListener('pointerup',event => {
    if (drag?.id !== event.pointerId) return;
    if (!drag.looking) {
      const bounds = canvas.getBoundingClientRect();
      const hit=mouseSteer && event.pointerType==='mouse' ? inspectAt(0,0) :
        inspectAt((event.clientX-bounds.left)/bounds.width*2-1,1-(event.clientY-bounds.top)/bounds.height*2);
      if (!hit && event.pointerType==='mouse') captureMouse();
    }
    drag = null;
  });
  canvas.addEventListener('lostpointercapture',event => {
    if(drag?.id===event.pointerId) drag=null;
  });
  for (const button of host.querySelectorAll('[data-step]')) {
    button.addEventListener('pointerdown',event => {
      event.preventDefault(); button.setPointerCapture(event.pointerId);
      route=[];held.set(event.pointerId,button.dataset.step);
      lastTime = performance.now(); schedule();
    });
    button.addEventListener('lostpointercapture',event => held.delete(event.pointerId));
    button.addEventListener('click',event => {
      if (event.detail) return;
      keys.add(button.dataset.step); move(.12); keys.delete(button.dataset.step); redraw();
    });
  }
  host.querySelector('.walk-status').hidden = true;
  updateCapture();
  host.querySelector('.walk-pad').hidden = host.querySelector('.aim').hidden = false;
  return {
    setMouseSteer(enabled){mouseSteer=enabled;lastMouse=null;edgeSide=0;updateCapture();},
    start() { running=true; resize(); canvas.focus({preventScroll:true}); },
    stop() { popup.hidden=true;focusedId=null;running=false; if(locked()) document.exitPointerLock(); cancelAnimationFrame(frame); frame=0; clearInput(); }
  };
}
