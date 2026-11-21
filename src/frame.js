import * as THREE from 'three';
import { studio } from './studio.js';

const host=document.getElementById('game'), reference=document.getElementById('reference');
const result=document.getElementById('result'), shutter=document.getElementById('shutter');
function init(){
  const {renderer,scene,camera,orbit,draw,move,resize,canvas}=studio(host,0xe1d7c0,31,.1,90);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  scene.fog = new THREE.Fog(0xe4dbc7,20,48);
  scene.add(new THREE.HemisphereLight(0xfff5de,0xafa397,1.85));
  const key=new THREE.DirectionalLight(0xffeed2,2.5);key.position.set(-5,9,5);key.castShadow=true;
  key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-6,right:6,top:6,bottom:-6});key.shadow.normalBias=.013;key.shadow.bias=-.0003;key.shadow.radius=3;scene.add(key);
  function mesh(geo,color,x,y,z){
    const m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:.76}));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;scene.add(m);return m;
  }
  const box=(w,h,d,color,x,y,z)=>mesh(new THREE.BoxGeometry(w,h,d),color,x,y,z);
  box(120,.12,120,0xe3dbc7,0,-.06,0);
  // A single extruded arch provides a real opening through both faces.
  const shape=new THREE.Shape();
  shape.moveTo(-1.55,0);shape.lineTo(-1.55,1.75);shape.absarc(0,1.75,1.55,Math.PI,0,true);
  shape.lineTo(1.55,0);shape.lineTo(.89,0);shape.lineTo(.89,1.75);
  shape.absarc(0,1.75,.89,0,Math.PI,false);shape.lineTo(-.89,0);shape.closePath();
  mesh(new THREE.ExtrudeGeometry(shape,{depth:.60,bevelEnabled:true,bevelSegments:3,steps:1,bevelThickness:.045,bevelSize:.045,curveSegments:48}),0xc04c30,-.35,.045,-.25);
  mesh(new THREE.SphereGeometry(.72,64,32),0x284b9f,-.23,.72,.35);
  for(let i=0;i<3;i++){const h=.32*(i+1);box(.44,h,1.35,0xe9b549,1.55+i*.44,h/2,-.18);}
  mesh(new THREE.CylinderGeometry(.65,.65,.27,64),0xc9b99b,-1.7,.135,.98);
  orbit.target.set(.14,1.45,0);orbit.minPolarAngle=.45;orbit.maxPolarAngle=1.54;
  orbit.enableZoom=false;orbit.minDistance=orbit.maxDistance=9.6;
  const target={theta:.36,phi:1.29}, start={theta:-.76,phi:1.04};
  function position(cam,pose){
    cam.position.setFromSpherical(new THREE.Spherical(9.6,pose.phi,pose.theta)).add(orbit.target);cam.lookAt(orbit.target);
  }
  function still(cam){
    // All photographs use the same 4:3 frame on both portrait and wide screens.
    const original=cam.aspect;
    const renderSize=renderer.getSize(new THREE.Vector2());
    const ratio=renderer.getPixelRatio();
    renderer.setPixelRatio(1);renderer.setSize(900,675,false);
    cam.aspect=4/3;cam.updateProjectionMatrix();renderer.render(scene,cam);
    const image=canvas.toDataURL('image/webp',.92);
    cam.aspect=original;cam.updateProjectionMatrix();renderer.setPixelRatio(ratio);renderer.setSize(renderSize.x,renderSize.y,false);draw();return image;
  }
  resize();position(camera,start);orbit.update();const refCamera=camera.clone();position(refCamera,target);
  reference.src=still(refCamera);host.classList.add('ready');draw();
  document.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>{move(...({left:[-.08,0],right:[.08,0],up:[0,-.05],down:[0,.05]}[b.dataset.move]));});
  let captured=false;
  shutter.onclick=()=>{
    if(captured){
      captured=false;position(camera,start);orbit.update();document.getElementById('comparison').hidden=true;shutter.textContent='Take photograph';result.textContent='Try another angle.';draw();return;
    }
    const actual=camera.position.clone().sub(orbit.target).normalize();
    const desired=refCamera.position.clone().sub(orbit.target).normalize();
    const difference=THREE.MathUtils.radToDeg(actual.angleTo(desired));
    const score=Math.round(Math.max(0,100-1.12*difference));
    document.getElementById('shot').src=still(camera);document.getElementById('target-shot').src=reference.src;
    document.getElementById('comparison').hidden=false;captured=true;shutter.textContent='Try again';
    result.textContent=score+'% framing match · '+Math.round(difference)+'° from the reference angle.';
    document.getElementById('comparison').scrollIntoView({block:'nearest',behavior:'instant'});
  };
}
try{init();}catch{
  host.querySelector('canvas')?.remove();shutter.disabled=true;
  document.querySelectorAll('[data-move]').forEach(b=>b.disabled=true);
  result.textContent='The camera game needs WebGL. The reference photograph is available here.';
}
