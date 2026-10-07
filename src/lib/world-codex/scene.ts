import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clamp, LANDMARKS, noise, PATH_POINTS, randomGenerator, riverWidth, riverX, riverY, smooth, terrainHeight } from "./terrain";

export type MapMarker = { x: number; y: number; visible: boolean; scale: number };
export type MapFrame = { depth: number; markers: MapMarker[]; triangles: number; calls: number };

/** Entirely generated in the browser: no textures, GLB, remote assets or shared world code. */
export class CodexLandscape {
  private renderer: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(38, 1, 2, 12000);
  private geometry = new Set<T.BufferGeometry>();
  private materials = new Set<T.Material>();
  private anchors: T.Vector3[] = [];
  private water!: T.ShaderMaterial;
  private sky!: T.Mesh;
  private raf = 0;
  private previous = 0;
  private depth = 0;
  private parked: number | null = null;
  private reduced: boolean;
  private paused = false;
  private disposed = false;
  private frame = 0;
  private windmill: T.Group | null = null;
  private cameraPosition = new T.Vector3();
  private cameraTarget = new T.Vector3();
  private look = new T.Vector3();
  private project = new T.Vector3();
  // The lake sits below the highlands. A constantly rising camera sails over
  // it; this rail follows the actual places, then climbs to the final summit.
  private railPosition = new T.CatmullRomCurve3([
    [180, 260, 670], [260, 230, 390], [245, 240, 150], [170, 285, -60],
    [80, 365, -420], [130, 400, -700], [220, 360, -985], [-18, 620, -1340],
  ].map(p => new T.Vector3(...p as [number, number, number])));
  private railTarget = new T.CatmullRomCurve3([
    [100, 128, -280], [90, 100, -570], [30, 100, -700], [40, 160, -970],
    [-80, 215, -1150], [70, 280, -1350], [70, 165, -1470], [-40, 460, -2290],
  ].map(p => new T.Vector3(...p as [number, number, number])));
  private resizeObserver: ResizeObserver;
  private onLost = (event: Event) => { event.preventDefault(); this.onFailure(); };

  constructor(private host: HTMLElement, private onFrame: (frame: MapFrame) => void, private onFailure: () => void) {
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener("webglcontextlost", this.onLost);
    this.scene.fog = new T.Fog(0xdca08d, 600, 2650);
    this.scene.add(new T.HemisphereLight(0xf3d5bb, 0x716981, 1.6));
    const sun = new T.DirectionalLight(0xffd3a0, 2.1);
    sun.position.set(-950, 750, -1400);
    this.scene.add(sun);
    this.buildSky();
    this.buildTerrain();
    this.buildWater();
    this.buildPath();
    this.buildLandmarks();
    this.buildVegetation();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.placeCamera(0, 1);
    this.raf = requestAnimationFrame(this.tick);
  }

  private ownGeometry<G extends T.BufferGeometry>(g: G): G { this.geometry.add(g); return g; }
  private ownMaterial<M extends T.Material>(m: M): M { this.materials.add(m); return m; }
  private matte(color: T.ColorRepresentation) { return this.ownMaterial(new T.MeshLambertMaterial({ color, flatShading: true })); }
  private add(g: T.BufferGeometry, m: T.Material, parent: T.Object3D = this.scene) {
    const mesh = new T.Mesh(this.ownGeometry(g), m);
    parent.add(mesh);
    return mesh;
  }

  private buildSky() {
    const material = this.ownMaterial(new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, toneMapped: false,
      uniforms: { upper: { value: new T.Color("#747896") }, lower: { value: new T.Color("#f2b489") } },
      vertexShader: `varying vec3 p; void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform vec3 upper; uniform vec3 lower; varying vec3 p;
        void main(){float h=smoothstep(-.09,.65,normalize(p).y);gl_FragColor=vec4(mix(lower,upper,h),1.);
        #include <colorspace_fragment>
        }`,
    }));
    this.sky = this.add(new T.SphereGeometry(9500, 24, 16), material);
    this.sky.frustumCulled = false;
    const disc = this.add(new T.CircleGeometry(117, 64), this.ownMaterial(new T.MeshBasicMaterial({ color: "#ffe0a5", fog: false, toneMapped: false })));
    disc.position.set(-1120, 830, -4700);
    // Layered silhouettes fill even an ultrawide horizon; no visible edge of the world.
    for (let layer = 0; layer < 4; layer++) {
      const shape = new T.Shape();
      shape.moveTo(-8500, -800);
      for (let i = 0; i <= 200; i++) {
        const x = -8500 + i * 85;
        const n = noise(x / 560 + layer * 15, layer * 9);
        shape.lineTo(x, 255 + layer * 70 + n * (340 - layer * 35) + noise(x / 170, layer) * 95);
      }
      shape.lineTo(8500, -800);
      shape.closePath();
      const mesh = this.add(new T.ShapeGeometry(shape), this.ownMaterial(new T.MeshBasicMaterial({ color: ["#aa848a", "#be9394", "#d2a098", "#e3af9f"][layer], fog: false })));
      mesh.position.z = -2850 - layer * 700;
    }
  }

  private buildTerrain() {
    const nx = 256, nz = 264;
    const points: number[] = [], colors: number[] = [], indices: number[] = [];
    const green = new T.Color("#718775"), dry = new T.Color("#b7a27d"), rock = new T.Color("#9b8a91"), snow = new T.Color("#e5c9b5");
    const colour = new T.Color();
    for (let j = 0; j <= nz; j++) {
      const z = 380 - j / nz * 3030;
      for (let i = 0; i <= nx; i++) {
        const x = -2100 + i / nx * 4200;
        const y = terrainHeight(x, z);
        points.push(x, y, z);
        const t = clamp(-z / 1800);
        const n = noise(x * 0.012, z * 0.01);
        colour.copy(green).lerp(dry, clamp(t * 0.76 + n * 0.3));
        colour.lerp(rock, smooth(130, 340, y - riverY(z)) * 0.68);
        colour.lerp(snow, smooth(365, 480, y + n * 35));
        if (y < 10) colour.lerp(dry, .8);
        colour.multiplyScalar(.84 + n * .22);
        colors.push(colour.r, colour.g, colour.b);
      }
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      if ((i + j) % 2) indices.push(a, b, c, b, d, c);
      else indices.push(a, b, d, a, d, c);
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(points, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    this.add(g, this.ownMaterial(new T.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  }

  private buildWater() {
    this.water = this.ownMaterial(new T.ShaderMaterial({
      fog: true,
      uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { time: { value: 0 }, deep: { value: new T.Color("#617c8a") }, light: { value: new T.Color("#d6aea0") }, gold: { value: new T.Color("#f8d7ab") } }]),
      vertexShader: `varying vec3 world;
        #include <fog_pars_vertex>
        void main(){vec4 mvPosition=modelViewMatrix*vec4(position,1.);world=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform float time; uniform vec3 deep; uniform vec3 light; uniform vec3 gold; varying vec3 world;
        #include <fog_pars_fragment>
        void main(){vec3 v=normalize(cameraPosition-world);
          float w=sin(world.z*.31+world.x*.07+time*.35)*sin(world.z*.11-world.x*.08+time*.19);
          float fresnel=pow(1.-max(v.y,0.),2.);
          vec3 c=mix(deep,light,.22+fresnel*.6+w*.026);
          vec3 n=normalize(vec3(w*.026,1.,cos(world.x*.12+world.z*.23+time*.2)*.045));
          vec3 h=normalize(v+normalize(vec3(-.5,.29,-.8)));
          float shine=pow(max(dot(n,h),0.),85.);
          c=mix(c,gold,shine*.78);gl_FragColor=vec4(c,1.);
          #include <fog_fragment>
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    const sea = this.add(new T.PlaneGeometry(16000, 14000), this.water);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, 1, 6900);
    const positions: number[] = [], indices: number[] = [];
    const segments = 420;
    for (let i = 0; i <= segments; i++) {
      const z = 260 - i / segments * 1880;
      const width = riverWidth(z) + Math.max(0, z) * .24;
      positions.push(riverX(z) - width, riverY(z), z, riverX(z) + width, riverY(z), z);
      if (i < segments) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const river = new T.BufferGeometry();
    river.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    river.setIndex(indices);
    this.add(river, this.water);
    const pond = this.add(new T.CircleGeometry(56, 48), this.water);
    pond.rotation.x = -Math.PI / 2;
    pond.scale.x = 1.35;
    pond.position.set(riverX(-1450), riverY(-1450) + .6, -1450);
  }

  private pathCurve() {
    return new T.CatmullRomCurve3(PATH_POINTS.map(([x, z]) => new T.Vector3(x, 0, z)), false, "centripetal");
  }
  private buildPath() {
    const curve = this.pathCurve(), positions: number[] = [], indices: number[] = [];
    for (let i = 0; i <= 1250; i++) {
      const p = curve.getPoint(i / 1250), tangent = curve.getTangent(i / 1250);
      for (const side of [-1, 1]) {
        const x = p.x + tangent.z * 2.9 * side, z = p.z - tangent.x * 2.9 * side;
        let h = terrainHeight(x, z) + 1.35;
        // The trail actually crosses the decks, rather than dropping into the river.
        if (Math.abs(z + 465) < 5 && Math.abs(x - riverX(-465)) < 70) h = Math.max(h, riverY(-465) + 24);
        if (Math.abs(z + 720) < 5 && Math.abs(x - riverX(-720)) < 112) h = Math.max(h, riverY(-720) + 54);
        positions.push(x, h, z);
      }
      if (i < 1250) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    g.setIndex(indices); g.computeVertexNormals();
    const m = this.matte("#c4ad83"); m.side = T.DoubleSide;
    this.add(g, m);
  }

  private buildLandmarks() {
    const stone = this.matte("#d1bb9f"), roof = this.matte("#8f665c"), dark = this.matte("#484652"), wood = this.matte("#776453"), light = this.matte("#decba8");
    const box = (parent: T.Object3D, m: T.Material, x: number, y: number, z: number, w: number, h: number, d: number) => {
      const o = this.add(new T.BoxGeometry(w, h, d), m, parent); o.position.set(x, y, z); return o;
    };
    const cylinder = (parent: T.Object3D, m: T.Material, y: number, rt: number, rb: number, h: number, n = 8) => {
      const o = this.add(new T.CylinderGeometry(rt, rb, h, n), m, parent); o.position.y = y; return o;
    };
    const house = (parent: T.Object3D, x: number, z: number, scale: number, angle: number) => {
      const group = new T.Group(); group.position.set(x, terrainHeight(x, z), z); group.scale.setScalar(scale); group.rotation.y = angle; parent.add(group);
      box(group, stone, 0, 5, 0, 15, 10, 11);
      const top = cylinder(group, roof, 13, 0, 11, 8, 4); top.rotation.y = Math.PI / 4; top.scale.z = .85;
      box(group, dark, -3, 4.5, 5.6, 2.4, 4.5, .3);
      box(group, dark, 3.8, 6.5, 5.6, 2, 2.5, .3);
      box(group, stone, 4.5, 14, -1, 2, 7, 2);
    };
    LANDMARKS.forEach((a, index) => {
      const group = new T.Group();
      const y = index === 2 || index === 3 ? riverY(a.z) : terrainHeight(a.x, a.z);
      group.position.set(a.x, y, a.z);
      this.scene.add(group);
      this.anchors.push(new T.Vector3(a.x, y + a.height + 4, a.z));
      if (index === 0) {
        cylinder(group, stone, 2, 15, 17, 4, 10);
        cylinder(group, light, 22, 6, 10, 40, 10);
        cylinder(group, roof, 29, 7.1, 7.9, 7, 10);
        cylinder(group, dark, 42, 9, 9, 2, 10);
        cylinder(group, this.ownMaterial(new T.MeshBasicMaterial({ color: "#ffdb96" })), 46, 5.5, 5.5, 7, 10);
        for (let j = 0; j < 8; j++) { const angle = j * Math.PI / 4; box(group, dark, Math.cos(angle) * 5.5, 46, Math.sin(angle) * 5.5, .7, 8, .7); }
        cylinder(group, roof, 51.5, 0, 9, 5, 10);
        for (let j = 0; j < 3; j++) box(group, dark, 0, 12 + j * 9, 8.5 - j * .85, 1.4, 3, .4);
        house(this.scene, a.x + 28, a.z - 12, .9, -.3);
        house(this.scene, a.x + 44, a.z - 42, .75, .25);
      } else if (index === 1) {
        cylinder(group, stone, 14, 6, 11, 28);
        cylinder(group, roof, 31, 0, 10, 11);
        const rotor = new T.Group(); rotor.position.set(0, 27, 8); group.add(rotor); rotor.rotation.z = .3;
        for (let j = 0; j < 4; j++) {
          const arm = new T.Group(); arm.rotation.z = j * Math.PI / 2; rotor.add(arm);
          box(arm, wood, 0, 10, 0, 1, 26, 1);
          box(arm, light, 2.3, 15, 0, 4, 14, .5);
          for (let k = 0; k < 4; k++) box(arm, wood, 2, 9 + k * 3.5, .4, 5, .4, .4);
        }
        this.windmill = rotor;
        house(this.scene, a.x + 35, a.z + 8, 1.05, -.2);
        house(this.scene, a.x - 28, a.z - 28, .8, .5);
        // Field strips are laid over the hillside, not floating flat rectangles.
        for (let f = 0; f < 5; f++) {
          const pos: number[] = [], idx: number[] = [];
          for (let j = 0; j <= 20; j++) for (let k = 0; k < 2; k++) {
            const x = a.x + 25 + f * 10 + k * 6, z = a.z + 28 + j * 3;
            pos.push(x, terrainHeight(x, z) + .6, z);
            if (j < 20 && k === 0) { const q = j * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
          }
          const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
          this.add(g, this.matte(f % 2 ? "#ad9965" : "#9c8c5e"));
        }
      } else if (index === 2 || index === 3) {
        const count = index === 2 ? 3 : 7, width = index === 2 ? 130 : 220, deck = index === 2 ? 24 : 54, span = width / count;
        // Real negative-space arches. Each is an extruded arch, not a painted black hole.
        for (let j = 0; j < count; j++) {
          const radius = span * .38, top = deck - 4, spring = top - radius;
          const s = new T.Shape();
          s.moveTo(-span / 2, -8); s.lineTo(-span / 2, top); s.lineTo(span / 2, top); s.lineTo(span / 2, -8);
          s.lineTo(radius, -8); s.lineTo(radius, spring);
          for (let k = 0; k <= 20; k++) { const angle = k / 20 * Math.PI; s.lineTo(Math.cos(angle) * radius, spring + Math.sin(angle) * radius); }
          s.lineTo(-radius, -8); s.closePath();
          const arch = this.add(new T.ExtrudeGeometry(s, { depth: 10, bevelEnabled: false }), stone, group);
          arch.position.set(-width / 2 + span * (j + .5), 0, -5);
        }
        box(group, light, 0, deck - 2, 0, width + 5, 4, 14);
        box(group, stone, 0, deck + .6, -6.6, width + 5, 2.5, 1.1);
        box(group, stone, 0, deck + .6, 6.6, width + 5, 2.5, 1.1);
        this.anchors[index].y = y + deck + 3;
      } else if (index === 4) {
        for (const x of [-7, 7]) for (const z of [-7, 7]) box(group, wood, x, 16, z, 2, 32, 2);
        for (const z of [-7, 7]) {
          const brace = box(group, wood, 0, 16, z, 1.5, 34, 1.5); brace.rotation.z = .42;
          const brace2 = box(group, wood, 0, 16, z, 1.5, 34, 1.5); brace2.rotation.z = -.42;
        }
        box(group, wood, 0, 31, 0, 20, 2, 20);
        box(group, light, 0, 36, 0, 14, 9, 14);
        box(group, dark, 0, 37, 7.1, 11, 3.5, .2);
        const top = cylinder(group, roof, 43, 0, 15, 8, 4); top.rotation.y = Math.PI / 4;
        for (let j = 0; j < 12; j++) box(group, wood, -9, j * 2.5, 10, 4, .8, 2);
      } else if (index === 5) {
        for (let j = 0; j < 5; j++) {
          const boulder = this.add(new T.DodecahedronGeometry(10 - j * 1.65, 0), stone, group);
          boulder.position.set(Math.sin(j * 4) * 1.8, 4 + j * 4.6, 0); boulder.scale.y = .55; boulder.rotation.y = j * .7;
        }
        const pole = box(group, wood, 5, 23, 0, .7, 24, .7);
        pole.rotation.z = -.08;
        const flag = this.add(new T.PlaneGeometry(7, 4), roof, group); flag.position.set(9, 33, 0); flag.material.side = T.DoubleSide;
      } else if (index === 6) {
        group.position.y = riverY(-1450) + 2;
        for (let j = 0; j < 23; j++) box(group, wood, -j * 1.7, 0, 0, 1.5, 1.2, 9);
        for (let j = 0; j < 4; j++) for (const z of [-4, 4]) box(group, wood, -j * 11, -2.5, z, 1.5, 10, 1.5);
        house(this.scene, a.x + 35, a.z + 35, .8, -.3);
        this.anchors[index].set(a.x - 26, group.position.y + 4, a.z);
      } else {
        for (let j = 0; j < 3; j++) box(group, stone, 0, j * 2.4, 0, 27 - j * 5, 2.4, 27 - j * 5);
        cylinder(group, light, 27, 3, 7, 41, 4).rotation.y = Math.PI / 4;
        cylinder(group, light, 50, 0, 3, 5, 4).rotation.y = Math.PI / 4;
        box(group, roof, 0, 32, 4, 1.2, 12, .5);
      }
    });
    // Batch static architecture by material. The windmill rotor remains separate.
    const batches = new Map<T.Material, T.BufferGeometry[]>();
    const remove: T.Mesh[] = [];
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((o) => {
      if (!(o instanceof T.Mesh) || o instanceof T.InstancedMesh || Array.isArray(o.material)) return;
      if (![stone, roof, dark, wood, light].includes(o.material)) return;
      let ancestor = o.parent;
      while (ancestor) { if (ancestor === this.windmill) return; ancestor = ancestor.parent; }
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const list = batches.get(o.material) ?? []; list.push(g); batches.set(o.material, list); remove.push(o);
    });
    batches.forEach((gs, m) => {
      const expanded = gs.map(g => g.index ? g.toNonIndexed() : g);
      const g = mergeGeometries(expanded);
      if (g) this.add(g, m);
      new Set([...gs, ...expanded]).forEach(part => part.dispose());
    });
    remove.forEach(o => o.removeFromParent());
  }

  private buildVegetation() {
    const rng = randomGenerator(), positions: Array<[number, number, number, number]> = [];
    const path = this.pathCurve().getPoints(320);
    for (let i = 0; i < 6800; i++) {
      const x = (rng() - .5) * 1450, z = 120 - rng() * 2010;
      const y = terrainHeight(x, z), d = Math.abs(x - riverX(z));
      if (y < 8 || y > 355 || d < riverWidth(z) + 12) continue;
      if (noise(x / 160 + 3, z / 110) < .35 || rng() < smooth(180, 360, y) * .8) continue;
      if (LANDMARKS.some(a => Math.hypot(a.x - x, a.z - z) < 33)) continue;
      if (path.some(p => Math.hypot(p.x - x, p.z - z) < 10)) continue;
      if (Math.hypot((x - riverX(-1450)) / 1.35, z + 1450) < 75) continue;
      positions.push([x, y - 1, z, 8 + rng() * 17]);
    }
    const treeGeo = new T.ConeGeometry(1, 1, 5);
    const trunkGeo = new T.CylinderGeometry(.55, .9, 1, 5);
    const material = this.matte("#e2e5d9");
    const crowns = new T.InstancedMesh(this.ownGeometry(treeGeo), material, positions.length * 2);
    const trunks = new T.InstancedMesh(this.ownGeometry(trunkGeo), this.matte("#6a5a53"), positions.length);
    const transform = new T.Object3D(), color = new T.Color();
    positions.forEach(([x, y, z, h], i) => {
      transform.position.set(x, y + h * .35, z); transform.scale.set(1, h * .7, 1); transform.rotation.set(0, rng() * 6, 0); transform.updateMatrix(); trunks.setMatrixAt(i, transform.matrix);
      color.set("#647b6a").lerp(new T.Color("#8b8270"), clamp(-z / 2200) * .65).multiplyScalar(.72 + rng() * .45);
      for (let j = 0; j < 2; j++) {
        transform.position.set(x, y + h * (.48 + j * .27), z);
        transform.scale.set(h * (.24 - j * .065), h * (.78 - j * .2), h * (.24 - j * .065));
        transform.updateMatrix(); crowns.setMatrixAt(i * 2 + j, transform.matrix); crowns.setColorAt(i * 2 + j, color);
      }
    });
    this.scene.add(crowns, trunks);
    const rockGeometry = this.ownGeometry(new T.DodecahedronGeometry(1, 0));
    const rocks = new T.InstancedMesh(rockGeometry, this.matte("#9a938b"), 230);
    for (let i = 0; i < 230; i++) {
      const z = 170 - rng() * 1920, x = riverX(z) + (rng() > .5 ? 1 : -1) * (28 + rng() * 180), s = 2 + rng() * 6;
      transform.position.set(x, terrainHeight(x, z), z); transform.scale.set(s * 1.6, s * .8, s); transform.rotation.set(rng(), rng() * 6, .2); transform.updateMatrix(); rocks.setMatrixAt(i, transform.matrix);
    }
    this.scene.add(rocks);
  }

  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    this.camera.aspect = width / height;
    // A narrower screen pulls back vertically without changing the scroll mechanics.
    this.camera.fov = this.camera.aspect < 1.45 ? 46 : 38;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
  setParked(index: number | null) { this.parked = index; }
  setPaused(value: boolean) { this.paused = value; }
  private placeCamera(depth: number, damping: number) {
    let segment = LANDMARKS.findIndex(a => a.depth > depth) - 1;
    if (segment < 0) segment = depth < 1 ? 0 : 6;
    const t = (segment + clamp((depth - LANDMARKS[segment].depth) / (LANDMARKS[segment + 1].depth - LANDMARKS[segment].depth))) / 7;
    this.railPosition.getPoint(t, this.cameraPosition);
    this.railTarget.getPoint(t, this.cameraTarget);
    if (this.parked !== null) {
      const a = this.anchors[this.parked];
      this.cameraPosition.set(a.x + 155, a.y + 125, a.z + 260);
      this.cameraTarget.set(a.x - 60, a.y - 5, a.z - 15);
    }
    this.cameraPosition.y = Math.max(this.cameraPosition.y, terrainHeight(this.cameraPosition.x, this.cameraPosition.z) + 65);
    this.camera.position.lerp(this.cameraPosition, damping);
    this.camera.position.y = Math.max(this.camera.position.y, terrainHeight(this.camera.position.x, this.camera.position.z) + 35);
    this.look.lerp(this.cameraTarget, damping);
    this.camera.lookAt(this.look);
    this.camera.updateMatrixWorld();
    this.sky.position.copy(this.camera.position);
  }
  private tick = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min((now - (this.previous || now)) / 1000, .05); this.previous = now;
    if (this.paused) return;
    const target = clamp(scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight));
    const damping = this.reduced ? 1 : 1 - Math.exp(-6 * dt);
    this.depth += (target - this.depth) * damping;
    this.placeCamera(this.depth, damping);
    if (!this.reduced) { this.water.uniforms.time.value = now / 1000; if (this.windmill) this.windmill.rotation.z = now * .000035; }
    this.renderer.render(this.scene, this.camera);
    // React never receives frame-by-frame updates; the owner positions DOM refs.
    if (this.frame++ % 2 === 0) {
      const w = this.host.clientWidth, h = this.host.clientHeight;
      const markers = this.anchors.map((a, i) => {
        this.project.copy(a).project(this.camera);
        const distance = this.camera.position.distanceTo(a);
        return { x: (this.project.x * .5 + .5) * w, y: (-this.project.y * .5 + .5) * h - 20,
          visible: this.project.z < 1 && this.project.z > -1 && Math.abs(this.project.x) < .93 && Math.abs(this.project.y) < .72 && distance < 1430 && LANDMARKS[i].depth > this.depth - .25,
          scale: clamp(1.2 - distance / 3000, .85, 1) };
      });
      this.onFrame({ depth: this.depth, markers, triangles: this.renderer.info.render.triangles, calls: this.renderer.info.render.calls });
    }
  };
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onLost);
    this.scene.traverse(o => { if (o instanceof T.InstancedMesh) o.dispose(); });
    this.geometry.forEach(g => g.dispose());
    this.materials.forEach(m => m.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.scene.clear();
  }
}
