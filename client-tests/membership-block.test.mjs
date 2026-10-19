// login-2 (2026-10-20): a student whose renewal charge failed (past_due,
// Whop still retrying the card) is still blocked on the map, as Karlo
// decided, but is never sent to buy a plan. The block says the last payment
// did not go through and links to Whop's page for updating the payment.
// Canceled and expired keep the renew checkout. Letting past_due in (option A)
// is the owner's call and is not built: lesson-video still refuses them.
//
// The overlay is the real source (src/components/onboarding/
// MembershipBlockOverlay.tsx), turned into plain JavaScript by the app's own
// TypeScript (types and JSX only) and rendered by React's server renderer,
// with the real framer-motion. Only useAuth is a stand-in: it hands the
// overlay the student each case needs.
//
//   node --experimental-strip-types client-tests/membership-block.test.mjs
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const req = createRequire(import.meta.url)
const ts = req('typescript')
const React = req('react')
const { renderToStaticMarkup } = req('react-dom/server')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

const SRC = 'src/components/onboarding/MembershipBlockOverlay.tsx'
const read = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')

/** The real module, its imports answered from `stubs` first and the app's node_modules after. */
function load(rel, stubs) {
  const js = ts.transpileModule(read(rel), {
    fileName: rel,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', js)((name) => (name in stubs ? stubs[name] : req(name)), mod, mod.exports)
  return mod.exports
}

let auth = { student: null, signOut: async () => {} }
const { MembershipBlockOverlay } = load(SRC, { '@/contexts/AuthContext': { useAuth: () => auth } })
const render = (student) => {
  auth = { student, signOut: async () => {} }
  return renderToStaticMarkup(React.createElement(MembershipBlockOverlay))
}
/** The words on screen, tags and React's text separators taken out. */
const words = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&rsquo;/g, '’').replace(/\s+/g, ' ').trim()
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])

const UPDATE = 'https://whop.com/@me/settings/memberships'
const CHECKOUT = 'https://whop.com/checkout/'
const student = (membership_status) => ({ id: 's1', name: 'Ana Horvat', membership_status })

console.log('\n=== past_due: the last payment did not go through ===')
{
  const html = render(student('past_due'))
  const text = words(html)
  ok(hrefs(html).length === 1 && hrefs(html)[0] === UPDATE, 'its one link is Whop\'s page for updating the payment', hrefs(html).join(', '))
  ok(!html.includes(CHECKOUT), 'no checkout anywhere: it is never sent to buy a second plan')
  ok(/target="_blank"/.test(html) && /rel="noopener noreferrer"/.test(html), 'the link opens in a new tab, as the renew link did')
  ok(text.includes('Hey Ana, your last payment did not go through.'), 'the heading says the last payment did not go through, with the first name', text)
  ok(text.includes('Payment failed') && text.includes('Update your payment method on Whop.')
     && text.includes('refresh this page'), 'its label says the payment failed, and the text says what to do: update the payment method on Whop, then refresh')
  ok(text.includes('Update payment on Whop') && !/renew/i.test(text), 'the button reads "Update payment on Whop", and "renew" is nowhere', text)
  ok(text.includes('Or sign out'), 'sign out is still there')
  ok(!/\u2014|unlock|EcomTalent/i.test(text), 'no em dash, no "unlock", no "EcomTalent"')
}

console.log('\n=== canceled and expired: as before, the renew checkout ===')
for (const status of ['canceled', 'expired']) {
  const html = render(student(status))
  const text = words(html)
  ok(hrefs(html).length === 1 && hrefs(html)[0] === `${CHECKOUT}plan_4ZrwR4PmBsVsx` && text.includes('Renew on Whop'),
     `${status}: "Renew on Whop" to the checkout, unchanged`, hrefs(html).join(', '))
  ok(text.includes('Hey Ana, your subscription isn’t active right now.') && text.includes('Subscription not active')
     && !text.includes('did not go through'), `${status}: the words are unchanged`, text.slice(0, 90))
}

console.log('\n=== active, or no student: nothing on screen ===')
ok(render(student('active')) === '', 'active: the overlay renders nothing')
ok(render(null) === '', 'no student yet: nothing')

console.log('\n=== Option A is not built: past_due is still kept out of the videos ===')
{
  const route = read('src/app/api/student/lesson-video/route.ts')
  ok(route.includes('if (student.membership_status !== "active") {'), 'lesson-video still refuses anything but active (letting past_due in is the owner\'s call)')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
