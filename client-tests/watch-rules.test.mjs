import { judgeWatch, WATCH_POSITION_THRESHOLD, WATCH_PLAYED_FLOOR } from './_gen/watch-rules.ts'

let pass = 0
const fails = []
function ok(cond, label, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

const D = 753                       // the real test lesson, 12m33s
const POS = D * WATCH_POSITION_THRESHOLD   // 715.35
const row = (o) => ({
  max_position_seconds: 0, watched_seconds: 0,
  reported_duration_seconds: null, threshold_met_at: null, ...o,
})

console.log(`\nthresholds under test: position >= ${WATCH_POSITION_THRESHOLD}, played >= ${WATCH_PLAYED_FLOOR}\n`)

console.log('=== the honest student ===')
{
  const v = judgeWatch(row({ max_position_seconds: 750, watched_seconds: 748, threshold_met_at: '2026-09-23T10:00:00Z' }), D)
  ok(v.complete && v.reason === 'complete', 'watched it start to finish -> complete')
}
{
  // Skipped a bit here and there, still played 82% of it.
  const v = judgeWatch(row({ max_position_seconds: 752, watched_seconds: D * 0.82, threshold_met_at: '2026-09-23T10:00:00Z' }), D)
  ok(v.complete, 'played 82% with some skipping -> still complete', `played=${v.playedRatio.toFixed(2)}`)
}

console.log('\n=== the scrubber: free seeking must not buy a completion ===')
{
  // Drags the bar straight to the end. Position satisfied, nothing played.
  const v = judgeWatch(row({ max_position_seconds: 753, watched_seconds: 3, threshold_met_at: '2026-09-23T10:00:00Z' }), D)
  ok(!v.complete && v.reason === 'played_short',
     'dragged to the end having played 3s -> NOT complete', `played=${v.playedRatio.toFixed(3)}`)
}
{
  // Watches 79% honestly but never reaches the end.
  const v = judgeWatch(row({ max_position_seconds: D * 0.79, watched_seconds: D * 0.79 }), D)
  ok(!v.complete && v.reason === 'position_short', 'stopped at 79% -> NOT complete (position)')
}
{
  const v = judgeWatch(row({ max_position_seconds: 753, watched_seconds: D * 0.79, threshold_met_at: 'x' }), D)
  ok(!v.complete && v.reason === 'played_short', 'reached the end but played 79% -> NOT complete (floor)')
}
{
  const v = judgeWatch(row({ max_position_seconds: POS, watched_seconds: D * WATCH_PLAYED_FLOOR }), D)
  ok(v.complete, 'exactly on both thresholds -> complete (boundary is inclusive)')
}

console.log('\n=== degenerate inputs ===')
ok(judgeWatch(null, D).reason === 'no_watch_row', 'never opened it -> no_watch_row')
ok(judgeWatch(row({ max_position_seconds: 900, watched_seconds: 900 }), null).reason === 'no_duration',
   'no duration anywhere -> no_duration, never a divide by zero')
ok(judgeWatch(row({ max_position_seconds: 900, watched_seconds: 900 }), 0).reason === 'no_duration',
   'zero duration -> no_duration')
{
  // v97: the client's own reported duration must NOT decide anything. It is
  // written by the browser through the heartbeat RPC, so falling back to it
  // let a student send duration=1, play one second and complete a 24-minute
  // lesson. Blocking a completion is recoverable; forging one is not.
  const v = judgeWatch(row({ max_position_seconds: 750, watched_seconds: 740, reported_duration_seconds: D }), null)
  ok(!v.complete && v.reason === 'no_duration',
     'a client-reported duration CANNOT stand in for the catalog\'s')
  const forged = judgeWatch(row({ max_position_seconds: 1, watched_seconds: 1, reported_duration_seconds: 1, threshold_met_at: 'x' }), null)
  ok(!forged.complete && forged.reason === 'no_duration',
     'the forge-your-own-denominator attack returns no_duration, not complete')
}
{
  // The catalog must win: a player misreporting a 10s duration would otherwise
  // make every lesson instantly complete.
  const v = judgeWatch(row({ max_position_seconds: 20, watched_seconds: 20, reported_duration_seconds: 10 }), D)
  ok(!v.complete, 'catalog duration OVERRIDES a player-reported one', `pos=${v.positionRatio.toFixed(3)}`)
}

console.log('\n=== numeric() coercion: string columns must not become string comparisons ===')
{
  // If PostgREST ever hands numeric back as a string, "9" > "80" is true and
  // the floor silently inverts. These must behave identically to the numbers.
  const v = judgeWatch(row({ max_position_seconds: '750', watched_seconds: '748', threshold_met_at: 'x' }), D)
  ok(v.complete, 'string numerics still complete', `played=${v.playedRatio.toFixed(2)}`)
  const w = judgeWatch(row({ max_position_seconds: '753', watched_seconds: '9', threshold_met_at: 'x' }), D)
  ok(!w.complete && w.reason === 'played_short',
     'string "9" seconds played is still 9 seconds, not more than "80"', `played=${w.playedRatio.toFixed(3)}`)
}

console.log('\n=== threshold_met_at is trusted over recomputation ===')
{
  // Scenario: the Bunny sync later writes a longer, correct duration. The
  // POSITION check must not retroactively fail — the database already stamped
  // that the student reached the end of the video as it then was.
  const v = judgeWatch(row({ max_position_seconds: 700, watched_seconds: 700, threshold_met_at: 'x' }), 1000)
  ok(v.reason !== 'position_short',
     'a corrected duration does not retroactively fail the POSITION check',
     `position ratio is only ${v.positionRatio.toFixed(2)}, but the stamp stands`)
  // The floor still applies, and correctly so: against the real length they
  // played 70%, so they genuinely have not watched the lesson.
  ok(v.reason === 'played_short',
     'but the floor still applies against the corrected length',
     `played=${v.playedRatio.toFixed(2)}`)
  // And none of this can revoke a completion already written: judgeWatch only
  // gates NEW completions, and the route short-circuits on an existing row.
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
