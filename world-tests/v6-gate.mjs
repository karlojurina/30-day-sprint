/**
 * v6 the Gate of the Sun (world_art_bible_v6.md 1.19, 1.20, 5.1).
 *
 *   node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v6-gate.mjs
 *
 *   - the stone dock's head (GATE_DOCK) is under the docked ship's bow
 *     (SHIP_DOCKED + SHIP.length / 2 along its heading, within 6);
 *   - the causeway runs from the dock to the arch's threshold, on the isle;
 *   - the arch's axis is on the docking line (within 5 degrees of the ship's
 *     heading) and the arch stands on the Gate isle;
 *   - from the a8 stop the sunrise's disc (az 322, el 4: the bible's
 *     `sunrise` key) is inside the arch opening's screen box, and the arch is
 *     at x 0.55-0.75 (1691x1278, the stop's lens);
 *   - the tail (final pass B: it ends on the arch instead of flying through it
 *     into the gold, which ended on blank sky) stays short of the arch's plane,
 *     on its axis (within 12), and its last frame has the sun's disc inside the
 *     opening's screen box and the arch's head in frame.
 * Exit code 1 on any failure.
 */
import * as THREE from "three";
import * as L from "../src/lib/world-v6/layout.ts";
import { createRail } from "../src/lib/world-v6/rail.ts";
import { railGround } from "../src/lib/world-v6/scene.ts";

let failures = 0;
const check = (name, pass, value) => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
};
const r1 = (v) => Math.round(v * 10) / 10;
const G = L.GATE;
const D = L.GATE_DOCK;
const I = L.WORLD.gateIsle;
const SUN = { az: 322, el: 4 };
const dir = (b) => [Math.sin((b * Math.PI) / 180), -Math.cos((b * Math.PI) / 180)];

// The dock under the bow.
{
  const [hx, hz] = dir(L.SHIP_DOCKED.heading);
  const bow = [L.SHIP_DOCKED.x + (hx * L.SHIP.length) / 2, L.SHIP_DOCKED.z + (hz * L.SHIP.length) / 2];
  const d = Math.hypot(bow[0] - D.x, bow[1] - D.z);
  check("the dock's head is under the docked ship's bow (<= 6)", d <= 6, `${r1(d)} from the bow (${bow.map(Math.round).join(", ")})`);
}
// The causeway and the arch on the isle, on the docking line.
{
  const C = L.GATE_CAUSEWAY;
  const onIsle = C.every((p) => Math.hypot(p.x - I.x, p.z - I.z) <= I.r + 10);
  const ends = Math.hypot(C[0].x - D.x, C[0].z - D.z) < 1 && Math.hypot(C[C.length - 1].x - G.x, C[C.length - 1].z - G.z) < 1;
  check("the causeway runs on the isle from the dock to the arch's threshold", onIsle && ends, `${C.length} points`);
  let da = Math.abs(G.axis - L.SHIP_DOCKED.heading) % 360;
  if (da > 180) da = 360 - da;
  check("the arch stands on the isle, its axis on the docking line (<= 5 degrees)", Math.hypot(G.x - I.x, G.z - I.z) < I.r - G.openW && da <= 5, `axis ${G.axis}, ship heading ${L.SHIP_DOCKED.heading}`);
}
// From a8: the sun inside the opening; the arch at x 0.55-0.75.
{
  const a8 = L.PLACES[7];
  const cam = new THREE.PerspectiveCamera(L.TRAIL_FOV[a8.trail], 1691 / 1278, 1, 20000);
  cam.position.set(...L.TRAIL[a8.trail]);
  cam.lookAt(...L.LOOK[a8.trail]);
  cam.updateMatrixWorld();
  const [cx, cz] = dir(G.axis + 90);
  const half = G.openW / 2;
  const corners = [
    [G.x - cx * half, G.y, G.z - cz * half],
    [G.x + cx * half, G.y, G.z + cz * half],
    [G.x - cx * half, G.y + G.openH, G.z - cz * half],
    [G.x + cx * half, G.y + G.openH, G.z + cz * half],
  ].map((p) => new THREE.Vector3(...p).project(cam));
  const box = { x0: Math.min(...corners.map((v) => v.x)), x1: Math.max(...corners.map((v) => v.x)), y0: Math.min(...corners.map((v) => v.y)), y1: Math.max(...corners.map((v) => v.y)) };
  const [sx, sz] = dir(SUN.az);
  const e = (SUN.el * Math.PI) / 180;
  const sunP = cam.position.clone().add(new THREE.Vector3(sx * Math.cos(e), Math.sin(e), sz * Math.cos(e)).multiplyScalar(10000)).project(cam);
  const inside = sunP.z < 1 && sunP.x > box.x0 && sunP.x < box.x1 && sunP.y > box.y0 && sunP.y < box.y1;
  check("from a8 the sunrise's disc (az 322, el 4) is inside the arch opening's screen box", inside, `sun at (${sunP.x.toFixed(2)}, ${sunP.y.toFixed(2)}); opening x ${box.x0.toFixed(2)}..${box.x1.toFixed(2)}, y ${box.y0.toFixed(2)}..${box.y1.toFixed(2)}`);
  const ax = ((box.x0 + box.x1) / 2 + 1) / 2;
  check("from a8 the arch sits at x 0.55-0.75", ax >= 0.55 && ax <= 0.75, `x ${ax.toFixed(3)}`);
}
// The tail: up the causeway on the arch's axis, ending short of it with the
// sun framed in the opening (final pass B).
{
  const rail = createRail();
  rail.setGround(railGround);
  const pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  const [ax, az] = dir(G.axis);
  const [cx, cz] = dir(G.axis + 90);
  let crossed = null;
  for (let s = rail.stopS[7]; s <= rail.length; s += 1) {
    rail.sampleS(s, pose);
    const p = pose.position;
    if ((p.x - G.x) * ax + (p.z - G.z) * az >= 0) {
      crossed = { s: Math.round(s) };
      break;
    }
  }
  rail.sampleS(rail.length, pose);
  const end = pose.position.clone();
  const lateral = Math.abs((end.x - G.x) * cx + (end.z - G.z) * cz);
  const cam = new THREE.PerspectiveCamera(rail.fovAtS(rail.length), 1691 / 1278, 1, 20000);
  cam.position.copy(end);
  cam.lookAt(pose.target);
  cam.updateMatrixWorld();
  const half = G.openW / 2;
  const corners = [
    [G.x - cx * half, G.y, G.z - cz * half],
    [G.x + cx * half, G.y, G.z + cz * half],
    [G.x - cx * half, G.y + G.openH, G.z - cz * half],
    [G.x + cx * half, G.y + G.openH, G.z + cz * half],
  ].map((q) => new THREE.Vector3(...q).project(cam));
  const box = { x0: Math.min(...corners.map((v) => v.x)), x1: Math.max(...corners.map((v) => v.x)), y0: Math.min(...corners.map((v) => v.y)), y1: Math.max(...corners.map((v) => v.y)) };
  const [sx, sz] = dir(SUN.az);
  const e = (SUN.el * Math.PI) / 180;
  const sunP = end.clone().add(new THREE.Vector3(sx * Math.cos(e), Math.sin(e), sz * Math.cos(e)).multiplyScalar(10000)).project(cam);
  const sunIn = sunP.z < 1 && sunP.x > box.x0 && sunP.x < box.x1 && sunP.y > box.y0 && sunP.y < box.y1;
  const head = new THREE.Vector3(G.x, G.y + G.height, G.z).project(cam);
  const headIn = head.z < 1 && Math.abs(head.x) <= 1 && head.y <= 1;
  check(
    "the tail ends on the arch: short of its plane, on its axis (within 12), the sun's disc inside the opening and the arch's head in frame",
    crossed === null && lateral <= 12 && sunIn && headIn,
    `crossed ${JSON.stringify(crossed)}, off axis ${r1(lateral)}, sun (${sunP.x.toFixed(2)}, ${sunP.y.toFixed(2)}) in opening x ${box.x0.toFixed(2)}..${box.x1.toFixed(2)} y ${box.y0.toFixed(2)}..${box.y1.toFixed(2)}, head y ${head.y.toFixed(2)}`,
  );
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\ngate: all pass");
process.exit(failures ? 1 : 0);
