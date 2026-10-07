/**
 * Locked mode's end view: for each frontier, where along the next stretch the
 * camera sees the NEXT place best. Prints the peek distance per frontier, the
 * numbers behind scene.ts LOCK_PEEK_UNITS.
 *
 *   node --import ./world-tests/v4-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v4-lockpeek.mjs
 *
 * Uses the scene's own rail and ground. A landmark sample point counts when it
 * is inside the frame (clear of the page chrome at the edges) and the terrain
 * does not rise above the line from the camera to it. Score = share of points
 * seen x on-screen height (full marks at a quarter of the frame), with a small
 * pull toward the shorter peek. Searched from 40 units past the stop to 70% of
 * the stretch, at the 16:10 aspect.
 *
 * Grey pass 2: landmark heights are layout's (PLACES.height; the falls, the
 * Climb and the Great Tree are capped at the part a stop frames), and the
 * floating isles block a sight line as the rock cones they hang as (the
 * observatory is not "seen" from under the Sky Island).
 */
import * as THREE from "three";
import { createRail } from "../src/lib/world-v4/rail.ts";
import { PLACES, WORLD, ISLAND_DEPTH, BOUNTY_DEPTH, HARBOUR_DEPTH } from "../src/lib/world-v4/layout.ts";
import { terrainHeight } from "../src/lib/world-v4/terrain.ts";

const { railGround } = await import("../src/lib/world-v4/scene.ts");
const rail = createRail();
rail.setGround(railGround);
// Layout's landmark heights, capped at 360 (the falls and the Climb run off the frame's top).
const HEIGHT = PLACES.map((p) => Math.min(360, p.height));
const ISLES = [
  [WORLD.island, ISLAND_DEPTH],
  [WORLD.bountyIsle, BOUNTY_DEPTH],
  [WORLD.harbourIsle, HARBOUR_DEPTH],
];
/** Inside a floating isle: under its top, within its rock cone. */
function inIsle(x, y, z) {
  for (const [I, depth] of ISLES) {
    const below = I.y - y;
    if (below <= 0 || below >= depth) continue;
    if (Math.hypot(x - I.x, z - I.z) < I.r * (1 - below / depth)) return true;
  }
  return false;
}
const cam = new THREE.PerspectiveCamera(31, 1.6, 1, 20000);
const pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
const v = new THREE.Vector3();

function clear(a, b) {
  const n = Math.max(6, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 40));
  for (let i = 1; i < n; i++) {
    const f = (i / n) * 0.96;
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    const z = a.z + (b.z - a.z) * f;
    if (terrainHeight(x, z) > y + 2 || inIsle(x, y, z)) return false;
  }
  return true;
}

function view(s, k) {
  rail.sampleS(s, pose);
  cam.position.copy(pose.position);
  cam.lookAt(pose.target);
  cam.updateMatrixWorld();
  const p = PLACES[k].pos;
  const h = HEIGHT[k];
  const w = Math.min(90, Math.max(12, h * 0.45)) / 2;
  const pts = [];
  for (let i = 0; i <= 4; i++) pts.push([p.x, p.y + (h * i) / 4, p.z]);
  pts.push([p.x - w, p.y + h / 2, p.z], [p.x + w, p.y + h / 2, p.z], [p.x, p.y + h / 2, p.z - w], [p.x, p.y + h / 2, p.z + w]);
  let seen = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const q of pts) {
    v.set(q[0], q[1], q[2]);
    const behind = v.clone().applyMatrix4(cam.matrixWorldInverse).z > -1;
    v.project(cam);
    if (behind || v.x < -0.9 || v.x > 0.9 || v.y < -0.55 || v.y > 0.8) continue;
    if (!clear(pose.position, new THREE.Vector3(q[0], q[1], q[2]))) continue;
    seen++;
    lo = Math.min(lo, v.y);
    hi = Math.max(hi, v.y);
  }
  const share = seen / pts.length;
  const height = seen ? (hi - lo) / 2 : 0;
  return { share, height, score: share * Math.min(1, height / 0.25) };
}

const out = [];
for (let k = 0; k < 7; k++) {
  const s0 = rail.stopS[k];
  const len = rail.stopS[k + 1] - s0;
  let best = null;
  for (let d = 40; d <= 0.7 * len; d += 10) {
    const r = view(s0 + d, k + 1);
    const score = r.score - 0.15 * (d / len);
    if (!best || score > best.score) best = { d, score, ...r };
  }
  const now = view(s0 + 0.22 * len, k + 1);
  out.push({ frontier: PLACES[k].id, next: PLACES[k + 1].id, stretch: Math.round(len), peek: best.d, share: +(best.d / len).toFixed(2), seen: +best.share.toFixed(2), height: +best.height.toFixed(2), at22: { seen: +now.share.toFixed(2), height: +now.height.toFixed(2) } });
}
console.table(out);
console.log("LOCK_PEEK_UNITS =", JSON.stringify(out.map((o) => o.peek)));
