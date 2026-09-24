import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * The world, ported out of the research prototype.
 *
 * Source: _admin/research/world-gen/web_prototype.html:131-377, which Lovro has
 * seen and signed off on ("a decent start, it gave me a vision"). Every number
 * below is carried across UNCHANGED. The art-direction conversation is
 * explicitly deferred and this file makes no aesthetic decisions — it is the
 * engine those decisions will later be poured into.
 *
 * THE THREE TRAPS THIS FILE IS WRITTEN AROUND, each of which cost hours once:
 *
 *   1. glTF has no Mix Shader. ridge.py mixes a haze Emission into EVERY
 *      material to fade surfaces by camera distance (the Firewatch trick), and
 *      the exporter flattens that branch to a flat emissiveFactor, discarding
 *      the distance. Every surface then glows full-strength peach, immune to
 *      lights, and the whole world reads as a cream blank. stripHazeEmissive()
 *      is the guard; scene.fog does the distance haze natively here.
 *
 *   2. PerspectiveCamera fov is VERTICAL, so a WIDER monitor sees MORE world,
 *      not less. Narrowing the lens can never fix a visible world edge — the
 *      mesh itself has to be wider, which is what X_OVERSCAN in ridge.py does.
 *
 *   3. The fog range MUST track FOG in ridge.py (760, 3000) or the browser and
 *      the Blender stills stop being the same picture. It was briefly (1500,
 *      4600) — wider than the world is deep — so nothing was ever hazed.
 */

/** Blender Z-up exported Y-up: a Blender point (x, y, z) arrives as (x, z, -y). */
const LEN_Y = 1500.0;

/** TIME_TABLE["sunset"] in ridge.py, converted linear -> sRGB. */
const SKY_TOP = 0x565a8c;
const SKY_HOR = 0xe8905c;
const HAZE = 0xc9795a;

/** Retina at 3x melts phones. */
const MAX_PIXEL_RATIO = 1.75;

/** Delta-time corrected. This damping is the difference between a glide and a snap. */
const SMOOTHING = 6.0;

export interface AreaAnchor {
  id: string;
  /** 0..1 along the rail. */
  depth: number;
}

export interface ProjectedMarker {
  id: string;
  /** CSS pixels within the container. */
  x: number;
  y: number;
  /** False when the anchor is behind the camera or off-screen. */
  visible: boolean;
  /** 0..1, nearer is larger. For scaling the marker without a 3D object. */
  proximity: number;
}

export type FrameCallback = (
  depth: number,
  markers: ProjectedMarker[],
) => void;

export class WorldScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private raf = 0;
  private lastTime = 0;
  private ready = false;
  private disposed = false;

  private targetDepth = 0;
  private currentDepth = 0;
  /** When set, the rail is ignored and the camera holds here. */
  private parkedDepth: number | null = null;
  private paused = false;

  private anchors: AreaAnchor[] = [];
  private frameCb: FrameCallback | null = null;

  private readonly scratch = new THREE.Vector3();
  private readonly camForward = new THREE.Vector3();
  private onResize = () => this.resize();

  constructor(container: HTMLElement) {
    this.container = container;
    this.init();
  }

  private init() {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    // Fog IS the mechanic, not decoration: what lies ahead is hazed out, so the
    // atmosphere doubles as fog of war. Tracks FOG in ridge.py.
    scene.fog = new THREE.Fog(HAZE, 760, 3000);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(
      31,
      window.innerWidth / window.innerHeight,
      1,
      6000,
    );

    // Gradient sky: one inverted sphere, two colours, no texture, no request.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(5000, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(SKY_TOP) },
          hor: { value: new THREE.Color(SKY_HOR) },
        },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform vec3 top; uniform vec3 hor; varying vec3 vP;
          void main(){
            float h = clamp(normalize(vP).y * 2.6 + 0.30, 0.0, 1.0);
            h = h * h * (3.0 - 2.0 * h);
            gl_FragColor = vec4(mix(hor, top, h), 1.0);
          }`,
      }),
    );
    sky.frustumCulled = false;
    scene.add(sky);

    const sun = new THREE.DirectionalLight(0xffa25c, 2.4);
    sun.position.set(320, 190, -3000); // low and deep: backlit sunset
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(SKY_HOR, 0x241c22, 0.44));
    scene.add(new THREE.AmbientLight(0xffd8bb, 0.15));

    window.addEventListener("resize", this.onResize, { passive: true });
  }

  private resize() {
    if (!this.renderer || !this.camera) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /** Mirrors build_camera(depth) in ridge.py. */
  private placeCamera(depth: number) {
    const camera = this.camera;
    if (!camera) return;
    const by = -LEN_Y * 0.615 + depth * (LEN_Y * 1.06);
    const height = 108 + depth * 96 + Math.max(0, depth - 0.45) * 210;
    camera.position.set(0, height, -by);
    const drop = Math.tan(THREE.MathUtils.degToRad(5.2 + depth * 2.2)) * 900;
    camera.lookAt(0, height - drop, -by - 900);
  }

  /**
   * The world point an area's marker sits on: what the camera would be LOOKING
   * AT from that area's stop. So a marker is dead centre when you are parked
   * there and recedes into the haze ahead of that.
   */
  private anchorWorldPosition(depth: number, out: THREE.Vector3) {
    const by = -LEN_Y * 0.615 + depth * (LEN_Y * 1.06);
    const height = 108 + depth * 96 + Math.max(0, depth - 0.45) * 210;
    const drop = Math.tan(THREE.MathUtils.degToRad(5.2 + depth * 2.2)) * 900;
    out.set(0, height - drop, -by - 900);
  }

  /**
   * 1,600 separate nodes is 1,600 draw calls. Anything sharing geometry becomes
   * one InstancedMesh, collapsing the trees and rocks to a handful.
   */
  private instanceRepeats(root: THREE.Object3D): number {
    const scene = this.scene;
    if (!scene) return 0;
    const byKey = new Map<string, THREE.Mesh[]>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      const key =
        mesh.geometry.uuid +
        "|" +
        (Array.isArray(mat) ? "m" : (mat as THREE.Material).uuid);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(mesh);
    });

    let collapsed = 0;
    for (const group of byKey.values()) {
      if (group.length < 12) continue;
      const src = group[0];
      const inst = new THREE.InstancedMesh(
        src.geometry,
        src.material as THREE.Material,
        group.length,
      );
      group.forEach((m, i) => {
        m.updateWorldMatrix(true, false);
        inst.setMatrixAt(i, m.matrixWorld);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      scene.add(inst);
      group.forEach((m) => m.parent?.remove(m));
      collapsed += group.length;
    }
    return collapsed;
  }

  /** See trap 1 in the header. Only the pins and the lighthouse lamp may glow. */
  private stripHazeEmissive(root: THREE.Object3D): number {
    const GLOWS = /^(Pin\d|LM_LighthouseLampMat)$/;
    let cleaned = 0;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const m of mats as THREE.MeshStandardMaterial[]) {
        if (!m || !m.emissive || GLOWS.test(m.name)) continue;
        if (m.emissive.getHex() === 0) continue;
        m.emissive.setHex(0x000000);
        cleaned++;
      }
    });
    return cleaned;
  }

  load(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(
        url,
        (gltf) => {
          if (this.disposed || !this.scene) return resolve();
          this.scene.add(gltf.scene);
          const stripped = this.stripHazeEmissive(gltf.scene);
          if (stripped) {
            console.warn(
              "[world] stripped haze emissive from",
              stripped,
              "materials — the .glb was exported without export_web.py's patch",
            );
          }
          this.instanceRepeats(gltf.scene);
          gltf.scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) m.frustumCulled = true;
          });
          this.ready = true;
          this.placeCamera(this.currentDepth);
          this.renderer?.render(this.scene, this.camera!);
          resolve();
        },
        undefined,
        (err) => reject(err),
      );
    });
  }

  setAnchors(anchors: AreaAnchor[]) {
    this.anchors = anchors;
  }

  onFrame(cb: FrameCallback | null) {
    this.frameCb = cb;
  }

  /** Hold the camera at one area's stop, ignoring the scroll rail. */
  setParked(depth: number | null) {
    this.parkedDepth = depth;
  }

  /** Stop rendering without tearing down — a hidden tab, or a lesson open. */
  setPaused(paused: boolean) {
    this.paused = paused;
  }

  /** Jump straight to a depth with no easing (reduced-motion, or a deep link). */
  snapTo(depth: number) {
    this.currentDepth = depth;
    this.targetDepth = depth;
  }

  private scrollDepth(): number {
    const max = document.body.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  }

  private projectMarkers(): ProjectedMarker[] {
    const camera = this.camera;
    const renderer = this.renderer;
    if (!camera || !renderer || this.anchors.length === 0) return [];

    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    camera.getWorldDirection(this.camForward);

    return this.anchors.map((a) => {
      this.anchorWorldPosition(a.depth, this.scratch);
      // Behind the camera? project() wraps those to a mirrored on-screen point,
      // which would put area 1's marker in front of you at the summit.
      const toAnchor = this.scratch.clone().sub(camera.position);
      const ahead = toAnchor.dot(this.camForward) > 0;
      const distance = toAnchor.length();

      this.scratch.project(camera);
      const x = (this.scratch.x * 0.5 + 0.5) * w;
      const y = (-this.scratch.y * 0.5 + 0.5) * h;
      const onScreen = x >= -80 && x <= w + 80 && y >= -80 && y <= h + 80;

      return {
        id: a.id,
        x,
        y,
        visible: ahead && onScreen,
        // 1 at ~300 units, falling off to 0 by ~3000 (the fog's far plane).
        proximity: Math.max(0, Math.min(1, 1 - (distance - 300) / 2700)),
      };
    });
  }

  start() {
    if (this.raf) return;
    this.lastTime = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);

      const dt = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;

      // README trap: read scrollDepth() EVERY frame. Driving the loop from a
      // cached value makes the camera stop following mid-scroll.
      this.targetDepth =
        this.parkedDepth !== null ? this.parkedDepth : this.scrollDepth();

      // Exponential smoothing, delta-time corrected so it behaves identically
      // at 60 and 120fps.
      this.currentDepth +=
        (this.targetDepth - this.currentDepth) *
        (1 - Math.exp(-SMOOTHING * dt));

      if (this.paused) return;

      if (this.ready && this.scene && this.camera && this.renderer) {
        this.placeCamera(this.currentDepth);
        this.renderer.render(this.scene, this.camera);
      }
      this.frameCb?.(this.currentDepth, this.projectMarkers());
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener("resize", this.onResize);
    this.frameCb = null;

    // Three holds GPU resources that garbage collection cannot reach. Without
    // this, navigating between areas leaks a whole world each time.
    this.scene?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        for (const value of Object.values(m)) {
          if (value && (value as THREE.Texture).isTexture) {
            (value as THREE.Texture).dispose();
          }
        }
        m.dispose();
      }
    });
    this.scene?.clear();
    this.renderer?.dispose();
    const canvas = this.renderer?.domElement;
    if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
    this.renderer = null;
    this.scene = null;
    this.camera = null;
  }
}
