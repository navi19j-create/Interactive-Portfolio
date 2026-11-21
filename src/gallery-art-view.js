import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {makeArt} from './gallery-art.js';
import {sundialLight} from './samrat-yantra.js';

export function createArtViewer(canvas){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled=true;
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0xe6e1d7);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:0xd2caba,roughness:1}));
  floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  scene.add(new THREE.HemisphereLight(0xfff6e6,0xd1bba4,1.65));
  const key=new THREE.DirectionalLight(0xffedd5,2.3);
  key.position.set(-3,6,4);key.castShadow=true;key.shadow.mapSize.set(1024,1024);
  key.shadow.normalBias=.005;scene.add(key,key.target);
  const camera=new THREE.PerspectiveCamera(36,1,.04,80);
  const orbit=new OrbitControls(camera,canvas);
  orbit.enablePan=false;orbit.maxPolarAngle=Math.PI*.49;orbit.minDistance=1.35;orbit.maxDistance=10;
  const models=new Map();
  const renderSize=new THREE.Vector2();
  let current;
  function setExhibitAmount(id,value){
    if(id==='rani-ki-vav')current.getObjectByName('CutawayBank').scale.y=1-.96*value;
    draw();
  }
  function draw(){
    if(!current || !canvas.clientWidth || !canvas.clientHeight) return;
    renderer.getSize(renderSize);
    if(renderSize.x!==canvas.clientWidth || renderSize.y!==canvas.clientHeight)
      renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);
    camera.aspect=canvas.clientWidth/canvas.clientHeight;camera.updateProjectionMatrix();
    renderer.render(scene,camera);
  }
  orbit.addEventListener('change',draw);
  new ResizeObserver(draw).observe(canvas);
  canvas.addEventListener('keydown',e=>{
    const steps={ArrowLeft:-.18,ArrowRight:.18};
    if(!Object.hasOwn(steps,e.key))return;
    e.preventDefault();
    camera.position.sub(orbit.target).applyAxisAngle(new THREE.Vector3(0,1,0),steps[e.key]).add(orbit.target);
    orbit.update();
  });
  function setSunHour(hour){
    key.target.position.set(0,.69,0);
    key.position.copy(sundialLight(hour)).multiplyScalar(6).add(key.target.position);
    draw();
  }
  function show(id){
    if(current) current.visible=false;
    if(!models.has(id)){const model=makeArt(id);models.set(id,model);scene.add(model);}
    current=models.get(id);current.visible=true;
    const dial=id==='samrat-yantra';
    if(id==='rani-ki-vav')setExhibitAmount(id,0);
    const extent=dial ? 1.8 : 5;
    Object.assign(key.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent});
    key.shadow.camera.updateProjectionMatrix();
    if(dial)setSunHour(9);
    else {key.target.position.set(0,0,0);key.position.set(-3,6,4);}
    const box=new THREE.Box3().setFromObject(current,true);
    const target=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    const aspect=canvas.clientWidth/Math.max(1,canvas.clientHeight);
    let distance=Math.max(size.y,size.x/Math.max(.65,aspect),size.z)*1.95+.4;
    if(dial){distance*=1.09;target.y-=.10;}
    if(id==='rani-ki-vav'){distance*=1.12;target.y-=.12;}
    const direction=(id==='rani-ki-vav' ? new THREE.Vector3(.39,1.23,1.10) : new THREE.Vector3(.78,.56,1)).normalize();
    orbit.target.copy(target);camera.position.copy(target).addScaledVector(direction,distance);
    orbit.update();draw();
  }
  return {show,setSunHour,setExhibitAmount};
}
