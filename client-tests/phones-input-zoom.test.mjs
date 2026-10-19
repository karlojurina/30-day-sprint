// phones-input-zoom.test.mjs: on a touch screen the action item's Discord
// link field and the 30% form's text answers are 16px, so iOS Safari does not
// zoom in when a student taps them (bug hunt of 19 October, phones-2).
//
// iOS Safari zooms into any focused text field under 16px while the page
// allows zoom (layout.tsx: maximumScale 5, kept for pinch zoom), and stays
// zoomed after the keyboard closes. The link field was 13px (world-ui.module
// .css, .input) and the answer box 15px (discount-form.module.css, .text).
// Each now takes 16px under @media (pointer: coarse); with a mouse they keep
// 13px and 15px.
//
// No harness renders those two screens without the dev server, so this is a
// source check, as close to the browser as a source check gets: it parses the
// two real CSS files into their rules (media conditions, selectors,
// declarations, source order), finds every rule that sets the field's font
// size, and runs the cascade for a mouse at 1366x768 and a phone at 390x844.
// It also checks that the components put these classes on these fields.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

// Every style rule, in source order, with the @media condition it sits in.
function rulesOf(css) {
  const out = []
  const walk = (text, media) => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      if (open < 0) break
      const prelude = text.slice(i, open).replace(/[^{};]*;/g, '').trim()
      let depth = 1
      let j = open + 1
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++
        else if (text[j] === '}') depth--
        j++
      }
      const body = text.slice(open + 1, j - 1)
      if (prelude.startsWith('@media')) walk(body, prelude.slice('@media'.length).trim())
      else if (!prelude.startsWith('@')) {
        const decls = {}
        for (const d of body.split(';')) {
          const k = d.indexOf(':')
          if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim()
        }
        out.push({ media, selectors: prelude.split(',').map((s) => s.trim()), decls, order: out.length })
      }
      i = j
    }
  }
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), null)
  return out
}

// The font size a rule sets: font-size, or the size inside the font shorthand.
function fontSizeOf(decls) {
  if (decls['font-size']) return decls['font-size']
  const m = decls.font?.match(/(?:^|\s)(\d+(?:\.\d+)?px)(?:\/\S+)?\s/)
  return m ? m[1] : null
}

// Whether a selector's subject is the field itself (not its placeholder).
const targets = (selector, cls) => {
  const subject = selector.split(/\s+|>|\+|~/).filter(Boolean).at(-1) ?? ''
  return new RegExp(`\\.${cls}(?![\\w-])`).test(subject) && !subject.includes('::')
}
const specificity = (selector) => (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length * 10 + (selector.match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length

// The media features this file uses, for a device.
const MOUSE = { pointer: 'fine', hover: 'hover', width: 1366, reducedMotion: false }
const PHONE = { pointer: 'coarse', hover: 'none', width: 390, reducedMotion: false }
function applies(media, device) {
  if (media === null) return true
  const known = {
    '(pointer: coarse)': device.pointer === 'coarse',
    '(pointer: fine)': device.pointer === 'fine',
    '(hover: none)': device.hover === 'none',
    '(hover: hover)': device.hover === 'hover',
    '(width < 760px)': device.width < 760,
    '(width >= 1100px)': device.width >= 1100,
    '(prefers-reduced-motion: reduce)': device.reducedMotion,
  }
  if (!(media in known)) throw new Error(`the test does not know the media condition ${media}`)
  return known[media]
}

// The font size the field ends with on a device: the winning rule among those
// that set one, by specificity, then source order.
function computed(rules, cls, device) {
  let best = null
  for (const r of rules) {
    const size = fontSizeOf(r.decls)
    if (!size || !applies(r.media, device)) continue
    for (const s of r.selectors) {
      if (!targets(s, cls)) continue
      const spec = specificity(s)
      if (!best || spec > best.spec || (spec === best.spec && r.order > best.order)) best = { spec, order: r.order, size }
    }
  }
  return best?.size ?? null
}

for (const [file, cls, base, field] of [
  ['src/components/world/world-ui.module.css', 'input', '13px', "the action item's Discord link field"],
  ['src/components/world/discount-form.module.css', 'text', '15px', "the 30% form's text answer"],
]) {
  console.log(`\n=== ${field} (.${cls} in ${file.split('/').at(-1)}) ===`)
  const rules = rulesOf(fromSrc(file))
  const sizing = rules.filter((r) => fontSizeOf(r.decls) && r.selectors.some((s) => targets(s, cls)))
  const plain = sizing.find((r) => r.media === null)
  const coarse = sizing.find((r) => r.media === '(pointer: coarse)')
  ok(sizing.length === 2 && plain && fontSizeOf(plain.decls) === base && coarse && fontSizeOf(coarse.decls) === '16px',
     `two rules set its size: ${base} for everyone, 16px under (pointer: coarse)`,
     show(sizing.map((r) => [r.media, r.selectors.join(','), fontSizeOf(r.decls)])))
  ok(coarse && plain && coarse.order > plain.order && coarse.selectors.length === 1 && coarse.selectors[0] === `.${cls}`,
     'the touch rule comes after the base rule, with the same selector, so it wins on a touch screen')
  ok(computed(rules, cls, PHONE) === '16px', 'a phone (pointer: coarse, 390x844, no hover): 16px, so Safari does not zoom', computed(rules, cls, PHONE))
  ok(computed(rules, cls, MOUSE) === base, `a mouse (pointer: fine, 1366x768): ${base} as before`, computed(rules, cls, MOUSE))
  ok(Object.keys(coarse?.decls ?? {}).join() === 'font-size', 'the touch rule changes the font size and nothing else', show(coarse?.decls))
}

console.log('\n=== The classes are on those fields ===')
{
  const action = fromSrc('src/components/world/ActionItemBlock.tsx')
  const form = fromSrc('src/components/world/WorldDiscountForm.tsx')
  // Up to the element's own "/>": its handlers hold "=>".
  const linkField = action.match(/<input\b[\s\S]*?\/>/)?.[0] ?? ''
  const answer = form.match(/<textarea\b[\s\S]*?\/>/)?.[0] ?? ''
  ok(/import u from "@\/components\/world\/world-ui\.module\.css"/.test(action) && /type="url"/.test(linkField) && /className=\{u\.input\}/.test(linkField),
     'ActionItemBlock.tsx: the Discord link field (type url) has world-ui.module.css .input')
  ok(/import f from "\.\/discount-form\.module\.css"/.test(form) && /className=\{f\.text\}/.test(answer),
     "WorldDiscountForm.tsx: the text answer's textarea has discount-form.module.css .text")
  const layout = fromSrc('src/app/layout.tsx')
  ok(/maximumScale:\s*5/.test(layout), 'layout.tsx still allows pinch zoom (maximumScale 5): the fix is the 16px, not a zoom lock')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
