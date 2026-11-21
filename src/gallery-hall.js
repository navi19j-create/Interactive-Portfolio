import * as THREE from 'three';
import {makeArt} from './gallery-art.js';
import {artLabels} from './gallery-collection.js';
import {wall,wallMount,islands,plinths,lap,crossing,threshold} from './twin-layout.js';

function routeFloor(){
  const canvas=document.createElement('canvas');canvas.width=2112;canvas.height=1152;
  const ctx=canvas.getContext('2d'),scale=48;
  ctx.fillStyle='#c4b39a';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.scale(scale,scale);ctx.translate(22,24+threshold);ctx.scale(1,-1);
  ctx.lineWidth=.018;ctx.strokeStyle='#b6a68d';
  for(let z=threshold;z<threshold+24;z+=2){
    ctx.beginPath();ctx.moveTo(-22,z);ctx.lineTo(22,z);ctx.stroke();
    for(let x=-22+((z-threshold)%4?2:0);x<22;x+=4){
      ctx.beginPath();ctx.moveTo(x,z);ctx.lineTo(x,z+2);ctx.stroke();
    }
  }
  ctx.lineJoin='round';
  const points=lap.getPoints(48);
  ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();
  ctx.lineWidth=.125;ctx.strokeStyle='#8f7253';ctx.stroke();
  ctx.lineWidth=.043;ctx.strokeStyle='#ecdab1';ctx.stroke();
  ctx.beginPath();ctx.moveTo(0,threshold);ctx.lineTo(0,crossing.y);
  ctx.setLineDash([.34,.24]);ctx.strokeStyle='#8f7253';ctx.lineWidth=.07;ctx.stroke();
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
  return texture;
}

export function addTwinGalleries(scene,grain,meshes){
  const card=color=>new THREE.MeshStandardMaterial({color,map:grain,roughness:.95,side:THREE.DoubleSide});
  const cream=card(0xe3d3ba),kraft=card(0xad8965),trim=card(0x896e51),plinth=card(0xf1e0c4);
  const accents=[card(0x45675f),card(0x845746)];
  const sky=new THREE.MeshBasicMaterial({color:0xd4e6e8,side:THREE.DoubleSide});
  function place(geometry,material,x=0,y=0,z=0){
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.receiveShadow=true;
    scene.add(mesh);meshes.push(mesh);return mesh;
  }
  function box(w,h,d,mat,x,y,z,yaw=0){
    const part=place(new THREE.BoxGeometry(w,h,d),mat,x,y,z);part.rotation.y=yaw;return part;
  }
  function disc(r,h,mat,x,y,z){
    return place(new THREE.CylinderGeometry(r,r,h,80),mat,x,y,z);
  }
  function sign(text,x,y,z,width,yaw,bg='#e9decb',fg='#373b34'){
    const c=document.createElement('canvas');c.width=1024;c.height=144;
    const g=c.getContext('2d');g.fillStyle=bg;g.fillRect(0,0,c.width,c.height);
    g.fillStyle=fg;g.textAlign='center';g.textBaseline='middle';g.font='76px Georgia';g.fillText(text,512,74,970);
    const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
    const part=place(new THREE.PlaneGeometry(width,width*144/1024),new THREE.MeshBasicMaterial({map,toneMapped:false}),x,y,z);
    part.rotation.y=yaw;return part;
  }
  const polygon=new THREE.Shape(wall.map(p=>new THREE.Vector2(p.x,-p.y)));
  const floor=new THREE.ShapeGeometry(polygon);
  const pos=floor.attributes.position,uv=floor.attributes.uv;
  for(let i=0;i<pos.count;i++)uv.setXY(i,(pos.getX(i)+22)/44,(-pos.getY(i)-threshold)/24);
  const walkingFloor=place(floor,new THREE.MeshStandardMaterial({map:routeFloor(),roughness:1}));
  walkingFloor.rotation.x=-Math.PI/2;
  walkingFloor.userData.walkable=true;
  walkingFloor.receiveShadow=false;
  for(const island of islands){
    const aperture=new THREE.Path();
    aperture.absarc(island.x,-island.z,3.54,0,Math.PI*2,true);polygon.holes.push(aperture);
  }
  place(new THREE.ShapeGeometry(polygon,48),cream,0,5.6,0).rotation.x=-Math.PI/2;
  // Continuous wall ribbons use the same perimeter as the collision boundary.
  function ribbon(y,h,mat){
    const xyz=[],uvs=[],indices=[];let run=0;
    wall.forEach((p,i)=>{
      if(i)run+=p.distanceTo(wall[i-1]);
      xyz.push(p.x,y,p.y,p.x,y+h,p.y);uvs.push(run/3,0,run/3,h/3);
      if(i){const n=2*i;indices.push(n-2,n,n-1,n,n+1,n-1);}
    });
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geo.setIndex(indices);geo.computeVertexNormals();place(geo,mat);
  }
  ribbon(0,.22,kraft);ribbon(.22,3.38,cream);ribbon(3.60,.15,trim);
  ribbon(3.75,1.42,sky);ribbon(5.17,.43,cream);
  for(let i=0;i<=64;i++){
    const p=wallMount(i/64,.045);
    box(.085,1.43,.095,trim,p.x,4.46,p.z,p.yaw);
  }
  for(const [i,island] of islands.entries()){
    const {x,z,title}=island;
    disc(3.60,.06,sky,x,5.73,z);
    const collar=place(new THREE.CylinderGeometry(3.54,3.54,.16,80,1,true),trim,x,5.65,z);
    collar.receiveShadow=false;
    for(let k=0;k<12;k++){
      const a=k*Math.PI/6,length=4.65,d=3.55+length/2;
      box(.095,.16,length,kraft,x+d*Math.sin(a),5.51,z+d*Math.cos(a),a);
    }
    for(const shift of [-2.4,-1.2,0,1.2,2.4]){
      box(.055,.09,2*Math.sqrt(3.54**2-shift**2),kraft,x+shift,5.61,z);
    }
    const light=new THREE.PointLight(i?0xffe4c6:0xffefd6,110,18,2);
    light.position.set(x,5.18,z);scene.add(light);
    // A large room name on the far wall reads from the entrance.
    sign(title,x,3.12,threshold+23.91,4.1,Math.PI,i?'#76513f':'#415c54','#f5e8cf');
  }
  for(const stand of plinths){
    const {id,r,h,x,z}=stand;
    const skirt=disc(r+.08,.12,kraft,x,.06,z);skirt.userData.exhibit=id;
    disc(r-.025,.20,accents[stand.wing],x,.22,z).userData.exhibit=id;
    const base=disc(r,h,plinth,x,.32+h/2,z);base.castShadow=true;base.userData.exhibit=id;
    const foot=disc(r+.012,.07,accents[stand.wing],x,.355,z);foot.userData.exhibit=id;
    const art=makeArt(id);art.scale.setScalar(stand.scale);art.position.set(x,.32+h,z);art.rotation.y=stand.yaw;
    scene.add(art);art.traverse(part=>{if(part.isMesh)meshes.push(part);});
    const face=Math.atan2(stand.dx,stand.dz);
    sign(artLabels[id].title,x+(r+.02)*Math.sin(face),.32+h*.54,z+(r+.02)*Math.cos(face),Math.min(1.52,r*1.39),face).userData.exhibit=id;
  }
}
