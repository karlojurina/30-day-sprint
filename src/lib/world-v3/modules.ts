/**
 * The contract between the V3 scene and its look modules.
 *
 * V3 keeps V2's camera, rail, park flight and interface, and replaces how the
 * world LOOKS through five independent modules, each installed once after the
 * glb loads:
 *
 *   atmosphere.ts  sky dome, sun disc and glow, far ridge silhouettes, lights,
 *                  fog colour, colour grade
 *   surfaces.ts    terrain material (painted colour zones + brush texture),
 *                  water (sea, lake, pond) and the river ribbon
 *   forest.ts      stylised conifers and broadleaf trees, cottages and rocks;
 *                  removes the glb's kit trees (T*), rocks (R*) and houses
 *                  (House4000*)
 *   landmarks.ts   the eight landmarks rebuilt as stylised models; removes the
 *                  glb's LM_* primitives and puts new objects under the SAME
 *                  names so markers and the park solver find them
 *   life.ts        things that move on their own: birds, cloud shadows,
 *                  smoke, sail rotation hooks
 *
 * Install order (scene.ts): atmosphere, surfaces, forest, landmarks, life.
 * The scene indexes landmarks and water AFTER every module has installed.
 *
 * Coordinates: three.js, Y up. The camera travels toward -z. World fraction
 * t in [0,1] maps to z = 1000 - 2000 t. Terrain spans x -868..868,
 * z -1000..1000. See modules' own headers for anything they add.
 */
import type * as THREE from "three";

export interface LandmarkBase {
  /** Base centre on the ground, world units. */
  x: number;
  y: number;
  z: number;
  /** Height of the original primitive, for scale reference. */
  height: number;
}

export interface WorldCtx {
  scene: THREE.Scene;
  /** The loaded glb root, already added to `scene`. */
  root: THREE.Object3D;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  /** Terrain height at (x, z); clamps outside the terrain. */
  heightAt(x: number, z: number): number;
  /** Walking path's lateral x at a world z. */
  pathXAtZ(z: number): number;
  /** River centre-line x at a world z; NaN where there is no river. */
  riverXAtZ(z: number): number;
  /** The eight LM_* bases as they were in the glb, keyed by mesh name. */
  landmarks: Readonly<Record<string, LandmarkBase>>;
  /** Unit vector from the world TOWARD the sun. Fixed for the whole scene. */
  sunDir: THREE.Vector3;
  /** Linear-space sun colour. */
  sunColor: THREE.Color;
  /** Linear-space fog/haze colour at the horizon. */
  hazeColor: THREE.Color;
  reducedMotion: boolean;
}

export interface WorldModule {
  name: string;
  /**
   * Called every rendered frame with seconds since start and the frame's dt.
   * Return true if anything visible changed, so the scene keeps rendering.
   * Omit for static modules.
   */
  update?(time: number, dt: number): boolean;
  /** True while this module has something animating on screen. */
  isAnimating?(): boolean;
  dispose(): void;
  /** Numbers for the harness: triangles, instances, bytes, ms to build. */
  stats?(): Record<string, number | string>;
}

export type InstallFn = (ctx: WorldCtx) => WorldModule | Promise<WorldModule>;
