// Rewrites the real module's path aliases to local stubs so Node can run it
// with --experimental-strip-types. The LOGIC under test is the real file,
// copied byte for byte apart from the two import lines.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src/lib/world/watch-heartbeat.ts', import.meta.url))
const OUT = fileURLToPath(new URL('./_gen/watch-heartbeat.ts', import.meta.url))

let s = fs.readFileSync(SRC, 'utf8')
s = s.replace('"use client";\n', '')
s = s.replace('from "@/lib/supabase-browser"', 'from "./stub-supabase.ts"')
s = s.replace('from "@/lib/call-gate"', 'from "./stub-call-gate.ts"')
if (s.includes('@/lib/')) throw new Error('an unrewritten @/lib import remains')
fs.writeFileSync(OUT, s)
console.log('generated _gen/watch-heartbeat.ts from the real source')
