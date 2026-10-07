/**
 * The contract between the V4 scene and its modules (landmarks, water, light,
 * clouds, anything that adds to the world). Same idea as V3's modules.ts.
 *
 * There is no glb in V4. The scene builds the grey terrain from terrain.ts,
 * then installs each module in the order the page passes them
 * (WorldSceneOptions.modules), then indexes the landmarks the modules left
 * under the LM_* names in layout.PLACES. Any place whose LM_* object is
 * missing after install gets a grey stand-in block, so the park always has
 * something to frame. Lights and sky get a grey stand-in too when no module
 * added a light.
 *
 * Ownership: the scene owns the camera, the rail, the park, the fog
 * DISTANCES and the frame loop. A module owns everything it adds, including
 * the fog COLOUR if it wants it (scene.fog is a THREE.Fog; keep it linear).
 *
 * Coordinates: three.js, Y up, world units as layout.ts (bearing 0 = -z).
 */
import type * as THREE from "three";
import type * as Layout from "./layout";

export interface LandmarkBase {
  /** Base centre on its ground, water or island top (layout.PLACES[i].pos). */
  x: number;
  y: number;
  z: number;
  /** Rough height (layout.PLACES[i].height). */
  height: number;
}

export type LockMode = "open" | "look" | "locked";

export interface LockState {
  mode: LockMode;
  /** Index 0..7 into layout.PLACES of the student's current place. */
  frontier: number;
}

/**
 * Your airship (grey pass 2), as the rail places it: layout.SHIP's frame (origin
 * = the deck's centre at deck level, nose along `heading`). Moored at the
 * bounty isle (layout.SHIP_MOORED) until the camera boards, carrying the
 * camera through the flight (the camera stands layout.SHIP.camBack behind the
 * origin, SHIP.camUp above the deck, on the centreline), docked at the Harbour
 * Isle (layout.SHIP_DOCKED) after. A pure function of where the camera is on
 * the route, so it retraces exactly on scroll up, and a park does not move it.
 */
export interface ShipPose {
  x: number;
  y: number;
  z: number;
  /** Compass degrees the nose points to (0 = -z, 90 = +x). */
  heading: number;
  /** Roll about the ship's own forward axis (through the origin), degrees;
   *  positive lowers the starboard (right) side. Up to ~5 in the flight's turns,
   *  0 when moored or docked. Rolling about that axis keeps the deck's
   *  centreline, where the camera stands, where it is. */
  bank: number;
  /** Share of the rail's speed the ship moves at, 0..1: 0 moored or docked, 1 in
   *  flight, easing between at cast-off and at the dock (for propellers). */
  throttle: number;
  phase: "moored" | "flight" | "docked";
}

export interface WorldCtx {
  scene: THREE.Scene;
  /** Parent for anything a module adds to the world (already in `scene`). */
  root: THREE.Object3D;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  /** layout.ts, the whole module (PLACES, WORLD, PATH, STEPS, RIVER...). */
  layout: typeof Layout;
  /** terrain.terrainHeight: ground height at (x, z). */
  terrainHeight(x: number, z: number): number;
  /** Ground height, or the water surface where the sea, lake or pool covers it. */
  heightAt(x: number, z: number): number;
  /**
   * Where the camera is along the route, 0..1, as the TRAIL curve parameter
   * t: key i sits at i / (TRAIL.length - 1) (layout.ts). Live, read it every
   * frame. (light.ts and blocks.ts both read this unit.)
   */
  railU(): number;
  /** Where the camera is as a share of the route's length, 0..1. */
  routeU(): number;
  /** railU of each of the eight stops, PLACES order: PLACES[i].trail / (n - 1). */
  stopU: readonly number[];
  /** The same array as stopU, under the name light.ts reads. */
  placeU: readonly number[];
  /**
   * Where the camera is between the places: 0 at the first stop, 7 at the
   * last, fractional in between by distance (1.5 = halfway from Base Camp to
   * the Falls). Below 0 before the first stop, above 7 in the tail. Light
   * tables keyed per place interpolate on this.
   */
  placeCoord(): number;
  /**
   * Where your airship is now (see ShipPose): writes into `out` and returns it,
   * allocates nothing. Live, read it every frame: it follows the rail's scroll
   * position, so blocks.ts draws the ship under the riding camera.
   */
  shipPose(out: ShipPose): ShipPose;
  /** The eight LM_* bases from layout.PLACES, keyed by mesh name. */
  landmarks: Readonly<Record<string, LandmarkBase>>;
  /** Unit vector toward the sun. A light module may rewrite it in place every
   *  frame; the park solver reads it when it solves (sun-lit side scores better). */
  sunDir: THREE.Vector3;
  /** Linear-space sun colour. A light module may rewrite it in place. */
  sunColor: THREE.Color;
  /** Linear-space haze colour. A light module may rewrite it in place. */
  hazeColor: THREE.Color;
  /** The locking mode and frontier, mutated in place when the page changes them. */
  lock: Readonly<LockState>;
  reducedMotion: boolean;
}

export interface WorldModule {
  name: string;
  /**
   * Called every rendered frame with seconds since start and the frame's dt.
   * Return true if anything visible changed, so the scene keeps rendering.
   */
  update?(time: number, dt: number): boolean;
  /** True while this module has something animating on screen. */
  isAnimating?(): boolean;
  dispose(): void;
  /** Numbers for the harness: triangles, instances, ms to build. */
  stats?(): Record<string, number | string>;
}

export type InstallFn = (ctx: WorldCtx) => WorldModule | Promise<WorldModule>;

/** How the page hands the scene its modules: a name and a lazy import. */
export type ModuleSpec = readonly [name: string, load: () => Promise<{ install: InstallFn }>];
