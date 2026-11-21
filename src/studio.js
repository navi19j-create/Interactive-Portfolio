import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function studio(host, background, fov, near, far) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(background);
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', host.id === 'view' ? 'Interactive music player, drag to rotate' : 'Camera view, drag to compose');
  host.append(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  const camera = new THREE.PerspectiveCamera(fov, 1, near, far);
  const orbit = new OrbitControls(camera, canvas);
  orbit.enablePan = false;
  orbit.rotateSpeed = .75;
  const draw = () => renderer.render(scene, camera);
  orbit.addEventListener('change', draw);
  const resize = () => {
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
    camera.updateProjectionMatrix();
    draw();
  };
  new ResizeObserver(resize).observe(host);
  function move(horizontal, vertical, zoom = 1) {
    const offset = camera.position.clone().sub(orbit.target);
    const angle = new THREE.Spherical().setFromVector3(offset);
    angle.theta += horizontal;
    angle.phi = THREE.MathUtils.clamp(angle.phi + vertical, orbit.minPolarAngle + .001, orbit.maxPolarAngle - .001);
    angle.radius = THREE.MathUtils.clamp(angle.radius * zoom, orbit.minDistance, orbit.maxDistance);
    camera.position.copy(orbit.target).add(offset.setFromSpherical(angle));
    orbit.update();
    draw();
  }
  canvas.addEventListener('keydown', event => {
    const delta = {ArrowLeft:[-.12,0], ArrowRight:[.12,0], ArrowUp:[0,-.09], ArrowDown:[0,.09], '+':[0,0,.9], '=':[0,0,.9], '-':[0,0,1.1]}[event.key];
    if (delta) {event.preventDefault(); move(...delta);}
  });
  return {renderer, canvas, scene, camera, orbit, draw, move, resize};
}
