import * as THREE from "three";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";

/**
 * Life: the things in world-v3 that move on their own.
 *
 *   LifeBirds      3 flocks of 7-9 soaring birds (V-winged chevrons) on slow
 *                  banked orbits: over the shore (the opening view), the
 *                  windmill valley (a2-a4) and the high valley (a5-a8). Dark
 *                  silhouettes placed against the pale far valley, hazed by
 *                  the fog, flapping in short bursts between long glides. One
 *                  InstancedMesh; matrices on the CPU (24 birds).
 *   LifeClouds     5 long, flat-bottomed cloud bands low over the far ridges,
 *                  drifting slowly left to right. Each takes the sky's own
 *                  colour behind it (scene.userData.atmosphere): a warm crown
 *                  lighter than the sky, a dusty base a touch darker, the edge
 *                  facing the sun brightest. Not tone mapped, like the sky.
 *                  Placed around the camera like the sky, behind every ridge.
 *   LifeSmoke      thin chimney plumes: one in the a2 village (the brief), one
 *                  from the lighthouse keeper's cottage (the opening view and
 *                  a1 see it). 10 soft billboarded puffs each that rise, lean
 *                  away from the landmark beside them, swell and fade; warm on
 *                  the sun side, cool grey on the other. Both plumes are one draw.
 *   LifeFireflies  24 warm sparks hovering and blinking round the a7 pond.
 *
 * Why cloud cards and not cloud shadows: the brief asked for drifting shadows
 * on the terrain only if this module could reach the terrain shader, and
 * surfaces.ts owns it. Every piece is a quad or a chevron in one instanced
 * draw: 4 draw calls and 386 triangles at most, and a group that is off
 * screen is not drawn at all.
 *
 * THE CLOCK. Everything is a pure function of the `time` update() receives
 * (scene.ts's sum of clamped frame dts), so a sleeping loop freezes the world
 * and it resumes where it stopped: nothing jumps. Reduced motion pins that
 * time to FROZEN_T: birds, smoke and clouds hold one good pose and update()
 * never asks for a frame.
 *
 * WHAT KEEPS THE LOOP AWAKE. isAnimating() is true only while a flock, the
 * plume or the fireflies are inside the camera frustum AND near enough to
 * read. A flock is tested where it IS: when it glides out of the frame and
 * nothing else moves, the loop sleeps and the flock waits just off screen
 * (its clock stops with the loop), so it never pops back in unseen. The clouds
 * never keep the loop awake by themselves: they drift ~0.1 degree a second,
 * too slow to matter between frames, so they move whenever anything else
 * renders and hold still when nothing does.
 *
 * FOG. The materials are ShaderMaterials, so scene.ts's patchFog() (which
 * rewrites onBeforeCompile on built-in materials) skips them; each applies
 * scene.fog itself, capped at FOG_MAX like the rest of the scene.
 */

// ── Tunables ────────────────────────────────────────────────────────────────

/** Reduced motion: every piece holds its pose at this scene time. */
const FROZEN_T = 23.0;
/** Mirrors scene.ts FOG_MAX: the fog never reaches the sky colour. */
const FOG_MAX = 0.9;
/** Wind speed for the smoke, world units per second. */
const WIND_SPEED = 3.2;

// Birds
/** Bird body colour, display sRGB: a warm near-black, not pure black. */
const BIRD_HEX = 0x2a2224;
/** Flocks this far from the camera are specks under the haze: not drawn, not animating. */
const BIRD_MAX_DIST = 1500;
/** Radius round a flock's moving centre that holds all its birds, wander and bob included. */
const FLOCK_SPREAD = 55;

interface FlockDef {
  /** Orbit centre, world units. */
  cx: number;
  cy: number;
  cz: number;
  /** Orbit semi-axes and the orbit's rotation about y (degrees). */
  rx: number;
  rz: number;
  rot: number;
  /** Height change per unit of z off the centre: the orbit climbs toward +z (the camera). */
  tilt: number;
  /** Ground speed, units/s; the sign picks the turning direction. */
  speed: number;
  count: number;
  /** Bird scale range. */
  scale: [number, number];
  seed: number;
}

/**
 * Placed by projecting each orbit into V3's camera at every stop (scratch
 * solver, 72 samples per orbit) so that each flock crosses the UPPER third of
 * the frame at the stops it serves: there the backdrop is the pale, hazed
 * far valley, and a dark bird reads. Lower, over the near forest, they vanish.
 *   shore     opening view: the whole orbit on screen at NDC y 0.44, x -0.42..0.32
 *             (the pale far valley between the two near hills), 380-480 away.
 *             The hero flock, so its birds are the largest (5-6 units across).
 *   valley    a2: NDC y 0.4-0.9, 525-665 away; a3: 0.3-1.0, crossing the frame
 *             diagonally 300-440 away. The orbit is tilted, climbing toward the
 *             camera, so its near side passes over the a4 camera instead of
 *             through its frame; a4 still sees the far side glide by below,
 *             ~190 away, seen from above.
 *   highland  a6: NDC y 0.5-0.7, 400-590 away (clear of the area label);
 *             a7: 0.3-0.6, 285-475 away; a5: 0.75-0.8, 630-820 away.
 */
const FLOCKS: FlockDef[] = [
  { cx: -15, cy: 172, cz: 801, rx: 70, rz: 50, rot: 12, tilt: 0, speed: 14, count: 9, scale: [1.1, 1.3], seed: 3 },
  { cx: -5, cy: 118, cz: 230, rx: 100, rz: 70, rot: -20, tilt: 0.5, speed: -14, count: 8, scale: [0.9, 1.05], seed: 11 },
  { cx: -40, cy: 158, cz: -600, rx: 110, rz: 90, rot: 30, tilt: 0, speed: 13, count: 7, scale: [1.1, 1.3], seed: 29 },
];

// Clouds
/** Distance of the cloud cards from the camera: behind the farthest ridge ring, inside the far plane. */
const CLOUD_R = 5850;
/** Drift in azimuth, radians per second (~0.11 degrees). */
const CLOUD_DRIFT = THREE.MathUtils.degToRad(0.11);
/** Clouds wrap within +-this azimuth of the valley's axis (-z), fading at the ends. */
const CLOUD_RANGE = THREE.MathUtils.degToRad(78);

interface CloudDef {
  /** Azimuth from -z toward +x, elevation of the flat base, width and height; degrees. */
  az: number;
  el: number;
  w: number;
  h: number;
  opacity: number;
  seed: number;
}

/**
 * From the shore (pitch 8, 31 degree lens) the frame's top edge is 7.5 degrees
 * up and the far ridges reach ~3.6, so the bands sit between: their bases
 * tuck behind the ridges, their tops reach toward the frame edge. As the
 * camera tilts down the valley, the sky and the clouds leave the frame.
 */
const CLOUDS: CloudDef[] = [
  { az: -44, el: 4.4, w: 30, h: 2.4, opacity: 0.8, seed: 1.7 },
  { az: -15, el: 5.6, w: 20, h: 1.5, opacity: 0.62, seed: 4.1 },
  { az: 9, el: 3.7, w: 36, h: 2.1, opacity: 0.72, seed: 7.9 },
  { az: 36, el: 5.2, w: 24, h: 1.8, opacity: 0.66, seed: 12.3 },
  { az: 63, el: 4.0, w: 28, h: 2.0, opacity: 0.7, seed: 15.5 },
];

// Smoke
/** Puffs per plume. */
const PUFFS = 10;
/** Seconds a puff lives. */
const PUFF_LIFE = 11;
/** Height a puff climbs over its life, world units. */
const PUFF_RISE = 34;
const PUFF_SIZE_START = 1.6;
const PUFF_SIZE_END = 9.5;
const SMOKE_MAX_DIST = 1400;

// Fireflies
const FIREFLIES = 24;
/** Past this the sparks are 1-2 px under the haze (a5 sees the pond from ~790). */
const FIREFLY_MAX_DIST = 650;

// ── Shared GLSL ─────────────────────────────────────────────────────────────

const NOISE_GLSL = /* glsl */ `
float lh(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float lnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lh(i), lh(i + vec2(1.0, 0.0)), u.x), mix(lh(i + vec2(0.0, 1.0)), lh(i + vec2(1.0, 1.0)), u.x), u.y);
}
float lfbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * lnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return s;
}
`;

/** Linear fog, capped like the rest of the scene. Needs vFogDepth from fog_vertex. */
const FOG_APPLY = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ${FOG_MAX.toFixed(2)} * smoothstep(fogNear, fogFar, vFogDepth));
#endif
`;

/** Tone mapping and output conversion, in three's order, then the fog (as three does). */
const FRAGMENT_TAIL = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${FOG_APPLY}
`;

// ── Small helpers ───────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexLinear(hex: number): THREE.Color {
  // Color.setHex reads sRGB and stores linear (ColorManagement is on in r169).
  return new THREE.Color().setHex(hex);
}

function fogUniforms() {
  return THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
}

/** A unit quad for instanced billboards: corner in [-1,1]^2, two triangles. */
function billboardQuad(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

// ── Birds ───────────────────────────────────────────────────────────────────

/**
 * One gliding bird, facing +z, wings along x, 4.8 units tip to tip at scale
 * 1, 12 triangles. `aWing` is 0 on the body and 1 at the wing tips; the
 * vertex shader lifts the wing by it. The wings are held in a soaring
 * vulture's V (~22 degrees): the rail camera sees the flocks from within a
 * few degrees of their own height, where a flat chevron is a 1 px line and a
 * V still reads as a bird.
 */
function birdGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const wing: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => {
    for (const v of [a, b, c]) {
      pos.push(v[0], v[1], v[2]);
      wing.push(v[3]);
    }
  };
  // [x, y, z, wing]
  const nose = [0, 0, 0.95, 0];
  const notch = [0, 0, -0.95, 0];
  for (const s of [1, -1]) {
    const rootF = [0.22 * s, 0, 0.36, 0];
    const rootB = [0.17 * s, 0, -0.34, 0];
    const elbowF = [1.05 * s, 0.4, 0.26, 0.45];
    const elbowB = [0.98 * s, 0.4, -0.3, 0.45];
    const tip = [2.4 * s, 0.95, -0.62, 1];
    const tail = [0.34 * s, 0, -1.22, 0];
    // Winding flips with the side; the material is double sided.
    tri(rootF, elbowF, rootB);
    tri(rootB, elbowF, elbowB);
    tri(elbowF, tip, elbowB);
    tri(nose, rootF, [0, 0, 0.3, 0]);
    tri([0, 0, 0.3, 0], rootF, rootB);
    tri(rootB, tail, notch);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aWing", new THREE.Float32BufferAttribute(wing, 1));
  return g;
}

function birdMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "LifeBirdMat",
    side: THREE.DoubleSide,
    fog: true,
    uniforms: { ...fogUniforms(), uColor: { value: hexLinear(BIRD_HEX) } },
    vertexShader: /* glsl */ `
      attribute float aWing;
      attribute float aFlap;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        // Wings beat about the shoulder: the tip travels most, and sweeps in a
        // little as it rises, so a beat reads as a beat and not a hinge.
        float w = aWing * aWing;
        p.y += aFlap * w * 1.45;
        p.x *= 1.0 - abs(aFlap) * w * 0.12;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
        ${FRAGMENT_TAIL}
      }`,
  });
}

interface Bird {
  /** Slot in the flock's moving frame: right, up, back (units). */
  ox: number;
  oy: number;
  oz: number;
  scale: number;
  /** Wander: slow drift around the slot. */
  wf: number;
  wp: number;
  /** Flap cycle: period (s), phase (0..1), beat rate (Hz). */
  period: number;
  phase: number;
  beat: number;
}

interface Flock {
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  rz: number;
  cosR: number;
  sinR: number;
  tilt: number;
  /** Angular speed, radians of orbit parameter per second (sign = direction). */
  omega: number;
  theta0: number;
  birds: Bird[];
  /** Round the flock's CURRENT centre, for the frustum test. */
  sphere: THREE.Sphere;
  onScreen: boolean;
}

function buildFlocks(): Flock[] {
  const out: Flock[] = [];
  for (const def of FLOCKS) {
    const rand = mulberry32(def.seed * 7919 + 13);
    const { cx, cy, cz } = def;
    const birds: Bird[] = [];
    for (let i = 0; i < def.count; i++) {
      // A loose, uneven gaggle: a leader, the rest spread behind and to the sides.
      const k = i === 0 ? 0 : 0.35 + 0.65 * rand();
      const side = i === 0 ? 0 : (i % 2 ? 1 : -1) * (4 + 22 * rand() * k);
      birds.push({
        ox: side,
        oy: (rand() - 0.5) * 10,
        oz: i === 0 ? 0 : 5 + 30 * k,
        scale: def.scale[0] + (def.scale[1] - def.scale[0]) * rand(),
        wf: 0.15 + 0.2 * rand(),
        wp: rand() * Math.PI * 2,
        period: 5.5 + 4 * rand(),
        phase: rand(),
        beat: 2.6 + 1.2 * rand(),
      });
    }
    const rot = THREE.MathUtils.degToRad(def.rot);
    const meanR = (def.rx + def.rz) / 2;
    out.push({
      cx,
      cy,
      cz,
      rx: def.rx,
      rz: def.rz,
      cosR: Math.cos(rot),
      sinR: Math.sin(rot),
      tilt: def.tilt,
      omega: def.speed / meanR,
      theta0: rand() * Math.PI * 2,
      birds,
      sphere: new THREE.Sphere(new THREE.Vector3(cx, cy, cz), FLOCK_SPREAD),
      onScreen: false,
    });
  }
  return out;
}

// ── Clouds ──────────────────────────────────────────────────────────────────

function cloudMaterial(sunDir: THREE.Vector3, sunColor: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "LifeCloudMat",
    transparent: true,
    depthWrite: false,
    fog: false,
    // Part of the sky: like atmosphere.ts's dome and ridges, not tone mapped,
    // so a cloud's colour sits on the sky's own scale (ACES greyed the peach).
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uR: { value: CLOUD_R },
      uDrift: { value: CLOUD_DRIFT },
      uRange: { value: CLOUD_RANGE },
      uSunDir: { value: sunDir.clone() },
      uSun: { value: sunColor.clone() },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uCam;
      uniform float uR;
      uniform float uDrift;
      uniform float uRange;
      attribute vec4 aShape;   // azimuth, elevation, width, height (radians)
      attribute vec3 aSky;     // the sky's linear colour behind this cloud (CPU, per frame)
      attribute vec2 aSeedOp;  // seed, opacity
      varying vec2 vUv;
      varying vec3 vDir;
      varying vec3 vSky;
      varying float vSeed;
      varying float vAlpha;
      varying vec2 vSunUv;
      uniform vec3 uSunDir;
      void main() {
        float az = aShape.x + uDrift * uTime;
        az = mod(az + uRange, 2.0 * uRange) - uRange;
        float edge = 1.0 - smoothstep(uRange - 0.35, uRange - 0.05, abs(az));
        float el = aShape.y;
        vec3 fwd = vec3(sin(az), 0.0, -cos(az));
        vec3 right = vec3(cos(az), 0.0, sin(az));
        vec2 c = position.xy;                 // [-1,1]^2
        float u = c.x;                        // across
        float v = c.y * 0.5 + 0.5;            // 0 at the flat base, 1 at the top
        // Place on the sphere around the camera: azimuth across, elevation up.
        float a = az + u * aShape.z * 0.5;
        float e = el + v * aShape.w;
        vec3 dir = vec3(sin(a) * cos(e), sin(e), -cos(a) * cos(e));
        vec3 wp = uCam + dir * uR;
        vUv = vec2(u, v);
        vDir = dir;
        vSky = aSky;
        vSeed = aSeedOp.x;
        vAlpha = aSeedOp.y * edge;
        // The sun's position in this card's (across, up) space, in card units.
        vec3 up = vec3(0.0, 1.0, 0.0);
        vSunUv = vec2(dot(uSunDir - fwd * dot(uSunDir, fwd), right) / (aShape.z * 0.5),
                      (asin(clamp(uSunDir.y, -1.0, 1.0)) - el) / aShape.w);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uSun;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vDir;
      varying vec3 vSky;
      varying float vSeed;
      varying float vAlpha;
      varying vec2 vSunUv;
      ${NOISE_GLSL}
      // Density of a long, flat-bottomed band: a lumpy top over a flat base,
      // tapering to both ends. Positive inside. \`top\` is the crown's height
      // at this x, so the shading can run from base to crown.
      float cloud(vec2 uv, out float top) {
        float x = uv.x;
        float taper = 1.0 - x * x;
        // Broad swells plus cumulus heads: many more bumps across than a
        // ridge line has, so the band never reads as one more mountain.
        float swell = lfbm(vec2(x * 2.2 + vSeed * 3.7, vSeed + uTime * 0.004));
        float heads = lnoise(vec2(x * 11.0 + vSeed * 9.1, 2.0 + uTime * 0.01));
        top = taper * (0.25 + 0.75 * swell + 0.35 * heads * heads);
        float base = 0.05 + 0.05 * lnoise(vec2(x * 7.0 + vSeed, 3.1));
        float billow = lfbm(uv * vec2(9.0, 3.4) + vec2(vSeed * 5.1 - uTime * 0.003, vSeed));
        float d = min(uv.y - base, top - uv.y) * 4.0 + (billow - 0.5) * 0.5;
        return d * smoothstep(1.0, 0.82, abs(x));
      }
      void main() {
        float top;
        float d = cloud(vUv, top);
        float a = smoothstep(0.0, 0.3, d);
        if (a * vAlpha < 0.004) discard;
        // Toward the sun: sample again a step closer to it. Where density
        // falls off toward the sun, this is the edge the light reaches.
        vec2 toSun = vSunUv - vUv;
        vec2 stepDir = toSun / max(length(toSun), 1e-4);
        float top2;
        float d2 = cloud(vUv + stepDir * vec2(0.03, 0.14), top2);
        float rim = clamp((d - d2) * 3.0, 0.0, 1.0) * (1.0 - smoothstep(0.1, 0.9, d));
        float near = pow(max(dot(normalize(vDir), uSunDir), 0.0), 12.0);
        // Lit from above (the sun is higher than every band): a warm, bright
        // crown over a dusty shaded base. The crown is lighter than the sky
        // around it, the base a touch darker, so the band reads as a cloud and
        // never as another far ridge (those are darker than the sky all over).
        vec3 warm = mix(uSun, vec3(1.0), 0.55);
        vec3 crown = mix(vSky, warm, 0.5) * 1.12;
        vec3 base = vSky * vec3(0.92, 0.88, 0.9);
        float h = clamp(vUv.y / max(top, 0.05), 0.0, 1.0);
        vec3 col = mix(base, crown, smoothstep(0.1, 0.8, h));
        col = mix(col, warm * 1.2, clamp(rim * (0.5 + 0.8 * near) + near * 0.2, 0.0, 1.0));
        gl_FragColor = vec4(col, a * vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ── Smoke ───────────────────────────────────────────────────────────────────

function smokeMaterial(sunDir: THREE.Vector3, sunColor: THREE.Color, haze: THREE.Color): THREE.ShaderMaterial {
  // Lit side: warm cream leaning to the sun; shade: cool, desaturated grey.
  const lit = new THREE.Color(0xf4e6d4).lerp(sunColor, 0.18);
  const shade = hexLinear(0x8c8a93).lerp(haze, 0.12);
  return new THREE.ShaderMaterial({
    name: "LifeSmokeMat",
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: {
      ...fogUniforms(),
      uTime: { value: 0 },
      uSunDir: { value: sunDir.clone() },
      uLit: { value: lit },
      uShade: { value: shade },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      attribute vec3 aOrigin;
      attribute vec3 aWind;
      attribute float aSeed;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vSeed;
      varying vec2 vSun;
      #include <fog_pars_vertex>
      void main() {
        float age = fract(uTime / ${PUFF_LIFE.toFixed(1)} + aSeed);
        float t = age * ${PUFF_LIFE.toFixed(1)};
        // Buoyant: quick off the chimney, slowing as it cools, bending downwind.
        float rise = ${PUFF_RISE.toFixed(1)} * (1.0 - exp(-2.4 * age)) / (1.0 - exp(-2.4));
        vec3 drift = aWind * t * (0.25 + 0.75 * age);
        float wob = (sin(t * 1.1 + aSeed * 41.0) * 1.3 + sin(t * 0.47 + aSeed * 13.0)) * age;
        vec3 c = aOrigin + vec3(wob, rise, wob * 0.4) + drift;
        float size = mix(${PUFF_SIZE_START.toFixed(1)}, ${PUFF_SIZE_END.toFixed(1)}, pow(age, 0.75));
        vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
        float ang = aSeed * 6.2831 + t * 0.12;
        vec2 corner = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * position.xy;
        mvPosition.xy += corner * size;
        gl_Position = projectionMatrix * mvPosition;
        vUv = position.xy;
        vSeed = aSeed;
        vAlpha = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.3, 1.0, age)) * (1.0 - 0.35 * age);
        // The sun's direction on screen, in this puff's rotated frame.
        vec2 s = normalize((viewMatrix * vec4(uSunDir, 0.0)).xy + vec2(1e-4));
        vSun = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * s;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uLit;
      uniform vec3 uShade;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vSeed;
      varying vec2 vSun;
      ${NOISE_GLSL}
      #include <fog_pars_fragment>
      void main() {
        float r = length(vUv);
        float n = lfbm(vUv * 1.6 + vSeed * 23.0);
        float d = 1.0 - smoothstep(0.35, 1.0, r + (n - 0.5) * 0.6);
        float a = d * vAlpha * 0.62;
        if (a < 0.004) discard;
        float lit = clamp(0.45 + 0.7 * dot(vUv, vSun), 0.0, 1.0);
        gl_FragColor = vec4(mix(uShade, uLit, lit), a);
        ${FRAGMENT_TAIL}
      }`,
  });
}

interface Chimney {
  pos: THREE.Vector3;
  from: string;
  /** Horizontal drift of this plume, units/s. */
  wind?: THREE.Vector3;
}

/**
 * Each plume leans AWAY from the landmark it stands beside, so the smoke
 * never drifts across that landmark's silhouette (with one global wind the
 * lighthouse keeper's smoke crossed the lighthouse lantern in the opening view).
 */
function windAwayFrom(c: THREE.Vector3, lm: { x: number; z: number }): THREE.Vector3 {
  const v = new THREE.Vector3(c.x - lm.x, 0, c.z - lm.z);
  if (v.lengthSq() < 1e-6) v.set(1, 0, 0);
  return v.normalize().multiplyScalar(WIND_SPEED);
}

/**
 * Every cottage chimney top. forest.ts builds the cottages into one merged
 * mesh, but leaves one invisible box per house (Cottage_i) with the house's
 * footprint, full height and yaw, and puts the chimney at
 * (0.45 * w/2, top + 2.2, -0.35 * d/2) in the house frame. The old glb houses
 * (House4000*) are the fallback: a point just over each roof.
 */
function findChimneys(ctx: WorldCtx): Chimney[] {
  const out: Chimney[] = [];
  const v = new THREE.Vector3();
  ctx.scene.updateMatrixWorld(true);
  ctx.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!/^(Cottage|House_v3)_\d+$/.test(o.name) || !mesh.geometry) return;
    const p = (mesh.geometry as THREE.BoxGeometry).parameters;
    if (!p) return;
    // The box is lifted inside its geometry; the mesh stands on the house's base.
    v.set(0.45 * (p.width / 2), p.height + 2.2, -0.35 * (p.depth / 2));
    out.push({ pos: v.clone().applyMatrix4(mesh.matrixWorld), from: o.name });
  });
  if (out.length) return out;
  ctx.root.traverse((o) => {
    if (!/^House4000/.test(o.name)) return;
    const box = new THREE.Box3().setFromObject(o);
    if (box.isEmpty()) return;
    out.push({ pos: new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + 1, (box.min.z + box.max.z) / 2), from: o.name });
  });
  return out;
}

/**
 * Up to two plumes. The first is the a2 village's: of the cottages round the
 * windmill, the one nearest the view's line to the mill that stands to its
 * right, clear of the sails. The a2 camera is not in WorldCtx; it stands ~350
 * units down-valley of the mill (rail.depthNearest), which is close enough to
 * rank five houses. The second is the lighthouse keeper's cottage, which the
 * opening view and a1 both see. Each leans away from its landmark (windAwayFrom).
 */
function pickPlumes(ctx: WorldCtx, all: Chimney[]): Chimney[] {
  const picks: Chimney[] = [];
  const mill = ctx.landmarks["LM_Windmill"];
  if (mill) {
    const m = new THREE.Vector3(mill.x, mill.y, mill.z);
    const eye = new THREE.Vector3(mill.x - 40, mill.y + 100, mill.z + 350);
    const toMill = m.clone().sub(eye).normalize();
    const right = new THREE.Vector3().crossVectors(toMill, new THREE.Vector3(0, 1, 0)).normalize();
    let best: Chimney | null = null;
    let bestScore = Infinity;
    for (const c of all) {
      if (Math.hypot(c.pos.x - m.x, c.pos.z - m.z) > 220) continue;
      const to = c.pos.clone().sub(eye).normalize();
      const off = Math.acos(Math.min(1, to.dot(toMill)));
      const side = c.pos.clone().sub(m).dot(right);
      const score = off + (side > 4 ? 0 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) picks.push({ ...best, wind: windAwayFrom(best.pos, mill) });
  }
  const lh = ctx.landmarks["LM_Lighthouse"];
  if (lh) {
    let best: Chimney | null = null;
    let bestD = 180;
    for (const c of all) {
      const d = Math.hypot(c.pos.x - lh.x, c.pos.z - lh.z);
      if (d < bestD && !picks.some((p) => p.from === c.from)) {
        bestD = d;
        best = c;
      }
    }
    if (best) picks.push({ ...best, wind: windAwayFrom(best.pos, lh) });
  }
  if (!picks.length && all.length) picks.push({ ...all[0], wind: new THREE.Vector3(WIND_SPEED, 0, 0) });
  return picks;
}

// ── Fireflies ───────────────────────────────────────────────────────────────

function fireflyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "LifeFireflyMat",
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
    uniforms: {
      ...fogUniforms(),
      uTime: { value: 0 },
      uColor: { value: hexLinear(0xffd98c) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute vec3 aHome;
      attribute float aSeed;
      varying vec2 vUv;
      varying float vGlow;
      #include <fog_pars_vertex>
      void main() {
        float s = aSeed * 97.0;
        vec3 c = aHome + vec3(
          sin(uTime * 0.31 + s) * 4.5 + sin(uTime * 0.83 + s * 1.7) * 1.6,
          sin(uTime * 0.57 + s * 2.3) * 1.8,
          cos(uTime * 0.27 + s * 0.9) * 4.5 + cos(uTime * 0.71 + s * 3.1) * 1.4);
        // Slow blink: mostly dim, a short bright pulse.
        float b = 0.5 + 0.5 * sin(uTime * (0.9 + fract(aSeed * 7.0) * 0.8) + s);
        vGlow = 0.12 + 0.88 * pow(b, 5.0);
        vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
        mvPosition.xy += position.xy * 1.9;
        gl_Position = projectionMatrix * mvPosition;
        vUv = position.xy;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vGlow;
      #include <fog_pars_fragment>
      void main() {
        float r = length(vUv);
        float core = 1.0 - smoothstep(0.0, 0.28, r);
        float halo = pow(max(1.0 - r, 0.0), 2.5) * 0.45;
        float a = (core + halo) * vGlow;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #ifdef USE_FOG
          // Additive: haze fades the spark out instead of tinting it.
          gl_FragColor.rgb *= 1.0 - ${FOG_MAX.toFixed(2)} * smoothstep(fogNear, fogFar, vFogDepth);
        #endif
      }`,
  });
}

// ── Install ─────────────────────────────────────────────────────────────────

export const install: InstallFn = (ctx: WorldCtx): WorldModule => {
  const t0 = performance.now();
  const scene = ctx.scene;
  const camera = ctx.camera;
  const sunDir = ctx.sunDir.clone().normalize();
  const disposables: { dispose(): void }[] = [];
  const owned: THREE.Object3D[] = [];
  const motionQuery = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const frozen = () => ctx.reducedMotion || !!motionQuery?.matches;

  // ── Birds
  const flocks = buildFlocks();
  const birdCount = flocks.reduce((n, f) => n + f.birds.length, 0);
  const birdGeo = birdGeometry();
  const flap = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, birdCount)), 1);
  flap.setUsage(THREE.DynamicDrawUsage);
  birdGeo.setAttribute("aFlap", flap);
  const birdMat = birdMaterial();
  const birds = new THREE.InstancedMesh(birdGeo, birdMat, Math.max(1, birdCount));
  birds.name = "LifeBirds";
  birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Only the flocks on screen are packed into the first `count` instances each
  // frame; 0 draws nothing (r169 skips an instanced draw with no instances).
  // `visible` is never touched here, so the harness's __worldHide('Life') holds.
  birds.count = 0;
  birds.frustumCulled = false;
  scene.add(birds);
  owned.push(birds);
  disposables.push(birdGeo, birdMat);

  // ── Clouds
  const cloudGeo = billboardQuad();
  const shape = new Float32Array(CLOUDS.length * 4);
  const seedOp = new Float32Array(CLOUDS.length * 2);
  const skyCol = new Float32Array(CLOUDS.length * 3);
  CLOUDS.forEach((c, i) => {
    shape.set([THREE.MathUtils.degToRad(c.az), THREE.MathUtils.degToRad(c.el), THREE.MathUtils.degToRad(c.w), THREE.MathUtils.degToRad(c.h)], i * 4);
    seedOp.set([c.seed, c.opacity], i * 2);
    skyCol.set([ctx.hazeColor.r, ctx.hazeColor.g, ctx.hazeColor.b], i * 3);
  });
  cloudGeo.setAttribute("aShape", new THREE.InstancedBufferAttribute(shape, 4));
  cloudGeo.setAttribute("aSeedOp", new THREE.InstancedBufferAttribute(seedOp, 2));
  const skyAttr = new THREE.InstancedBufferAttribute(skyCol, 3);
  skyAttr.setUsage(THREE.DynamicDrawUsage);
  cloudGeo.setAttribute("aSky", skyAttr);
  cloudGeo.instanceCount = CLOUDS.length;
  const cloudMat = cloudMaterial(sunDir, ctx.sunColor);
  const clouds = new THREE.Mesh(cloudGeo, cloudMat);
  clouds.name = "LifeClouds";
  // Positioned in the shader around the camera; three cannot cull it.
  clouds.frustumCulled = false;
  scene.add(clouds);
  owned.push(clouds);
  disposables.push(cloudGeo, cloudMat);
  type SkyFn = (dir: THREE.Vector3, out: THREE.Color) => THREE.Color;
  const skyColorAt = (scene.userData.atmosphere?.skyColorAt as SkyFn | undefined) ?? null;
  const skyTmp = new THREE.Color();
  const dirTmp = new THREE.Vector3();
  const CLOUD_MIN_EL = Math.min(...CLOUDS.map((c) => c.el));

  // ── Smoke: every plume's puffs in one instanced draw
  const chimneys = findChimneys(ctx);
  const plumes = pickPlumes(ctx, chimneys);
  let smoke: THREE.Mesh | null = null;
  const plumeSpheres: THREE.Sphere[] = [];
  if (plumes.length) {
    const n = plumes.length * PUFFS;
    const g = billboardQuad();
    const origin = new Float32Array(n * 3);
    const wind = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const rand = mulberry32(77);
    const all = new THREE.Box3();
    plumes.forEach((c, k) => {
      const w = c.wind ?? new THREE.Vector3(WIND_SPEED, 0, 0);
      const reach = w.clone().multiplyScalar(PUFF_LIFE);
      for (let i = 0; i < PUFFS; i++) {
        origin.set([c.pos.x, c.pos.y, c.pos.z], (k * PUFFS + i) * 3);
        wind.set([w.x, w.y, w.z], (k * PUFFS + i) * 3);
        // Evenly spaced ages with a little jitter; each plume on its own phase.
        seed[k * PUFFS + i] = (i + rand() * 0.45) / PUFFS + k * 0.37;
      }
      // The plume's envelope: up PUFF_RISE, a life of wind downwind, puffs PUFF_SIZE_END wide.
      const top = c.pos.clone().add(new THREE.Vector3(reach.x, PUFF_RISE, reach.z));
      const sph = new THREE.Sphere(c.pos.clone().add(top).multiplyScalar(0.5), c.pos.distanceTo(top) / 2 + PUFF_SIZE_END + 4);
      plumeSpheres.push(sph);
      all.union(new THREE.Box3().setFromCenterAndSize(sph.center, new THREE.Vector3(2, 2, 2).multiplyScalar(sph.radius)));
    });
    g.setAttribute("aOrigin", new THREE.InstancedBufferAttribute(origin, 3));
    g.setAttribute("aWind", new THREE.InstancedBufferAttribute(wind, 3));
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
    g.instanceCount = n;
    g.boundingSphere = all.getBoundingSphere(new THREE.Sphere());
    const m = smokeMaterial(sunDir, ctx.sunColor, ctx.hazeColor);
    smoke = new THREE.Mesh(g, m);
    smoke.name = "LifeSmoke";
    scene.add(smoke);
    owned.push(smoke);
    disposables.push(g, m);
  }

  // ── Fireflies round the pond (a7)
  let flies: THREE.Mesh | null = null;
  const fliesSphere = new THREE.Sphere();
  {
    let pond: THREE.Vector3 | null = null;
    // The glb pond is a unit disc scaled 51.
    let pondR = 51;
    const jetty = ctx.landmarks["LM_Jetty"];
    ctx.root.traverse((o) => {
      if (pond || o.name !== "Pond") return;
      const box = new THREE.Box3().setFromObject(o);
      if (box.isEmpty()) return;
      pond = box.getCenter(new THREE.Vector3());
      pondR = Math.max(20, Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2);
    });
    if (!pond && jetty) pond = new THREE.Vector3(jetty.x, jetty.y, jetty.z - 85);
    if (pond) {
      const p = pond as THREE.Vector3;
      const g = billboardQuad();
      const home = new Float32Array(FIREFLIES * 3);
      const seed = new Float32Array(FIREFLIES);
      const rand = mulberry32(606);
      for (let i = 0; i < FIREFLIES; i++) {
        // On the banks: a loose ring just outside the water's edge.
        const a = rand() * Math.PI * 2;
        const r = pondR * (0.95 + 0.45 * rand());
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        const y = Math.max(ctx.heightAt(x, z), p.y) + 2.5 + rand() * 7;
        home.set([x, y, z], i * 3);
        seed[i] = rand();
      }
      g.setAttribute("aHome", new THREE.InstancedBufferAttribute(home, 3));
      g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
      g.instanceCount = FIREFLIES;
      fliesSphere.center.copy(p);
      fliesSphere.radius = pondR * 1.45 + 12;
      g.boundingSphere = fliesSphere.clone();
      const m = fireflyMaterial();
      flies = new THREE.Mesh(g, m);
      flies.name = "LifeFireflies";
      scene.add(flies);
      owned.push(flies);
      disposables.push(g, m);
    }
  }

  // ── Per frame
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const camPos = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qBank = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const scl = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const zAxis = new THREE.Vector3(0, 0, 1);
  let animating = false;
  let lastT = -1;

  const onScreen = (s: THREE.Sphere, maxDist: number) =>
    s.radius > 0 && camPos.distanceTo(s.center) - s.radius < maxDist && frustum.intersectsSphere(s);

  const refreshView = () => {
    camera.updateMatrixWorld();
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    camera.getWorldPosition(camPos);
  };

  const poseBirds = (t: number) => {
    let any = false;
    let n = 0;
    for (const f of flocks) {
      const th = f.theta0 + f.omega * t;
      const dir = f.omega < 0 ? -1 : 1;
      // The flock's centre on its orbit and its tangent, in the orbit's rotated frame.
      const ex = f.rx * Math.cos(th);
      const ez = f.rz * Math.sin(th);
      const tx = -f.rx * Math.sin(th) * dir;
      const tz = f.rz * Math.cos(th) * dir;
      const px = f.cx + ex * f.cosR - ez * f.sinR;
      const pz = f.cz + ex * f.sinR + ez * f.cosR;
      const py = f.cy + f.tilt * (pz - f.cz);
      f.sphere.center.set(px, py, pz);
      f.onScreen = onScreen(f.sphere, BIRD_MAX_DIST);
      if (!f.onScreen) continue;
      any = true;
      fwd.set(tx * f.cosR - tz * f.sinR, 0, tx * f.sinR + tz * f.cosR).normalize();
      // Local x (the wings) = up x forward, so (x, up, forward) is right-handed.
      right.crossVectors(up, fwd).normalize();
      // Bank into the turn: the wing on the orbit centre's side dips. A
      // positive roll about forward lifts local +x, so roll away from the centre's side.
      const centreSide = right.x * (f.cx - px) + right.z * (f.cz - pz);
      const bank = -0.32 * Math.sign(centreSide || 1);
      for (let i = 0; i < f.birds.length; i++) {
        const b = f.birds[i];
        const w = t * b.wf + b.wp;
        const ox = b.ox + Math.sin(w) * 3.5;
        const oy = b.oy + Math.sin(w * 1.3 + 1.1) * 2.2 + Math.sin(th * 2 + b.wp) * 4;
        const oz = b.oz + Math.cos(w * 0.8) * 3;
        pos.set(px + right.x * ox - fwd.x * oz, py + oy, pz + right.z * ox - fwd.z * oz);
        // Heading along the orbit, a touch of individual yaw, then the bank.
        const yawJit = Math.sin(w * 0.7) * 0.12;
        basis.makeBasis(right, up, fwd);
        q.setFromRotationMatrix(basis);
        qBank.setFromAxisAngle(zAxis, bank + Math.sin(w) * 0.08);
        q.multiply(qBank);
        qBank.setFromAxisAngle(up, yawJit);
        q.premultiply(qBank);
        scl.setScalar(b.scale);
        m4.compose(pos, q, scl);
        birds.setMatrixAt(n, m4);
        // Flap in short bursts, then glide with a faint flex.
        const ph = (t / b.period + b.phase) % 1;
        const env = THREE.MathUtils.smoothstep(ph, 0, 0.04) * (1 - THREE.MathUtils.smoothstep(ph, 0.2, 0.27));
        flap.setX(n, Math.sin(t * Math.PI * 2 * b.beat + b.wp) * env + Math.sin(w * 2.1) * 0.07);
        n++;
      }
    }
    birds.count = n;
    if (n) {
      birds.instanceMatrix.needsUpdate = true;
      flap.needsUpdate = true;
    }
    return any;
  };

  const poseClouds = (t: number) => {
    // Out of the frame when the view's top edge is below the lowest band (the
    // high valley looks down 16 degrees): no draw at all.
    camera.getWorldDirection(dirTmp);
    const topEdge = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dirTmp.y, -1, 1))) + camera.fov / 2;
    cloudGeo.instanceCount = topEdge < CLOUD_MIN_EL - 0.5 ? 0 : CLOUDS.length;
    const u = cloudMat.uniforms;
    u.uTime.value = t;
    u.uCam.value.copy(camPos);
    if (!skyColorAt) return;
    // The sky behind each cloud, at its drifted centre.
    for (let i = 0; i < CLOUDS.length; i++) {
      const c = CLOUDS[i];
      let az = THREE.MathUtils.degToRad(c.az) + CLOUD_DRIFT * t;
      az = ((((az + CLOUD_RANGE) % (2 * CLOUD_RANGE)) + 2 * CLOUD_RANGE) % (2 * CLOUD_RANGE)) - CLOUD_RANGE;
      const el = THREE.MathUtils.degToRad(c.el + c.h * 0.5);
      dirTmp.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      skyColorAt(dirTmp, skyTmp);
      skyAttr.setXYZ(i, skyTmp.r, skyTmp.g, skyTmp.b);
    }
    skyAttr.needsUpdate = true;
  };

  const pose = (time: number) => {
    const t = frozen() ? FROZEN_T : time;
    refreshView();
    const b = poseBirds(t);
    poseClouds(t);
    let s = false;
    if (smoke) {
      for (const sph of plumeSpheres) if (onScreen(sph, SMOKE_MAX_DIST)) s = true;
      (smoke.geometry as THREE.InstancedBufferGeometry).instanceCount = s ? plumes.length * PUFFS : 0;
      (smoke.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    }
    let fl = false;
    if (flies) {
      fl = onScreen(fliesSphere, FIREFLY_MAX_DIST);
      (flies.geometry as THREE.InstancedBufferGeometry).instanceCount = fl ? FIREFLIES : 0;
      (flies.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    }
    lastT = t;
    animating = !frozen() && (b || s || fl);
    return animating;
  };

  // A first pose now, so the first rendered frame is already right.
  pose(0);

  const buildMs = performance.now() - t0;
  const triangles = birdCount * 12 + CLOUDS.length * 2 + plumes.length * PUFFS * 2 + (flies ? FIREFLIES * 2 : 0);
  if (!plumes.length) console.warn("[world-v3] life: no cottage chimney found, the smoke plumes are off");

  const stats = () => ({
    triangles,
    drawCallsMax: owned.length,
    drawCallsNow:
      (birds.count > 0 ? 1 : 0) +
      (cloudGeo.instanceCount > 0 ? 1 : 0) +
      (smoke && (smoke.geometry as THREE.InstancedBufferGeometry).instanceCount > 0 ? 1 : 0) +
      (flies && (flies.geometry as THREE.InstancedBufferGeometry).instanceCount > 0 ? 1 : 0),
    birds: birdCount,
    flocks: flocks.length,
    flocksOnScreen: flocks.filter((f) => f.onScreen).length,
    birdsDrawn: birds.count,
    cloudsDrawn: cloudGeo.instanceCount,
    clouds: CLOUDS.length,
    puffs: plumes.length * PUFFS,
    fireflies: flies ? FIREFLIES : 0,
    plumes: plumes.map((c) => `${c.from} (${c.pos.x.toFixed(0)}, ${c.pos.y.toFixed(0)}, ${c.pos.z.toFixed(0)})`).join(", ") || "none",
    skyFromAtmosphere: skyColorAt ? "yes" : "no (haze colour)",
    animating: animating ? 1 : 0,
    time: +lastT.toFixed(2),
    buildMs: +buildMs.toFixed(1),
  });

  // Development only: the proof harness (world-tests/v3-life.mjs) reads this.
  const w = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : null;
  const debugHook =
    process.env.NODE_ENV !== "production" && w
      ? () => ({
          ...stats(),
          flockCentres: flocks.map((f) => {
            const v = f.sphere.center.clone().project(camera);
            return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(4), onScreen: f.onScreen, dist: Math.round(camPos.distanceTo(f.sphere.center)) };
          }),
          chimneys: chimneys.map((c) => ({ name: c.from, ndc: c.pos.clone().project(camera).toArray().map((n) => +n.toFixed(3)), dist: Math.round(camPos.distanceTo(c.pos)) })),
          smoke: smoke ? { drawn: (smoke.geometry as THREE.InstancedBufferGeometry).instanceCount > 0, ndc: plumes.map((c) => c.pos.clone().project(camera).toArray().map((n) => +n.toFixed(3))) } : null,
          flies: flies ? { drawn: (flies.geometry as THREE.InstancedBufferGeometry).instanceCount > 0, dist: Math.round(camPos.distanceTo(fliesSphere.center)) } : null,
        })
      : null;
  if (w && debugHook) w.__worldLife = debugHook;

  return {
    name: "life",
    update(time: number) {
      return pose(time);
    },
    isAnimating() {
      return animating;
    },
    dispose() {
      for (const o of owned) o.parent?.remove(o);
      for (const d of disposables) d.dispose();
      owned.length = 0;
      disposables.length = 0;
      if (w && w.__worldLife === debugHook) delete w.__worldLife;
    },
    stats,
  };
};
