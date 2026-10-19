/**
 * The two text fields that iPhones zoomed into, checked in headless Chrome
 * (bug hunt of 19 October, phones-2).
 *
 *   node world-tests/phones-input-zoom.mjs
 *
 * Run it from the app root (30-day-sprint), after `npm install` once in
 * world-tests/. Nothing has to be running: no dev server, no database, no
 * network. It takes a few seconds.
 *
 * WHY. iOS Safari zooms into a focused text field under 16px while the page
 * allows zoom (layout.tsx: maximumScale 5, kept for pinch zoom), and stays
 * zoomed after the keyboard closes. The action item's Discord link field
 * (world-ui.module.css .input) was 13px and the 30% form's text answer
 * (discount-form.module.css .text) 15px. Each now takes 16px under
 * @media (pointer: coarse). client-tests/phones-input-zoom.test.mjs checks
 * the same from the source with a cascade of its own; here Chrome runs it.
 *
 * WHAT IS REAL. The stylesheets, read from src/ on every run and loaded
 * unchanged: the field's module file, the world's tokens
 * (world-v6/tokens.module.css, on a wrapper as the app puts it there) and the
 * app's globals.css. The page has the app's viewport line. The field is the
 * element the component renders: ActionItemBlock's <input type="url"> in its
 * .field form, and WorldDiscountForm's <textarea>. Its size is read after it
 * takes the focus, as Safari decides on focus. The same module files as they
 * stood at 70c934a (production on 19 October) are taken from git and loaded
 * the same way, to show the bug.
 *
 * WHAT IS NOT. The class names: the build hashes them, here they stay as
 * written, so each module file gets its own page (both have a class called
 * .text). Tailwind's own CSS: globals.css imports it, and nothing here builds
 * it, so only globals.css's plain rules apply; Tailwind's rules sit in
 * layers, which the unlayered module rules outrank anyway. The font:
 * next/font sets --font-jetbrains-mono on <html>, and here it names a font
 * that is not loaded, which changes the face and not the size. It must be
 * set: without it the link field's `font` shorthand is invalid, and its size
 * falls back to the parent's 16px, which would pass the touch check for the
 * wrong reason. A check below sees that the shorthand applied.
 *
 * TOUCH. A 390x844 viewport with isMobile and hasTouch, which turns on
 * Chrome's touch emulation, under which (pointer: coarse) matches; the mouse
 * is a plain 1366x768 viewport. Each page first says which pointer it has, so
 * an emulation that did not take fails the run instead of passing it.
 *
 * WHAT IT DOES NOT PROVE. That Safari stops zooming: the zoom is WebKit's, and
 * Chrome has none. It proves the size the browser's own cascade gives each
 * field on a touch screen and with a mouse. One tap on a real iPhone settles
 * the zoom itself.
 *
 * Chrome is the system one, as in the other scripts here (CHROME_PATH to use
 * another). It talks to this script over a pipe, so it opens no port, and
 * every DNS lookup fails, so a request has nowhere to go; the last check
 * fails if a page asked for anything. While it runs, Chrome's profile is in
 * world-tests/shots/ (ignored by git) and is removed at the end.
 *
 * One line per check, a totals line, exit code 1 if any check fails.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.join(HERE, '..')
const PROFILE = path.join(HERE, 'shots', 'phones-input-zoom-profile')
const BASE = '70c934a'

const now = (rel) => fs.readFileSync(path.join(APP_ROOT, rel), 'utf8')
const atBase = (rel) => execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: APP_ROOT, encoding: 'utf8' })

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

const GLOBALS = now('src/app/globals.css')
const TOKENS = now('src/components/world-v6/tokens.module.css')
// layout.tsx's viewport export, as Next writes it into the page.
const VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover'
const FIELDS = [
  {
    what: "the action item's Discord link field",
    css: 'src/components/world/world-ui.module.css',
    html: '<form class="field" novalidate><input class="input" type="url" inputmode="url" autocomplete="off" placeholder="https://discord.com/channels/…"></form>',
    selector: 'input.input',
    mouse: '13px',
  },
  {
    what: "the 30% form's text answer",
    css: 'src/components/world/discount-form.module.css',
    html: '<textarea class="text" rows="4" placeholder="Type your answer"></textarea>',
    selector: 'textarea.text',
    mouse: '15px',
  },
]
const PHONE = { name: 'a phone (touch, 390x844)', viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true } }
const MOUSE = { name: 'a mouse (1366x768)', viewport: { width: 1366, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false } }

const page = (moduleCss, field) => `<!doctype html>
<html lang="en" style="--font-jetbrains-mono: 'JetBrains Mono'">
<head><meta charset="utf-8"><meta name="viewport" content="${VIEWPORT}">
<style>${GLOBALS}</style>
<style>${TOKENS}</style>
<style>${moduleCss}</style>
</head>
<body><div class="tokens">${field.html}</div></body>
</html>`

let browser = null
const asked = []
/** The field's computed style after it takes the focus, and which pointer the page has. */
async function measure(device, moduleCss, field) {
  const tab = await browser.newPage()
  try {
    tab.on('request', (r) => { if (!r.url().startsWith('data:')) asked.push(r.url()) })
    await tab.setViewport(device.viewport)
    await tab.setContent(page(moduleCss, field), { waitUntil: 'load' })
    return await tab.evaluate((selector) => {
      const el = document.querySelector(selector)
      el.focus()
      const cs = getComputedStyle(el)
      return {
        focused: document.activeElement === el,
        coarse: matchMedia('(pointer: coarse)').matches,
        fine: matchMedia('(pointer: fine)').matches,
        hoverNone: matchMedia('(hover: none)').matches,
        width: innerWidth,
        size: cs.fontSize,
        family: cs.fontFamily,
      }
    }, field.selector)
  } finally {
    await tab.close()
  }
}

const dropProfile = () => {
  try {
    fs.rmSync(PROFILE, { recursive: true, force: true })
  } catch {
    // Chrome can still be letting go of a file. The next run starts by removing it.
  }
}
dropProfile()
fs.mkdirSync(PROFILE, { recursive: true })
browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', userDataDir: PROFILE, pipe: true,
  args: ['--no-first-run', '--disable-default-apps', '--disable-sync', '--disable-background-networking',
    '--disable-component-update', '--disable-domain-reliability', '--disable-client-side-phishing-detection',
    // Every DNS lookup fails: a request has nowhere to go.
    '--host-resolver-rules=MAP * ~NOTFOUND'],
})
try {
  for (const field of FIELDS) {
    console.log(`\n=== ${field.what} (${field.selector.split('.')[1]} in ${field.css.split('/').at(-1)}) ===`)
    const css = now(field.css)
    const phone = await measure(PHONE, css, field)
    const mouse = await measure(MOUSE, css, field)
    ok(phone.coarse && phone.hoverNone && !phone.fine && phone.width === 390 && mouse.fine && !mouse.coarse && mouse.width === 1366,
       'the emulation took: the phone page has a coarse pointer and no hover, 390px wide; the mouse page a fine pointer, 1366px wide',
       JSON.stringify({ phone: [phone.coarse, phone.hoverNone, phone.width], mouse: [mouse.fine, mouse.width] }))
    ok(phone.focused && phone.size === '16px', `on ${PHONE.name}, focused: 16px, so Safari does not zoom in`, phone.size)
    ok(mouse.focused && mouse.size === field.mouse, `with ${MOUSE.name}, focused: ${field.mouse}, as before`, mouse.size)
    if (field.selector === 'input.input') {
      ok(phone.family.includes('JetBrains Mono') && mouse.family.includes('JetBrains Mono'),
         "the field's font shorthand applied (its face is the mono one), so the sizes above are its own",
         phone.family.slice(0, 40))
    }
    const before = await measure(PHONE, atBase(field.css), field)
    ok(before.coarse && before.size === field.mouse,
       `BEFORE (${BASE}): on ${PHONE.name} the field was ${field.mouse}, under 16px, so Safari zoomed in`, before.size)
  }
} finally {
  await browser.close()
  dropProfile()
}
ok(asked.length === 0, 'no page asked for anything over the network', asked.slice(0, 3).join(', '))

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
fails.forEach((f) => console.log('  - ' + f))
process.stdout.write('', () => process.exit(fails.length ? 1 : 0))
