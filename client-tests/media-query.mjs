// The map's phone rule as the tests read it: the four places it is written
// (WorldV6.tsx NARROW_QUERY, the poster layer in world.module.css, the
// screens over the map in world-ui.module.css, and the landing poster's
// stylesheet rule, .posterLanding in world.module.css; a <source media> in
// WorldV6.tsx until the night posters of 2026-10-21), and a small evaluator
// of the media features they use, asked
// about a screen: its width and height in CSS px and its pointer, "coarse"
// (a finger: phones, tablets), "fine" (a mouse or a trackpad) or "none".
// Shared by phone-view.test.mjs and phone-view-laptops.test.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** The four, read from the source; null where one is not found. */
export function phoneQueries() {
  const map = read('src/components/world-v6/WorldV6.tsx')
  const mapCss = read('src/components/world-v6/world.module.css')
  const uiCss = read('src/components/world/world-ui.module.css')
  return {
    narrow: /const NARROW_QUERY = "([^"]+)";/.exec(map)?.[1] ?? null,
    // The landing poster's still, for the opening (POSTER_IDS[0]), drawn by the stylesheet: only where the 3D draws.
    landing: /@media ([^{]+)\{\s*\.posterLanding \{/.exec(mapCss)?.[1]?.trim() ?? null,
    // The poster layer, hidden on a phone: the @media wrapping `.poster { display: none; }`.
    posterHide: /@media ([^{]+)\{\s*\.poster \{\s*display: none;\s*\}\s*\}/.exec(mapCss)?.[1]?.trim() ?? null,
    // The screens over the map, their phone look: the @media after its heading.
    uiPhone: /The phone view: solid surfaces, no blur[^\n]*\n\s*\n@media ([^{]+)\{/.exec(uiCss)?.[1]?.trim() ?? null,
  }
}

/** One media feature against a screen: the level 4 ranges, their level 3 spellings, and pointer. */
function feature(text, { width, height, pointer }) {
  const t = text.trim()
  let m = /^\((width|height) (<|<=|>|>=) (\d+(?:\.\d+)?)px\)$/.exec(t)
  if (m) {
    const v = m[1] === 'width' ? width : height
    const n = Number(m[3])
    return m[2] === '<' ? v < n : m[2] === '<=' ? v <= n : m[2] === '>' ? v > n : v >= n
  }
  m = /^\((min|max)-(width|height): (\d+(?:\.\d+)?)px\)$/.exec(t)
  if (m) {
    const v = m[2] === 'width' ? width : height
    const n = Number(m[3])
    return m[1] === 'min' ? v >= n : v <= n
  }
  m = /^\(pointer: (coarse|fine|none)\)$/.exec(t)
  if (m) {
    if (!['coarse', 'fine', 'none'].includes(pointer)) throw new Error(`a screen with no pointer: ${JSON.stringify({ width, height, pointer })}`)
    return pointer === m[1]
  }
  throw new Error(`a media feature this test cannot read: ${t}`)
}

/** A query list against a screen: "," is or, " and " is and (all the four use). */
export function matches(query, screen) {
  return query.split(',').some((q) => q.split(/\s+and\s+/).every((f) => feature(f, screen)))
}

export const POINTERS = ['coarse', 'fine', 'none']
