import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const clay=color=>new THREE.MeshStandardMaterial({color,roughness:.93});
function textureFrom(canvas){
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=4;
  return texture;
}
function block(group,material,x,y,z,w,h,d){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
  mesh.position.set(x,y,z);group.add(mesh);
  return mesh;
}
// Batch the stonework of each independently moving section.
function batch(group){
  const buckets=new Map();
  for(const part of group.children){
    part.updateMatrix();
    const geo=part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    geo.applyMatrix4(part.matrix);
    if(!buckets.has(part.material))buckets.set(part.material,[]);
    buckets.get(part.material).push(geo);
  }
  group.clear();
  for(const [mat,pieces] of buckets)group.add(new THREE.Mesh(mergeGeometries(pieces),mat));
}
function nicheMaterial(){
  const c=document.createElement('canvas');c.width=256;c.height=128;
  const g=c.getContext('2d');
  g.fillStyle='#c49871';g.fillRect(0,0,256,128);
  for(let i=0;i<5;i++){
    g.save();g.translate(26+i*51,0);
    g.fillStyle='#8a6049';g.beginPath();g.moveTo(-19,111);g.lineTo(-19,51);
    g.quadraticCurveTo(-17,40,-9,36);g.quadraticCurveTo(-9,28,0,23);
    g.quadraticCurveTo(9,28,9,36);g.quadraticCurveTo(17,40,19,51);g.lineTo(19,111);g.fill();
    g.fillStyle='#e5ba8a';g.beginPath();g.arc(0,53,6,0,2*Math.PI);g.fill();
    g.beginPath();g.moveTo(0,59);g.quadraticCurveTo(12,70,6,83);g.lineTo(10,99);
    g.lineTo(-9,99);g.lineTo(-4,78);g.quadraticCurveTo(-15,64,0,59);g.fill();
    g.fillRect(-20,110,40,4);g.restore();
  }
  return new THREE.MeshStandardMaterial({map:textureFrom(c),roughness:1});
}

function sandstoneGrain(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(128,128);
  let seed=72;
  for(let i=0;i<pixels.data.length;i+=4){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const x=i/4%128,y=Math.floor(i/512);
    const grain=237+(seed>>>28)+3*Math.sin((y+1.8*Math.sin(x*.098))*Math.PI/16);
    pixels.data.set([grain,grain-1,grain-3,255],i);
  }
  ctx.putImageData(pixels,0,0);return textureFrom(canvas);
}

// The recessed panels and corbels on the pavilion catch grazing light as it rotates.
function decoratePavilion(group,stone,trim,shade){
  const crestY=1.445,z=-1.04;
  block(group,stone,0,crestY,z,2.38,.21,.19);
  block(group,trim,0,crestY+.117,z,2.45,.028,.22);
  for(const end of [-1,1]){
    block(group,stone,end*.866,crestY+.147,z,.584,.036,.181);
    block(group,trim,end*.866,crestY+.174,z,.615,.023,.206);
  }
  const surround=new THREE.Shape();
  surround.moveTo(-.125,0);surround.lineTo(-.125,.166);surround.lineTo(.125,.166);
  surround.lineTo(.125,0);surround.lineTo(.087,0);surround.lineTo(.087,.074);
  surround.quadraticCurveTo(.074,.077,.066,.101);surround.quadraticCurveTo(.027,.101,0,.140);
  surround.quadraticCurveTo(-.027,.101,-.066,.101);surround.quadraticCurveTo(-.074,.077,-.087,.074);
  surround.lineTo(-.087,0);surround.closePath();
  const archStone=new THREE.ExtrudeGeometry(surround,{depth:.021,bevelEnabled:false,curveSegments:6});
  const petal=new THREE.SphereGeometry(1,10,7);
  for(let bay=0;bay<8;bay++){
    const x=(bay-3.5)*.286,face=z+.095;
    block(group,shade,x,crestY-.005,face+.004,.235,.158,.008);
    const arch=new THREE.Mesh(archStone.clone(),trim);
    arch.position.set(x,crestY-.087,face+.008);group.add(arch);
    for(let i=0;i<6;i++){
      const a=i*Math.PI/3;
      const leaf=new THREE.Mesh(petal.clone(),stone);
      leaf.position.set(x+.026*Math.sin(a),crestY-.013+.026*Math.cos(a),face+.020);
      leaf.scale.set(.012,.030,.009);leaf.rotation.z=-a;group.add(leaf);
    }
    block(group,trim,x,crestY-.087,face+.021,.247,.017,.038);
  }
}
export function makeStepwell(){
  const model=new THREE.Group(),fixed=new THREE.Group(),section=new THREE.Group();
  section.name='CutawayBank';
  const stone=clay(0xc79472),cornice=clay(0xe4b88d),shadow=clay(0x956950);
  const warm=clay(0xc18e6d),pale=clay(0xd0a17c);
  const courses=[stone,pale,stone,warm,stone];
  const grain=sandstoneGrain();
  for(const material of [stone,cornice,shadow,warm,pale])material.map=grain;
  const wallArt=nicheMaterial();
  const pool=document.createElement('canvas');pool.width=pool.height=256;
  const ctx=pool.getContext('2d');
  const wash=ctx.createLinearGradient(0,0,180,256);
  wash.addColorStop(0,'#204849');wash.addColorStop(.58,'#417570');wash.addColorStop(1,'#376568');
  ctx.fillStyle=wash;ctx.fillRect(0,0,256,256);
  for(let n=0;n<280;n++){
    const x=(n*197)%256,y=(n*67+n*n*13)%256;
    ctx.strokeStyle='rgba(193,222,205,.13)';ctx.beginPath();ctx.moveTo(x,y);
    ctx.quadraticCurveTo(x+4,y-1.8,x+8+n%13,y);ctx.stroke();
  }
  const water=new THREE.MeshStandardMaterial({map:textureFrom(pool),roughness:.36});
  block(fixed,shadow,0,.045,0,2.66,.09,2.62);
  block(fixed,water,0,.102,-.03,.95,.034,1.42);
  // A threshold at the open end gives the eye an uninterrupted descent into the tank.
  for(let row=0;row<9;row++){
    const z=1.217-row*.068,h=.048+(8-row)*.040;
    for(let slab=0;slab<3;slab++)
      block(fixed,courses[(row+slab)%5],(slab-1)*.301,.09+h/2,z,.299,h,.0675);
  }
  for(const side of [-1,1]){
    const bank=side===1 ? section : fixed;
    for(let tier=0;tier<3;tier++){
      const x=side*(.59+tier*.274),rise=(tier+1)*.28;
      // Stair flights alternate with flat landings down to the water.
      for(let j=0;j<18;j++){
        const lift=(j-Math.floor(j/6))*.012;
        const h=rise+lift, z=1.175-j*.132;
        if((j>=2 && j<=4) || (j>=10 && j<=12)){
          // Cross-flights link adjacent terraces and the lowest flight meets the pool.
          for(let step=0;step<6;step++){
            const tread=h-(5-step)*.28/6;
            const treadX=x+side*(step-2.5)*.273/6;
            block(bank,courses[(tier+j+step)%5],treadX,.09+tread/2,z,.273/6,tread,.132);
          }
        }else{
          block(bank,courses[(j+tier)%5],x,.09+h/2,z,.273,h,.132);
        }
      }
    }
    block(bank,stone,side*1.265,.60,0,.13,1.02,2.48);
    for(let bay=0;bay<9;bay++){
      const z=(bay-4)*.282;
      block(bank,bay%3===1?pale:cornice,side*1.265,1.135,z,.175,.052,.279);
      block(bank,pale,side*1.185,1.021,z-.12,.042,.175,.043);
    }
    for(const z of [-.79,-.20,.39,.98]){
      const plaque=new THREE.Mesh(new THREE.PlaneGeometry(.46,.20),wallArt);
      plaque.position.set(side*1.197,.998,z);plaque.rotation.y=-side*Math.PI/2;bank.add(plaque);
    }
  }
  // Three recessed colonnades across the far end. Taller bays stay open between pillars.
  block(fixed,shadow,0,.72,-1.23,2.50,1.26,.11);
  for(let level=0;level<3;level++){
    const y=.09+level*.416,z=-.66-level*.13;
    block(fixed,stone,0,y+.037,z-.12,2.39,.074,.48);
    for(let col=0;col<7;col++){
      const x=(col-3)*.355;
      block(fixed,cornice,x,y+.100,z+.068,.128,.052,.128);
      const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.043,.055,.204,8),stone);
      shaft.position.set(x,y+.227,z+.068);fixed.add(shaft);
      block(fixed,pale,x,y+.305,z+.068,.104,.028,.104);
      block(fixed,cornice,x,y+.17,z+.068,.093,.017,.093);
      block(fixed,cornice,x,y+.347,z+.068,.119,.038,.119);
      block(fixed,stone,x,y+.382,z+.068,.169,.033,.146);
      for(const side of [-1,1]){
        const corbel=block(fixed,pale,x+side*.067,y+.365,z+.068,.091,.034,.087);
        corbel.rotation.z=side*.41;
      }
    }
    block(fixed,cornice,0,y+.41,z-.112,2.46,.049,.51);
    for(let i=0;i<24;i++)
      block(fixed,stone,(i-11.5)*.097,y+.37,z+.126,.048,.032,.023);
    const frieze=new THREE.Mesh(new THREE.PlaneGeometry(2.04,.205),wallArt);
    frieze.position.set(0,y+.23,-1.171);fixed.add(frieze);
  }
  decoratePavilion(fixed,stone,cornice,shadow);
  batch(fixed);batch(section);model.add(fixed,section);
  return model;
}

function rosePattern(){
  const c=document.createElement('canvas');c.width=c.height=1024;
  const g=c.getContext('2d');g.translate(512,512);g.scale(500,500);
  const lead='#261f29',blue=['#2747ad','#315cd1','#263685'],red=['#af233e','#db374b','#8e233c'];
  function pane(path,palette,seed){
    g.save();g.clip(path);g.fillStyle=palette[0];g.fillRect(-1,-1,2,2);
    let state=seed;
    const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
    for(let i=0;i<380;i++){
      const x=(random()-.5)*.65,y=random(),r=.018+random()*.09;
      g.fillStyle=palette[i%palette.length];g.beginPath();g.moveTo(x,y);
      g.lineTo(x+r,y+r*.24);g.lineTo(x+r*.31,y+r*.87);g.fill();
    }
    g.restore();g.strokeStyle=lead;g.lineWidth=.014;g.stroke(path);
  }
  g.fillStyle=lead;g.beginPath();g.arc(0,0,.995,0,Math.PI*2);g.fill();
  const leaf=new Path2D();leaf.moveTo(0,.211);leaf.bezierCurveTo(-.069,.263,-.177,.655,-.084,.73);
  leaf.quadraticCurveTo(0,.829,.084,.73);leaf.bezierCurveTo(.177,.655,.069,.263,0,.211);leaf.closePath();
  const outer=new Path2D();outer.moveTo(0,.691);outer.bezierCurveTo(-.044,.724,-.145,.775,-.116,.845);
  outer.quadraticCurveTo(-.093,.889,-.053,.865);outer.bezierCurveTo(-.109,.994,.109,.994,.053,.865);
  outer.quadraticCurveTo(.095,.889,.116,.845);outer.bezierCurveTo(.145,.775,.044,.724,0,.691);outer.closePath();
  const bud=new Path2D();bud.ellipse(0,.138,.036,.061,0,0,2*Math.PI);
  for(let i=0;i<16;i++){
    g.save();g.rotate(i*Math.PI/8);pane(leaf,i%2?red:blue,21+i);
    const tip=new Path2D();tip.moveTo(0,.795);tip.quadraticCurveTo(-.122,.901,-.104,.96);
    tip.quadraticCurveTo(0,.998,.104,.96);tip.quadraticCurveTo(.122,.901,0,.795);
    pane(tip,i%2?blue:red,124+i);g.rotate(Math.PI/16);
    pane(outer,i%2?blue:red,74+i);g.restore();
  }
  for(let i=0;i<8;i++){g.save();g.rotate(i*Math.PI/4);pane(bud,i%2?blue:red,54+i);g.restore();}
  g.fillStyle='#d64548';g.beginPath();g.arc(0,0,.065,0,2*Math.PI);g.fill();
  return c;
}
export function makeRoseWindow(){
  const group=new THREE.Group(),rose=rosePattern();
  const glass=new THREE.MeshBasicMaterial({map:textureFrom(rose),side:THREE.DoubleSide});
  const frame=clay(0x40353a),brass=clay(0xad8552);
  const radius=.86,cy=.985;
  const glassDisc=new THREE.Mesh(new THREE.CircleGeometry(radius,128),glass);
  glassDisc.position.y=cy;group.add(glassDisc);
  for(const [r,tube] of [[radius,.031],[radius*.219,.012]]){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(r,tube,8,128),frame);
    ring.position.y=cy;group.add(ring);
  }
  for(const x of [-.51,.51]){
    block(group,frame,x,.14,0,.065,.28,.083);
    block(group,brass,x,.024,0,.19,.048,.29);
  }
  return group;
}

// Project each coloured pane onto the inspection floor along the movable light ray.
export function makeRoseProjection(){
  const c=rosePattern(),ctx=c.getContext('2d');
  const image=ctx.getImageData(0,0,c.width,c.height);
  for(let i=0;i<image.data.length;i+=4){
    const range=Math.max(image.data[i],image.data[i+1],image.data[i+2])-Math.min(image.data[i],image.data[i+1],image.data[i+2]);
    image.data[i+3]=range>37 ? Math.min(210,range*1.55) : 0;
  }
  ctx.putImageData(image,0,0);
  const soft=document.createElement('canvas');soft.width=soft.height=c.width;
  const glow=soft.getContext('2d');glow.filter='blur(9px)';glow.drawImage(c,0,0);
  const mat=new THREE.MeshBasicMaterial({map:textureFrom(soft),transparent:true,opacity:.74,depthWrite:false,side:THREE.DoubleSide});
  const projection=new THREE.Mesh(new THREE.PlaneGeometry(1.72,1.72),mat);
  projection.matrixAutoUpdate=false;
  return projection;
}
export function positionRoseProjection(projection,fraction){
  const dx=(fraction-.5)*1.85,dz=.72;
  projection.matrix.set(1,dx,0,.985*dx, 0,0,1,.003, 0,dz,0,.985*dz, 0,0,0,1);
  projection.matrixWorldNeedsUpdate=true;
}
