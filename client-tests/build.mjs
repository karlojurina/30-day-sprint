// Rewrites the real module's path aliases to local stubs so Node can run it
// with --experimental-strip-types. The LOGIC under test is the real file,
// copied byte for byte apart from its import lines.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

function gen(srcRel, outRel, rewrites = []) {
  const src = fileURLToPath(new URL(srcRel, import.meta.url))
  const out = fileURLToPath(new URL(outRel, import.meta.url))
  let s = fs.readFileSync(src, 'utf8')
  s = s.replace('"use client";\n', '')
  for (const [from, to] of rewrites) s = s.split(from).join(to)
  if (s.includes('@/')) throw new Error(`an unrewritten @/ import remains in ${srcRel}`)
  fs.writeFileSync(out, s)
  console.log(`generated ${outRel} from the real source`)
}

// The Supabase import becomes the stub, wrapped in a counter. The stub cannot
// say whether a client was ever built, and "a heartbeat that is handed its own
// rpc builds none" is one of the things the test has to prove. The counter is
// the only code in the generated file that is not in the source.
gen('../src/lib/world/watch-heartbeat.ts', './_gen/watch-heartbeat.ts', [
  ['import { createClient } from "@/lib/supabase-browser";',
   'import { createClient as createStubClient } from "./stub-supabase.ts";\n' +
   'export let clientsCreated = 0;\n' +
   'function createClient() { clientsCreated++; return createStubClient(); }'],
  ['from "@/lib/call-gate"', 'from "./stub-call-gate.ts"'],
  // Node needs the extension on a relative import; the bundler does not.
  ['from "./tella"', 'from "./tella.ts"'],
])

// watch-rules.ts has no imports at all, so it copies across untouched.
gen('../src/lib/world/watch-rules.ts', './_gen/watch-rules.ts')

// access.ts reads process.env at module load; parseIds/isAllowed are pure.
gen('../src/lib/world/access.ts', './_gen/access.ts')

// catalog.ts imports only a TYPE, which --experimental-strip-types erases.
gen('../src/lib/world/catalog.ts', './_gen/catalog.ts', [
  ['import type { StudentLessonWatch } from "@/types/database";\n', ''],
  ['StudentLessonWatch', 'unknown'],
])

// map-model.ts imports only TYPES from ./catalog, which --experimental-strip-types erases.
gen('../src/lib/world/map-model.ts', './_gen/map-model.ts')

// tella.ts and tella-lock.ts have no imports at all, so they copy across untouched.
gen('../src/lib/world/tella.ts', './_gen/tella.ts')
gen('../src/lib/world/tella-lock.ts', './_gen/tella-lock.ts')

// tella-player.ts imports one constant from tella.ts. It touches `window`
// only inside attachTellaPlayer, so the parser runs under Node as it is.
gen('../src/lib/world/tella-player.ts', './_gen/tella-player.ts', [
  ['from "./tella"', 'from "./tella.ts"'],
])

// lesson-text.ts has no imports at all, so it copies across untouched.
gen('../src/lib/world/lesson-text.ts', './_gen/lesson-text.ts')

// embed-cache.ts imports only TYPES from ./lesson-transport, which --experimental-strip-types erases.
gen('../src/lib/world/embed-cache.ts', './_gen/embed-cache.ts')

// action-items.ts has no imports at all, so it copies across untouched. So
// has progress.ts, whose isLessonComplete() the action item test asks.
gen('../src/lib/world/action-items.ts', './_gen/action-items.ts')
gen('../src/lib/progress.ts', './_gen/progress.ts')

// discount.ts takes the 14 days from constants.ts, which has no imports and
// copies across untouched; discount-server.ts imports discount.ts and only a
// TYPE from supabase-js, which --experimental-strip-types erases.
gen('../src/lib/constants.ts', './_gen/constants.ts')
gen('../src/lib/world/discount.ts', './_gen/discount.ts', [
  ['from "@/lib/constants"', 'from "./constants.ts"'],
])
gen('../src/lib/world/discount-server.ts', './_gen/discount-server.ts', [
  ['from "./discount"', 'from "./discount.ts"'],
])

// curriculum-reset.ts imports only a TYPE from supabase-js, which --experimental-strip-types erases.
gen('../src/lib/curriculum-reset.ts', './_gen/curriculum-reset.ts')
