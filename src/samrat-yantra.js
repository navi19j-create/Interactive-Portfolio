import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const latitude = 27 * Math.PI / 180;
const axis = new THREE.Vector3(0, Math.sin(latitude), -Math.cos(latitude));
const down = new THREE.Vector3(0, -Math.cos(latitude), -Math.sin(latitude));
const east = new THREE.Vector3(1, 0, 0);
const pivot = new THREE.Vector3(0, .69, 0);

// Equinox model. Noon is the lowest point of the equatorial scale.
export function sundialLight(hour) {
  const angle = (hour - 12) * Math.PI / 12;
  return down.clone().multiplyScalar(-Math.cos(angle)).addScaledVector(east, -Math.sin(angle));
}

export function makeSundial() {
  const model = new THREE.Group();
  const paper = color => new THREE.MeshStandardMaterial({color, roughness:.95});
  const ochre = paper(0xc58153), biscuit = paper(0xe0b482), cream = paper(0xffe6b6);
  const edge = paper(0x965e3d), ink = paper(0x453c33);
  function block(parent, w, h, d, material, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
    mesh.position.set(x,y,z);parent.add(mesh);
    return mesh;
  }
  block(model,1.92,.052,2.36,edge,0,.026,0);
  block(model,1.87,.03,2.31,biscuit,0,.067,0);

  // Cut the side elevation in the z/y plane; the top edge is parallel to Earth's axis.
  const slope = Math.tan(latitude);
  const top = z => pivot.y - z * slope;
  const wall = new THREE.Shape();
  wall.moveTo(-1.07,.082);wall.lineTo(1.07,.082);
  wall.lineTo(1.07,top(1.07));wall.lineTo(-1.07,top(-1.07));wall.closePath();
  for (const [z,r] of [[-.83,.12],[-.49,.12],[-.15,.105],[.18,.09]]) {
    const arch = new THREE.Path();
    arch.moveTo(z-r,.11);arch.lineTo(z-r,.15+r);
    arch.absarc(z,.15+r,r,Math.PI,0,true);arch.lineTo(z+r,.11);arch.closePath();
    wall.holes.push(arch);
  }
  const masonry = new THREE.Mesh(new THREE.ExtrudeGeometry(wall,{depth:.12,bevelEnabled:false}),ochre);
  masonry.rotation.y=-Math.PI/2;masonry.position.x=.06;model.add(masonry);
  // Recessed stair flight between the straight sighting edges.
  for (let i=0;i<24;i++) {
    const z=1.07-(i+.5)*2.14/24;
    block(model,.105,.047,2.14/24,cream,0,top(z)+.016,z);
  }
  for (const x of [-.074,.074]) {
    const rail=block(model,.022,.047,2.14/Math.cos(latitude),biscuit,x,pivot.y+.041,0);
    rail.rotation.x=latitude;
  }

  // The stair terminates under an open chhatri. Its landing spans the gnomon wall.
  const summitZ=-1.012, landingY=top(summitZ)+.043;
  block(model,.245,.046,.226,biscuit,0,landingY-.009,summitZ);
  block(model,.262,.014,.241,cream,0,landingY+.018,summitZ);
  for(const x of [-.091,.091])for(const dz of [-.082,.082]){
    const z=summitZ+dz;
    block(model,.042,.024,.042,biscuit,x,landingY+.037,z);
    const column=new THREE.Mesh(new THREE.CylinderGeometry(.014,.017,.128,8),cream);
    column.position.set(x,landingY+.113,z);model.add(column);
    block(model,.044,.022,.044,biscuit,x,landingY+.187,z);
  }
  const arch=new THREE.Shape();
  arch.moveTo(-1,0);arch.quadraticCurveTo(-.75,.02,-.67,.37);
  arch.quadraticCurveTo(-.29,.33,0,.88);arch.quadraticCurveTo(.29,.33,.67,.37);
  arch.quadraticCurveTo(.75,.02,1,0);arch.lineTo(1,1);arch.lineTo(-1,1);arch.closePath();
  const spandrel=new THREE.ExtrudeGeometry(arch,{depth:1,bevelEnabled:false,curveSegments:8});
  for(const sign of [-1,1]){
    const front=new THREE.Mesh(spandrel,biscuit);
    front.scale.set(.091,.042,.018);front.position.set(0,landingY+.165,summitZ+sign*.082-.009);model.add(front);
    const side=new THREE.Mesh(spandrel,biscuit);
    side.scale.set(.082,.042,.018);side.rotation.y=Math.PI/2;
    side.position.set(sign*.091-.009,landingY+.165,summitZ);model.add(side);
  }
  block(model,.277,.021,.264,ochre,0,landingY+.216,summitZ);
  block(model,.285,.012,.272,cream,0,landingY+.232,summitZ);
  // A shallow drum, bell-shaped dome, and turned finial share a continuous profile.
  const roofProfile=[[.108,0],[.108,.017],[.118,.022],[.118,.031],[.11,.036],
    [.106,.055],[.093,.076],[.073,.094],[.049,.11],[.02,.126],
    [.013,.134],[.021,.138],[.021,.146],[.011,.151],[.013,.159],[.004,.173],[0,.182]];
  const roof=new THREE.Mesh(new THREE.LatheGeometry(roofProfile.map(([r,h])=>new THREE.Vector2(r,h)),32),biscuit);
  roof.position.set(0,landingY+.238,summitZ);model.add(roof);

  // Paired ivory measuring faces run around the polar axis, with a tick every quarter hour.
  const radius=.62, width=.20;
  for (const side of [-1,1]) {
    const scale = new THREE.Group();
    scale.position.copy(pivot);
    scale.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east,down.clone().negate(),axis.clone().negate()));
    model.add(scale);
    const start=side===1 ? -Math.PI/2+.13 : -Math.PI+.04;
    const end=side===1 ? -.04 : -Math.PI/2-.13;
    const band=(inner,outer,depth,material)=>{
      const shape=new THREE.Shape();
      shape.absarc(0,0,outer,start,end,false);
      shape.absarc(0,0,inner,end,start,true);shape.closePath();
      const strip=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:48}),material);
      strip.position.z=-depth/2;scale.add(strip);
    };
    band(radius+.013,radius+.078,width+.035,ochre);
    band(radius,radius+.013,width,cream);
    for (let quarter=1;quarter<24;quarter++) {
      const a=-Math.PI/2+side*quarter*Math.PI/48;
      if(a<start || a>end)continue;
      const major=quarter%4===0;
      const tick=block(scale,major?.009:.004,.002,major?width*.83:width*.31,ink,
        (radius-.001)*Math.cos(a),(radius-.001)*Math.sin(a),major?0:width*.25);
      tick.rotation.z=a-Math.PI/2;
    }
    for (const degree of [34,60,85]) {
      const a=degree*Math.PI/180, x=side*(radius+.045)*Math.sin(a);
      const base=pivot.clone().addScaledVector(down,(radius+.045)*Math.cos(a));
      const h=base.y-.082;
      if(h>0)block(model,.055,h,.16,biscuit,x,.082+h/2,base.z);
    }
  }
  // All parts are fixed to the plinth. Batch small steps and ticks by paper stock.
  model.updateMatrixWorld(true);
  const batches=new Map();
  model.traverse(part=>{
    if(!part.isMesh)return;
    const geometry=part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    geometry.applyMatrix4(part.matrixWorld);
    if(!batches.has(part.material))batches.set(part.material,[]);
    batches.get(part.material).push(geometry);
  });
  const finished=new THREE.Group();
  for(const [material,geometries] of batches){
    finished.add(new THREE.Mesh(mergeGeometries(geometries),material));
  }
  return finished;
}
