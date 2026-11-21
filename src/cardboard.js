import {artLabels} from './gallery-collection.js';
import {enableFullscreen} from './fullscreen.js';

const rooms={rotunda:{
  title:'Twin Galleries',image:'architecture-hall',
  alt:'Two wings of cardboard architectural miniatures along a figure-eight floor inlay.',
  caption:'Walk through both wings or choose a building for a closer look.',
  marks:[['rani-ki-vav',5,48],['samrat-yantra',21,51],['sanchi',28,44],['pantheon',73,49],['parthenon',93,46]]
}};
const details=Object.fromEntries(Object.entries(artLabels).map(([id,model])=>[id,{
  ...model,label:model.title,image:id,alt:'Cardboard architectural study of '+model.title
}]));
const $=id=>document.getElementById(id);
const walkLink=document.querySelector('.walk-link');
const roomNav=walkLink.parentElement;
for(const [id,model] of Object.entries(artLabels)){
  const link=document.createElement('a');
  link.href='#rotunda/'+id;
  const name=document.createElement('span');name.textContent=model.title;
  link.append(name);roomNav.append(link);
}
const links=[...roomNav.querySelectorAll('a')];
let lastRoom, lastDetail;
let walker, loadingWalk, walkFailed = false;
let walkStarted=false;
let resumeCaptured=false;
const walkHint = 'WASD to move · Mouse to look · Space to jump · Aim and click to inspect · Esc to release the mouse.';
const steerToggle=$('mouse-steer');
const captureButton=$('capture-mouse');
const desktopWalk=$('desktop-walk-link');
const canOpenEdge=/Win/i.test(navigator.platform) && !/Edg\//.test(navigator.userAgent);
desktopWalk.href='microsoft-edge:'+new URL('#walk',location.href).href;
let captureDenied=false;
steerToggle.checked=true;
function updateWalkHint(){
  const captured=document.pointerLockElement===$('walk-canvas');
  const desktop=$('tour').classList.contains('desktop-walk');
  desktopWalk.hidden=!(desktop && captureDenied && !captured && canOpenEdge);
  captureButton.hidden=!desktop || captured || !$('walk-canvas').requestPointerLock;
  walkLink.hidden=steerToggle.checked;
  if(captured){
    $('caption').textContent='WASD to walk · Move the mouse to look · Click the floor to walk or a model to inspect · Esc to release the mouse.';
  }else if(desktop && steerToggle.checked){
    $('caption').textContent=(captureDenied?'Mouse capture unavailable. ':'')+'At either edge, return the mouse to centre and sweep again to keep turning. Click the floor or use WASD to walk.';
  }else if(steerToggle.checked){
    $('caption').textContent='WASD to walk · Move the mouse to look · Click the floor to walk or a model to inspect. On touchscreens, drag to look.';
  }else{
    $('caption').textContent=matchMedia('(pointer:coarse)').matches ? 'Use the arrows to move. Drag to look. Tap the floor to walk or a model to inspect.' : walkHint;
  }
}
function captureFailed(){
  if($('walk').hidden || document.pointerLockElement===$('walk-canvas')) return;
  captureDenied=true;
  updateWalkHint();
}
async function requestMouseLook(){
  const canvas=$('walk-canvas');
  if(document.pointerLockElement===canvas) return;
  canvas.focus({preventScroll:true});
  if(!canvas.requestPointerLock){ captureFailed(); return; }
  try {
    await canvas.requestPointerLock({unadjustedMovement:true});
  } catch(error) {
    if(error.name!=='NotSupportedError' || $('walk').hidden){captureFailed();return;}
    try { await canvas.requestPointerLock(); } catch { captureFailed(); }
  }
}
document.addEventListener('pointerlockerror',captureFailed);
captureButton.addEventListener('click',requestMouseLook);
document.addEventListener('pointerlockchange',()=>{
  if(document.pointerLockElement===$('walk-canvas')) captureDenied=false;
  if(!$('walk').hidden) updateWalkHint();
  else if(document.pointerLockElement===$('walk-canvas')) document.exitPointerLock();
});
steerToggle.addEventListener('change',()=>{
  walker?.setMouseSteer(steerToggle.checked);
  if(!steerToggle.checked && document.pointerLockElement===$('walk-canvas'))document.exitPointerLock();
  updateWalkHint();
  $('walk-canvas').focus({preventScroll:true});
});
function openWalk() {
  if (!loadingWalk) {
    loadingWalk = import('./gallery-walk.js').then(({createWalk}) => createWalk($('walk'), image => {
      const id = Object.hasOwn(details,image) ? image : Object.keys(details).find(key => details[key].image === image);
      if (id) {
        resumeCaptured=document.pointerLockElement===$('walk-canvas');
        location.hash = 'walk/' + id;
      }
    },requestMouseLook)).then(result => {
      walker = result;
      walker.setMouseSteer(steerToggle.checked);
      if (!$('walk').hidden) walker.start();
    }).catch(error => {
      console.error('Gallery walkthrough:', error);
      walkFailed = true;
      if (lastRoom === 'walk' && !lastDetail) {
        showView();
        closeFailedWalk();
      }
    });
  } else if (walker) walker.start();
}
let artViewer;
let activeArt;
const miniatureRange=$('miniature-range');
function adjustMiniature(){
  const value=Number(miniatureRange.value);
  const label=value+'% open';
  $('miniature-value').textContent=label;miniatureRange.setAttribute('aria-valuetext',label);
  activeArt?.setExhibitAmount(lastDetail,value/100);
}
miniatureRange.addEventListener('input',adjustMiniature);
const sunRange=$('sun-time');
function moveSun(){
  const minutes=Number(sunRange.value);
  const time=Math.floor(minutes/60)+':'+String(minutes%60).padStart(2,'0');
  $('solar-time').textContent=time;
  sunRange.setAttribute('aria-valuetext',time+' solar time');
  activeArt?.setSunHour(minutes/60);
}
sunRange.addEventListener('input',moveSun);
async function openArt(id){
  const canvas=$('art-view');
  try {
    artViewer ??= import('./gallery-art-view.js').then(({createArtViewer})=>createArtViewer(canvas));
    const viewer=await artViewer;
    if(lastDetail!==id) return;
    canvas.hidden=false;
    $('plate').hidden=true;
    canvas.setAttribute('aria-label','Rotate '+artLabels[id].title);
    viewer.show(id);
    if(id==='rani-ki-vav'){
      activeArt=viewer;
      $('miniature-controls').hidden=false;
      $('miniature-label').textContent='Open the cutaway';
      miniatureRange.value=0;
      adjustMiniature();
    }
    if(id==='samrat-yantra'){
      activeArt=viewer;
      $('sun-controls').hidden=false;
      sunRange.value='540';moveSun();
    }
    $('caption').textContent=artLabels[id].caption+' Drag or use the left and right arrow keys to rotate.';
  } catch {
    // A local still supplies the same work if a WebGL context is unavailable.
    if(lastDetail===id){canvas.hidden=true;$('plate').hidden=false;}
  }
}
function showView() {
  const [roomId,detailId] = location.hash.slice(1).split('/');
  if(roomId!=='walk') walkStarted=false;
  const walking = roomId==='walk' && (walkStarted || Boolean(detailId && Object.hasOwn(details,detailId)));
  const room = walking ? 'walk' : Object.hasOwn(rooms,roomId) ? roomId : 'rotunda';
  const view = rooms[room] || rooms.rotunda;
  const detail=Object.hasOwn(details,detailId)?details[detailId]:null;
  const previousRoom = lastRoom, previousDetail = lastDetail;
  lastRoom=room;lastDetail=detail?detailId:null;
  const live = walking && walkStarted && !detail && !walkFailed;
  const preview=!detail && !live && (!roomId || roomId==='walk');
  if(preview) $('plate').parentElement.append(walkLink);
  else roomNav.prepend(walkLink);
  walkLink.hidden=false;
  $('walk').hidden = !live;
  captureButton.hidden=true;
  desktopWalk.hidden=true;
  $('steer-control').hidden = !live;
  $('plate').hidden = live;
  if (!live) {
    walker?.stop();
    if(document.pointerLockElement===$('walk-canvas')) document.exitPointerLock();
  }
  $('scene-image').src=detail?.src || 'media/'+(detail?.image || view.image || room)+'.webp';
  $('scene-image').alt=detail?.alt || view.alt;
  $('view-title').textContent=detail?.title || view.title;
  $('caption').textContent=detail?.caption || view.caption;
  $('back-room').hidden=!detail;
  $('back-room').href=walking && !walkStarted ? '#rotunda' : '#'+room;
  $('back-room').textContent=walking && walkStarted ? '← Back to walk' : '← Room view';
  $('art-view').hidden=true;
  $('sun-controls').hidden=true;
  $('miniature-controls').hidden=true;
  activeArt=undefined;
  if(detail && Object.hasOwn(artLabels,detailId)) openArt(detailId);
  for(const link of links){
    if(link.hash==='#'+room+(detail?'/'+detailId:''))link.setAttribute('aria-current','location');
    else link.removeAttribute('aria-current');
  }
  const markers=$('markers');
  markers.replaceChildren();
  if (live) {
    $('view-title').textContent='Gallery walk';
    updateWalkHint();
    openWalk();
    return;
  }
  if (walking && walkFailed && !detail) {
    $('caption').textContent='The 3D view is unavailable. Choose a building for a closer look.';
  }
  if(detail){
    if(previousRoom) $('back-room').focus({preventScroll:true});
    return;
  }
  for(const [id,x,y] of view.marks){
    const link=document.createElement('a');
    link.className='marker'+(x<20?' near-left':x>80?' near-right':'');
    link.href='#'+(walking ? 'rotunda' : room)+'/'+id;
    link.style.left=x+'%';link.style.top=y+'%';
    link.setAttribute('aria-label','Inspect '+details[id].title);
    const label=document.createElement('span');label.textContent=details[id].label;
    link.append(label);markers.append(link);
    if(previousRoom===room && previousDetail===id)link.focus({preventScroll:true});
  }
}
window.addEventListener('hashchange',showView);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape' && !$('walk').hidden){
    leaveWalk();
    if(document.fullscreenElement===$('tour')) document.exitFullscreen().catch(()=>{});
    return;
  }
  if(event.key==='Escape' && lastDetail && !document.fullscreenElement && !$('tour').classList.contains('expanded-view'))location.hash=lastRoom;
});
const enterFullscreen = enableFullscreen($('tour'),$('tour-fullscreen'));
function closeFailedWalk(){
  if(walkFailed && (document.fullscreenElement===$('tour') || $('tour').classList.contains('expanded-view'))){
    $('tour-fullscreen').click();
  }
}
function enterWalk(event){
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  walkStarted=true;
  captureDenied=false;
  $('tour').classList.toggle('desktop-walk',event.pointerType!=='touch');
  if (location.hash !== '#walk') history.pushState(null,'','#walk');
  showView();
  if(walkFailed) return;
  const canvas=$('walk-canvas');
  canvas.focus({preventScroll:true});
  // Both APIs need the entry gesture. Capture before fullscreen consumes it,
  // even on a cold load while the gallery geometry is still downloading.
  if(event.pointerType!=='touch') requestMouseLook();
  enterFullscreen().then(closeFailedWalk);
}
walkLink.addEventListener('click',enterWalk);
function leaveWalk(){
  walkStarted=false;
  resumeCaptured=false;
  showView();
  document.querySelector('.walk-link').focus({preventScroll:true});
}
$('back-room').addEventListener('click',event=>{
  if(walkStarted && lastRoom==='walk' && resumeCaptured) enterWalk(event);
  resumeCaptured=false;
});
document.addEventListener('fullscreenchange',()=>{
  if(!document.fullscreenElement && walkStarted && !$('walk').hidden){
    leaveWalk();
  }
});
showView();
