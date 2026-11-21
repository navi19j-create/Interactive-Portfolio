import * as THREE from 'three';
import {makeStepwell} from './gallery-miniatures.js';
import {makeSundial} from './samrat-yantra.js';
import {makeLandmark} from './landmark-models.js';

export function makeArt(id){
  const group=new THREE.Group();
  const piece=id==='rani-ki-vav' ? makeStepwell() : id==='samrat-yantra' ? makeSundial() : makeLandmark(id);
  const bounds=new THREE.Box3().setFromObject(piece,true);
  const center=bounds.getCenter(new THREE.Vector3());
  piece.position.set(-center.x,-bounds.min.y,-center.z);
  group.add(piece);
  group.traverse(part=>{if(part.isMesh){part.userData.exhibit=id;part.castShadow=true;part.receiveShadow=true;}});
  return group;
}
