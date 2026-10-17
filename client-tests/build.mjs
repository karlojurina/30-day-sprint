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
// has progress.ts, whose isLessonComplete() the action item test asks and
// whose isPlaybookUnlocked() playbook.test.mjs runs beside the old one from git.
gen('../src/lib/world/action-items.ts', './_gen/action-items.ts')
gen('../src/lib/progress.ts', './_gen/progress.ts')

// celebrations.ts has no imports at all, so it copies across untouched.
gen('../src/lib/world/celebrations.ts', './_gen/celebrations.ts')

// discount-feedback.ts imports only TYPES, from an @/ path, which this file
// refuses: the line goes, and --experimental-strip-types erases the names.
gen('../src/lib/discount-feedback.ts', './_gen/discount-feedback.ts', [
  ['import type { DiscountFeedbackAnswer, DiscountFeedbackQuestion } from "@/types/database";\n', ''],
])

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

// achievements.ts imports curriculum-reset.ts (above) and only a TYPE from
// supabase-js. titles.ts imports only a TYPE, but from an @/ path, which this
// file refuses: the line goes and the type (a union of strings) reads as string.
// achievements-cutover.test.mjs takes the old copies of both from git itself.
gen('../src/lib/achievements.ts', './_gen/achievements.ts', [
  ['from "./curriculum-reset"', 'from "./curriculum-reset.ts"'],
  // Discount Earned reads the launch cutoff from the map's own module (above).
  ['from "./world/discount"', 'from "./discount.ts"'],
])
gen('../src/lib/titles.ts', './_gen/titles.ts', [
  ['import type { StudentTitle } from "@/types/database";\n', ''],
  ['StudentTitle', 'string'],
])

// csm-triggers.ts imports constants.ts and curriculum-reset.ts (above) and
// only TYPES from @/types/database, in import type lines and inline
// import("...") types, all of which --experimental-strip-types erases; the
// path is pointed at a file that does not exist, so one that survived would
// fail loudly. csm-cutover.test.mjs takes the old copy from git itself.
gen('../src/lib/csm-triggers.ts', './_gen/csm-triggers.ts', [
  ['"@/types/database"', '"./types-erased.ts"'],
  ['from "@/lib/constants"', 'from "./constants.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
])

// The server code behind the backend fixes of 16 October (backend_readiness.md
// section 5): the Whop backfill and the visit route that runs it, the Whop
// webhook, mark-action-shipped, skip-lesson and the CSM's event hooks. Their
// imports go to stub-server.ts (Next's response, a stand-in Supabase client,
// Whop, the steps after a lesson, the catalog flags) or to the real copies
// above. The webhook's type-only import is pointed at a file that does not
// exist, as csm-triggers.ts's is, so one that survived would fail loudly.
const toStub = (...paths) => paths.map((p) => [`from "${p}"`, 'from "./stub-server.ts"'])
// The closed doors before the new course (T-078): every student route asks
// the real gate, copied here, and the routes' copies point at it. Its one
// import is a TYPE from supabase-js, which --experimental-strip-types erases.
gen('../src/lib/student-app-gate.ts', './_gen/student-app-gate.ts')
const GATE = ['from "@/lib/student-app-gate"', 'from "./student-app-gate.ts"']
gen('../src/app/api/student/_lib/watch-sync.ts', './_gen/watch-sync.ts', [
  // The note's words come from constants.ts (above), as the admin page reads them.
  ['from "@/lib/constants"', 'from "./constants.ts"'],
  ...toStub('@supabase/supabase-js', '@/lib/whop', '@/lib/csm-events'),
])
gen('../src/app/api/student/refresh-watch-sync/route.ts', './_gen/refresh-watch-sync-route.ts', [
  GATE,
  ['from "../_lib/watch-sync"', 'from "./watch-sync.ts"'],
  ...toStub('next/server', '@supabase/supabase-js', '../_lib/update-streak', '@/lib/achievements'),
])
gen('../src/app/api/webhooks/whop/route.ts', './_gen/whop-webhook-route.ts', [
  ...toStub('next/server', '@/lib/supabase-server', '@/lib/whop-members', '@/lib/complete-lesson'),
  ['from "@/types/whop"', 'from "./types-erased.ts"'],
])
gen('../src/app/api/student/mark-action-shipped/route.ts', './_gen/mark-action-shipped-route.ts', [
  GATE,
  ['from "@/lib/world/action-items"', 'from "./action-items.ts"'],
  ...toStub('next/server', '@supabase/supabase-js', '../_lib/update-streak', '@/lib/achievements',
    '@/lib/csm-events', '@/lib/csm-task-evaluation', '@/lib/catalog-tables'),
])
gen('../src/app/api/student/skip-lesson/route.ts', './_gen/skip-lesson-route.ts', [
  GATE,
  ...toStub('next/server', '@supabase/supabase-js', '@/lib/csm-task-evaluation', '@/lib/catalog-tables'),
])
// csm-events.ts imports only a TYPE from supabase-js, which --experimental-strip-types erases.
gen('../src/lib/csm-events.ts', './_gen/csm-events.ts')

// Three more student routes, for the closed doors' route test (T-078,
// student-app-gate-routes.test.mjs): the map's video address, its "I finished
// watching", and the data route behind every student page. lesson-watched
// runs the real complete-lesson.ts, whose own imports are all in stub-server.ts.
gen('../src/lib/complete-lesson.ts', './_gen/complete-lesson.ts',
  toStub('@/app/api/student/_lib/update-streak', '@/lib/csm-events', '@/lib/achievements', '@/lib/csm-task-evaluation'))
gen('../src/app/api/student/lesson-watched/route.ts', './_gen/lesson-watched-route.ts', [
  GATE,
  ['from "@/lib/world/watch-rules"', 'from "./watch-rules.ts"'],
  ['from "@/lib/complete-lesson"', 'from "./complete-lesson.ts"'],
  ...toStub('next/server', '@supabase/supabase-js', '@/lib/catalog-tables'),
])
gen('../src/app/api/student/lesson-video/route.ts', './_gen/lesson-video-route.ts', [
  GATE,
  ['from "@/lib/world/tella"', 'from "./tella.ts"'],
  ...toStub('next/server', '@supabase/supabase-js', '@/lib/catalog-tables'),
])
gen('../src/app/api/student/data/route.ts', './_gen/student-data-route.ts', [
  GATE,
  ...toStub('next/server', '@supabase/supabase-js', '@/lib/catalog-tables'),
])

// The two routes that write a discount request (second Loom round, 16
// October): a double submit refused by v106 is answered as a request in
// review. Their imports go to stub-server.ts or to the real copies above; the
// database function the feedback form calls is the test's own stand-in.
for (const [route, out] of [['request', 'discount-request-route'], ['submit-feedback', 'discount-submit-feedback-route']]) {
  gen(`../src/app/api/discounts/${route}/route.ts`, `./_gen/${out}.ts`, [
    GATE,
    ['from "@/lib/constants"', 'from "./constants.ts"'],
    ['from "@/lib/world/discount-server"', 'from "./discount-server.ts"'],
    ...toStub('next/server', '@supabase/supabase-js', '@/lib/csm-events', '@/lib/catalog-tables'),
  ])
}
