// Where the functions run (CONTEXT.md, "Where the functions run"): the
// project's functions run in dub1, next to the database, and the Whop-bound
// routes are pinned to iad1 by their entries under `functions` in vercel.json.
//
// Vercel's Next.js builder takes a Node route's region only from those
// entries. It drops the `regions` that `export const preferredRegion` writes
// into Next's functions-config-manifest.json (@vercel/next, getPageLambdaGroups),
// and Next's own doc gives regions on Vercel to the edge runtime alone. It
// matches an entry against the route's source path, and the Vercel CLI lets a
// `src/app/` entry that matches no file pass without an error
// (checkUnusedFunctions), so a moved or misspelled route would lose its pin
// and nothing would say so. This test is what says so.
//
//   node client-tests/function-regions.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

console.log('vercel.json')
let config = null
try {
  config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'))
} catch (e) {
  ok(false, 'vercel.json parses', String(e))
}
if (config) {
  ok(show(config.regions) === show(['dub1']), 'the project runs in dub1, next to the database', show(config.regions))
  const functions = config.functions ?? {}
  const entries = Object.entries(functions)
  ok(entries.length > 0, 'routes are pinned under `functions`', `${entries.length}`)
  for (const [key, entry] of entries) {
    // A glob would need its own matcher here; an exact path is what the builder compares first.
    ok(!/[*?{}]|^!/.test(key), `${key}: an exact path, no glob`)
    ok(/^src\/app\/(.+\/)?route\.(ts|js)$/.test(key), `${key}: an App Router route file`)
    ok(exists(key), `${key}: the file exists, so the pin reaches its function`)
    const regions = entry?.regions
    ok(
      Array.isArray(regions) && regions.length > 0 && regions.every((r) => typeof r === 'string' && /^[a-z]{3}\d$/.test(r)),
      `${key}: names its regions`,
      show(regions),
    )
  }
}

console.log('\npreferredRegion under src/app')
const files = []
const walk = (dir) => {
  for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, d.name)
    if (d.isDirectory()) walk(rel)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(d.name)) files.push(rel)
  }
}
walk('src/app')
// Guards the walk itself: an empty list would pass the check below by reading nothing.
ok(files.length > 100, 'every source file under src/app is read', `${files.length} files`)
const ignored = files.filter((rel) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  return /export\s+(const|let|var)\s+preferredRegion\b/.test(src) && !/export\s+const\s+runtime\s*=\s*["']edge["']/.test(src)
})
ok(ignored.length === 0, 'no Node route sets preferredRegion, which Vercel ignores there (pin it in vercel.json)', ignored.join(', ') || 'none')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
