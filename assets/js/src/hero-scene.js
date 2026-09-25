/*
 * Pampered Pets — cinematic 3D hero.
 *
 * A freshly groomed bichon-style dog, built entirely from code (no model
 * files to download), sitting on a velvet podium under a warm key light with
 * soap bubbles and golden dust drifting through the beam.
 *
 * This is the SOURCE file. The page loads the bundled, minified copy at
 * assets/js/hero-scene.js. After editing this file, rebuild it with:
 *
 *   npx esbuild assets/js/src/hero-scene.js --bundle --minify --format=esm \
 *     --outfile=assets/js/hero-scene.js
 *
 * (run `npm i three esbuild` once in a scratch folder, or see README.md)
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const hero = document.getElementById('home');
const canvas = document.getElementById('heroCanvas');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSmall = Math.min(window.innerWidth, window.innerHeight) < 640;
const quality = isSmall ? 0.6 : 1; // fewer fluff blobs and particles on phones

// Deterministic random so the dog looks the same on every visit.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function start() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    hero.classList.add('no-webgl');
    return;
  }

  let pixelRatio = Math.min(window.devicePixelRatio, isSmall ? 1.5 : 1.75);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const BG = new THREE.Color(0x0e0a12);
  scene.fog = new THREE.FogExp2(BG, 0.07);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.22;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);

  /* ------------------------------ Backdrop ------------------------------ */
  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(50, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x1d1223) },
        uBottom: { value: new THREE.Color(0x07050a) },
        uGlow: { value: new THREE.Color(0x7a3f4c) },
        uGlow2: { value: new THREE.Color(0x3a2a5c) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uBottom, uGlow, uGlow2;
        varying vec3 vDir;
        void main() {
          float h = vDir.y * 0.5 + 0.5;
          vec3 c = mix(uBottom, uTop, smoothstep(0.4, 0.85, h));
          c += uGlow * pow(max(dot(vDir, normalize(vec3(0.25, 0.1, -1.0))), 0.0), 7.0);
          c += uGlow2 * 0.6 * pow(max(dot(vDir, normalize(vec3(-0.9, 0.35, -0.6))), 0.0), 5.0);
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  backdrop.renderOrder = -1;
  scene.add(backdrop);

  /* ------------------------------- Stage -------------------------------- */
  const stage = new THREE.Group();
  scene.add(stage);

  const fade = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, '#fff');
    grd.addColorStop(0.35, '#bbb');
    grd.addColorStop(1, '#000');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(9, 64),
    new THREE.MeshStandardMaterial({ color: 0x1a121d, roughness: 0.5, metalness: 0.1, alphaMap: fade, transparent: true, depthWrite: false })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.32;
  floor.receiveShadow = true;
  stage.add(floor);

  const velvet = new THREE.MeshPhysicalMaterial({
    color: 0x2a1622, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25,
    sheen: 1, sheenColor: new THREE.Color(0x8a4a62), sheenRoughness: 0.4,
  });
  const gold = new THREE.MeshStandardMaterial({ color: 0xe7bf7a, metalness: 1, roughness: 0.22 });

  const podium = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.38, 0.24, 96), velvet);
  podium.position.y = -0.12;
  podium.castShadow = podium.receiveShadow = true;
  stage.add(podium);

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.62, 1.66, 0.1, 96), velvet);
  plinth.position.y = -0.27;
  plinth.receiveShadow = true;
  stage.add(plinth);

  for (const [r, y] of [[1.355, 0.0], [1.635, -0.22]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.014, 12, 160), gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    stage.add(ring);
  }

  /* -------------------------------- Dog --------------------------------- */
  const fur = new THREE.MeshPhysicalMaterial({
    color: 0xf2e0cc, roughness: 0.92, sheen: 1,
    sheenColor: new THREE.Color(0xffdcb8), sheenRoughness: 0.5,
  });
  // Warm apricot ears and tail give the silhouette some definition.
  const furDark = fur.clone();
  furDark.color.set(0xc98f62);
  furDark.sheenColor.set(0xffc49a);
  const blobGeo = new THREE.SphereGeometry(1, 12, 9);
  const baseGeo = new THREE.SphereGeometry(1, 32, 24);
  const tint = new THREE.Color();

  /**
   * One fluffy "pom-pom": a solid ellipsoid core covered in small overlapping
   * spheres, which reads as a freshly scissored coat under the rim lights.
   */
  function pompom(parent, center, radii, count, blob = 0.1, avoid = [], mat = fur, hue = [0.08, 0.35, 0.8]) {
    const group = new THREE.Group();
    group.position.copy(center);
    parent.add(group);

    const core = new THREE.Mesh(baseGeo, mat);
    core.scale.set(radii.x * 0.93, radii.y * 0.93, radii.z * 0.93);
    core.castShadow = core.receiveShadow = true;
    group.add(core);

    const n = Math.round(count * 1.45 * quality);
    const mesh = new THREE.InstancedMesh(blobGeo, mat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const golden = Math.PI * (3 - Math.sqrt(5));
    let placed = 0;
    for (let i = 0; i < n; i++) {
      // Fibonacci sphere with jitter: even coverage without visible rows.
      const y = 1 - ((i + 0.5) / n) * 2;
      const rr = Math.sqrt(1 - y * y);
      const th = golden * i + rand() * 0.6;
      const dir = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr);
      const push = 1 + (rand() - 0.5) * 0.06;
      p.set(dir.x * radii.x * push, dir.y * radii.y * push, dir.z * radii.z * push);
      const world = p.clone().add(center);
      if (avoid.some(([c, d]) => world.distanceTo(c) < d)) continue;
      const r = blob * 0.8 * (0.75 + rand() * 0.5);
      s.set(r, r * (0.85 + rand() * 0.3), r);
      q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
      m.compose(p, q, s);
      mesh.setMatrixAt(placed, m);
      tint.setHSL(hue[0], hue[1] + rand() * 0.15, hue[2] + rand() * 0.14);
      mesh.setColorAt(placed, tint);
      placed++;
    }
    mesh.count = placed;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return group;
  }

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const dog = new THREE.Group();
  stage.add(dog);

  const body = new THREE.Group();
  dog.add(body);
  pompom(body, V(0, 0.95, -0.05), V(0.55, 0.64, 0.56), 420, 0.11).rotation.x = -0.22;
  pompom(body, V(0, 1.08, 0.3), V(0.43, 0.46, 0.32), 240, 0.1);
  for (const sx of [-1, 1]) {
    pompom(body, V(sx * 0.38, 0.48, -0.08), V(0.34, 0.37, 0.44), 220, 0.1);
    pompom(body, V(sx * 0.45, 0.1, 0.28), V(0.17, 0.11, 0.26), 80, 0.075);
    pompom(body, V(sx * 0.19, 0.5, 0.42), V(0.14, 0.44, 0.14), 130, 0.075);
    pompom(body, V(sx * 0.2, 0.1, 0.54), V(0.16, 0.11, 0.18), 70, 0.07);
  }

  // Head pivots at the neck so it can tilt and follow the cursor.
  const head = new THREE.Group();
  head.position.set(0, 1.52, 0.22);
  dog.add(head);

  const eyeL = V(-0.155, 0.4, 0.44);
  const eyeR = V(0.155, 0.4, 0.44);
  const noseP = V(0, 0.26, 0.61);
  const clear = [[eyeL, 0.15], [eyeR, 0.15], [noseP, 0.11]];

  pompom(head, V(0, 0.32, 0.08), V(0.41, 0.39, 0.38), 300, 0.095, clear);
  pompom(head, V(0, 0.68, -0.01), V(0.45, 0.37, 0.41), 300, 0.1);
  pompom(head, V(0, 0.19, 0.37), V(0.25, 0.19, 0.22), 130, 0.075, clear);

  const ears = [];
  for (const sx of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(sx * 0.37, 0.42, 0.02);
    head.add(ear);
    pompom(ear, V(sx * 0.05, -0.28, 0), V(0.17, 0.36, 0.2), 150, 0.085, [], furDark);
    ear.rotation.z = sx * 0.12;
    ears.push(ear);
  }

  const gloss = new THREE.MeshPhysicalMaterial({ color: 0x0b0708, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 16), gloss);
  nose.scale.set(1.25, 0.9, 1);
  nose.position.copy(noseP);
  head.add(nose);

  const eyes = [];
  const sparkle = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const pos of [eyeL, eyeR]) {
    const eye = new THREE.Group();
    eye.position.copy(pos);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.078, 24, 16), gloss);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), sparkle);
    glint.position.set(0.022, 0.026, 0.056);
    eye.add(ball, glint);
    head.add(eye);
    eyes.push(eye);
  }

  // Pink satin bow on the top-knot and a matching collar with a gold tag.
  const satin = new THREE.MeshPhysicalMaterial({
    color: 0xf07ea2, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15,
    sheen: 1, sheenColor: new THREE.Color(0xffc2d6),
  });
  const bow = new THREE.Group();
  bow.position.set(0.24, 0.94, 0.2);
  bow.rotation.set(0.25, 0.3, -0.4);
  bow.scale.setScalar(1.25);
  head.add(bow);
  for (const sx of [-1, 1]) {
    const loop = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 16), satin);
    loop.scale.set(1.25, 0.8, 0.45);
    loop.position.x = sx * 0.13;
    loop.rotation.z = sx * -0.35;
    loop.castShadow = true;
    bow.add(loop);
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), satin);
  knot.scale.set(1, 1, 0.8);
  bow.add(knot);

  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.045, 16, 64), satin);
  collar.position.set(0, 1.46, 0.2);
  collar.rotation.x = Math.PI / 2 - 0.35;
  collar.castShadow = true;
  dog.add(collar);
  const tag = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 32), gold);
  tag.rotation.x = Math.PI / 2 - 0.15;
  tag.position.set(0, 1.3, 0.62);
  dog.add(tag);

  const tail = new THREE.Group();
  tail.position.set(0, 0.62, -0.55);
  dog.add(tail);
  pompom(tail, V(0, 0.22, -0.2), V(0.22, 0.22, 0.22), 130, 0.08, [], furDark);

  /* ------------------------------ Lighting ------------------------------ */
  scene.add(new THREE.HemisphereLight(0xffe7d2, 0x1a0e1c, 0.18));

  const key = new THREE.SpotLight(0xffd6a6, 62, 30, 0.42, 0.8, 1.6);
  key.position.set(3.2, 6.2, 4.2);
  key.target.position.set(0, 1, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(isSmall ? 1024 : 2048, isSmall ? 1024 : 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 6;
  scene.add(key, key.target);

  const rimCool = new THREE.SpotLight(0xc6a4ff, 110, 30, 0.6, 0.9, 1.6);
  rimCool.position.set(-3.4, 3.6, -4.2);
  rimCool.target.position.set(0, 1.3, 0);
  scene.add(rimCool, rimCool.target);

  const rimWarm = new THREE.SpotLight(0xffa987, 70, 30, 0.6, 0.9, 1.6);
  rimWarm.position.set(3.6, 2.4, -3.4);
  rimWarm.target.position.set(0, 1.2, 0);
  scene.add(rimWarm, rimWarm.target);

  const fill = new THREE.PointLight(0xf5c7d6, 2.5, 12, 1.8);
  fill.position.set(-2.6, 1.6, 3.2);
  scene.add(fill);

  // Soft volumetric beam from the key light.
  const beamLen = key.position.distanceTo(new THREE.Vector3(0, -0.3, 0));
  const beamGeo = new THREE.CylinderGeometry(0.15, 2.1, beamLen, 48, 1, true);
  beamGeo.translate(0, -beamLen / 2, 0);
  beamGeo.rotateX(-Math.PI / 2);
  const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0xffd9a8) }, uLen: { value: beamLen } },
    vertexShader: /* glsl */ `
      varying float vT; varying vec3 vN; varying vec3 vView;
      uniform float uLen;
      void main() {
        vT = clamp(-position.z / uLen, 0.0, 1.0);
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying float vT; varying vec3 vN; varying vec3 vView;
      void main() {
        float edge = pow(abs(dot(vN, vView)), 1.6);
        float a = edge * smoothstep(0.0, 0.35, vT) * (1.0 - smoothstep(0.7, 1.0, vT)) * 0.085;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  }));
  beam.position.copy(key.position);
  beam.lookAt(0, -0.3, 0);
  scene.add(beam);

  /* ------------------------------ Bubbles ------------------------------- */
  const bubbleMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0, metalness: 0, transparent: true, opacity: 0.22,
    iridescence: 1, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 700],
    clearcoat: 1, envMapIntensity: 2.4, depthWrite: false,
  });
  const bubbleGeo = new THREE.SphereGeometry(1, 32, 20);
  const bubbles = [];
  const bubbleCount = Math.round(28 * quality);
  for (let i = 0; i < bubbleCount; i++) {
    const b = new THREE.Mesh(bubbleGeo, bubbleMat);
    const angle = rand() * Math.PI * 2;
    const dist = 1.6 + rand() * 2.2;
    b.userData = {
      x: Math.max(Math.cos(angle) * dist, -1.5 - rand() * 0.4),
      z: Math.sin(angle) * dist * 0.8 - 0.6,
      y: rand() * 4.5 - 0.3,
      speed: 0.12 + rand() * 0.2,
      phase: rand() * 10,
      size: 0.05 + rand() * 0.14,
    };
    b.scale.setScalar(b.userData.size);
    b.renderOrder = 2;
    scene.add(b);
    bubbles.push(b);
  }

  /* ---------------------------- Golden dust ----------------------------- */
  const dustTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const dustCount = Math.round(700 * quality);
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (rand() - 0.5) * 10;
    dustPos[i * 3 + 1] = rand() * 6 - 0.3;
    dustPos[i * 3 + 2] = (rand() - 0.5) * 8;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xffd9a0, size: 0.045, map: dustTex, transparent: true, opacity: 0.8,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  scene.add(dust);

  /* --------------------------- Post-processing -------------------------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.6, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ------------------------------- Camera ------------------------------- */
  const layout = { offsetX: 0, dist: 6, targetY: 1.2 };
  function resize() {
    const w = hero.clientWidth;
    const h = hero.clientHeight;
    const aspect = w / h;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = aspect;
    if (aspect < 0.9) {
      // Portrait phones: dog centred in the upper half, text sits below.
      layout.offsetX = 0;
      layout.dist = 9 + (0.9 - aspect) * 10;
      layout.targetY = -0.2 - (0.9 - aspect) * 1.6;
      scene.fog.density = 0.035;
      camera.fov = 36;
    } else {
      const visibleW = 2 * 7.6 * Math.tan(THREE.MathUtils.degToRad(17)) * aspect;
      layout.offsetX = -Math.min(visibleW * 0.21, 2.4);
      layout.dist = 7.6;
      layout.targetY = 1.2;
      scene.fog.density = 0.07;
      camera.fov = 34;
    }
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const INTRO = reduceMotion ? 0 : 4.2;
  const t0 = performance.now();
  let scroll = 0;
  let nextBlink = 2.5;
  const target = new THREE.Vector3();

  function frame() {
    const t = (performance.now() - t0) / 1000;
    const intro = INTRO ? ease(Math.min(t / INTRO, 1)) : 1;

    // Scroll progress through the hero (0 at top, 1 once it has scrolled away).
    const rect = hero.getBoundingClientRect();
    scroll = Math.min(Math.max(-rect.top / rect.height, 0), 1);

    pointer.sx += (pointer.x - pointer.sx) * 0.04;
    pointer.sy += (pointer.y - pointer.sy) * 0.04;
    const motion = reduceMotion ? 0 : 1;

    // Cinematic dolly: sweep in from low and wide, then a slow drifting orbit.
    const orbit = (-0.75 * (1 - intro)) + motion * (Math.sin(t * 0.11) * 0.16 + pointer.sx * 0.18);
    const dist = layout.dist + (1 - intro) * 4.5 - scroll * 2.2;
    const height = layout.targetY + 0.35 - (1 - intro) * 0.9 + scroll * 0.9 - motion * pointer.sy * 0.2;
    target.set(layout.offsetX * Math.cos(orbit), layout.targetY + scroll * 0.35, -layout.offsetX * Math.sin(orbit));
    camera.position.set(
      target.x + Math.sin(orbit) * dist,
      height,
      target.z + Math.cos(orbit) * dist
    );
    camera.lookAt(target);
    camera.rotateZ(motion * Math.sin(t * 0.3) * 0.004);

    if (motion) {
      // Breathing, head follows the cursor, ears lag behind, happy tail bursts.
      body.scale.y = 1 + Math.sin(t * 2.1) * 0.012;
      head.position.y = 1.52 + Math.sin(t * 2.1 - 0.4) * 0.01;
      head.rotation.y += ((pointer.sx * 0.45) - head.rotation.y) * 0.05;
      head.rotation.x += ((pointer.sy * 0.18 + Math.sin(t * 0.5) * 0.03) - head.rotation.x) * 0.05;
      head.rotation.z = Math.sin(t * 0.63) * 0.09;
      ears[0].rotation.z = -0.12 - head.rotation.z * 0.6 + Math.sin(t * 1.7) * 0.03;
      ears[1].rotation.z = 0.12 - head.rotation.z * 0.6 + Math.sin(t * 1.7 + 1) * 0.03;
      const wag = Math.max(Math.sin(t * 0.45), 0);
      tail.rotation.z = Math.sin(t * 11) * 0.45 * wag;
      tail.rotation.x = -0.2 + wag * 0.15;

      if (t > nextBlink) {
        const k = (t - nextBlink) / 0.16;
        const lid = k < 1 ? 1 - Math.sin(k * Math.PI) * 0.9 : 1;
        eyes.forEach((e) => (e.scale.y = lid));
        if (k >= 1) nextBlink = t + 2.5 + rand() * 3.5;
      }

      for (const b of bubbles) {
        const u = b.userData;
        u.y += u.speed * 0.016;
        if (u.y > 5) u.y = -0.3;
        b.position.set(u.x + Math.sin(t * 0.7 + u.phase) * 0.18, u.y, u.z + Math.cos(t * 0.5 + u.phase) * 0.12);
        b.scale.setScalar(u.size * Math.min(1, (u.y + 0.3) * 2) * (1 + Math.sin(t * 3 + u.phase) * 0.03));
      }
      dust.rotation.y = t * 0.02;
      dust.position.y = Math.sin(t * 0.2) * 0.1;
    } else {
      bubbles.forEach((b) => {
        const u = b.userData;
        b.position.set(u.x, u.y, u.z);
      });
    }

    bloom.strength = 0.35 + (1 - intro) * 0.3;
    renderer.toneMappingExposure = 0.3 + intro * 0.65;
    composer.render();
  }

  // Only animate while the hero is on screen and the tab is visible.
  let visible = true;
  let running = false;
  // Adaptive quality: if frames are slow, render at a lower resolution.
  let last = 0;
  let avg = 16;
  let checkAt = 3;
  function loop(now) {
    if (!visible || document.hidden) { running = false; last = 0; return; }
    if (last) avg += (Math.min(now - last, 100) - avg) * 0.05;
    last = now;
    frame();
    const t = (performance.now() - t0) / 1000;
    if (t > checkAt) {
      checkAt = t + 2;
      if (avg > 30 && pixelRatio > 0.75) {
        pixelRatio = Math.max(0.75, pixelRatio - 0.25);
        renderer.setPixelRatio(pixelRatio);
        composer.setPixelRatio(pixelRatio);
        resize();
      }
    }
    requestAnimationFrame(loop);
  }
  function kick() {
    if (reduceMotion) return;
    if (!running && visible && !document.hidden) { running = true; requestAnimationFrame(loop); }
  }
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; kick(); }).observe(hero);
  document.addEventListener('visibilitychange', kick);

  frame();
  hero.classList.add('is-3d-ready');
  if (reduceMotion) window.addEventListener('resize', () => requestAnimationFrame(frame));
  else kick();
}

try {
  start();
} catch (err) {
  hero.classList.add('no-webgl');
  console.error(err);
}
