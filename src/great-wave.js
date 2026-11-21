import * as THREE from 'three';
import sheets from './great-wave-cuts.json';

const unit=.0027, width=800*unit, height=538*unit;
const spacing=.042;
let atlasPromise;
export function loadWaveInk(){
  atlasPromise ??= new THREE.TextureLoader().loadAsync('media/great-wave-cuts.webp').then(texture=>{
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=4;
    return texture;
  }).catch(error=>{atlasPromise=undefined;throw error;});
  return atlasPromise;
}

export function makeWave(texture){
  const frame=new THREE.Group();
  const sample=document.createElement('canvas');sample.width=256;sample.height=128;
  const context=sample.getContext('2d');
  context.fillStyle='#d4b387';context.fillRect(0,0,256,128);
  for(let i=0;i<1900;i++){
    const x=(i*139+i*i*17)%256,y=(i*71+Math.floor(i/256)*13)%128;
    context.fillStyle=i%3?'#79583022':'#f8e8cd66';
    context.fillRect(x,y,1+i%5,1);
  }
  const grain=new THREE.CanvasTexture(sample);grain.colorSpace=THREE.SRGBColorSpace;
  grain.wrapS=grain.wrapT=THREE.RepeatWrapping;
  const stock=new THREE.MeshStandardMaterial({map:grain,roughness:1});
  const rim=new THREE.MeshStandardMaterial({color:0xa6856a,map:grain,roughness:.96});
  const ink=new THREE.MeshStandardMaterial({map:texture,roughness:.98});
  const thickness=.013;
  function rail(w,h,d,x,y,z,material){
    const part=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
    part.position.set(x,y,z);frame.add(part);
  }
  rail(width+.10,height+.10,.045,0,0,-.032,rim);
  const depth=sheets.length*spacing;
  for(const side of [-1,1]){
    rail(.043,height+.086,depth,side*(width+.043)/2,0,depth/2-.02,rim);
    rail(width,.043,depth,0,side*(height+.043)/2,depth/2-.02,rim);
    rail(.008,height+.07,.004,side*(width+.025)/2,0,depth-.018,stock);
    rail(width,.008,.004,0,side*(height+.025)/2,depth-.018,stock);
  }
  for(const [index,sheet] of sheets.entries()){
    const layer=new THREE.Group();
    layer.name=sheet.name;
    layer.userData.sheetIndex=index;
    layer.position.z=index*spacing;
    frame.add(layer);
    for(const cut of sheet.cuts){
      const points=cut.map(([x,y])=>new THREE.Vector2((x-400)*unit,(269-y)*unit));
      const shape=new THREE.Shape(points);
      // Colour the actual front cap, so the paper and its ink share a single surface.
      const surface=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false});
      const [caps,sides]=surface.groups;
      const capCount=caps.count/2;
      const positions=surface.attributes.position,uv=surface.attributes.uv;
      for(let j=capCount;j<caps.count;j++){
        const u=positions.getX(j)/width+.5,v=positions.getY(j)/height+.5;
        uv.setXY(j,(index%3+u)/3,(1-Math.floor(index/3)+v)/2);
      }
      surface.clearGroups();
      surface.addGroup(0,capCount,0);
      surface.addGroup(capCount,capCount,1);
      surface.addGroup(sides.start,sides.count,0);
      layer.add(new THREE.Mesh(surface,[stock,ink]));
    }
  }
  return frame;
}

export function spreadWave(model,fraction){
  model.traverse(part=>{
    const index=part.userData.sheetIndex;
    if(index!==undefined) part.position.z=index*(spacing+.26*fraction);
  });
}
