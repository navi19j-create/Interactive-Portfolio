import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Each material is a sheet colour. Batch its cut pieces into one gallery mesh.
export function makeLandmark(id){
  const batches=new Map();
  const ivory=0xe5d6b6, edge=0xc0a47d, dark=0x71604e, brick=0xaf7251, stone=0xd5a46f;
  let frame=new THREE.Matrix4();
  function cut(geometry,colour,x,y,z,yaw=0){
    const transform=new THREE.Matrix4().makeRotationY(yaw).setPosition(x,y,z);
    const part=geometry.index?geometry.toNonIndexed():geometry;
    part.applyMatrix4(transform.premultiply(frame));
    if(!batches.has(colour))batches.set(colour,[]);
    batches.get(colour).push(part);
    if(geometry!==part)geometry.dispose();
  }
  const box=(w,h,d,c,x,y,z,yaw)=>cut(new THREE.BoxGeometry(w,h,d),c,x,y,z,yaw);
  function drum(top,bottom,h,c,x,y,z,n=48){
    cut(new THREE.CylinderGeometry(top,bottom,h,n),c,x,y,z);
  }
  function turned(profile,c,x,y,z){
    cut(new THREE.LatheGeometry(profile.map(([r,h])=>new THREE.Vector2(r,h)),64),c,x,y,z);
  }
  function column(x,z,y,h,r){
    drum(r*1.25,r*1.32,.035,edge,x,y+.0175,z,16);
    drum(r*.82,r,h-.10,ivory,x,y+h/2-.015,z,16);
    drum(r*1.24,r*.84,.055,edge,x,y+h-.065,z,16);
    box(r*2.65,.04,r*2.65,ivory,x,y+h-.02,z);
  }
  function gable(w,rise,d,x,y,z){
    const outline=new THREE.Shape();
    outline.moveTo(-w/2,0);outline.lineTo(w/2,0);outline.lineTo(0,rise);outline.closePath();
    cut(new THREE.ExtrudeGeometry(outline,{depth:d,bevelEnabled:false}),edge,x,y,z-d/2);
    const length=Math.hypot(w/2,rise),angle=Math.atan2(rise,w/2);
    for(const side of [-1,1]){
      const roof=new THREE.BoxGeometry(length+.055,.045,d+.065);
      roof.rotateZ(-side*angle);cut(roof,ivory,x+side*w/4,y+rise/2+.02,z);
    }
  }
  if(id==='parthenon'){
    for(let i=0;i<3;i++)box(1.22-i*.045,.045,2.38-i*.05,ivory,0,.0225+i*.045,0);
    for(let j=0;j<17;j++)for(let i=0;i<8;i++){
      if(i===0||i===7||j===0||j===16)column((i-3.5)*.143,(j-8)*.133,.135,.53,.046);
    }
    box(.68,.46,1.71,edge,0,.365,0);
    box(.24,.35,.025,dark,0,.31,.858);
    box(1.12,.11,2.24,ivory,0,.72,0);
    for(let side of [-1,1])for(let i=0;i<33;i++)box(.012,.056,.026,edge,side*.564,.724,(i-16)*.066);
    gable(1.18,.19,2.27,0,.78,0);
  }else if(id==='pantheon'){
    drum(.81,.86,.08,edge,0,.04,-.28);
    drum(.78,.79,.79,brick,0,.465,-.28);
    for(const y of [.16,.56,.83])drum(.805,.805,.036,edge,0,y,-.28);
    for(let i=0;i<5;i++)drum(.78-i*.037,.797-i*.037,.045,edge,0,.864+i*.036,-.28);
    // The open profile turns inward at the oculus so it has a visible cut edge.
    turned([[.66,0],[.59,.075],[.47,.16],[.31,.228],[.15,.259],[.115,.26],[.115,.225],[.30,.196],[.47,.13],[.65,-.02]],ivory,0,1.025,-.28);
    box(1.23,.063,.84,edge,0,.035,.63);
    box(1.17,.044,.79,ivory,0,.089,.61);
    for(let i=0;i<8;i++)column((i-3.5)*.147,.94,.111,.54,.042);
    for(const z of [.54,.72])for(const x of [-.51,-.36,.36,.51])column(x,z,.111,.54,.042);
    box(1.17,.085,.76,ivory,0,.693,.63);gable(1.22,.18,.78,0,.74,.63);
  }else if(id==='sanchi'){
    drum(.97,1.01,.075,edge,0,.0375,0);
    drum(.75,.78,.20,stone,0,.17,0);
    drum(.76,.77,.055,ivory,0,.29,0);
    const mound=[];
    for(let i=0;i<=24;i++){const a=i*Math.PI/48;mound.push([.71*Math.cos(a),.61*Math.sin(a)]);}
    turned(mound,stone,0,.313,0);
    box(.23,.095,.23,edge,0,.95,0);box(.31,.035,.31,ivory,0,1.015,0);
    drum(.018,.023,.32,dark,0,1.16,0);
    for(let i=0;i<3;i++)drum(.025,.135-.028*i,.038,ivory,0,1.085+i*.088,0);
    for(let i=0;i<48;i++){
      if(i%12===0)continue;
      const a=i*Math.PI/24,x=.89*Math.sin(a),z=.89*Math.cos(a);
      box(.038,.18,.042,edge,x,.16,z,a);
      if(i%12!==11)for(const y of [.125,.205]){
        const b=a+Math.PI/48;box(.128,.026,.027,stone,.89*Math.sin(b),y,.89*Math.cos(b),b);
      }
    }
    for(let i=0;i<4;i++){
      frame.makeRotationY(i*Math.PI/2);
      for(const x of [-.10,.10]){
        box(.052,.36,.062,stone,x,.25,.94);
        box(.08,.045,.085,edge,x,.43,.94);
      }
      for(let j=0;j<3;j++){
        const w=.42-j*.03,y=.464+j*.069;
        box(w,.037,.056,stone,0,y,.94);
        for(const x of [-w*.45,w*.45])box(.035,.056,.055,edge,x,y+.012,.94);
        for(const x of [-.09,.09])box(.03,.04,.038,edge,x,y+.032,.94);
      }
    }
  }else if(id==='pisa'){
    drum(.57,.61,.055,edge,0,.0275,0);
    frame.makeRotationZ(-.069).setPosition(0,.06,0);
    drum(.456,.475,.39,ivory,0,.195,0);
    for(let i=0;i<16;i++){
      const a=i*Math.PI/8;
      cut(new THREE.CylinderGeometry(.021,.023,.29,10),edge,.465*Math.sin(a),.19,.465*Math.cos(a));
    }
    function arcade(y,r,h,count){
      drum(r*.74,r*.75,h,dark,0,y+h/2,0);
      drum(r*1.045,r,.045,ivory,0,y+.015,0);
      const w=2*r*Math.tan(Math.PI/count);
      const arch=new THREE.Shape();
      arch.moveTo(-w*.51,.015);arch.lineTo(-w*.37,.015);arch.lineTo(-w*.37,h*.48);
      arch.absarc(0,h*.48,w*.37,Math.PI,0,true);arch.lineTo(w*.37,.015);
      arch.lineTo(w*.51,.015);arch.lineTo(w*.51,h);arch.lineTo(-w*.51,h);arch.closePath();
      for(let i=0;i<count;i++){
        const a=i*2*Math.PI/count;
        cut(new THREE.ExtrudeGeometry(arch,{depth:.034,bevelEnabled:false,curveSegments:6}),ivory,r*Math.sin(a),y,r*Math.cos(a),a);
      }
      drum(r*1.055,r*1.025,.035,edge,0,y+h+.012,0);
    }
    for(let j=0;j<6;j++)arcade(.39+j*.185,.46,.153,24);
    arcade(1.53,.335,.245,12);
    drum(.36,.37,.04,ivory,0,1.817,0);
  }else throw new Error('Unknown landmark '+id);
  const model=new THREE.Group();
  for(const [colour,parts] of batches){
    const mesh=new THREE.Mesh(mergeGeometries(parts),new THREE.MeshStandardMaterial({color:colour,roughness:.94,side:THREE.DoubleSide}));
    model.add(mesh);parts.forEach(part=>part.dispose());
  }
  return model;
}
