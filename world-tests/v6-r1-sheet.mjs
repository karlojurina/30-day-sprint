/**
 * Contact sheet of already rendered frames: node world-tests/v6-r1-sheet.mjs <out.png> <cols> <cellW> <img> [<img> ...]
 * Each caption is the file's name.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const [out, colsS, cellS, ...imgs] = process.argv.slice(2);
const cols = Number(colsS);
const cellW = Number(cellS);
const cellH = Math.round((cellW * 1278) / 1691);
const html = `<html><body style="margin:0;background:#15171a;font:12px/1.3 -apple-system,Helvetica,sans-serif;color:#e8e4dc">
<div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:5px;padding:5px">
${imgs
  .map(
    (f) => `<div><img src="data:image/png;base64,${fs.readFileSync(f).toString("base64")}" style="width:${cellW}px;height:${cellH}px;display:block"><div style="padding:2px">${path.basename(f, ".png")}</div></div>`,
  )
  .join("")}
</div></body></html>`;
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
const p = await browser.newPage();
const rows = Math.ceil(imgs.length / cols);
await p.setViewport({ width: cols * (cellW + 5) + 5, height: rows * (cellH + 22) + 10 });
await p.setContent(html, { waitUntil: "load" });
await p.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("wrote", out);
