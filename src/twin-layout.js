import {Path,Vector2} from 'three';

// Coordinates are metres. The entrance faces +Z, so the left wing is at +X.
export const threshold=6.34, crossing=new Vector2(0,threshold+11.7);
export const islands=[
  {x:10.8,z:threshold+12.1,r:3.8,title:'India'},
  {x:-10.9,z:threshold+12.1,r:3.8,title:'Mediterranean'}
];
export const stands=[
  {id:'samrat-yantra',wing:0,dx:-4,dz:-3.4,r:1.40,h:.85,yaw:-1.7,scale:.84},
  {id:'rani-ki-vav',wing:0,dx:4.7,dz:.9,r:1.48,h:.74,yaw:2.92,scale:.76},
  {id:'sanchi',wing:0,dx:-.75,dz:5.05,r:1.25,h:.78,yaw:.12,scale:1.15},
  {id:'pantheon',wing:1,dx:4.7,dz:-1.9,r:1.62,h:.55,yaw:1.85,scale:1.18},
  {id:'parthenon',wing:1,dx:-4.3,dz:1.2,r:1.51,h:.70,yaw:-2.45,scale:1.14},
  {id:'pisa',wing:1,dx:-.9,dz:5,r:1.28,h:.8,yaw:.28,scale:1.16}
];
export const plinths=stands.map(stand=>({...stand,x:islands[stand.wing].x+stand.dx,z:islands[stand.wing].z+stand.dz}));

const perimeter=new Path();
perimeter.moveTo(1.45,threshold);perimeter.lineTo(13.2,threshold);
perimeter.quadraticCurveTo(22,threshold,22,threshold+8.9);
perimeter.lineTo(22,threshold+15.1);
perimeter.quadraticCurveTo(22,threshold+24,13.2,threshold+24);
perimeter.lineTo(9.2,threshold+24);
perimeter.quadraticCurveTo(5.4,threshold+24,3,threshold+20.9);
perimeter.quadraticCurveTo(0,threshold+17.5,-3,threshold+20.9);
perimeter.quadraticCurveTo(-5.4,threshold+24,-9.2,threshold+24);
perimeter.lineTo(-13.2,threshold+24);
perimeter.quadraticCurveTo(-22,threshold+24,-22,threshold+15.1);
perimeter.lineTo(-22,threshold+8.9);
perimeter.quadraticCurveTo(-22,threshold,-13.2,threshold);
perimeter.lineTo(1.45,threshold);
export const wall=perimeter.getPoints(18);
export function wallMount(fraction,inset){
  const p=perimeter.getPointAt(fraction),t=perimeter.getTangentAt(fraction);
  const inward=new Vector2(-t.y,t.x);
  p.addScaledVector(inward,inset);
  return {x:p.x,z:p.y,nx:inward.x,nz:inward.y,yaw:Math.atan2(inward.x,inward.y)};
}

export const lap=new Path();
const z=y=>threshold+(266-y)/10;
lap.moveTo(0,z(149));
lap.bezierCurveTo(5.3,z(65),7.4,z(62),10.8,z(62));
lap.bezierCurveTo(21,z(62),21,z(228),10.8,z(228));
lap.bezierCurveTo(6.7,z(228),4.7,z(211),0,z(149));
lap.bezierCurveTo(-4.7,z(87),-6.7,z(62),-10.9,z(62));
lap.bezierCurveTo(-21.1,z(62),-21.1,z(228),-10.9,z(228));
lap.bezierCurveTo(-7,z(228),-4.9,z(216),0,z(149));

export function galleryBlocks(x,z,clearance){
  if(z<threshold+clearance)return true;
  if(plinths.some(p=>Math.hypot(x-p.x,z-p.z)<p.r+.08+clearance))return true;
  let inside=false;
  for(let i=0;i<wall.length-1;i++){
    const a=wall[i],b=wall[i+1],dx=b.x-a.x,dz=b.y-a.y;
    if((a.y>z)!==(b.y>z) && x<a.x+(z-a.y)*dx/dz)inside=!inside;
    const along=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.y)*dz)/(dx*dx+dz*dz)));
    if(Math.hypot(x-a.x-along*dx,z-a.y-along*dz)<clearance+.14)return true;
  }
  return !inside;
}

// For an obstructed floor click, route via the existing figure eight. Every
// connector and chord is checked against the same clearance used by walking.
const waypoints=lap.getSpacedPoints(72).slice(0,-1).map(p=>p.toArray());
export function floorRoute(x,z,goalX,goalZ){
  const start=[x,z],goal=[goalX,goalZ];
  const length=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
  function clear(a,b){
    const samples=Math.max(1,Math.ceil(length(a,b)/.12));
    for(let i=1;i<=samples;i++){
      const t=i/samples;
      if(galleryBlocks(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,.25))return false;
    }
    return true;
  }
  if(galleryBlocks(goalX,goalZ,.25))return [];
  if(clear(start,goal))return [goal];
  function connection(point){
    return waypoints.map((p,i)=>({i,d:length(point,p)})).sort((a,b)=>a.d-b.d)
      .find(({i})=>clear(point,waypoints[i]))?.i;
  }
  const first=connection(start),last=connection(goal);
  if(first===undefined||last===undefined)return [];
  const n=waypoints.length;
  const step=(last-first+n)%n<=n/2?1:-1;
  const route=[waypoints[first]];
  for(let i=first;i!==last;){
    const next=(i+step+n)%n;
    if(!clear(waypoints[i],waypoints[next]))return [];
    route.push(waypoints[next]);i=next;
  }
  route.push(goal);
  return route;
}
