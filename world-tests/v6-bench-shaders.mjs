/**
 * v6 shader inventory for the cheap-laptop model: every program the page
 * compiles (after the warm compile), its GLSL size and loop count, and the
 * time to compile and link each one again, alone and synchronously, in a
 * fresh context on this machine. The second number is the cost a compiler
 * pays per program; Windows (ANGLE on Direct3D 11, HLSL through fxc) pays it
 * several times over (world-tests/shots/v6/cheap/cheap_laptop_model.md).
 *
 *   node world-tests/v6-bench-shaders.mjs [--swiftshader] [--size=1920x1080@1]
 *
 * Output: shots/v6/cheap/baseline/shaders-<gpu|swiftshader>.json and .txt
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v6/cheap/baseline");
fs.mkdirSync(OUT, { recursive: true });
const swift = process.argv.includes("--swiftshader");
const sz = (process.argv.find((a) => a.startsWith("--size=")) || "--size=1920x1080@1").slice(7).match(/^(\d+)x(\d+)@([\d.]+)$/);
const [W, H, DPR] = [+sz[1], +sz[2], +sz[3]];
const tag = `shaders-${swift ? "swiftshader" : "gpu"}`;
const args = swift
  ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--hide-scrollbars"]
  : ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"];
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args, protocolTimeout: 120000 });
const lines = [];
const say = (s) => {
  lines.push(s);
  console.log(s);
};
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
  await page.goto("http://localhost:3111/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 110000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const ok = await page.evaluate(() => !!window.__worldReady).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  // Collect the sources (the page's context), then compile each again in a fresh context, one at a time.
  const inv = await page.evaluate(() => {
    const sc = window.__worldV6Debug;
    const r = sc.renderer;
    const gl = r.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const progs = r.info.programs.map((p) => ({
      name: p.name,
      vs: gl.getShaderSource(p.vertexShader) || "",
      fs: gl.getShaderSource(p.fragmentShader) || "",
    }));
    return { gpu, progs };
  });
  const rows = await page.evaluate(async (progs) => {
    const c = document.createElement("canvas");
    c.width = c.height = 4;
    const gl = c.getContext("webgl2");
    const out = [];
    // A unique define after #version, so no program cache in Chrome or ANGLE can hand back the page's own compile.
    const salt = (src, i) => src.replace(/^(#version[^\n]*\n)/, `$1#define BENCH_SALT_${i}_${Date.now()} 1\n`);
    let i = 0;
    for (const p of progs) {
      i++;
      const a = performance.now();
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, salt(p.vs, i));
      gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, salt(p.fs, i));
      gl.compileShader(fs);
      const pr = gl.createProgram();
      gl.attachShader(pr, vs);
      gl.attachShader(pr, fs);
      gl.linkProgram(pr);
      const ok = gl.getProgramParameter(pr, gl.LINK_STATUS); // forces the compile and link to finish
      const ms = performance.now() - a;
      const loops = (p.vs.match(/\bfor\s*\(/g) || []).length + (p.fs.match(/\bfor\s*\(/g) || []).length;
      out.push({ name: p.name, ok, ms: +ms.toFixed(1), vsKB: +(p.vs.length / 1024).toFixed(1), fsKB: +(p.fs.length / 1024).toFixed(1), loops });
      gl.deleteProgram(pr);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      await new Promise((r) => setTimeout(r, 0));
    }
    return out;
  }, inv.progs);
  const total = rows.reduce((a, b) => a + b.ms, 0);
  const kb = rows.reduce((a, b) => a + b.vsKB + b.fsKB, 0);
  const sorted = rows.slice().sort((a, b) => b.ms - a.ms);
  const byName = {};
  for (const r of rows) (byName[r.name] ||= { n: 0, ms: 0, kb: 0 }), byName[r.name].n++, (byName[r.name].ms += r.ms), (byName[r.name].kb += r.vsKB + r.fsKB);
  say(`${tag}: ${inv.gpu}`);
  say(`  ${rows.length} programs, ${kb.toFixed(0)} KB of GLSL (mean ${(kb / rows.length).toFixed(1)} KB), ${rows.reduce((a, b) => a + b.loops, 0)} loops; compile+link one at a time, fresh context: total ${total.toFixed(0)} ms, mean ${(total / rows.length).toFixed(1)} ms, median ${sorted[Math.floor(sorted.length / 2)].ms} ms, max ${sorted[0].ms} ms`);
  say("  slowest 12:");
  for (const r of sorted.slice(0, 12)) say(`    ${String(r.ms).padStart(7)} ms  ${r.name.padEnd(34)} vs ${r.vsKB} KB fs ${r.fsKB} KB loops ${r.loops}`);
  say("  by material name (programs, ms, KB):");
  for (const [n, v] of Object.entries(byName).sort((a, b) => b[1].ms - a[1].ms).slice(0, 20)) say(`    ${n.padEnd(34)} ${String(v.n).padStart(3)}  ${v.ms.toFixed(0).padStart(6)} ms  ${v.kb.toFixed(0).padStart(5)} KB`);
  fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify({ gpu: inv.gpu, total, kb, rows, byName }, null, 1));
} catch (e) {
  say("FATAL " + String(e && e.stack ? e.stack : e));
} finally {
  fs.writeFileSync(path.join(OUT, `${tag}.txt`), lines.join("\n") + "\n");
  await browser.close();
}
