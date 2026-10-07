/**
 * Round 1 verify: contact sheets from the scroll video's frames
 * (v6-r1-verify-scroll.mjs), each captioned with its time, scroll depth in vh,
 * the route key (fractional) and its ROUTE_MARKS name or kind, and the stretch.
 *
 *   node world-tests/v6-r1-verify-sheet.mjs <name> <vh0> <vh1> <count> [cols=6]
 *
 * Out: world-tests/shots/v6/round1/verify/sheet-<name>.png
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const [name, vh0s, vh1s, counts, colss] = process.argv.slice(2);
const vh0 = Number(vh0s);
const vh1 = Number(vh1s);
const count = Number(counts);
const cols = Number(colss || 6);
const ROOT = path.resolve(process.env.VERIFY_ROOT || "world-tests/shots/v6/round1/verify");
const DIR = path.join(ROOT, "scroll");
const info = JSON.parse(fs.readFileSync(path.join(DIR, "info.json"), "utf8"));
const rec = JSON.parse(fs.readFileSync(path.join(DIR, "rec.json"), "utf8"));
const { shots } = JSON.parse(fs.readFileSync(path.join(DIR, "shots.json"), "utf8"));
const markOf = Object.fromEntries(Object.entries(info.marks).map(([k, v]) => [v, k]));
for (const [id, k] of info.places) markOf[k] = "stop " + id;
const rows = rec.rows.map((r) => ({ ...r, wall: (rec.timeOrigin + r.t) / 1000 }));
const keyOfS = (s) => {
  let i = 0;
  while (i + 1 < info.keyS.length && info.keyS[i + 1] <= s) i++;
  if (i + 1 >= info.keyS.length) return i;
  return i + (s - info.keyS[i]) / (info.keyS[i + 1] - info.keyS[i]);
};
const stretch = (s) => {
  const S = info.stopS;
  if (s < S[0]) return "opening → a1";
  for (let i = 0; i + 1 < S.length; i++) if (s < S[i + 1]) return `a${i + 1} → a${i + 2}`;
  return "a8 → tail";
};
let j = 0;
const tagged = shots.map((sh) => {
  while (j + 1 < rows.length && rows[j + 1].wall <= sh.ts) j++;
  const r = rows[j];
  return { ...sh, vh: r.d * info.totalVh, s: r.s, t: sh.ts - shots[0].ts };
});
const pool = tagged.filter((f) => f.vh >= vh0 && f.vh <= vh1);
const pick = [];
for (let i = 0; i < count; i++) {
  const target = vh0 + ((vh1 - vh0) * i) / Math.max(1, count - 1);
  let best = null;
  for (const f of pool) if (!best || Math.abs(f.vh - target) < Math.abs(best.vh - target)) best = f;
  if (best && !pick.includes(best)) pick.push(best);
}
const cellW = Math.floor(1800 / cols) - 8;
const cellH = Math.round((cellW * 720) / 1280);
const html = `<html><body style="margin:0;background:#15171a;font:12px/1.3 -apple-system,Helvetica,sans-serif;color:#e8e4dc">
<div style="padding:8px 8px 0;font-size:14px"><b>scroll.mp4 · ${name}</b> · ${vh0}-${vh1} vh of ${Math.round(info.totalVh)} · steady scroll, 1280x720</div>
<div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:8px;padding:8px">
${pick
  .map((f) => {
    const k = keyOfS(f.s);
    const near = Math.round(k);
    const lab = markOf[near] && Math.abs(k - near) < 0.35 ? markOf[near] : info.kinds[Math.floor(k)] || "";
    return `<div><img src="data:image/jpeg;base64,${fs.readFileSync(path.join(DIR, "frames", f.file)).toString("base64")}" style="width:${cellW}px;height:${cellH}px;display:block">
<div style="padding:3px 1px">${f.t.toFixed(1)} s · <b>${Math.round(f.vh)} vh</b> · key ${k.toFixed(1)} ${lab} · ${stretch(f.s)}</div></div>`;
  })
  .join("")}
</div></body></html>`;
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });
const p = await browser.newPage();
await p.setViewport({ width: cols * (cellW + 8) + 8, height: 400 });
await p.setContent(html, { waitUntil: "load" });
const file = path.join(ROOT, `sheet-${name}.png`);
await p.screenshot({ path: file, fullPage: true });
await browser.close();
console.log(file + ` (${pick.length} frames)`);
