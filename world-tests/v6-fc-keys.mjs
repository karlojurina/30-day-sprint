// Frame cleanup: print TRAIL keys 55-70 with route s, kind and view.
import * as THREE from "three";
import * as L from "../src/lib/world-v6/layout.ts";
const { TRAIL, TRAIL_KIND, TRAIL_VIEW } = L;
const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const pc = new THREE.CatmullRomCurve3(TRAIL.map(v3), false, "centripetal");
const nK = TRAIL.length, N = 8000;
const S = [0]; let prev = pc.getPoint(0);
for (let i = 1; i <= N; i++) { const p = pc.getPoint(i / N); S.push(S[i - 1] + p.distanceTo(prev)); prev = p; }
const sAt = (k) => S[Math.round((k / (nK - 1)) * N)];
console.log("nK", nK, "STAR_KEY", L.STAR_KEY, "FLIGHT", JSON.stringify(L.FLIGHT_KEYS));
for (let k = 52; k < Math.min(nK, 72); k++) console.log(k, Math.round(sAt(k)), TRAIL_KIND[k], TRAIL[k].map(Math.round).join(","), JSON.stringify(TRAIL_VIEW[k]), L.fovAtKey(k));
