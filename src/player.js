import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { studio } from './studio.js';

import { enableFullscreen } from './fullscreen.js';
import { installInspection } from './inspection.js';
import { setupSubmissions } from './submissions.js';
import { youtubeSource } from './youtube.js';
import { playlist, submissionEmail } from './playlist-settings.js';

const $ = id => document.getElementById(id);
const tracks = [
  {title:'Soft Circuit',url:'../assets/soft-circuit.mp3',credit:'Original portfolio loop'},
  {title:'Afterimage',url:'../assets/afterimage.mp3',credit:'Original portfolio loop'}
];
const audio=new Audio();
audio.volume=.6;audio.preload='metadata';
let current=0,selected=0,menu=false,stopped=true,volumeUntil=0;
let panel,screenTexture,drawScene=()=>{},animatePress=()=>{};
let online=false,menuKey='';
const notify=message=>{$('feedback').textContent=message;};
const youtube=youtubeSource(refresh,notify,()=>{changeSource('local');void play();});
const count=()=>online?youtube.count:tracks.length;
const trackName=i=>online?youtube.label(i):tracks[i].title;
const trackIndex=()=>online?youtube.index:current;
const formatTime=seconds=>[Math.floor(seconds/60),Math.floor(seconds%60)].map(v=>String(v).padStart(2,'0')).join(':');

function refresh() {
  const info=online?youtube.info:{
    title:tracks[current].title,credit:tracks[current].credit,seconds:audio.currentTime||0,
    state:audio.paused?(stopped?'Stopped':'Paused'):'Playing',playing:!audio.paused
  };
  const stamp=formatTime(info.seconds);
  $('track').textContent=info.title;$('artist-credit').textContent=info.credit;
  $('clock').textContent=stamp;$('mode').textContent=info.state;
  document.querySelector('[data-action="play"]').textContent=info.playing?'Ⅱ Pause':'▶ Play';
  document.querySelector('[data-action="menu"]').setAttribute('aria-expanded',String(menu));
  $('menu-list').hidden=!menu;
  if(menu){
    const labels=Array.from({length:count()},(_,i)=>trackName(i));
    const key=JSON.stringify(labels);
    if(menuKey!==key){
      menuKey=key;$('menu-list').replaceChildren();
      labels.forEach((text,i)=>{const b=document.createElement('button');b.textContent=text;b.onclick=()=>{selected=i;act('play');};$('menu-list').append(b);});
      if(!labels.length)$('menu-list').textContent='Open the track list in the YouTube player.';
    }
    [...$('menu-list').children].forEach((b,i)=>b.setAttribute('aria-pressed',String(i===selected)));
  }
  if(!panel)return;
  panel.fillStyle='#0b0d0c';panel.fillRect(0,0,512,330);panel.fillStyle='#f1f1e7';panel.font='26px monospace';
  panel.fillText(menu?'TRACK MENU':'TRACK '+String(trackIndex()+1).padStart(2,'0'),25,46);
  panel.strokeStyle='#eee';panel.lineWidth=3;panel.strokeRect(423,25,55,19);panel.fillRect(429,31,37,7);
  if(menu){
    const first=Math.max(0,selected-2);
    for(let i=first;i<Math.min(count(),first+3);i++)panel.fillText((i===selected?'> ':'  ')+trackName(i).slice(0,24),26,110+(i-first)*60,465);
  }else{
    panel.font='68px monospace';panel.textAlign='center';
    panel.fillText(!online && Date.now()<volumeUntil?Math.round(audio.volume*100)+'%':stamp,256,195);panel.textAlign='left';
    panel.font='22px monospace';panel.fillText(info.title.toUpperCase().slice(0,28),26,292,370);panel.fillText(info.playing?'>>':'II',435,292);
  }
  screenTexture.needsUpdate=true;drawScene();
}
async function play(){
  stopped=false;
  try{await audio.play();}catch(error){if(error.name!=='AbortError')notify('This file could not play. Choose another track or file format.');}
  refresh();
}
function setTrack(index,resume){
  current=(index+tracks.length)%tracks.length;audio.src=tracks[current].url;stopped=true;
  if(resume)void play();refresh();
}
function act(action){
  animatePress(action);
  if(action==='menu'){menu=!menu;selected=trackIndex();refresh();return;}
  if(menu && (action==='next'||action==='prev')){
    if(count())selected=(selected+(action==='next'?1:-1)+count())%count();refresh();return;
  }
  if(menu && action==='play'){
    menu=false;
    if(online){if(count())youtube.choose(selected);else youtube.command('play');}
    else setTrack(selected,true);
    refresh();return;
  }
  if(action==='stop')menu=false;
  if(online){youtube.command(action);refresh();return;}
  if(action==='play'){if(audio.paused)void play();else audio.pause();}
  if(action==='stop'){audio.pause();audio.currentTime=0;stopped=true;}
  if(action==='next'||action==='prev')setTrack(current+(action==='next'?1:-1),!audio.paused);
  if(action==='up'||action==='down'){
    audio.volume=Math.max(0,Math.min(1,Math.round(audio.volume*10+(action==='up'?1:-1))/10));
    notify('Volume '+Math.round(audio.volume*100)+'%');volumeUntil=Date.now()+1000;setTimeout(refresh,1010);
  }
  refresh();
}
function changeSource(value){
  online=value==='youtube';menu=false;menuKey='';audio.pause();youtube.close();
  $('music-source').value=value;$('online-player').hidden=!online;
  if(online)void youtube.open();else notify('Volume '+Math.round(audio.volume*100)+'%');refresh();
}
$('music-source').onchange=e=>changeSource(e.target.value);
$('playlist-link').href=playlist.url;$('playlist-link').textContent='Open '+playlist.title+' in YouTube Music ↗';
$('add-song').onsubmit=e=>{
  e.preventDefault();const file=$('song-file').files[0];if(!file)return;
  const title=$('song-title').value.trim()||file.name.replace(/\.[^.]+$/,'');
  tracks.push({title,credit:$('song-artist').value.trim()||'Artist credit unavailable',url:URL.createObjectURL(file)});
  changeSource('local');setTrack(tracks.length-1,false);notify('Song added for this visit. Press Play.');e.target.reset();
};
enableFullscreen($('player-shell'),$('fullscreen'));
setupSubmissions(submissionEmail);
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>act(b.dataset.action));
['timeupdate','play','pause','loadedmetadata'].forEach(event=>audio.addEventListener(event,refresh));
audio.addEventListener('ended',()=>{if(!online)setTrack(current+1,true);});
document.addEventListener('visibilitychange',()=>{if(document.hidden && online)youtube.pause();});
window.addEventListener('pagehide',event=>{
  audio.pause();audio.currentTime=0;stopped=true;youtube.close();
  if(!event.persisted)tracks.filter(t=>t.url.startsWith('blob:')).forEach(t=>URL.revokeObjectURL(t.url));
});
window.addEventListener('pageshow',e=>{if(e.persisted && online)void youtube.open();});
setTrack(0,false);

async function showModel() {
  const host=$('view');
  const {canvas,renderer,scene,camera,orbit,draw,move,resize}=studio(host,0xd9d9d2,32,1,1500);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.91;
  const env = new RoomEnvironment();
  const generator = new THREE.PMREMGenerator(renderer);
  scene.environment=generator.fromScene(env,.04).texture; env.dispose();generator.dispose();
  scene.environmentIntensity=.78;
  scene.add(new THREE.HemisphereLight(0xfff6e9,0x6e7479,1.05));
  const key=new THREE.DirectionalLight(0xfff7e9,1.5);key.position.set(-100,170,130);scene.add(key);
  orbit.minDistance=72;orbit.maxDistance=620;orbit.minPolarAngle=.05;orbit.maxPolarAngle=Math.PI-.05;
  const home=()=>{orbit.target.set(0,-4,0);camera.position.set(86,89,Math.max(320,205/Math.max(.4,camera.aspect)));orbit.update();draw();};
  resize(); home();
  const gltf=await new GLTFLoader().loadAsync('../assets/player.glb');
  scene.add(gltf.scene);
  const bounds=new THREE.Box3().setFromObject(gltf.scene,true);
  const size=bounds.getSize(new THREE.Vector3());
  const center=bounds.getCenter(new THREE.Vector3());
  const thickness=5;
  const base=new THREE.Mesh(
    new RoundedBoxGeometry(size.x+20,thickness,size.z+24,3,1.4),
    new THREE.MeshStandardMaterial({color:0xa29e91,roughness:.88})
  );
  base.position.set(center.x,bounds.min.y-thickness/2,center.z);
  base.receiveShadow=true;
  scene.add(base);
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.autoUpdate=false;
  key.castShadow=true;
  Object.assign(key.shadow.camera,{left:-115,right:115,top:120,bottom:-120,near:1,far:450});
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.mapSize.set(1024,1024);
  key.shadow.normalBias=.12;
  gltf.scene.traverse(part=>{if(part.isMesh)part.castShadow=true;});
  renderer.shadowMap.needsUpdate=true;
  const mapping = {play:/BTN_Play_|Icon_Play|Icon_Pause/,stop:/BTN_Stop_|Icon_Stop/,menu:/BTN_Menu_|MenuDot/,next:/BTN_Next_|Icon_Next/,prev:/BTN_Previous_|Icon_Prev/,up:/BTN_VolumeUp_|Icon_Plus/,down:/BTN_VolumeDown_|Icon_Minus/};
  const groups = new Map();
  gltf.scene.traverse(obj=>{
    if(!obj.isMesh) return;
    for(const [action,pattern] of Object.entries(mapping)){
      if(!pattern.test(obj.name))continue;
      obj.userData.action=action;obj.userData.rest=obj.position.z;
      if(!groups.has(action))groups.set(action,[]);
      groups.get(action).push(obj);break;
    }
  });
  const timers=new Map();
  animatePress=action=>{
    const parts=groups.get(action)||[];
    clearTimeout(timers.get(action));
    parts.forEach(o=>o.position.z=o.userData.rest-.8);draw();
    timers.set(action,setTimeout(()=>{parts.forEach(o=>o.position.z=o.userData.rest);draw();},125));
  };
  const surface=document.createElement('canvas');surface.width=512;surface.height=330;panel=surface.getContext('2d');
  screenTexture=new THREE.CanvasTexture(surface);screenTexture.colorSpace=THREE.SRGBColorSpace;
  const display=new THREE.Mesh(new THREE.PlaneGeometry(40.1,26.1),new THREE.MeshBasicMaterial({map:screenTexture,toneMapped:false}));
  display.position.set(-9.55,49,11.72);scene.add(display);drawScene=draw;
  installInspection(gltf.scene,display,draw);
  const ray=new THREE.Raycaster();let start,dragged=false;
  canvas.addEventListener('pointerdown',e=>{if(start){dragged=true;return;}start={id:e.pointerId,x:e.clientX,y:e.clientY};dragged=false;});
  canvas.addEventListener('pointermove',e=>{if(start && Math.hypot(e.clientX-start.x,e.clientY-start.y)>5)dragged=true;});
  canvas.addEventListener('pointercancel',()=>{start=null;dragged=true;});
  canvas.addEventListener('pointerup',e=>{
    if(!start || start.id!==e.pointerId)return;
    start=null;if(dragged)return;
    const rect=canvas.getBoundingClientRect();
    ray.setFromCamera({x:(e.clientX-rect.left)/rect.width*2-1,y:1-(e.clientY-rect.top)/rect.height*2},camera);
    const first=ray.intersectObjects([base,gltf.scene],true)[0];
    if(first?.object.userData.action)act(first.object.userData.action);
  });
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{
    const choice=b.dataset.view;
    if(choice==='reset')home();else move(...({left:[-.25,0],right:[.25,0],in:[0,0,.86],out:[0,0,1.16]}[choice]));
  });
  refresh();host.classList.add('ready');$('load').hidden=true;
}
showModel().catch(()=>{
  $('view').querySelector('canvas')?.remove();
  $('load').textContent='Studio render · playback controls available';
  document.querySelectorAll('[data-view]').forEach(b=>b.disabled=true);
});
