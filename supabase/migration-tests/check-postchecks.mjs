// Runs diagnostics/prd1-postchecks.sql against the harness DB after v92-v95,
// so we never hand Lovro a query that errors in the production SQL editor.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const M = fileURLToPath(new URL('../migrations/', import.meta.url))
const D = fileURLToPath(new URL('../diagnostics/', import.meta.url))
const read = (d, f) => fs.readFileSync(d + f, 'utf8')

function lift(file, startMarker, endMarker = ';') {
  const s = read(M, file)
  const i = s.indexOf('\n' + startMarker) + 1
  if (i < 1) throw new Error(`marker not found in ${file}`)
  if (endMarker !== ';') {
    const j = s.indexOf(endMarker, i)
    return s.slice(i, j + endMarker.length)
  }
  const lines = s.slice(i).split('\n'); const out = []
  for (const line of lines) {
    out.push(line)
    if (line.replace(/--.*$/, '').includes(';')) return out.join('\n')
  }
  throw new Error('end not found')
}

const db = new PGlite()
await db.exec(fs.readFileSync(new URL('base.sql', import.meta.url), 'utf8'))
for (const [f, m, e] of [
  ['2026_v81_canonical_progress_alignment.sql', 'create or replace view public.student_progress_counts as', ';'],
  ['2026_v49_student_current_region_view.sql', 'create or replace view public.student_current_region as', ';'],
  ['2026_v90_achievement_stats_and_copy.sql', 'create or replace view achievement_unlock_stats', ';'],
  ['2026_v89_point_in_time_snapshots.sql', 'create or replace function public.rebuild_daily_snapshots(', '$$;'],
]) await db.exec(lift(f, m, e))
await db.exec(`
alter view public.student_progress_counts set (security_invoker = on);
revoke select on public.student_progress_counts from anon;
grant select on public.student_progress_counts to authenticated;
alter view public.student_current_region set (security_invoker = on);
revoke select on public.student_current_region from anon;
grant select on public.student_current_region to authenticated;
revoke select on public.achievement_unlock_stats from anon;`)

// seed: 65 lessons (l001..l064 + l078), 4 regions
let seed = `insert into regions (id, order_num, name, terrain) values
 ('r1',1,'Foundation','shore'),('r2',2,'Production','forest'),
 ('r3',3,'Strategy','mountains'),('r4',4,'Gate of Possibilities','city');\n`
const regionOf = n => n <= 16 ? 'r1' : n <= 32 ? 'r2' : n <= 48 ? 'r3' : 'r4'
for (let n = 1; n <= 64; n++) {
  const id = 'l' + String(n).padStart(3, '0')
  const type = n % 7 === 0 ? 'setup' : n % 3 === 0 ? 'action' : 'watch'
  seed += `insert into lessons (id,region_id,day,type,title,sort_order) values ('${id}','${regionOf(n)}',${Math.min(30,Math.ceil(n/2.2))},'${type}','L${n}',${n});\n`
}
seed += `insert into lessons (id,region_id,day,type,title,sort_order) values ('l078','r4',30,'action','Playbook',78);\n`
await db.exec(seed)

for (const f of ['2026_v92_progress_predicate_and_lessons_v2_columns.sql',
                 '2026_v93_lesson_watch_telemetry.sql',
                 '2026_v94_catalog_next_staging.sql',
                 '2026_v95_discount_window_config.sql',
                 '2026_v96_lock_down_rebuild_snapshots.sql',
                 '2026_v97_heartbeat_trust_nothing.sql']) {
  await db.exec(read(M, f))
}

// Only the first statement (everything before the OPTIONAL comment block)
const sql = read(D, 'prd1-postchecks.sql')
try {
  const res = await db.query(sql)
  const rows = res.rows
  console.log('QUERY EXECUTED OK —', rows.length, 'rows\n')
  const pad = (s, n) => String(s).padEnd(n).slice(0, n)
  for (const r of rows) {
    const v = r.verdict
    const mark = v === 'PASS' ? ' ok ' : v === 'INFO' ? 'info' : 'FAIL'
    console.log(`${mark}  ${pad(r['#'], 3)} ${pad(r.check, 62)} exp=${pad(r.expected, 24)} got=${r.actual}`)
  }
  const fails = rows.filter(r => r.verdict !== 'PASS' && r.verdict !== 'INFO')
  console.log(`\n=== ${rows.filter(r=>r.verdict==='PASS').length} PASS · ${rows.filter(r=>r.verdict==='INFO').length} INFO · ${fails.length} FAIL ===`)
  if (fails.length) { console.log('\nUnexpected failures in the harness:'); fails.forEach(f => console.log(`  #${f['#']} ${f.check}: expected ${f.expected}, got ${f.actual}`)) }
} catch (e) {
  console.log('QUERY FAILED:', e.message)
  console.log('position:', e.position, 'code:', e.code)
  process.exit(1)
}
