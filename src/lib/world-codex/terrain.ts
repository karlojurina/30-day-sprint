/** A deterministic, self-contained landscape for the Codex design study. */
export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function hash(x: number, y: number) {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
export function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const u = smooth(0, 1, x - ix), v = smooth(0, 1, y - iy);
  return (hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u) * (1 - v)
    + (hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u) * v;
}
export function randomGenerator(seed = 1977) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
}
export const riverX = (z: number) => 35 + 105 * Math.sin(-z / 245 + 0.25) + 30 * Math.sin(-z / 103);
export const riverY = (z: number) => 2 + 150 * Math.pow(clamp(-z / 1780), 1.65);
export const riverWidth = (z: number) => 13 + 9 * (1 - clamp(-z / 1600));

export const LANDMARKS = [
  { x: -145, z: 25, height: 52, depth: 0 },
  { x: 215, z: -235, height: 36, depth: 0.14 },
  { x: riverX(-465), z: -465, height: 20, depth: 0.27 },
  { x: riverX(-720), z: -720, height: 49, depth: 0.41 },
  { x: -182, z: -970, height: 44, depth: 0.55 },
  { x: 175, z: -1200, height: 25, depth: 0.69 },
  { x: riverX(-1450) + 85, z: -1450, height: 6, depth: 0.83 },
  { x: -62, z: -1950, height: 52, depth: 1 },
] as const;

function baseHeight(x: number, z: number) {
  const t = clamp(-z / 1850);
  const distance = Math.abs(x - riverX(z));
  const shoulder = smooth(35, 340, distance);
  const broad = noise(x * 0.005 + 50, z * 0.003);
  const detail = noise(x * 0.017, z * 0.014);
  let h = riverY(z) - 7 + smooth(riverWidth(z) * 0.68, 66, distance)
    * (13 + broad * 34 + detail * 9);
  h += shoulder * (30 + broad * 150 + t * 95);
  // Distinct, asymmetric massing: a coastal headland, a gorge and a summit.
  h += 55 * Math.exp(-((x + 205) ** 2 / 24000 + (z - 20) ** 2 / 29000));
  h += 145 * Math.exp(-((x + 355) ** 2 / 46000 + (z + 760) ** 2 / 70000));
  h += 230 * Math.exp(-((x - 490) ** 2 / 58000 + (z + 1210) ** 2 / 100000));
  h += 275 * Math.exp(-((x + 70) ** 2 / 35000 + (z + 1950) ** 2 / 39000));
  const shore = 105 + 44 * Math.sin(x / 140) + 29 * Math.sin(x / 65);
  h = h * (1 - smooth(shore - 75, shore + 35, z)) - 15 * smooth(shore - 15, shore + 60, z);
  const channel = (1 - smooth(riverWidth(z) * .7, riverWidth(z) + 15, distance)) * smooth(-1680, -1560, z);
  h = h * (1 - channel) + (riverY(z) - 7) * channel;
  // A broad, level basin for the pond, cut into the same terrain.
  const pondDistance = Math.hypot((x - riverX(-1450)) / 1.35, z + 1450);
  h = h * smooth(42, 85, pondDistance) + (riverY(-1450) - 3) * (1 - smooth(42, 85, pondDistance));
  return h;
}

const terraces = [0, 1, 4, 5, 7].map(index => ({ ...LANDMARKS[index], y: baseHeight(LANDMARKS[index].x, LANDMARKS[index].z), radius: index === 7 ? 29 : 18 }));
export function terrainHeight(x: number, z: number) {
  let h = baseHeight(x, z);
  for (const a of terraces) {
    const blend = 1 - smooth(a.radius, a.radius + 30, Math.hypot(x - a.x, z - a.z));
    h += (a.y - h) * blend;
  }
  return h;
}

// The walking route crosses the river at the two bridges, then climbs the west bank.
export const PATH_POINTS: ReadonlyArray<readonly [number, number]> = [
  [-145, 25], [-120, -70], [45, -120], [205, -170], [215, -235],
  [245, -320], [205, -405], [riverX(-465) + 68, -465],
  [riverX(-465) - 68, -465], [-90, -550], [-110, -650],
  [riverX(-720) - 108, -720], [riverX(-720) + 108, -720],
  [110, -825], [-65, -880], [-182, -970], [-135, -1060],
  [85, -1130], [175, -1200], [155, -1300],
  [riverX(-1450) + 88, -1380], [riverX(-1450) + 85, -1450],
  [100, -1560], [-130, -1650], [10, -1735], [-170, -1820], [-62, -1950],
];
