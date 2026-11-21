import * as THREE from 'three';
import { track } from './track.js';

const fieldWidth = 12;
const lampTextureWidth = 2048;
const lampTextureHeight = 64;

function lampTexture(lights) {
  const data = new Uint8Array(lampTextureWidth * lampTextureHeight * 4);
  const stride = track.length / lampTextureWidth;
  for (const { s, side } of lights) {
    const first = Math.floor((s - 18) / stride);
    const last = Math.ceil((s + 18) / stride);
    for (let column = first; column <= last; column++) {
      const along = (column + 0.5) * stride - s;
      const x = THREE.MathUtils.euclideanModulo(column, lampTextureWidth);
      for (let y = 0; y < lampTextureHeight; y++) {
        const across = ((y + 0.5) / lampTextureHeight * 2 - 1) * fieldWidth * side;
        const pool = Math.exp(-((along / 6.6) ** 2) - ((across - 5.8) / 5.6) ** 2);
        const sheen = Math.exp(-((along / 4.5) ** 2) - ((across - 3.0 - along * 0.11) / 2.05) ** 2);
        const index = (y * lampTextureWidth + x) * 4;
        data[index] = Math.min(255, data[index] + Math.round(pool * 250));
        data[index + 1] = Math.min(255, data[index + 1] + Math.round(sheen * 255));
      }
    }
  }
  const texture = new THREE.DataTexture(data, lampTextureWidth, lampTextureHeight);
  texture.wrapS = THREE.RepeatWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function asphaltTexture() {
  const size = 256;
  const cells = 54;
  const data = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  const { clamp, euclideanModulo, smoothstep } = THREE.MathUtils;
  let seed = 92047;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stones = Array.from({ length: cells * cells }, () => ({
    x: 0.2 + random() * 0.6,
    z: 0.2 + random() * 0.6,
    width: 0.22 + random() * 0.40,
    length: 0.23 + random() * 0.39,
    tone: random(),
    height: 0.45 + random() * 0.55,
  }));
  const byte = value => Math.round(clamp(value, 0, 1) * 255);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * cells / size;
      const v = (z + 0.5) * cells / size;
      const column = Math.floor(u);
      const row = Math.floor(v);
      let distance = Infinity;
      let stone;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cell = stones[euclideanModulo(row + dz, cells) * cells + euclideanModulo(column + dx, cells)];
          const d = ((u - column - dx - cell.x) / cell.width) ** 2
            + ((v - row - dz - cell.z) / cell.length) ** 2;
          if (d < distance) {
            distance = d;
            stone = cell;
          }
        }
      }
      const crown = 1 - smoothstep(distance, 0.12, 1);
      const fine = random() - 0.5;
      const i = z * size + x;
      heights[i] = crown * stone.height + fine * 0.06;
      data[i * 4] = byte(0.31 + crown * (0.15 + stone.tone * 0.49) + fine * 0.12);
    }
  }
  // Pack color and surface slopes together so one mipmapped lookup filters both in the distance.
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const i = (z * size + x) * 4;
      const dx = heights[z * size + (x + 1) % size] - heights[z * size + (x + size - 1) % size];
      const dz = heights[(z + 1) % size * size + x] - heights[(z + size - 1) % size * size + x];
      data[i + 1] = byte(0.5 + dx * 0.48);
      data[i + 2] = byte(0.5 + dz * 0.48);
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function wetRoadMaterial(lights, carGlints) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93 });
  const reflections = lampTexture(lights);
  const aggregate = asphaltTexture();
  material.addEventListener('dispose', () => {
    reflections.dispose();
    aggregate.dispose();
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.lampPools = { value: reflections };
    shader.uniforms.asphaltAggregate = { value: aggregate };
    shader.uniforms.carGlints = { value: carGlints };
    shader.vertexShader = `
      attribute vec3 trackCoordinate;
      varying vec3 roadCoord;
      varying vec2 asphaltPosition;
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      roadCoord = trackCoordinate;
      asphaltPosition = position.xz;
    `);
    shader.fragmentShader = `
      uniform sampler2D lampPools;
      uniform sampler2D asphaltAggregate;
      uniform vec3 carGlints[4];
      varying vec3 roadCoord;
      varying vec2 asphaltPosition;
      float wetHash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      float wetNoise(vec2 p) {
        vec2 f = smoothstep(vec2(0.), vec2(1.), fract(p));
        vec2 c = floor(p);
        return mix(mix(wetHash(c), wetHash(c + vec2(1, 0)), f.x),
          mix(wetHash(c + vec2(0, 1)), wetHash(c + 1.), f.x), f.y);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec2 lampUV = vec2(roadCoord.x / ${track.length.toFixed(5)}, roadCoord.y / ${2 * fieldWidth}. + 0.5);
      vec2 pools = texture2D(lampPools, lampUV).rg;
      vec3 grit = texture2D(asphaltAggregate, asphaltPosition / 4.8).rgb;
      float coarse = wetNoise(asphaltPosition * 0.38);
      float wear = wetNoise(asphaltPosition * 1.26 + vec2(21.2, -6.8));
      float shoulder = smoothstep(${(track.width / 2 - 1.25).toFixed(2)}, ${(track.width / 2).toFixed(2)}, abs(roadCoord.y));
      float tireLane = 1. - smoothstep(0.15, 0.9, abs(abs(roadCoord.y) - 1.35));
      float variation = 0.89 + coarse * 0.19 + wear * 0.12 + shoulder * 0.065 - tireLane * wear * 0.09;
      float asphalt = roadCoord.z;
      diffuseColor.rgb *= mix(0.84, variation * (0.65 + grit.r * 0.83), asphalt);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      float damp = pools.g * (0.53 + 0.47 * wear) * asphalt;
      roughnessFactor -= damp * 0.16;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      vec2 slopes = grit.gb * 2. - 1.;
      vec3 relief = mat3(viewMatrix) * vec3(-slopes.x, 0., -slopes.y);
      normal = normalize(normal + relief * (asphalt * 0.29));
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      float pool = pools.r * mix(0.012, 0.012 + wear * 0.007, asphalt);
      float grazing = 1. - clamp(dot(nonPerturbedNormal, normalize(vViewPosition)), 0., 1.);
      float sheen = damp * (0.018 + grazing * 0.020) * (0.82 + grit.r * 0.40);
      totalEmissiveRadiance += vec3(0.56, 0.77, 1.) * (pool + sheen);
      float brakes = 0.;
      for (int i = 0; i < 4; i++) {
        float along = mod(roadCoord.x - carGlints[i].x + ${track.length * 0.5}, ${track.length}) - ${track.length * 0.5};
        float across = abs(roadCoord.y - carGlints[i].y);
        float width = mix(0.21, 0.37, smoothstep(1.2, 3.75, -along));
        float tail = 1. - smoothstep(0.065, width, abs(across - 0.70));
        float trail = smoothstep(-3.75, -2.25, along) * (1. - smoothstep(-1.55, -1.15, along));
        brakes += tail * trail * carGlints[i].z;
      }
      totalEmissiveRadiance += vec3(0.15, 0.022, 0.014) * brakes * asphalt * (0.32 + wear * 0.33);
    `);
  };
  return material;
}

function lampHaze(lights) {
  const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(2, 2));
  geometry.instanceCount = lights.length;
  for (const key of ['head', 'target']) {
    const points = lights.flatMap(light => light[key].toArray());
    geometry.setAttribute(key, new THREE.InstancedBufferAttribute(new Float32Array(points), 3));
  }
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 head;
      attribute vec3 target;
      varying vec2 beamUV;
      varying float distanceFade;
      void main() {
        vec3 a = (viewMatrix * vec4(head, 1.)).xyz;
        vec3 b = (viewMatrix * vec4(target, 1.)).xyz;
        float t = mix(-0.16, 1., uv.y);
        vec2 axis = b.xy - a.xy;
        vec2 crossAxis = normalize(vec2(-axis.y, axis.x) + vec2(0.0001));
        vec3 p = mix(a, b, t);
        p.xy += crossAxis * position.x * mix(1.26, 5.2, max(t, 0.));
        beamUV = vec2(position.x, t);
        distanceFade = 1. - smoothstep(50., 125., -p.z);
        gl_Position = projectionMatrix * vec4(p, 1.);
      }
    `,
    fragmentShader: `
      varying vec2 beamUV;
      varying float distanceFade;
      void main() {
        float center = exp(-beamUV.x * beamUV.x * 5.5);
        float edges = 1. - smoothstep(0.65, 1., abs(beamUV.x));
        float reach = smoothstep(-0.003, 0.034, beamUV.y) * (1. - smoothstep(0.10, 0.94, beamUV.y));
        vec2 glowPoint = beamUV * vec2(3.05, 27.);
        float glow = exp(-dot(glowPoint, glowPoint));
        gl_FragColor = vec4(0.42, 0.67, 0.93, (center * edges * reach * 0.22 + glow * 0.41) * distanceFade);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Floodlight haze';
  mesh.frustumCulled = false;
  return mesh;
}

function rain() {
  let state = 849315;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const positions = [];
  const segments = [];
  for (let i = 0; i < 2300; i++) {
    const point = [random() * 90, random() * 48, random() * 90];
    const size = 0.24 + random() ** 2 * 0.50;
    const opacity = 0.08 + random() ** 2 * 0.20;
    positions.push(...point, ...point);
    segments.push(0, size, opacity, 1, size, opacity);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('segment', new THREE.Float32BufferAttribute(segments, 3));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, center: { value: new THREE.Vector3() }, opacity: { value: 1 } },
    vertexShader: `
      uniform float time;
      uniform vec3 center;
      uniform float opacity;
      attribute vec3 segment;
      varying float rainAlpha;
      void main() {
        vec3 drift = vec3(4.6, -22., 3.1);
        vec3 extents = vec3(90., 48., 90.);
        vec3 local = mod(position + drift * time - center + extents * 0.5, extents) - extents * 0.5;
        vec3 p = center + local - normalize(drift) * segment.x * segment.y;
        vec4 viewPosition = modelViewMatrix * vec4(p, 1.);
        float depth = -viewPosition.z;
        float volume = 1. - smoothstep(0.70, 1., length(local / (extents * 0.5)));
        float fade = smoothstep(2.4, 11., depth) * (1. - smoothstep(29., 67., depth));
        rainAlpha = segment.z * volume * fade * opacity * mix(1., 0.10, segment.x);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying float rainAlpha;
      void main() {
        gl_FragColor = vec4(0.26, 0.46, 0.65, rainAlpha);
        #include <colorspace_fragment>
      }
    `,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = 'Rain streaks';
  lines.frustumCulled = false;
  lines.renderOrder = 8;
  return lines;
}

export function createNightWeather(scene, lights) {
  const haze = lampHaze(lights);
  const streaks = rain();
  scene.add(haze, streaks);
  return (camera, focus, time, reduced) => {
    const uniforms = streaks.material.uniforms;
    uniforms.time.value = reduced ? 0 : time;
    uniforms.opacity.value = reduced ? 0.27 : 0.95;
    uniforms.center.value.copy(focus).lerp(camera.position, 0.34);
    uniforms.center.value.y += 3.2;
  };
}
