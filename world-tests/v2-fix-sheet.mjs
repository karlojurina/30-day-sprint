// Contact sheet of v2-fix-check.mjs shots: node world-tests/v2-fix-sheet.mjs <vp> <kind> [cols] [scale]
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = process.env.OUT_DIR || path.join(HERE, 'shots', 'v2-verify', 'fix')
const [vp, kind, colsArg, scaleArg] = process.argv.slice(2)
const cols = Number(colsArg || 4)
const scale = Number(scaleArg || 0.3)
const files = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'].map((id) => `${vp}-${id}-${kind}.png`).filter((f) => fs.existsSync(path.join(DIR, f)))
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
const srcs = files.map((f) => 'data:image/png;base64,' + fs.readFileSync(path.join(DIR, f)).toString('base64'))
const url = await page.evaluate(async (srcs, caps, cols, scale) => {
  const imgs = await Promise.all(srcs.map((s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s })))
  const cw = Math.round(imgs[0].width * scale), ch = Math.round(imgs[0].height * scale), cap = 22
  const c = document.createElement('canvas')
  c.width = cw * cols; c.height = (ch + cap) * Math.ceil(imgs.length / cols)
  const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height)
  imgs.forEach((im, k) => { const x = (k % cols) * cw, y = Math.floor(k / cols) * (ch + cap); g.fillStyle = '#eee'; g.font = '15px monospace'; g.fillText(caps[k], x + 6, y + 16); g.drawImage(im, x, y + cap, cw, ch) })
  return c.toDataURL('image/png')
}, srcs, files, cols, scale)
const out = path.join(DIR, `sheet-${vp}-${kind}.png`)
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'))
console.log(out)
await browser.close()
