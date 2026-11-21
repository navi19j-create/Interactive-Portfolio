import * as THREE from 'three';

function walnutMaterial() {
  const material = new THREE.MeshStandardMaterial({color:0xffffff, roughness:.46});
  // Position-based grain stays continuous across the unwrapped shell and requires no UVs.
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 grainPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\ngrainPosition = position;');
    shader.fragmentShader = 'varying vec3 grainPosition;\n' + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec3 p = grainPosition;
      float bend = 2.1 * sin(p.y * .055) + 1.4 * sin(p.z * .12 + p.y * .025);
      float lines = p.x * 1.35 + bend + .65 * sin(p.y * .17 + p.x * .24);
      float grain = .5 + .5 * sin(lines + .9 * sin(lines * 2.13));
      float fine = .5 + .5 * sin(p.x * 8.4 + bend * 4.);
      diffuseColor.rgb = mix(vec3(.117,.046,.022), vec3(.41,.206,.085), grain * .66 + fine * .16);
    `);
  };
  return material;
}

export function installInspection(model, display, draw) {
  const selector = document.getElementById('inspect-mode');
  const summary = document.getElementById('inspect-summary');
  const original = new Map();
  let triangles = 0;
  model.traverse(part => {
    if (!part.isMesh) return;
    original.set(part,part.material);
    triangles += (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3;
  });
  const shell = [...original.keys()].find(part=>part.name.includes('Enclosure_Base'));
  const looks = {
    walnut:walnutMaterial(),
    graphite:new THREE.MeshStandardMaterial({color:0x343b3e,metalness:.78,roughness:.32}),
    clay:new THREE.MeshStandardMaterial({color:0xcba98d,roughness:.85}),
    wire:new THREE.MeshBasicMaterial({color:0x314434,wireframe:true}),
    normals:new THREE.MeshNormalMaterial()
  };
  const lightInk = new THREE.MeshStandardMaterial({color:0xe2dfd3,roughness:.6});
  const labels = {
    original:'Original ivory housing and colored controls.',
    walnut:'Walnut study · procedural grain on the housing.',
    graphite:'Graphite study · satin metal housing with light lettering.',
    clay:'Clay · one finish reveals bevels, seams, and silhouette.',
    wire:'Wireframe · triangulated browser mesh.',
    normals:'Surface normals · colors show the direction each surface faces.'
  };
  function apply() {
    const mode = selector.value;
    const diagnostic = ['clay','wire','normals'].includes(mode);
    for(const [part,material] of original){
      part.material = diagnostic ? looks[mode] : material;
      if(!diagnostic && mode !== 'original'){
        if(part===shell) part.material=looks[mode];
        else if(mode==='graphite' && (part.name.includes('Vector_') && !part.name.includes('MenuDot') || part.name.includes('Exchange_Arrows'))) part.material=lightInk;
      }
    }
    display.visible=!diagnostic;
    summary.textContent = labels[mode] + (diagnostic ? ' ' + original.size + ' mesh parts · ' + triangles.toLocaleString() + ' triangles.' : '');
    draw();
  }
  selector.disabled=false;selector.addEventListener('change',apply);apply();
}
