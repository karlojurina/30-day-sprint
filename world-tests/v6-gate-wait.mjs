/**
 * The Gate isle waits for the flight (second Loom's fix round, 2026-10-16).
 * Lovro, 5:20 to 5:44, on the cloud bank that hid the Gate isle from the Sky
 * Island, the bridge and the Ad Bounty: "very distracting". The bank is gone;
 * scene.ts (updateGate) draws the isle and everything on it (the arch, the
 * isle's body and rocks, its lanterns and lamps, the loop ship, the arch's
 * motes and the two ships leaving it) from the moored deck on, the flight's
 * first key, and while the camera is parked at a8 or flying to or from it.
 * Leaving such a park for a view that has the isle in the frame, it stays
 * until the camera turns from it.
 *
 *   node --import ./world-tests/v6-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v6-gate-wait.mjs [--app]
 *
 * Offline (no browser, no server, about a minute), on the scene's own rail
 * (createRail with railGround):
 *   1  the switch never shows: from the walk across the bounty isle (the
 *      key before the moored deck) to two keys into the flight, no sight
 *      point of the isle (its top, its underside, the arch's face) is in the
 *      frame and clear of terrain, the other isles and the cloud layer, at
 *      16:9, 1.92 (Lovro's window), 2.79 (the widest review size) and 3.4,
 *      and none of the loop ship's loop at 16:9 and 1.92 (wider, part of it
 *      is in the frame: reported);
 *   2  the Ad Bounty's click-in parks before the switch (so the isle is not
 *      drawn there; the click-in would see it from 1.92 up), a8's stop after;
 *   3  the cloud bank is gone from dress-sky.ts;
 *   and, for the record, the stretches before the flight that would see the
 *   isle at 1.92 if it were drawn.
 * --app, on the dev server (http://localhost:3111, never started here), plain
 * /dev/world-app at 1920 x 1000:
 *   4  rail views before the moored deck (the arrival on the island, Lovro's
 *      5:22 view, the bridge, the walk to the ship): the Gate not drawn (the
 *      scene's flag, the arch, the isle's zone, its rocks); from the moored
 *      deck on, the flight and a8: drawn;
 *   5  parked at the Ad Bounty from the bridge: not drawn; parked at a8 from
 *      the island: drawn; back on the island's arrival view, where the isle
 *      is in the frame: still drawn; turned from it (the rise): not drawn, and
 *      the arrival view again: not drawn;
 *   6  0 page errors, 0 requests to /api or Supabase.
 *
 * Exit 1 on any FAIL.
 */
import * as THREE from "three";
import * as L from "../src/lib/world-v6/layout.ts";
import { terrainHeight } from "../src/lib/world-v6/terrain.ts";
import { createRail } from "../src/lib/world-v6/rail.ts";
import { railGround } from "../src/lib/world-v6/scene.ts";
import { BOUNTY } from "../src/lib/world-v6/bounty.ts";

const { WORLD, PLACES } = L;
const APP = process.argv.includes("--app");
let failures = 0;
const check = (name, pass, value) => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
};

// ── The rail as the scene builds it ──
const rail = createRail();
rail.setGround(railGround);
const nK = L.TRAIL.length;
const pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
const sOfKey = (k) => {
  let lo = 0;
  let hi = rail.length;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (rail.tAtS(m) * (nK - 1) < k) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
};

// ── What hides the isle ──
const ISLES = [
  { c: WORLD.island, depth: L.ISLAND_DEPTH },
  { c: WORLD.bountyIsle, depth: L.BOUNTY_DEPTH },
  { c: WORLD.gateIsle, depth: L.GATE_DEPTH },
];
const inIsle = (x, y, z) => {
  for (const { c, depth } of ISLES) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < c.r && y <= c.y && y >= c.y - depth * (1 - d / c.r)) return true;
  }
  return false;
};
const CL = WORLD.cloudClear;
const inCloudAt = (x, z) => Math.hypot(x - CL.x, z - CL.z) > CL.r;
function hidden(o, p) {
  const dx = p[0] - o.x;
  const dy = p[1] - o.y;
  const dz = p[2] - o.z;
  const steps = Math.ceil(Math.hypot(dx, dy, dz) / 12);
  let prevY = o.y;
  for (let k = 2; k < steps - 2; k++) {
    const u = k / steps;
    const x = o.x + dx * u;
    const y = o.y + dy * u;
    const z = o.z + dz * u;
    if (terrainHeight(x, z) > y) return true;
    if (inIsle(x, y, z)) return true;
    if ((prevY - WORLD.cloudLevel) * (y - WORLD.cloudLevel) <= 0 && inCloudAt(x, z)) return true;
    prevY = y;
  }
  return false;
}

// ── The isle's sight points ──
const target = [];
{
  const H = WORLD.gateIsle;
  for (let ri = 0; ri <= 6; ri++) {
    const r = (ri / 6) * H.r;
    const n = ri === 0 ? 1 : 28;
    for (let a = 0; a < n; a++) {
      const th = (a / n) * Math.PI * 2;
      const x = H.x + Math.cos(th) * r;
      const z = H.z + Math.sin(th) * r;
      target.push([x, H.y + 40, z]);
      target.push([x, H.y - L.GATE_DEPTH * (1 - r / H.r) - 4, z]);
    }
  }
  const G = L.GATE;
  const ax = Math.sin((G.axis * Math.PI) / 180);
  const az = -Math.cos((G.axis * Math.PI) / 180);
  for (let u = -0.5; u <= 0.5; u += 0.05)
    for (let h = 0; h <= 1.0001; h += 0.05) target.push([G.x - az * (G.openW + 2 * G.pillarW) * u, G.y + G.height * h, G.z + ax * (G.openW + 2 * G.pillarW) * u]);
}
/** blocks.ts's loop ship, wherever it is on its loop: 250 over the isle's top, 720 round its centre. */
const orbit = [];
for (let a = 0; a < 24; a++) {
  const th = (a / 24) * Math.PI * 2;
  orbit.push([WORLD.gateIsle.x + Math.cos(th) * 720, WORLD.gateIsle.y + 250, WORLD.gateIsle.z + Math.sin(th) * 720]);
}
const cam = new THREE.PerspectiveCamera(31, 1.92, 1, 30000);
const v = new THREE.Vector3();
/** Sight points (the isle's by default) in the frame and clear, from p looking at q. */
function seen(p, q, fov, aspect, pts = target) {
  cam.fov = fov;
  cam.aspect = aspect;
  cam.position.copy(p);
  cam.lookAt(q);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  let n = 0;
  for (const t of pts) {
    v.set(t[0], t[1], t[2]).project(cam);
    if (!(v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1)) continue;
    if (hidden(p, t)) continue;
    n++;
  }
  return n;
}

// ── 1 ──
const ASPECTS = [["16:9", 16 / 9], ["1.92", 1.92], ["2.79", 2.79], ["3.4", 3.4]];
const sW0 = sOfKey(L.FLIGHT_KEYS.first - 1);
const sW1 = sOfKey(L.FLIGHT_KEYS.first + 2);
const sSwitch = rail.flightS[0];
{
  let frames = 0;
  const worst = {};
  const ship = {};
  for (let s = sW0; s <= sW1; s += 4) {
    rail.sampleS(s, pose);
    const fov = rail.fovAtS(s);
    const key = +(rail.tAtS(s) * (nK - 1)).toFixed(2);
    frames++;
    for (const [name, a] of ASPECTS) {
      const n = seen(pose.position, pose.target, fov, a);
      if (n && (!worst[name] || n > worst[name].n)) worst[name] = { n, key };
      const m = seen(pose.position, pose.target, fov, a, orbit);
      if (m) ship[name] = { from: ship[name]?.from ?? key, to: key };
    }
  }
  check(
    `1 the switch never shows: from the walk across the bounty isle (key ${L.FLIGHT_KEYS.first - 1}) to two keys into the flight (key ${L.FLIGHT_KEYS.first + 2}), the isle and its arch are out of the frame at ${ASPECTS.map(([n]) => n).join(", ")}, and the loop ship's whole loop at 16:9 and 1.92; the scene draws them from the moored deck (key ${L.FLIGHT_KEYS.first})`,
    Object.keys(worst).length === 0 && !ship["16:9"] && !ship["1.92"] && sSwitch > sW0 && sSwitch < sW1,
    `${frames} frames, every 4 units; the isle: ${Object.keys(worst).length ? `seen ${JSON.stringify(worst)}` : "never in the frame"}; part of the loop ship's loop in the frame: ${Object.keys(ship).length ? Object.entries(ship).map(([n, r]) => `${n} keys ${r.from} to ${r.to}`).join(", ") : "never"} (the ship pops in there only if it is on that part of its loop as the camera steps onto the deck)`,
  );
}

// ── 2 ──
{
  const sB = rail.sNearest(BOUNTY.x, BOUNTY.z);
  const k = BOUNTY.park;
  const b = (k.bearing * Math.PI) / 180;
  const pt = (k.pitch * Math.PI) / 180;
  const p = new THREE.Vector3(k.x, k.y, k.z);
  const q = p.clone().add(new THREE.Vector3(Math.sin(b) * Math.cos(pt), -Math.sin(pt), -Math.cos(b) * Math.cos(pt)).multiplyScalar(500));
  const would = ASPECTS.map(([n, a]) => `${n} ${seen(p, q, k.fov, a)}`).join(", ");
  const sA8 = rail.stopS[PLACES.length - 1];
  check(
    "2 the Ad Bounty's click-in parks before the switch (not drawn there) and a8's stop after it (drawn)",
    sB < sSwitch && sA8 > sSwitch,
    `the click-in's rail point at key ${(rail.tAtS(sB) * (nK - 1)).toFixed(2)}, the switch at key ${L.FLIGHT_KEYS.first}, a8 at key ${PLACES[PLACES.length - 1].trail}; drawn, the click-in would see ${would} of ${target.length} sight points`,
  );
}

// ── 3 ──
{
  await import("../src/lib/world-v6/rocks.ts");
  const SKY = await import("../src/lib/world-v6/dress-sky.ts");
  check("3 the cloud bank is gone from dress-sky.ts", !("GATE_BANK" in SKY) && !("gateBank" in SKY) && !("gateBankTop" in SKY), Object.keys(SKY).filter((n) => /bank/i.test(n)).join(", ") || "no bank exported");
}

// ── For the record: where the isle would be seen before the flight if it were drawn (1.92) ──
{
  const runs = [];
  let run = null;
  for (let s = rail.stopS[PLACES.length - 2] - 1600; s < sW0; s += 16) {
    rail.sampleS(s, pose);
    const n = seen(pose.position, pose.target, rail.fovAtS(s), 1.92);
    const key = +(rail.tAtS(s) * (nK - 1)).toFixed(2);
    if (n) {
      if (!run) runs.push((run = { from: key, to: key, most: n }));
      run.to = key;
      run.most = Math.max(run.most, n);
    } else run = null;
  }
  console.log(`for the record, drawn the isle would be seen at 1.92 before the bounty isle's walk at keys ${runs.map((r) => `${r.from} to ${r.to} (up to ${r.most} points)`).join(", ") || "none"}`);
}

// ── 4 to 6: the scene itself ──
if (APP) {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const puppeteer = require("puppeteer-core");
  const ORIGIN = process.env.BASE_URL || "http://localhost:3111";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new",
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
    protocolTimeout: 180000,
  });
  const waitFor = async (page, fn, arg, timeout, what) => {
    const t0 = Date.now();
    for (;;) {
      try {
        const r = await page.evaluate(fn, arg);
        if (r) return r;
      } catch {}
      if (Date.now() - t0 > timeout) throw new Error(what);
      await sleep(150);
    }
  };
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    const errors = [];
    const api = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
    page.on("request", (req) => {
      try {
        const u = new URL(req.url());
        if ((u.origin === ORIGIN && u.pathname.startsWith("/api")) || /supabase/i.test(u.hostname)) api.push(u.pathname);
      } catch {}
    });
    await page.setViewport({ width: 1920, height: 1000, deviceScaleFactor: 1 });
    await page.goto(`${ORIGIN}/dev/world-app?arrive=0&poster=off`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await waitFor(page, () => window.__worldReady === true || typeof window.__worldError === "string", null, 180000, "map ready");
    const settle = async () => {
      let last = -1;
      let still = 0;
      const t0 = Date.now();
      for (;;) {
        const f = await page.evaluate(() => {
          const fr = window.__worldFrame;
          return fr ? { d: fr.depth, p: fr.parkProgress, fl: fr.flight, id: fr.parkedId } : null;
        });
        if (f && f.fl >= 0.999 && (f.p === 0 || f.p >= 0.999) && Math.abs(f.d - last) < 2e-6) {
          if (++still >= 3) break;
        } else still = 0;
        if (f) last = f.d;
        if (Date.now() - t0 > 30000) throw new Error("did not settle");
        await sleep(150);
      }
      await sleep(400);
    };
    const seed = async (depth) => {
      await page.evaluate((d) => {
        const sc = window.__worldV6Debug;
        window.scrollTo(0, Math.round(sc.scrollYForDepth(d)));
        sc.seedDepth(d);
      }, depth);
      await settle();
    };
    const state = () =>
      page.evaluate(() => {
        const S = window.__worldV6Debug.debugScene();
        const vis = (n) => S.getObjectByName(n)?.visible ?? null;
        return { flag: S.userData.gateShown ?? null, arch: vis("LM_StoneArch"), zone: vis("Zone_gate"), rocks: vis("Rocks:gate"), bank: S.getObjectByName("Sky_GateBank") ? "present" : "gone" };
      });
    const drawn = (s) => s.flag === true && s.arch === true && s.zone === true && s.rocks === true;
    const notDrawn = (s) => s.flag === false && s.arch === false && s.zone === false && s.rocks === false;
    const depthAtS = (sv) => page.evaluate((x) => window.__worldV6Debug.debugRail().depthOfS(x), sv);
    const depthAtKey = (k) => depthAtS(sOfKey(k));
    // 4
    const before = [];
    for (const [name, d] of [
      ["the arrival on the island (key 60)", await depthAtKey(60)],
      ["Lovro's 5:22 view (depth 0.786)", 0.786],
      ["the bridge (key 68)", await depthAtKey(68)],
      ["the walk to the ship, just short of the moored deck", await depthAtS(sSwitch - 20)],
    ]) {
      await seed(d);
      before.push([name, await state()]);
    }
    check("4 the rail before the moored deck: the Gate not drawn, no cloud bank", before.every(([, s]) => notDrawn(s) && s.bank === "gone"), before.map(([n, s]) => `${n} ${JSON.stringify(s)}`).join("; "));
    const after = [];
    for (const [name, d] of [
      ["the moored deck", await depthAtS(sSwitch + 1)],
      ["the flight (key 75)", await depthAtKey(75)],
      ["a8's stop", await page.evaluate(() => window.__worldV6Debug.debugRail().stopDepth(7))],
    ]) {
      await seed(d);
      after.push([name, await state()]);
    }
    check("4 from the moored deck on: the Gate drawn", after.every(([, s]) => drawn(s)), after.map(([n, s]) => `${n} ${JSON.stringify(s)}`).join("; "));
    // 5
    const park = async (id) => {
      await page.evaluate((i) => window.__worldPark(i), id);
      await waitFor(page, (i) => window.__worldFrame?.parkedId === i && window.__worldFrame.parkProgress >= 0.999, id, 30000, "park " + id);
      await sleep(600);
    };
    const unpark = async () => {
      await page.evaluate(() => window.__worldPark(null));
      await waitFor(page, () => window.__worldFrame?.parkedId === null && window.__worldFrame.parkProgress === 0 && window.__worldFrame.flight >= 0.999, null, 30000, "unpark");
      await sleep(600);
    };
    await seed(await depthAtKey(68));
    await park("bounty");
    const atBounty = await state();
    await unpark();
    await seed(await depthAtKey(60));
    await park("a8");
    const atA8 = await state();
    await unpark();
    const heldBack = await state();
    await seed(await depthAtKey(57));
    const turnedAway = await state();
    await seed(await depthAtKey(60));
    const againArrival = await state();
    check(
      "5 parks: not drawn at the Ad Bounty; drawn at a8 from the island; still drawn back on the arrival view (in its frame); gone once turned from it (the rise) and on the arrival view after",
      notDrawn(atBounty) && drawn(atA8) && drawn(heldBack) && notDrawn(turnedAway) && notDrawn(againArrival),
      `the Ad Bounty ${JSON.stringify(atBounty)}; a8 ${JSON.stringify(atA8)}; back ${JSON.stringify(heldBack)}; the rise ${JSON.stringify(turnedAway)}; the arrival again ${JSON.stringify(againArrival)}`,
    );
    check("6 0 page errors, 0 requests to /api or Supabase", errors.length === 0 && api.length === 0, `${errors.length} errors${errors.length ? ` (${errors[0]})` : ""}, ${api.length} requests`);
  } finally {
    await browser.close();
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nall pass");
process.exit(failures ? 1 : 0);
