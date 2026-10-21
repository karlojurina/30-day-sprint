// Rewrites the real module's path aliases to local stubs so Node can run it
// with --experimental-strip-types. The LOGIC under test is the real file,
// copied byte for byte apart from its import lines.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

function gen(srcRel, outRel, rewrites = [], { dropLineComments = false } = {}) {
  const src = fileURLToPath(new URL(srcRel, import.meta.url))
  const out = fileURLToPath(new URL(outRel, import.meta.url))
  let s = fs.readFileSync(src, 'utf8')
  s = s.replace('"use client";\n', '')
  for (const [from, to] of rewrites) s = s.split(from).join(to)
  // Lines that are only a `//` comment, left out of the copy (the code is untouched).
  if (dropLineComments) s = s.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')
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
// checkpointView.ts holds the panel's words for the 30% (discountRule): it
// imports discount.ts (above) and only a TYPE from checkpoint.ts, by an @/
// path, which this file refuses, so that line goes; the name is a type only.
gen('../src/components/world-v6/checkpointView.ts', './_gen/checkpointView.ts', [
  ['from "@/lib/world/discount"', 'from "./discount.ts"'],
  ['import type { CheckpointLook } from "@/lib/world-v6/checkpoint";\n', ''],
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

// The streak (T-079): its math and its writer, which stub-server.ts runs for
// real behind its recorded steps, and the chain after a lesson, which the
// lesson-watched route and the webhook below run as it is. update-streak.ts
// imports only a TYPE from supabase-js, which --experimental-strip-types erases.
gen('../src/lib/streak.ts', './_gen/streak.ts')
gen('../src/app/api/student/_lib/update-streak.ts', './_gen/update-streak.ts', [
  ['from "@/lib/streak"', 'from "./streak.ts"'],
])
const toStub = (...paths) => paths.map((p) => [`from "${p}"`, 'from "./stub-server.ts"'])
gen('../src/lib/complete-lesson.ts', './_gen/complete-lesson.ts',
  toStub('@/app/api/student/_lib/update-streak', '@/lib/csm-events', '@/lib/achievements', '@/lib/csm-task-evaluation'))

// The server code behind the backend fixes of 16 October (backend_readiness.md
// section 5): the Whop backfill and the visit route that runs it, the Whop
// webhook, mark-action-shipped, skip-lesson and the CSM's event hooks. Their
// imports go to stub-server.ts (Next's response, a stand-in Supabase client,
// Whop, the steps after a lesson, the catalog flags) or to the real copies
// above. The webhook's type-only import is pointed at a file that does not
// exist, as csm-triggers.ts's is, so one that survived would fail loudly.
// The closed doors before the new course (T-078): every student route asks
// the real gate, copied here, and the routes' copies point at it. Its imports
// are TYPES (supabase-js, next), which --experimental-strip-types erases.
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
// The Whop read behind the backfill (fetchCompletedLessonsAsAdmin), which
// whop-backfill.test.mjs runs on a stand-in fetch (2026-10-17: it refuses rows
// for anyone else). Its other import is TYPES, pointed at a file that does not
// exist as the webhook's is below.
gen('../src/lib/whop.ts', './_gen/whop.ts', [
  ['from "./constants"', 'from "./constants.ts"'],
  ['from "@/types/whop"', 'from "./types-erased.ts"'],
])
// The webhook runs the real chain after a lesson (complete-lesson.ts, above).
gen('../src/app/api/webhooks/whop/route.ts', './_gen/whop-webhook-route.ts', [
  ['from "@/lib/complete-lesson"', 'from "./complete-lesson.ts"'],
  ...toStub('next/server', '@/lib/supabase-server', '@/lib/whop-members'),
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

// The map's video address, for the closed doors' route test (T-078,
// student-app-gate-routes.test.mjs). The test's other two routes, the map's
// "I finished watching" (lesson-watched) and the data route behind every
// student page, are generated with the streak's routes below, GATE included.
gen('../src/app/api/student/lesson-video/route.ts', './_gen/lesson-video-route.ts', [
  GATE,
  ['from "@/lib/world/tella"', 'from "./tella.ts"'],
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
    ['from "@/lib/membership-discount"', 'from "./membership-discount.ts"'],
    // The required questions (the owner's review, 2026-10-21): the forms' rule, copied above.
    ['from "@/lib/discount-feedback"', 'from "./discount-feedback.ts"'],
    ...toStub('next/server', '@supabase/supabase-js', '@/lib/csm-events', '@/lib/catalog-tables'),
  ])
}
// The approve button (POST /api/discounts/approve), for
// discount-september.test.mjs (2026-10-17): the team's login and Whop's promo
// code go to stub-server.ts; the rule and the switch's date are the real
// copies above.
gen('../src/app/api/discounts/approve/route.ts', './_gen/discount-approve-route.ts', [
  ['from "@/lib/constants"', 'from "./constants.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ['from "@/lib/world/discount-server"', 'from "./discount-server.ts"'],
  ['from "@/lib/membership-discount"', 'from "./membership-discount.ts"'],
  ...toStub('next/server', '@/lib/admin-auth', '@/lib/whop', '@/lib/catalog-tables'),
])

// The 30% for every student at once (admin rebuild, WI-2, thirty-view.test.mjs):
// the bulk loader and the 30% page's builder, with the date helpers
// they use. The rule is the real copies above; the pages helper has no
// imports; which catalog is live goes to stub-server.ts. The loader's
// Supabase import and the builder's imports from the loader are TYPES, which
// --experimental-strip-types erases.
gen('../src/lib/supabase-pagination.ts', './_gen/supabase-pagination.ts')
gen('../src/lib/admin/croatia-dates.ts', './_gen/croatia-dates.ts')
const RULE = [
  ['from "@/lib/world/discount"', 'from "./discount.ts"'],
  ['from "@/lib/world/discount-server"', 'from "./discount-server.ts"'],
]
gen('../src/lib/admin/thirty-view.ts', './_gen/thirty-view.ts', [
  ...RULE,
  ['from "./croatia-dates"', 'from "./croatia-dates.ts"'],
  ['from "./thirty-data"', 'from "./thirty-data.ts"'],
  // Whether a stored Whop id can be asked about at all (the review's fix round): the coupon rule's copy below.
  ['from "@/lib/membership-discount"', 'from "./membership-discount.ts"'],
])
gen('../src/lib/admin/thirty-data.ts', './_gen/thirty-data.ts', [
  ...RULE,
  ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
  ['from "./thirty-view"', 'from "./thirty-view.ts"'],
  // The Approved rows' live coupon read (the review's fix round): the coupon rule's reader, copied below.
  ['from "@/lib/membership-discount"', 'from "./membership-discount.ts"'],
  ...toStub('@/lib/catalog-tables'),
])

// The admin rebuild's routes (admin-routes.test.mjs): GET /api/admin/thirty
// (work item 3) and PUT /api/admin/config (admin rebuild 2, D6). The REAL
// team check, admin-auth.ts, not stub-server.ts's stand-in: its Next
// response and its Supabase client go to stub-server.ts, so the token is
// looked up in the stand-in's users and the role in its team_members, and a
// route answers 401, 403 or 200 for that login as it would on Vercel. Its
// other import is a TYPE, pointed at a file that does not exist, as
// csm-triggers.ts's is. GET /api/admin/thirty runs over that check and the
// real loader and builder above; PUT /api/admin/config over it and the 6
// keys of config-keys.ts, whose one import is a TYPE pointed the same way.
gen('../src/lib/admin-auth.ts', './_gen/admin-auth.ts', [
  ...toStub('next/server', '@supabase/supabase-js'),
  ['"@/types/database"', '"./types-erased.ts"'],
])
gen('../src/app/api/admin/thirty/route.ts', './_gen/admin-thirty-route.ts', [
  ['from "@/lib/admin-auth"', 'from "./admin-auth.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ['from "@/lib/admin/thirty-data"', 'from "./thirty-data.ts"'],
  ['from "@/lib/admin/thirty-view"', 'from "./thirty-view.ts"'],
  ...toStub('next/server'),
])
gen('../src/lib/admin/config-keys.ts', './_gen/config-keys.ts', [
  ['from "@/lib/dm-toggles"', 'from "./types-erased.ts"'],
])
gen('../src/app/api/admin/config/route.ts', './_gen/admin-config-route.ts', [
  ['from "@/lib/admin-auth"', 'from "./admin-auth.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ['from "@/lib/admin/config-keys"', 'from "./config-keys.ts"'],
  ...toStub('next/server'),
])

// The admin's frame and what admin rebuild 2 removed (WI-1,
// admin-frame.test.mjs): the top bar's entries for each role, the home every
// sign-in lands on, which pages wear the dark look (admin-frame.ts, whose one
// import is a TYPE pointed at a file that does not exist), and the 2 Whop
// product ids that moved out of etfb.ts (whop-products.ts, no imports).
gen('../src/lib/admin/admin-frame.ts', './_gen/admin-frame.ts', [
  ['"@/types/database"', '"./types-erased.ts"'],
])
gen('../src/lib/whop-products.ts', './_gen/whop-products.ts')

// Every other route that writes or shows the streak (T-079, streak.test.mjs):
// a finished video (lesson-watched, with the real chain after it), the old
// course's task box (toggle-lesson) and quiz (submit-quiz), the app's data
// read, and the login. quiz.ts imports only a TYPE, from an @/ path, pointed
// at a file that does not exist as above. pkce.ts imports only Node's crypto.
// The login's copy leaves out its `//` comment lines: two of them once named a
// student and a customer's email, and this repository is public. Each of
// these routes also asks the closed doors' gate (T-078), pointed at its copy.
gen('../src/app/api/student/lesson-watched/route.ts', './_gen/lesson-watched-route.ts', [
  GATE,
  ['from "@/lib/world/watch-rules"', 'from "./watch-rules.ts"'],
  ['from "@/lib/complete-lesson"', 'from "./complete-lesson.ts"'],
  ...toStub('next/server', '@supabase/supabase-js', '@/lib/catalog-tables'),
])
gen('../src/app/api/student/toggle-lesson/route.ts', './_gen/toggle-lesson-route.ts', [
  GATE,
  ...toStub('next/server', '@supabase/supabase-js', '../_lib/update-streak', '@/lib/csm-events',
    '@/lib/achievements', '@/lib/csm-task-evaluation', '@/lib/catalog-tables'),
])
gen('../src/lib/quiz.ts', './_gen/quiz.ts', [['"@/types/database"', '"./types-erased.ts"']])
gen('../src/app/api/student/submit-quiz/route.ts', './_gen/submit-quiz-route.ts', [
  GATE,
  ['from "@/lib/quiz"', 'from "./quiz.ts"'],
  ...toStub('next/server', '@supabase/supabase-js', '../_lib/update-streak', '@/lib/achievements'),
])
gen('../src/app/api/student/data/route.ts', './_gen/student-data-route.ts', [
  GATE,
  ['from "@/lib/streak"', 'from "./streak.ts"'],
  // Whether the stored coupon counts for the student (T-122): the coupon rule's copy below.
  ['from "@/lib/membership-discount"', 'from "./membership-discount.ts"'],
  ...toStub('next/server', '@supabase/supabase-js', '@/lib/catalog-tables'),
])
gen('../src/lib/pkce.ts', './_gen/pkce.ts')
gen('../src/app/api/auth/whop/callback/route.ts', './_gen/whop-callback-route.ts', [
  GATE,
  ['from "@/lib/pkce"', 'from "./pkce.ts"'],
  ['from "@/app/api/student/_lib/watch-sync"', 'from "./watch-sync.ts"'],
  ...toStub('next/server', '@/lib/supabase-server', '@/lib/whop', '@/lib/whop-members', '@/lib/achievements',
    '@/app/api/student/_lib/update-streak', '@supabase/supabase-js', '@/lib/first-payment'),
], { dropLineComments: true })

// The Whop catch-up (T-089, whop-catchup.test.mjs): the route and the run as
// they are. The run reads Whop through the real whop.ts (above), which the
// test answers with a stand-in fetch, so a failure is sorted from the read's
// own message. The team login is the real admin-auth.ts on the stand-in's
// auth and team_members, so 401 and 403 are its own answers; its type-only
// import is pointed at a file that does not exist, as above. The streak's
// writer is the stub's (recorded, then run for real). supabase-pagination.ts
// has no imports (outreach-cutover.test.mjs writes the same copy).
gen('../src/lib/supabase-pagination.ts', './_gen/supabase-pagination.ts')
gen('../src/lib/admin-auth.ts', './_gen/admin-auth.ts', [
  ['from "@/types/database"', 'from "./types-erased.ts"'],
  ...toStub('next/server', '@supabase/supabase-js'),
])
gen('../src/lib/whop-catchup.ts', './_gen/whop-catchup.ts', [
  ['from "@/lib/whop"', 'from "./whop.ts"'],
  ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
  ['from "@/lib/constants"', 'from "./constants.ts"'],
  ['from "@/lib/streak"', 'from "./streak.ts"'],
  ...toStub('@/app/api/student/_lib/update-streak'),
])
gen('../src/app/api/admin/whop-catchup/route.ts', './_gen/whop-catchup-route.ts', [
  ['from "@/lib/whop-catchup"', 'from "./whop-catchup.ts"'],
  ['from "@/lib/admin-auth"', 'from "./admin-auth.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ...toStub('next/server', '@/lib/supabase-server'),
])
// The map's terrain (speed, 2026-10-20; terrain-identical.test.mjs, which
// copies the frozen old terrain the same way). layout.ts has no imports and
// copies across untouched; terrain.ts's layout import gains the .ts Node
// needs, and "three" resolves from node_modules as it is. Not committed
// (client-tests/.gitignore): 2,500 lines that every run writes again.
gen('../src/lib/world-v6/layout.ts', './_gen/world-layout.ts')
gen('../src/lib/world-v6/terrain.ts', './_gen/terrain.ts', [['from "./layout"', 'from "./world-layout.ts"']])

// The first-paid fix (2026-10-20, first-payment.test.mjs and
// first-paid-repair.test.mjs): first_paid_at is the student's first real
// Whop payment. The reader (first-payment.ts) runs on a stand-in fetch; its one
// import is whop-members.ts, which has no imports of its own and copies across
// untouched. The writers run through their entry points: the sync
// (whop-sync-runner.ts) with the real reads on that fetch and the stand-in's
// database, and the backfill route and the repair (first-paid-repair.ts and
// its route) with the real team login (admin-auth.ts, above). The repair reads
// the 30%'s dates and requestCounts from the real discount.ts (above).
gen('../src/lib/whop-members.ts', './_gen/whop-members.ts')
gen('../src/lib/first-payment.ts', './_gen/first-payment.ts', [
  ['from "@/lib/whop-members"', 'from "./whop-members.ts"'],
])
gen('../src/lib/whop-sync-runner.ts', './_gen/whop-sync-runner.ts', [
  ['from "@/lib/whop-members"', 'from "./whop-members.ts"'],
  ['from "@/lib/first-payment"', 'from "./first-payment.ts"'],
  ['from "@/lib/constants"', 'from "./constants.ts"'],
])
gen('../src/app/api/admin/backfill-first-paid-at/route.ts', './_gen/backfill-first-paid-at-route.ts', [
  ['from "@/lib/admin-auth"', 'from "./admin-auth.ts"'],
  ['from "@/lib/first-payment"', 'from "./first-payment.ts"'],
  ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
  ...toStub('next/server', '@/lib/supabase-server'),
])
gen('../src/lib/first-paid-repair.ts', './_gen/first-paid-repair.ts', [
  ['from "@/lib/first-payment"', 'from "./first-payment.ts"'],
  ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
  ['from "@/lib/world/discount"', 'from "./discount.ts"'],
])
gen('../src/app/api/admin/first-paid-repair/route.ts', './_gen/first-paid-repair-route.ts', [
  ['from "@/lib/first-paid-repair"', 'from "./first-paid-repair.ts"'],
  ['from "@/lib/admin-auth"', 'from "./admin-auth.ts"'],
  ...toStub('next/server', '@/lib/supabase-server'),
])

// The Dashboard (admin rebuild 2, WI-2, D3; dashboard.test.mjs): its numbers,
// dashboard-metrics.ts, over the real rules it builds on: Month 2 and the
// member predicates (metrics-definitions.ts, the same copy
// discount-queue.test.mjs makes), the switch's date (curriculum-reset.ts,
// above) and the launch and 30% dates (discount.ts, above). The page's reads
// are run by the test itself, from page.tsx, over supabase-pagination.ts (above).
gen('../src/lib/admin/metrics-definitions.ts', './_gen/metrics-definitions.ts', [['from "@/lib/constants"', 'from "./constants.ts"']])
gen('../src/lib/admin/dashboard-metrics.ts', './_gen/dashboard-metrics.ts', [
  ['from "@/lib/constants"', 'from "./constants.ts"'],
  ['from "@/lib/admin/metrics-definitions"', 'from "./metrics-definitions.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ['from "@/lib/world/discount"', 'from "./discount.ts"'],
  // The tasks reset's check (the review's fix round): tasks-reset.ts is copied below, for the Tasks lane.
  ['from "@/lib/admin/tasks-reset"', 'from "./tasks-reset.ts"'],
])

// ── Admin rebuild 2, lane thirty (WI-3 and WI-4): the coupon rule ────────────
// A discount already on the student's next Whop renewal (D5,
// membership-discount.test.mjs). The reader and its run, on a stand-in
// fetch: its imports are the rule's dates (discount.ts), the pages helper
// and the 429 wait of first-payment.ts, all copied above. The three discount
// routes point their import at this copy (their gen() lines above). The cron
// route runs with Next and the service client from stub-server.ts, and the
// real cron-auth.ts, its own service client pointed at stub-server.ts too, so
// its cron_runs rows land in the stand-in's database. (cron-failed-reads.test.mjs
// writes _gen/cron-auth.ts on a real supabase-js client; this copy is apart.)
gen('../src/lib/membership-discount.ts', './_gen/membership-discount.ts', [
  ['from "@/lib/world/discount"', 'from "./discount.ts"'],
  ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
  ['from "@/lib/first-payment"', 'from "./first-payment.ts"'],
  // T-122: the order's status reading and the course's products, for the membership found through the Whop user.
  ['from "@/lib/whop-members"', 'from "./whop-members.ts"'],
  ['from "@/lib/whop-products"', 'from "./whop-products.ts"'],
])
gen('../src/lib/cron-auth.ts', './_gen/cron-auth.stub-server.ts', [
  ['from "@/lib/supabase-server"', 'from "./stub-server.ts"'],
])
gen('../src/app/api/cron/refresh-membership-discounts/route.ts', './_gen/refresh-membership-discounts-route.ts', [
  ['from "@/lib/cron-auth"', 'from "./cron-auth.stub-server.ts"'],
  ['from "@/lib/membership-discount"', 'from "./membership-discount.ts"'],
  ...toStub('next/server', '@/lib/supabase-server'),
])
// "Check Whop again" on the 30% page (the render review's second round,
// membership-discount.test.mjs): POST /api/admin/thirty/check-coupon, the
// coupon rule's live read for one student (the copy above), over the REAL
// team check (admin-auth.ts, copied above for the admin routes), so no token
// answers 401 and a student's token 403, as on Vercel.
gen('../src/app/api/admin/thirty/check-coupon/route.ts', './_gen/admin-check-coupon-route.ts', [
  ['from "@/lib/admin-auth"', 'from "./admin-auth.ts"'],
  ['from "@/lib/membership-discount"', 'from "./membership-discount.ts"'],
  ...toStub('next/server'),
])

// ── Admin rebuild 2, lane WI-5 and WI-6 (Tasks, All students, the student page,
// the journey), for admin-tasks.test.mjs and admin-people.test.mjs. The tasks
// reset (tasks-reset.ts: one import, a TYPE from supabase-js, which
// --experimental-strip-types erases). The Tasks page's rules (tasks-view.ts)
// read the buckets' order from templates.ts, whose {dayNumber} comes from
// database.ts (no imports, erasable types only), and isCanceling from
// metrics-definitions.ts. The three student pages' readers and builders read
// the 30% page's whopPulled from the thirty-view.ts copy above; their
// CourseActivity is a TYPE from a client module, pointed at a file that does
// not exist, as csm-triggers.ts's types are.
gen('../src/lib/admin/tasks-reset.ts', './_gen/tasks-reset.ts')
gen('../src/types/database.ts', './_gen/database.ts')
gen('../src/lib/templates.ts', './_gen/templates.ts', [['from "@/types/database"', 'from "./database.ts"']])
gen('../src/lib/admin/metrics-definitions.ts', './_gen/metrics-definitions.ts', [['from "@/lib/constants"', 'from "./constants.ts"']])
gen('../src/lib/admin/tasks-view.ts', './_gen/tasks-view.ts', [
  ['from "@/lib/templates"', 'from "./templates.ts"'],
  ['from "@/lib/admin/metrics-definitions"', 'from "./metrics-definitions.ts"'],
  ['from "@/lib/admin/croatia-dates"', 'from "./croatia-dates.ts"'],
  ['from "./tasks-reset"', 'from "./tasks-reset.ts"'],
])
gen('../src/lib/admin/people-common.ts', './_gen/people-common.ts')
const PEOPLE = [
  ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
  ['from "@/lib/constants"', 'from "./constants.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ['from "@/lib/useJourneyPaceCounts"', 'from "./types-erased.ts"'],
  ['from "./people-common"', 'from "./people-common.ts"'],
]
// All students from 1 October (the owner's review, 2026-10-21): DISCOUNT_ELIGIBLE_FROM, from the rule's copy above.
gen('../src/lib/admin/students-list.ts', './_gen/students-list.ts', [...PEOPLE, ['from "@/lib/world/discount"', 'from "./discount.ts"']])
gen('../src/lib/admin/student-detail.ts', './_gen/student-detail.ts', [
  ...PEOPLE,
  ['from "@/lib/progress"', 'from "./progress.ts"'],
  ['from "@/lib/streak"', 'from "./streak.ts"'],
  ['from "@/lib/admin/metrics-definitions"', 'from "./metrics-definitions.ts"'],
  ['from "@/lib/admin/thirty-view"', 'from "./thirty-view.ts"'],
  // The 30% statuses' one map (the review's fix round), copied at the end of this file.
  ['from "@/lib/admin/discount-status"', 'from "./discount-status.ts"'],
])
gen('../src/lib/admin/journey-board.ts', './_gen/journey-board.ts', [
  ...PEOPLE,
  ['from "@/lib/world/discount"', 'from "./discount.ts"'],
  ['from "@/lib/admin/metrics-definitions"', 'from "./metrics-definitions.ts"'],
])

// Lesson feedback (admin rebuild 2, WI-7; lesson-rating.test.mjs and
// lesson-feedback.test.mjs). The rule both sides share (lesson-rating.ts) has
// no imports and copies across untouched. The student's route asks the real
// closed doors' gate, progress.ts and the rule (the copies above), with Next's
// response and its Supabase client from stub-server.ts. The team's loader and
// builder (lesson-feedback.ts) read through the real pagination helper and the
// switch's reader; its route runs over the real team check (admin-auth.ts,
// above), so 401, 403 and 200 are its own answers.
gen('../src/lib/world/lesson-rating.ts', './_gen/lesson-rating.ts')
gen('../src/app/api/student/rate-lesson/route.ts', './_gen/rate-lesson-route.ts', [
  GATE,
  ['from "@/lib/progress"', 'from "./progress.ts"'],
  ['from "@/lib/world/lesson-rating"', 'from "./lesson-rating.ts"'],
  ...toStub('next/server', '@supabase/supabase-js'),
])
gen('../src/lib/admin/lesson-feedback.ts', './_gen/lesson-feedback.ts', [
  ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ['from "@/lib/world/lesson-rating"', 'from "./lesson-rating.ts"'],
])
gen('../src/app/api/admin/lesson-feedback/route.ts', './_gen/admin-lesson-feedback-route.ts', [
  ['from "@/lib/admin-auth"', 'from "./admin-auth.ts"'],
  ['from "@/lib/admin/lesson-feedback"', 'from "./lesson-feedback.ts"'],
  ...toStub('next/server'),
])

// ── Admin rebuild 2, WI-8 and WI-9 (the templates lane): Templates, Survey,
// Team, Insights. Each page's data module, as the page imports it; the
// suites templates-page, survey-page, team-page and insights-page run them on
// the stand-in database, and compile the pages' components themselves.
// template-on-off.ts as template-on-off.test.mjs copies it (the same bytes),
// and metrics-definitions.ts as cron-failed-reads.test.mjs does, so these
// suites also run alone. The type-only imports point at a file that does not
// exist, as csm-triggers.ts's do.
gen('../src/lib/template-on-off.ts', './_gen/template-on-off.ts', [
  ['from "@/lib/csm-triggers"', 'from "./csm-triggers.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ['from "@/types/database"', 'from "./types-erased.ts"'],
])
gen('../src/lib/admin/metrics-definitions.ts', './_gen/metrics-definitions.ts', [['from "@/lib/constants"', 'from "./constants.ts"']])
const LANE_TYPES = [
  ['from "@/lib/admin/admin-transport"', 'from "./types-erased.ts"'],
  ['from "@/types/database"', 'from "./types-erased.ts"'],
]
gen('../src/lib/admin/templates-data.ts', './_gen/templates-data.ts', [
  ...LANE_TYPES,
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ['from "@/lib/csm-triggers"', 'from "./csm-triggers.ts"'],
  ['from "@/lib/template-on-off"', 'from "./template-on-off.ts"'],
  ['from "@/lib/admin/config-keys"', 'from "./config-keys.ts"'],
])
gen('../src/lib/admin/survey-data.ts', './_gen/survey-data.ts', [
  ...LANE_TYPES,
  ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
  // The review's fix round: the one status map (copied at the end of this file) and the 30%'s first day.
  ['from "@/lib/admin/discount-status"', 'from "./discount-status.ts"'],
  ['from "@/lib/world/discount"', 'from "./discount.ts"'],
])
gen('../src/lib/admin/team-data.ts', './_gen/team-data.ts', LANE_TYPES)
gen('../src/lib/admin/insights-data.ts', './_gen/insights-data.ts', [
  ...LANE_TYPES,
  ['from "@/lib/constants"', 'from "./constants.ts"'],
  ['from "@/lib/admin/metrics-definitions"', 'from "./metrics-definitions.ts"'],
  ['from "@/lib/supabase-pagination"', 'from "./supabase-pagination.ts"'],
  // The course switch, for Avg progress's floor (the review's fix round).
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
])
// The message renderer the preview runs (templates.ts): its one value import
// is getDayNumber from the types file, which has no imports and runs as it is.
gen('../src/types/database.ts', './_gen/a2-database.ts')
gen('../src/lib/templates.ts', './_gen/a2-templates.ts', [['from "@/types/database"', 'from "./a2-database.ts"']])
// The Templates page's real calls (templates-transport.ts and call-route.ts):
// the browser client goes to a hand-written stand-in
// (a2-browser-stub.ts), so fetch() reaches the routes' copies.
gen('../src/lib/admin/call-route.ts', './_gen/call-route.ts', [
  ['from "@/lib/supabase-browser"', 'from "./a2-browser-stub.ts"'],
  ['from "@/lib/admin/admin-transport"', 'from "./types-erased.ts"'],
])
gen('../src/lib/admin/templates-transport.ts', './_gen/templates-transport.ts', [
  ['from "@/lib/supabase-browser"', 'from "./a2-browser-stub.ts"'],
  ['from "@/lib/admin/call-route"', 'from "./call-route.ts"'],
  ['from "@/lib/admin/templates-data"', 'from "./templates-data.ts"'],
  ['from "@/types/database"', 'from "./types-erased.ts"'],
])

// ── Admin rebuild 2, WI-11: the review's fix round (admin-review.test.mjs) ───
// A failed read in plain words (read-failure.ts, no imports): the pages'
// LoadError and the Dashboard's line about its failed reads say it, the raw
// text behind Details. templates-page and team-page compile review-parts.tsx
// over this copy, since list-parts.tsx's LoadError imports it.
gen('../src/lib/admin/read-failure.ts', './_gen/read-failure.ts')
// The 30% statuses' one map (discount-status.ts, no imports): the 30% page,
// the Survey (survey-data.ts above) and a student's page (student-detail.ts
// above) name and colour them from it.
gen('../src/lib/admin/discount-status.ts', './_gen/discount-status.ts')
