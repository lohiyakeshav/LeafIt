// The 2.5D diorama: a floating slab of the user's area seen from a fixed isometric angle (an orthographic camera that
// only turns left/right, like a 2D game that happens to look 3D).
//
// Performance rules this file keeps:
//   * render on demand: no requestAnimationFrame loop while nothing changes (the GPU is idle when you aren't touching it)
//   * ~8 draw calls total: ground, sides, shadow, buildings (ONE merged mesh), trees, tree shadows, stops, cursor
//   * trees are GPU-billboarded instances, so turning the view costs zero CPU per tree
//   * no shadow maps: tree shadows are flat blobs, buildings use a camera-attached light
//   * pixel ratio capped at 1.5; everything is disposed in dispose()
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { heatColor } from '../../../shared/heatmap/draw.js';
import { maturity } from '../../../model/rules.js';
import { buildIndex, groundHit, pickBuilding } from './geometry.js';
import { makeTreeAtlas, TREE_VARIANTS } from './sprites.js';

// Stylised, not physically based: colours are used exactly as written (no sRGB round-trip), which keeps the look predictable.
THREE.ColorManagement.enabled = false;

const ELEVATION_DEG = 38;            // starting tilt; the user can tilt between the limits below
const MIN_ELEVATION_DEG = 12, MAX_ELEVATION_DEG = 88;   // never below the slab (picking needs a downward ray), up to top-down
const DEFAULT_AZIMUTH = Math.PI / 4; // open on the diagonal: the classic isometric look
const TREE_HEIGHT_M = 9;             // a fully grown street tree
const MAX_ITEMS = 6000;              // > the API's 5000-placement cap
const SOIL_TOP = [0.72, 0.56, 0.4], SOIL_BOTTOM = [0.42, 0.3, 0.2];
const CONCRETE = [0.86, 0.82, 0.76];  // walls lean towards this, coloured by the roof the photo shows
const COOL_TINT = [0.97, 0.98, 0.96, 0.85], HOVER_TINT = [0.62, 0.93, 0.36, 0.5], NO_TINT = [0, 0, 0, 0];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hashf = (i) => { let h = (i * 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
const idHash = (id) => { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return h >>> 0; };

// Heat tints the photo rather than hiding it: texture detail survives under the colour.
const HEAT_BLEND = `vec3 heatBlend(vec3 base, vec4 h){ return mix(base, base * 0.42 + h.rgb * 0.68, h.a); }`;
const GROUND_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GROUND_FRAG = `
  varying vec2 vUv;
  uniform sampler2D uBase; uniform sampler2D uHeat; uniform vec2 uSize; uniform vec3 uSoil;
  ${HEAT_BLEND}
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  void main(){
    vec3 col = texture2D(uBase, vUv).rgb;
    vec4 h = texture2D(uHeat, vUv);
    col = heatBlend(col, h);
    vec2 m = vec2(min(vUv.x, 1.0 - vUv.x) * uSize.x, min(vUv.y, 1.0 - vUv.y) * uSize.y);
    float d = min(m.x, m.y);
    float rim = smoothstep(0.0, 5.0 + 5.0 * vnoise(vUv * uSize * 0.08), d);  // an irregular, hand-drawn soil edge
    gl_FragColor = vec4(mix(uSoil, col, rim), 1.0);
  }`;
// Roofs wear the same photo as the ground (so every building shows its real roof) and the same heat layer.
const ROOF_VERT = `
  attribute vec4 aTint; uniform float uRise; varying vec2 vUv; varying vec4 vTint;
  void main(){ vUv = uv; vTint = aTint; vec3 p = position; p.y *= uRise; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`;
const ROOF_FRAG = `
  varying vec2 vUv; varying vec4 vTint; uniform sampler2D uBase; uniform sampler2D uRoofBase; uniform sampler2D uHeat;
  ${HEAT_BLEND}
  void main(){
    vec3 c = heatBlend(texture2D(uRoofBase, vUv).rgb * 1.1, texture2D(uHeat, vUv));
    gl_FragColor = vec4(mix(c, vTint.rgb, vTint.a), 1.0);
  }`;
const TREE_VERT = `
  attribute float aVariant; uniform float uHeight; varying vec2 vUv; varying float vVar;
  void main(){
    vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float sc = length(instanceMatrix[0].xyz) * uHeight;
    vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));   // face the camera around the vertical axis only
    // Looking down from overhead an upright card is seen edge-on and vanishes, so it leans back towards the camera.
    float lean = smoothstep(0.55, 0.95, viewMatrix[1][2]);                    // 0 = side view, 1 = straight down
    vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]), lean));
    vec3 pos = c.xyz + right * position.x * sc * 0.73 + up * position.y * sc + vec3(0.0, lean * 1.5, 0.0);
    vUv = uv; vVar = aVariant;
    gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  }`;
const TREE_FRAG = `
  uniform sampler2D uAtlas; uniform vec3 uTint; varying vec2 vUv; varying float vVar;
  void main(){ vec4 t = texture2D(uAtlas, vec2((vUv.x + vVar) / ${TREE_VARIANTS}.0, vUv.y)); if (t.a < 0.5) discard; gl_FragColor = vec4(t.rgb * uTint, 1.0); }`;

export class DioramaScene {
  /**
   * @param container  element to fill with the canvas
   * @param handlers   { onTap({x,z,building}), onErase({x,z}), onHover({x,z,building}|null), onAzimuth(rad), onPaint({x,z}) }
   * @throws if WebGL is unavailable (the caller falls back to the flat 2D grid)
   */
  constructor(container, handlers = {}) {
    this.container = container;
    this.h = handlers;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.world = new THREE.Group();            // area coordinates (0,0 = NW corner); shifted so the slab is centred on the origin
    this.scene.add(this.world);
    this.camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 1, 5000);
    this.scene.add(this.camera);
    // three.js lights are physically scaled (diffuse is divided by π), so intensities read ~3× what they would in legacy mode.
    // Lights ride on the camera, so the shading stays the same as the view turns.
    this.camera.add(new THREE.HemisphereLight(0xffffff, 0xd6c8ae, 2.1));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.7);
    sun.position.set(-0.6, 1, 0.5);
    this.camera.add(sun);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;       // no damping => no continuous loop: we only render when something changes
    this.controls.enableRotate = true;
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(90 - MAX_ELEVATION_DEG);
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(90 - MIN_ELEVATION_DEG);
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;   // panning slides along the ground, like moving a map
    this.controls.minZoom = 0.6;
    this.controls.maxZoom = 7;
    this.controls.zoomSpeed = 0.9;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => { this._clampPan(); this.requestRender(); this.h.onAzimuth?.(this.controls.getAzimuthalAngle()); });

    this.tool = 'tree';
    this.paintMode = false;
    this.treeAtlas = new THREE.CanvasTexture(makeTreeAtlas());
    this.treeAtlas.colorSpace = THREE.NoColorSpace;
    this.riseUniform = { value: 1 };
    this.ripples = [];
    this.disposables = [this.treeAtlas];

    this._bindPointer();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);
    this._resize();
  }

  // ───────────────────────────── area ─────────────────────────────
  /** Build (or rebuild) everything that depends on the area. `ground` is a canvas: satellite tiles or the painted fallback. */
  setArea({ grid, buildings, ground, ambientTrees }) {
    this._clearArea();
    this.grid = grid;
    this.W = grid.cols * grid.cellM;
    this.D = grid.rows * grid.cellM;
    this.buildings = buildings;
    this.index = buildIndex(buildings, grid);
    this.maxHeight = buildings.reduce((m, b) => Math.max(m, b.height), 0);
    let minT = Infinity, maxT = -Infinity;
    for (const v of grid.lst) { if (v < minT) minT = v; if (v > maxT) maxT = v; }
    this.minT = minT; this.span = Math.max(maxT - minT, 0.1);
    this.world.position.set(-this.W / 2, 0, -this.D / 2);

    this._buildGround(ground);
    this._buildSides();
    this._buildBuildings();
    this._colorWalls(ground);
    this._buildTrees(ambientTrees);
    this._buildStops();
    this._buildCursor();

    const R = Math.hypot(this.W, this.D) / 2;
    this.radius = R;
    this._placeCamera();
    this.controls.target.set(0, 0, 0);
    this.camera.zoom = 1;
    this.camera.far = R * 12;
    this._resize();
    this.controls.update();
    this.setAzimuth(DEFAULT_AZIMUTH);
    this._fit();
    this._rise(0.9);
  }

  _clearArea() {
    for (const o of this.areaObjects ?? []) { this.world.remove(o); o.geometry?.dispose(); o.material?.dispose?.(); o.dispose?.(); }
    for (const t of this.areaTextures ?? []) t.dispose();
    this.areaObjects = [];
    this.areaTextures = [];
    this.ripples = [];
  }

  _add(obj) { this.world.add(obj); this.areaObjects.push(obj); return obj; }

  _texture(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    t.minFilter = THREE.LinearMipmapLinearFilter;
    this.areaTextures.push(t);
    return t;
  }

  /** Ground photo + baked contact shadows around each footprint (never inside it, so roofs stay clean). */
  _composeGround(canvas) {
    const out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    const kx = out.width / this.W, kz = out.height / this.D;
    const sh = document.createElement('canvas');
    sh.width = out.width; sh.height = out.height;
    const s = sh.getContext('2d');
    const path = () => { s.beginPath(); for (const b of this.buildings) { b.poly.forEach(([x, z], i) => (i ? s.lineTo(x * kx, z * kz) : s.moveTo(x * kx, z * kz))); s.closePath(); } };
    s.filter = `blur(${Math.max(2, 2.5 * kx)}px)`;
    s.fillStyle = 'rgba(14,16,12,0.55)';
    path(); s.fill();
    s.filter = 'none';
    s.globalCompositeOperation = 'destination-out';
    path(); s.fill();
    ctx.drawImage(sh, 0, 0);
    return out;
  }

  /** Walls take their tone from the roof the photo shows, pulled towards concrete, and darken towards the ground. */
  _colorWalls(canvas) {
    if (!this.wallColor) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pos = this.wallPos;
    this.buildings.forEach((b, i) => {
      const cx = b.poly.reduce((a, p) => a + p[0], 0) / b.poly.length, cz = b.poly.reduce((a, p) => a + p[1], 0) / b.poly.length;
      const px = clamp(Math.round((cx / this.W) * width), 2, width - 3), pz = clamp(Math.round((cz / this.D) * height), 2, height - 3);
      let r = 0, g = 0, bl = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const o = ((pz + dy) * width + px + dx) * 4; r += data[o]; g += data[o + 1]; bl += data[o + 2]; }
      const tone = [r / 6375, g / 6375, bl / 6375].map((v, k) => v * 0.45 + CONCRETE[k] * 0.55);
      const [start, count] = [this.bRange[i * 4 + 2], this.bRange[i * 4 + 3]];
      for (let v = start; v < start + count; v++) {
        const k = pos[v * 3 + 1] > 0 ? 1 : 0.55;           // base of the wall is in shade
        this.wallColor.setXYZ(v, tone[0] * k, tone[1] * k, tone[2] * k);
      }
    });
    this.wallColor.needsUpdate = true;
  }

  _buildGround(groundCanvas) {
    const { W, D, grid } = this;
    const roofBase = this._texture(groundCanvas);
    const base = this._texture(this._composeGround(groundCanvas));
    this.heatData = new Uint8Array(grid.rows * grid.cols * 4);
    this.heatTex = new THREE.DataTexture(this.heatData, grid.cols, grid.rows, THREE.RGBAFormat);
    this.heatTex.magFilter = this.heatTex.minFilter = THREE.LinearFilter;   // smooth blend between 10 m cells
    this.heatTex.colorSpace = THREE.NoColorSpace;
    this.heatTex.needsUpdate = true;
    this.areaTextures.push(this.heatTex);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, W, 0, 0, W, 0, D, 0, 0, D], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));   // v=1 is the north edge
    geo.setIndex([0, 2, 1, 0, 3, 2]);
    // one uniforms object shared by ground and roofs: swapping the photo or the heat updates both at once
    this.groundUniforms = { uBase: { value: base }, uRoofBase: { value: roofBase }, uHeat: { value: this.heatTex }, uSize: { value: new THREE.Vector2(W, D) }, uSoil: { value: new THREE.Vector3(...SOIL_TOP) } };
    const mat = new THREE.ShaderMaterial({ vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, uniforms: this.groundUniforms });
    this.ground = this._add(new THREE.Mesh(geo, mat));
    this.heatOpacity = this.heatOpacity ?? 0.6;
    this._updateHeat();
  }

  /** Swap the ground picture in place (painted fallback first, satellite once it has streamed in). */
  setGroundImage(canvas, { satellite = false } = {}) {
    if (!this.ground) return;
    const u = this.groundUniforms, old = [u.uBase.value, u.uRoofBase.value];
    u.uRoofBase.value = this._texture(canvas);
    u.uBase.value = this._texture(this._composeGround(canvas));
    this.areaTextures = this.areaTextures.filter((t) => !old.includes(t));
    old.forEach((t) => t.dispose());
    this._colorWalls(canvas);
    if (satellite && this.ambient) this.ambient.mesh.visible = this.ambient.shadow.visible = false;  // real trees are in the photo
    this.requestRender();
  }

  _buildSides() {
    const { W, D } = this;
    const T = Math.max(8, Math.max(W, D) * 0.035);
    const pos = [], col = [];
    const quad = (a, b, shade) => {  // a,b are the top-edge corners (x,z); the quad hangs down by T
      const v = [[a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], -T, b[1]], [a[0], -T, a[1]]];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(...v[i]);
        const k = v[i][1] === 0 ? SOIL_TOP : SOIL_BOTTOM;
        col.push(k[0] * shade, k[1] * shade, k[2] * shade);
      }
    };
    quad([0, D], [W, D], 1.0);   // south
    quad([W, D], [W, 0], 0.82);  // east
    quad([W, 0], [0, 0], 0.7);   // north
    quad([0, 0], [0, D], 0.9);   // west
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this._add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    // soft contact shadow under the floating slab
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d').createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, 'rgba(40,36,28,0.34)'); g.addColorStop(1, 'rgba(40,36,28,0)');
    c.getContext('2d').fillStyle = g; c.getContext('2d').fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c); this.areaTextures.push(tex);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.set(W / 2, -T - 1, D / 2); sh.scale.set(W * 1.5, D * 1.5, 1);
    this._add(sh);
  }

  _buildBuildings() {
    const wPos = [], wNrm = [], rPos = [], rUv = [];
    const n = this.buildings.length;
    this.bRange = new Int32Array(n * 4);          // roofStart, roofCount (roof mesh), wallStart, wallCount (wall mesh), in vertices
    this.bCoated = new Uint8Array(n);
    this._hoveredBuilding = -1;
    const facing = (a, b, c, normal) => {         // winding that makes the face point along `normal`
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      return (uy * vz - uz * vy) * normal[0] + (uz * vx - ux * vz) * normal[1] + (ux * vy - uy * vx) * normal[2] >= 0 ? [a, b, c] : [a, c, b];
    };
    this.buildings.forEach((b, i) => {
      const poly = b.poly, h = b.height;
      const wallStart = wPos.length / 3;
      let area = 0;
      for (let k = 0; k < poly.length; k++) { const p = poly[k], q = poly[(k + 1) % poly.length]; area += p[0] * q[1] - q[0] * p[1]; }
      for (let k = 0; k < poly.length; k++) {
        const p = poly[k], q = poly[(k + 1) % poly.length];
        const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz) || 1;
        const nv = area > 0 ? [dz / len, 0, -dx / len] : [-dz / len, 0, dx / len];
        const p0 = [p[0], 0, p[1]], q0 = [q[0], 0, q[1]], p1 = [p[0], h, p[1]], q1 = [q[0], h, q[1]];
        for (const t of [facing(p0, q0, q1, nv), facing(p0, q1, p1, nv)]) for (const v of t) { wPos.push(...v); wNrm.push(...nv); }
      }
      const roofStart = rPos.length / 3;
      const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
      for (const [a, b2, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
        for (const v of facing([poly[a][0], h, poly[a][1]], [poly[b2][0], h, poly[b2][1]], [poly[c][0], h, poly[c][1]], [0, 1, 0])) {
          rPos.push(...v); rUv.push(v[0] / this.W, 1 - v[2] / this.D);     // the ground photo's own coordinates
        }
      }
      this.bRange.set([roofStart, rPos.length / 3 - roofStart, wallStart, wPos.length / 3 - wallStart], i * 4);
    });

    this.wallPos = new Float32Array(wPos);
    this.wallColor = new THREE.Float32BufferAttribute(new Float32Array(wPos.length).fill(0.8), 3);
    const wGeo = new THREE.BufferGeometry();
    wGeo.setAttribute('position', new THREE.BufferAttribute(this.wallPos, 3));
    wGeo.setAttribute('normal', new THREE.Float32BufferAttribute(wNrm, 3));
    wGeo.setAttribute('color', this.wallColor);
    const wMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    wMat.onBeforeCompile = (shader) => {          // buildings "rise" out of the ground when an area opens
      shader.uniforms.uRise = this.riseUniform;
      shader.vertexShader = shader.vertexShader.replace('void main() {', 'uniform float uRise;\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y *= uRise;');
    };
    this.wallMesh = this._add(new THREE.Mesh(wGeo, wMat));
    this.wallMesh.frustumCulled = false;          // the vertex shader moves vertices; the static bounding box would lie

    this.roofTint = new THREE.Float32BufferAttribute(new Float32Array((rPos.length / 3) * 4), 4);
    const rGeo = new THREE.BufferGeometry();
    rGeo.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
    rGeo.setAttribute('uv', new THREE.Float32BufferAttribute(rUv, 2));
    rGeo.setAttribute('aTint', this.roofTint);
    const u = this.groundUniforms;
    this.roofMesh = this._add(new THREE.Mesh(rGeo, new THREE.ShaderMaterial({
      vertexShader: ROOF_VERT, fragmentShader: ROOF_FRAG,
      uniforms: { uBase: u.uBase, uRoofBase: u.uRoofBase, uHeat: u.uHeat, uRise: this.riseUniform },
    })));
    this.roofMesh.frustumCulled = false;
  }

  _setRoof(i, tint) {
    const [start, count] = [this.bRange[i * 4], this.bRange[i * 4 + 1]];
    for (let v = start; v < start + count; v++) this.roofTint.setXYZW(v, tint[0], tint[1], tint[2], tint[3]);
    this.roofTint.needsUpdate = true;
  }

  _roofTint(i) {
    if (this.bCoated[i]) return COOL_TINT;
    if (i === this._hoveredBuilding && this.tool === 'cool_roof') return HOVER_TINT;
    return NO_TINT;
  }

  _buildTrees(ambient) {
    const mk = (cap, tint, shadowOpacity) => {
      const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0);
      const variant = new Float32Array(cap);
      geo.setAttribute('aVariant', new THREE.InstancedBufferAttribute(variant, 1));
      const mat = new THREE.ShaderMaterial({ vertexShader: TREE_VERT, fragmentShader: TREE_FRAG, side: THREE.DoubleSide,
        uniforms: { uAtlas: { value: this.treeAtlas }, uTint: { value: new THREE.Vector3(...tint) }, uHeight: { value: TREE_HEIGHT_M } } });
      const mesh = new THREE.InstancedMesh(geo, mat, cap); mesh.count = 0; mesh.frustumCulled = false;
      const sGeo = new THREE.CircleGeometry(1, 20); sGeo.rotateX(-Math.PI / 2);
      const shadow = new THREE.InstancedMesh(sGeo, new THREE.MeshBasicMaterial({ color: 0x1d3a1d, transparent: true, opacity: shadowOpacity, depthWrite: false }), cap);
      shadow.count = 0; shadow.frustumCulled = false;
      this._add(shadow); this._add(mesh);
      return { mesh, shadow, variant };
    };
    this.trees = mk(MAX_ITEMS, [1, 1, 1], 0.28);
    // existing tree cover on the painted (non-satellite) ground; on satellite imagery the real trees are already visible
    this.ambient = ambient ? mk(this.grid.rows * this.grid.cols * 2, [0.86, 0.96, 0.88], 0.16) : null;
    if (this.ambient) {
      const { rows, cols, lc, classes, cellM } = this.grid;
      const treeCls = classes.indexOf('trees');
      const m = new THREE.Matrix4(); let k = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (lc[r * cols + c] !== treeCls) continue;
        for (let t = 0; t < 2; t++) {
          const s = 0.8 + 0.3 * hashf(r * 977 + c * 31 + t);
          const x = (c + 0.2 + 0.6 * hashf(r * 13 + c * 7 + t)) * cellM, z = (r + 0.2 + 0.6 * hashf(r * 17 + c * 29 + t * 5)) * cellM;
          m.compose(new THREE.Vector3(x, 0.05, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
          this.ambient.mesh.setMatrixAt(k, m);
          this.ambient.shadow.setMatrixAt(k, m.clone().scale(new THREE.Vector3(3.2, 1, 1.9)));
          this.ambient.variant[k] = (r + c + t) % TREE_VARIANTS; k++;
        }
      }
      this.ambient.mesh.count = this.ambient.shadow.count = k;
      this.ambient.mesh.instanceMatrix.needsUpdate = this.ambient.shadow.instanceMatrix.needsUpdate = true;
      this.ambient.mesh.geometry.getAttribute('aVariant').needsUpdate = true;
    }
  }

  _buildStops() {
    const geo = new THREE.BoxGeometry(3.4, 0.5, 6); geo.translate(0, 3.2, 0);
    const post = new THREE.BoxGeometry(0.4, 3.2, 0.4); post.translate(1.4, 1.6, 2.4);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x7fd6ff }), 600);
    const posts = new THREE.InstancedMesh(post, new THREE.MeshLambertMaterial({ color: 0x4a5c66 }), 600);
    mesh.count = posts.count = 0; mesh.frustumCulled = posts.frustumCulled = false;
    this.stops = { mesh, posts };
    this._add(mesh); this._add(posts);
  }

  _buildCursor() {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 2.3, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9ee35f, transparent: true, opacity: 0.95, depthTest: false }));
    ring.renderOrder = 10; ring.visible = false;
    this.cursor = ring; this._add(ring);
    this.rippleMeshes = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7fd6ff, transparent: true, opacity: 0, depthTest: false }));
      m.visible = false; m.renderOrder = 9; this._add(m); this.rippleMeshes.push(m);
    }
  }

  // ───────────────────────────── data in ─────────────────────────────
  /** Things the user placed. Cheap: rewrites instance buffers only (a few thousand matrices at most). */
  setItems(items, years) {
    if (!this.trees) return;
    // Props are exaggerated as the area gets bigger (a 9 m tree is a speck over 600 m), the way a diorama makes small things legible.
    const ex = clamp((this.radius ?? 100) / 100, 1.4, 2.6);
    const grown = (0.4 + 0.6 * maturity(years)) * ex;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    let nt = 0, ns = 0;
    const coatedIds = new Set(), coatedCells = new Set();   // tapped roofs carry their building id; AI plans only have cells
    this.pickables = [];                       // trees and stops, for screen-space erase picking
    for (const it of items) {
      if (it.type === 'tree' && nt < MAX_ITEMS) {
        const s = grown * (0.9 + 0.2 * hashf(idHash(it.id)));
        m.compose(new THREE.Vector3(it.x, 0.05, it.z), q, new THREE.Vector3(s, s, s));
        this.trees.mesh.setMatrixAt(nt, m);
        m.compose(new THREE.Vector3(it.x + 0.8, 0.04, it.z + 0.6), q, new THREE.Vector3(s * 3.4, 1, s * 2));
        this.trees.shadow.setMatrixAt(nt, m);
        this.trees.variant[nt] = idHash(it.id) % TREE_VARIANTS; nt++;
        this.pickables.push({ id: it.id, x: it.x, y: TREE_HEIGHT_M * s * 0.55, z: it.z });
      } else if (it.type === 'shade_stop' && ns < 600) {
        m.compose(new THREE.Vector3(it.x, 0, it.z), q, new THREE.Vector3(ex, ex, ex));
        this.stops.mesh.setMatrixAt(ns, m); this.stops.posts.setMatrixAt(ns, m); ns++;
        this.pickables.push({ id: it.id, x: it.x, y: 2.5, z: it.z });
      } else if (it.type === 'cool_roof') {
        if (it.buildingId != null) coatedIds.add(it.buildingId);
        else for (const [r, c] of it.cells) coatedCells.add(r * this.grid.cols + c);
      }
    }
    this.trees.mesh.count = this.trees.shadow.count = nt;
    this.stops.mesh.count = this.stops.posts.count = ns;
    for (const o of [this.trees.mesh, this.trees.shadow, this.stops.mesh, this.stops.posts]) o.instanceMatrix.needsUpdate = true;
    this.trees.mesh.geometry.getAttribute('aVariant').needsUpdate = true;
    // Only the roof that was tapped lights up. Row houses share 10 m cells, so matching by cell would also coat the neighbours.
    this.buildings.forEach((b, i) => {
      const coated = coatedIds.has(b.id) || b.cells.some(([r, c]) => coatedCells.has(r * this.grid.cols + c)) ? 1 : 0;
      if (coated !== this.bCoated[i]) { this.bCoated[i] = coated; this._setRoof(i, this._roofTint(i)); }
    });
    this.requestRender();
  }

  /** cooling: flat Float32Array (°C per cell) or null. heatOpacity 0 = pure satellite (a cyan glow still marks cooled ground). */
  setCooling(cooling, { showAfter = true, heatOpacity = this.heatOpacity ?? 0.6 } = {}) {
    this.cooling = cooling; this.showAfter = showAfter; this.heatOpacity = heatOpacity;
    this._updateHeat();
    this.requestRender();
  }

  _updateHeat() {
    if (!this.heatData) return;
    const { rows, cols, lst } = this.grid;
    const cooling = this.showAfter === false ? null : this.cooling;
    const opacity = this.heatOpacity ?? 0.6;
    for (let r = 0; r < rows; r++) {
      const dst = (rows - 1 - r) * cols;                // texture row 0 is the south edge; grid row 0 is the north edge
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c, cool = cooling ? cooling[i] : 0;
        let [R, G, B] = heatColor((lst[i] - cool - this.minT) / this.span);
        let a = opacity;
        if (cool > 0.03) {
          const g = Math.min(0.75, 0.15 + cool * 0.35);
          R = R * (1 - g) + 127 * g; G = G * (1 - g) + 214 * g; B = B * (1 - g) + 255 * g;
          a = opacity > 0 ? Math.max(opacity, 0.55) : g * 0.75;
        }
        const o = (dst + c) * 4;
        this.heatData[o] = R; this.heatData[o + 1] = G; this.heatData[o + 2] = B; this.heatData[o + 3] = a * 255;
      }
    }
    this.heatTex.needsUpdate = true;
  }

  setTool(tool) { this.tool = tool; this._hover(null); }
  setPaintMode(on) { this.paintMode = on; this.controls.enabled = !on; }

  /** { x, z, valid } or null: where the cursor ghost sits and whether the action is allowed there. */
  setGhost(g) {
    if (!this.cursor) return;
    this.cursor.visible = Boolean(g) && this.tool !== 'cool_roof';
    if (g) {
      this.cursor.position.set(g.x, 0.3, g.z);
      this.cursor.material.color.setHex(this.tool === 'erase' ? 0xffb454 : g.valid ? 0x9ee35f : 0xff6b5a);
    }
    this.requestRender();
  }

  ripple(x, z) {
    const m = this.rippleMeshes?.find((r) => !r.visible);
    if (!m) return;
    m.position.set(x, 0.35, z); m.visible = true;
    this.ripples.push({ m, t0: performance.now() });
    this.requestRender();
  }

  setAzimuth(a) {
    const t = this.controls.target, off = this.camera.position.clone().sub(t);
    const r = Math.hypot(off.x, off.z);
    this.camera.position.set(t.x + r * Math.sin(a), this.camera.position.y, t.z + r * Math.cos(a));
    this.controls.update();
  }

  /** Camera at the starting tilt, looking at the slab's centre. */
  _placeCamera() {
    const R = this.radius ?? 100, el = THREE.MathUtils.degToRad(ELEVATION_DEG);
    this.camera.position.set(0, R * 1.6 * Math.sin(el), R * 1.6 * Math.cos(el));
  }

  resetView() {
    this.controls.target.set(0, 0, 0);
    this.camera.zoom = 1;
    this._placeCamera();
    this.controls.update();
    this.setAzimuth(DEFAULT_AZIMUTH);
    this._fit();
  }

  // ───────────────────────────── interaction ─────────────────────────────
  _bindPointer() {
    const el = this.renderer.domElement, ray = new THREE.Raycaster();
    let down = null, longPress = null;
    const area = (e) => {                                      // pointer -> ray in area coordinates
      this.camera.updateMatrixWorld();
      const rect = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
      const off = this.world.position;
      return { origin: { x: ray.ray.origin.x - off.x, y: ray.ray.origin.y, z: ray.ray.origin.z - off.z }, dir: ray.ray.direction };
    };
    this._target = (e) => {
      if (!this.grid) return null;
      const { origin, dir } = area(e);
      let building = null, x, z;
      const g = groundHit(origin, dir);
      const hit = pickBuilding(this.index, this.buildings, origin, dir, this.maxHeight);
      if (this.tool === 'cool_roof' || this.tool === 'erase') building = hit;
      if (building !== null) { const b = this.buildings[building]; x = b.poly.reduce((s, p) => s + p[0], 0) / b.poly.length; z = b.poly.reduce((s, p) => s + p[1], 0) / b.poly.length; }
      else if (g) ({ x, z } = g);
      else return null;
      const inside = x >= 0 && z >= 0 && x <= this.W && z <= this.D;
      // onRoof: the pointer is over a building, so a tree or bus stop would land on the hidden ground behind it
      return inside ? { x, z, building: building === null ? null : this.buildings[building], buildingIndex: building, onRoof: hit !== null } : null;
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      clearTimeout(longPress);
      if (this.paintMode) { this.h.onPaintStart?.(); const t = this._target(e); if (t) this.h.onPaint?.(t); return; }
      longPress = setTimeout(() => { if (down && !down.moved) { const t = this._target(e); this.h.onErase?.({ ...(t ?? {}), itemId: this._pickItem(e) }); down = null; } }, 550);
    });
    el.addEventListener('pointermove', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down.moved = true; clearTimeout(longPress); }
      if (this.paintMode && down) { const t = this._target(e); if (t) this.h.onPaint?.(t); this._hover(t); return; }
      if (!down) this._hover(this._target(e));
    });
    el.addEventListener('pointerup', (e) => {
      clearTimeout(longPress);
      if (this.paintMode && down) this.h.onPaintEnd?.();
      if (down && !down.moved && !this.paintMode && performance.now() - down.t < 550) {
        const t = this._target(e);
        if (this.tool === 'erase') this.h.onErase?.({ ...(t ?? {}), itemId: this._pickItem(e) });   // erase prefers the thing you see under the cursor
        else if (t) this.h.onTap?.(t);
      }
      down = null;
    });
    el.addEventListener('pointerleave', () => { clearTimeout(longPress); if (this.paintMode && down) this.h.onPaintEnd?.(); down = null; this._hover(null); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Id of the tree/stop drawn nearest to the pointer (within ~24 px), or null. Crowns float above their base, so we pick on screen. */
  _pickItem(e) {
    if (!this.pickables?.length) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3(), off = this.world.position;
    let best = null, bestD = 24 * 24;
    for (const p of this.pickables) {
      v.set(p.x + off.x, p.y, p.z + off.z).project(this.camera);
      const dx = rect.left + ((v.x + 1) / 2) * rect.width - e.clientX, dy = rect.top + ((1 - v.y) / 2) * rect.height - e.clientY;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = p.id; }
    }
    return best;
  }

  _hover(t) {
    const next = t?.buildingIndex ?? -1;
    if (next !== this._hoveredBuilding) {
      const prev = this._hoveredBuilding;
      this._hoveredBuilding = next;
      if (prev >= 0) this._setRoof(prev, this._roofTint(prev));
      if (next >= 0) this._setRoof(next, this._roofTint(next));
      this.requestRender();
    }
    this.h.onHover?.(t);
  }

  // ───────────────────────────── frame loop (on demand) ─────────────────────────────
  _clampPan() {
    if (!this.W) return;
    const t = this.controls.target;
    const cx = clamp(t.x, -this.W / 2, this.W / 2), cz = clamp(t.z, -this.D / 2, this.D / 2);
    if (cx !== t.x || cz !== t.z) { this.camera.position.x += cx - t.x; this.camera.position.z += cz - t.z; t.x = cx; t.z = cz; }
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this._fit();
  }

  /** Frame the slab: project its corners (top, bottom, tallest roof) and size the frustum around them with a margin. */
  _fit() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    if (!this.W) { this.requestRender(); return; }
    this.camera.updateMatrixWorld();
    const inv = this.camera.matrixWorldInverse, v = new THREE.Vector3();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [-this.W / 2, this.W / 2]) for (const z of [-this.D / 2, this.D / 2]) for (const y of [-10, this.maxHeight ?? 0]) {
      v.set(x, y, z).applyMatrix4(inv);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, aspect = w / h;
    let bw = (x1 - x0) * 1.12, bh = (y1 - y0) * 1.12;
    if (bw / bh < aspect) bw = bh * aspect; else bh = bw / aspect;
    // the frustum stays centred on the orbit target (so turning pivots on the slab); the vertical offset is tiny
    const halfW = Math.max(Math.abs(cx - bw / 2), Math.abs(cx + bw / 2)), halfH = Math.max(Math.abs(cy - bh / 2), Math.abs(cy + bh / 2));
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  _rise(seconds) {
    this.riseUniform.value = 0.001;
    this._riseStart = performance.now(); this._riseDur = seconds * 1000;
    this.requestRender();
  }

  requestRender() {
    if (this._raf || this._disposed) return;
    this._raf = requestAnimationFrame((now) => {
      this._raf = 0;
      let animating = false;
      if (this._riseStart != null) {
        const p = clamp((now - this._riseStart) / this._riseDur, 0, 1);
        this.riseUniform.value = Math.max(0.001, 1 - (1 - p) ** 3);
        if (p < 1) animating = true; else this._riseStart = null;
      }
      for (const r of this.ripples) {
        const p = (performance.now() - r.t0) / 750;
        if (p >= 1) { r.m.visible = false; r.done = true; continue; }
        r.m.scale.setScalar(2 + 12 * p); r.m.material.opacity = 0.9 * (1 - p); animating = true;
      }
      this.ripples = this.ripples.filter((r) => !r.done);
      this.renderer.render(this.scene, this.camera);
      if (animating) this.requestRender();
    });
  }

  /** Draw calls for the last frame (the speed budget is checked against this in tests / DevTools). */
  get drawCalls() { return this.renderer.info.render.calls; }

  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.controls.dispose();
    this._clearArea();
    this.disposables.forEach((d) => d.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
