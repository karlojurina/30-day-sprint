// Rewrites the real module's path aliases to local stubs so Node can run it
// with --experimental-strip-types. The LOGIC under test is the real file,
// copied byte for byte apart from the two import lines.
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

gen('../src/lib/world/watch-heartbeat.ts', './_gen/watch-heartbeat.ts', [
  ['from "@/lib/supabase-browser"', 'from "./stub-supabase.ts"'],
  ['from "@/lib/call-gate"', 'from "./stub-call-gate.ts"'],
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
