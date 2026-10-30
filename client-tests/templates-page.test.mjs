// templates-page.test.mjs: the Templates page of admin rebuild 2 (WI-8, PRD
// D6 and D12), _admin/prds/admin-rebuild-2/ in the workspace.
//
//   D6  the Message settings panel: the 2 links and the 4 Discord switches,
//       read by every role, changed by founders and admins through PUT
//       /api/admin/config; a warning when the Discord link is empty and when
//       the program link is not on sprint.ecomuniversity.com; a switch under
//       the master acts only while the master is on, and says so.
//   The preview fills {programLink} and {discordInvite} from the live values.
//   Delete: only a custom template, on the page and in the route.
//   Save sends only what changed (a text save of a built-in wrote
//   trigger_config {"all": []}, which check-csm-tasks' auto-dismiss reads).
//   D12 the trigger editor says "Membership status".
//
// No browser runs here, so the page is checked on the real source in the
// ways that need none:
//   - the page's data module (templates-data.ts, copied by build.mjs; run it
//     first, `npm run test:client` does) and its loader on stub-server.ts's
//     database;
//   - the real calls (templates-transport.ts, call-route.ts) with the
//     browser client pointed at a stand-in (_gen/a2-browser-stub.ts), and fetch()
//     going to copies of the real routes: PUT /api/admin/config with the
//     real team check (admin-auth.ts), and the templates route with
//     stub-admin.ts's;
//   - the page's components, compiled by TypeScript (JSX to
//     react/jsx-runtime calls, as Next's compiler does) and rendered by
//     React's server renderer;
//   - the route and the page as they were at BASE, run or read the same
//     way, to show a check fails on the old code.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

const BASE = 'ca9b5ef' // night/admin2 after WI-1, where this lane started

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
const fromBase = (rel) => execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: here('..'), encoding: 'utf8' })

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

/** Writes `text` to _gen/`out` with `rewrites` applied, refusing an @/ import left over. */
function write(text, label, out, rewrites = []) {
  let s = text
  for (const [from, to] of rewrites) {
    if (!s.includes(from)) throw new Error(`${label} has no ${from}`)
    s = s.split(from).join(to)
  }
  // An import from an @/ path left over (list-parts.tsx has an "@/" inside a regular expression, so imports only).
  if (/(?:from|import)\s*["']@\//.test(s)) throw new Error(`an unrewritten @/ import remains in ${label}`)
  fs.writeFileSync(here(`./_gen/${out}`), s)
}
/** A .tsx file compiled as Next compiles it (types out, JSX to react/jsx-runtime), its imports rewritten. */
function compile(rel, out, rewrites = []) {
  const js = ts.transpileModule(fromSrc(rel), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  write(js, rel, out, rewrites)
}

async function hush(fn) {
  const real = [console.info, console.warn, console.error]
  console.info = console.warn = console.error = () => {}
  try { return await fn() } finally { [console.info, console.warn, console.error] = real }
}

// ── The code under test ─────────────────────────────────────────────────────

// The browser client the transport and call-route.ts import is
// _gen/a2-browser-stub.ts (hand-written): the stand-in database's client, and
// the session a test sets.

const ROUTE = 'src/app/api/admin/templates/[id]/route.ts'
const STUBBED_ROUTE = [['from "next/server"', 'from "./stub-server.ts"'], ['from "@/lib/admin-auth"', 'from "./stub-admin.ts"']]
write(fromSrc(ROUTE), ROUTE, 'admin-template-route.ts', STUBBED_ROUTE)
write(fromBase(ROUTE), `${ROUTE} at ${BASE}`, 'a2-template-route-base.ts', STUBBED_ROUTE)
write(fromSrc('src/lib/dm-toggles.ts'), 'src/lib/dm-toggles.ts', 'a2-dm-toggles.ts')

const UI = [['from "@/components/admin/ui"', 'from "./a2-ui.mjs"']]
compile('src/components/admin/ui.tsx', 'a2-ui.mjs', [['import Link from "next/link";', 'const Link = (props) => props.children;']])
// The review fix round's parts (review-parts.tsx), which LoadError uses: its plain words are read-failure.ts, copied by build.mjs.
compile('src/components/admin/review-parts.tsx', 'a2-review-parts.mjs', [
  ['import Link from "next/link";', 'const Link = (props) => props.children;'],
  ...UI,
  ['from "@/lib/admin/read-failure"', 'from "./read-failure.ts"'],
])
compile('src/components/admin/list-parts.tsx', 'a2-list-parts.mjs', [
  ...UI,
  ['from "@/components/admin/review-parts"', 'from "./a2-review-parts.mjs"'],
])
compile('src/components/admin/templates/form-parts.tsx', 'a2-form-parts.mjs', [...UI, ['from "@/components/admin/list-parts"', 'from "./a2-list-parts.mjs"']])
compile('src/components/admin/TemplateOnOff.tsx', 'a2-template-on-off-view.mjs')
compile('src/components/admin/TriggerBuilder.tsx', 'a2-trigger-builder.mjs', [['from "@/lib/csm-triggers"', 'from "./csm-triggers.ts"']])
const PAGE_LIBS = [
  ['from "@/lib/admin/templates-data"', 'from "./templates-data.ts"'],
  ['from "./form-parts"', 'from "./a2-form-parts.mjs"'],
]
compile('src/components/admin/templates/MessageSettings.tsx', 'a2-message-settings.mjs', [
  ...UI,
  ...PAGE_LIBS,
  // The review's fix round: a failed read of the settings in plain words (review-parts.tsx, compiled above).
  ['from "@/components/admin/review-parts"', 'from "./a2-review-parts.mjs"'],
])
compile('src/components/admin/templates/TemplateRow.tsx', 'a2-template-row.mjs', [
  ...UI,
  ...PAGE_LIBS,
  ['from "@/components/admin/TemplateOnOff"', 'from "./a2-template-on-off-view.mjs"'],
  ['from "@/components/admin/TriggerBuilder"', 'from "./a2-trigger-builder.mjs"'],
  ['from "@/lib/template-on-off"', 'from "./template-on-off.ts"'],
  ['from "@/lib/templates"', 'from "./a2-templates.ts"'],
])
console.log('generated the page\'s components and the route copies into _gen/')

const DATA = await import('./_gen/templates-data.ts')
const ONOFF = await import('./_gen/template-on-off.ts')
const CSM = await import('./_gen/csm-triggers.ts')
const { readDmEnabled } = await import('./_gen/a2-dm-toggles.ts')
const { templatesTransport } = await import('./_gen/templates-transport.ts')
const { setBrowser } = await import('./_gen/a2-browser-stub.ts')
const templateRoute = await import('./_gen/admin-template-route.ts')
const baseRoute = await import('./_gen/a2-template-route-base.ts')
const configRoute = await import('./_gen/admin-config-route.ts')
const { setTeam } = await import('./_gen/stub-admin.ts')
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
const { FakeDb, NextRequest, fakeClient, useDb: installDb } = await import('./_gen/stub-server.ts')
const { MessageSettings, SettingsBody } = await import('./_gen/a2-message-settings.mjs')
const { TemplateRow, TemplatePreview } = await import('./_gen/a2-template-row.mjs')
const { TriggerBuilder } = await import('./_gen/a2-trigger-builder.mjs')

const render = (component, props) => renderToString(createElement(component, props))
/** The visible words of rendered HTML, entities read. */
const words = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

// ── The templates: the 18 built-ins after v57 with the placeholders their
// seeds use (9 {programLink}: welcome.day1 and the 8 stalled.*; 4
// {discordInvite}: the stalled.whop.*), and a custom one ────────────────────

const STAMP = '2026-10-20T08:30:00.000Z'
function tpl(scenario_id, body, extra = {}) {
  return {
    id: `tpl-${scenario_id}`, scenario_id, bucket: 'at_risk', week: 'D03', title: `Title of ${scenario_id}`,
    trigger_description: 'A note.', intent: null, tone: null, variables: [], body, word_count: null,
    is_active: true, is_admin_only: false, is_custom: false, trigger_config: null, created_at: STAMP, updated_at: STAMP, ...extra,
  }
}
function builtIns() {
  const out = [tpl('welcome.day1', 'Hey {firstName}! Start here: {programLink}', { week: 'D01', bucket: 'event' })]
  for (const d of [3, 5, 7, 10]) {
    out.push(tpl(`stalled.discord.day${d}`, `Hey {firstName}, day ${d}. {programLink}`, { week: `D${String(d).padStart(2, '0')}`, bucket: 'cancel_path' }))
    out.push(tpl(`stalled.whop.day${d}`, `Hey {firstName}, day ${d}.\nDiscord: {discordInvite}\nCourse: {programLink}`, { week: `D${String(d).padStart(2, '0')}`, bucket: 'cancel_path' }))
  }
  for (const s of ['nolessons.day3', 'nolessons.day7', 'nolessons.day14', 'noship.r1.day7', 'noship.r2.day14', 'pace.day7', 'pace.day14', 'pace.day21']) {
    out.push(tpl(s, 'Hey {firstName}, a nudge.'))
  }
  out.push(tpl('month2.entry', 'Hey {firstName}! Month 2.', { week: 'M2', bucket: 'event' }))
  return out
}
const CUSTOM = tpl('C-a1b2c3', 'Hey {firstName}, a custom one.', {
  week: 'X', is_custom: true, bucket: 'cancel_path',
  trigger_config: { all: [{ metric: 'is_canceling', op: 'is' }, { metric: 'membership_status', op: 'is', value: 'active' }] },
})
const ALL = () => [...builtIns(), { ...CUSTOM }]

// The live course after the switch: 8 areas, the lessons, three action items.
const NEW_LESSONS = []
for (let a = 1; a <= 8; a++) for (let n = 1; n <= 17; n++) {
  const id = `a${a}l${String(n).padStart(2, '0')}`
  NEW_LESSONS.push({ id, region_id: `a${a}`, title: `Lesson ${id}`, day: null, sort_order: n, requires_action: ['a1l05', 'a2l07', 'a4l17'].includes(id), counts_toward_progress: true })
}
const RESET_AT = '2026-10-19T14:33:33.972Z'
/** The values admin_config held on 20 October (live_read.json): the old program host, no Discord link, every switch off. */
const LIVE_SETTINGS = {
  program_login_link: 'https://30-day-sprint-smkv.vercel.app/login', discord_invite_link: '',
  dms_master_enabled: 'false', engagement_alerts_enabled: 'false', csm_task_summary_enabled: 'false', day28_dm_enabled: 'false',
}
function pageDb({ templates = ALL(), settings = LIVE_SETTINGS } = {}) {
  return new FakeDb({
    templates,
    regions: Array.from({ length: 8 }, (_, i) => ({ id: `a${i + 1}`, name: `Area name ${i + 1}`, order_num: i + 1 })),
    lessons: NEW_LESSONS,
    admin_config: [
      { key: 'curriculum_reset_at', value: RESET_AT },
      { key: 'discount_window_days', value: '14' },
      ...Object.entries(settings).map(([key, value]) => ({ key, value })),
    ],
  })
}
const LIVE = { course: await ONOFF.readLiveCourse(fakeClient(pageDb())), error: null }

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The loader: the templates, the live course, the trigger catalog and the message settings ===')
{
  const r = await DATA.loadTemplatesData(fakeClient(pageDb()))
  ok(r.ok && r.data.templates.length === 19 && r.data.templates[0].scenario_id === 'welcome.day1'
       && r.data.templates.at(-1).scenario_id === 'C-a1b2c3',
     'on the stand-in database it reads the 19 templates, Day 1 first and the custom one last', show(r.ok && r.data.templates.map((t) => t.scenario_id).slice(0, 3)))
  ok(r.ok && r.data.live.course?.courseIsNew === true && r.data.live.course.regions.size === 8 && r.data.live.error === null,
     'with the live course (new: 8 areas), for the on/off switch')
  ok(r.ok && show(r.data.trigger.catalog?.regions.map((x) => x.label).slice(0, 2)) === show(['Area 1 (Area name 1)', 'Area 2 (Area name 2)'])
       && show(r.data.trigger.catalog?.actionLessons.map((x) => x.id)) === show(['a1l05', 'a2l07', 'a4l17']) && r.data.trigger.catalog?.courseIsNew === true,
     'with the trigger editor\'s catalog, read once for the page: the areas by name and the 3 action lessons in course order', show(r.ok && r.data.trigger))
  const sorted = (o) => show(Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))))
  ok(r.ok && r.data.settings.ok && sorted(r.data.settings.values) === sorted(LIVE_SETTINGS),
     'and the 6 message settings, nothing else of admin_config (not the switch\'s date, not the discount window)', show(r.ok && r.data.settings))

  const noTemplates = pageDb()
  noTemplates.fail['templates.select'] = { message: 'permission denied for table templates' }
  const failed = await DATA.loadTemplatesData(fakeClient(noTemplates))
  ok(!failed.ok && failed.error === 'The templates could not be read: permission denied for table templates',
     'a failed read of the templates fails the load with what failed, so the page shows it and Retry (it showed an empty page)', show(failed))

  const noConfig = pageDb()
  noConfig.fail['admin_config.select'] = { message: 'permission denied for table admin_config' }
  const partly = await DATA.loadTemplatesData(fakeClient(noConfig))
  ok(partly.ok && partly.data.templates.length === 19 && partly.data.settings.ok === false
       && partly.data.settings.error === 'permission denied for table admin_config' && partly.data.live.course === null && partly.data.live.error,
     'a failed read of admin_config keeps the templates, and the panel and the switches each say why', show(partly.ok && partly.data.settings))

  const noRegions = pageDb()
  noRegions.fail['regions.select'] = { message: 'timeout' }
  const r2 = await DATA.loadTemplatesData(fakeClient(noRegions))
  ok(r2.ok && r2.data.trigger.catalog === null && r2.data.trigger.error === 'areas: timeout' && r2.data.live.error === 'the areas could not be read: timeout',
     'a failed read of the areas: the editor\'s dropdowns and the switch each carry the reason', show(r2.ok && r2.data.trigger))
}

console.log('\n=== D6: the panel\'s warnings ===')
const W_DISCORD = '4 messages send an empty Discord link.'
const W_PROGRAM = 'The program link is not on sprint.ecomuniversity.com. 9 messages send it.'
{
  const live = DATA.settingsWarnings(LIVE_SETTINGS, ALL(), LIVE).map((w) => w.text)
  ok(show(live) === show([W_DISCORD, W_PROGRAM]),
     'with the values of 20 October: "4 messages send an empty Discord link." and the program link not on sprint.ecomuniversity.com, sent by 9 messages', show(live))
  const fixed = { ...LIVE_SETTINGS, program_login_link: 'https://sprint.ecomuniversity.com/login', discord_invite_link: 'https://discord.gg/madeup' }
  ok(DATA.settingsWarnings(fixed, ALL(), LIVE).length === 0, 'with both links fixed: no warning')
  const spaces = { ...fixed, discord_invite_link: '   ' }
  ok(show(DATA.settingsWarnings(spaces, ALL(), LIVE).map((w) => w.text)) === show([W_DISCORD]), 'a Discord link of spaces is empty too')

  // A template that is off where its switch works sends nothing; one whose tasks are made whatever the switch says still sends.
  // Since 2026-10-30 (T-106) the switch works for nolessons.* too.
  const someOff = ALL().map((t) => (t.scenario_id === 'stalled.whop.day3' ? { ...t, is_active: false } : t))
  ok(show(DATA.settingsWarnings(LIVE_SETTINGS, someOff, LIVE).map((w) => w.text))
       === show(['3 messages send an empty Discord link.', 'The program link is not on sprint.ecomuniversity.com. 8 messages send it.']),
     'stalled.whop.day3 turned off (its switch works): 3 and 8 messages', show(DATA.settingsWarnings(LIVE_SETTINGS, someOff, LIVE)))
  const nolessons = ALL().map((t) => (t.scenario_id === 'nolessons.day3' ? { ...t, is_active: false, body: 'Hey {firstName}: {programLink}' } : t))
  ok(DATA.messagesUsing(nolessons, LIVE, 'programLink').length === 9
       && DATA.messagesUsing(nolessons.map((t) => (t.scenario_id === 'nolessons.day3' ? { ...t, is_active: true } : t)), LIVE, 'programLink').length === 10,
     'nolessons.day3 with {programLink}: counted while on, not while off, as off now stops its tasks (template-on-off.ts, T-106)')
  ok(show(DATA.settingsWarnings({ ...fixed, discord_invite_link: '' }, ALL().filter((t) => !t.body.includes('{discordInvite}')), LIVE).map((w) => w.text))
       === show(['The Discord link is empty. No message uses it now.']),
     'with no message using it, the empty Discord link is still named, and says no message uses it')
  ok(show(DATA.settingsWarnings({ ...fixed, program_login_link: '' }, ALL(), LIVE).map((w) => w.text)) === show(['9 messages send an empty program link.']),
     'an empty program link: "9 messages send an empty program link."')

  const cases = [
    ['https://sprint.ecomuniversity.com/login', null],
    ['https://sprint.ecomuniversity.com', null],
    ['http://sprint.ecomuniversity.com/login', null],
    ['https://30-day-sprint-smkv.vercel.app/login', 'other-host'],
    ['https://sprint.ecomuniversity.com.example.net/login', 'other-host'],
    ['https://www.ecomuniversity.com/login', 'other-host'],
    ['sprint.ecomuniversity.com/login', 'not-a-link'],
    ['javascript:alert(1)', 'not-a-link'],
    ['', 'empty'],
    [null, 'empty'],
  ]
  const wrong = cases.filter(([v, want]) => DATA.programLinkProblem(v) !== want).map(([v]) => v)
  ok(wrong.length === 0, `the program link's check on ${cases.length} values: only an http(s) address whose host is sprint.ecomuniversity.com passes`, show(wrong))
}

console.log('\n=== D6: the switches, as the crons read them ===')
{
  const st = (values) => {
    const v = DATA.switchViews({ ...LIVE_SETTINGS, ...values })
    return [v.master, ...v.others].map((x) => `${x.key}=${x.state}`)
  }
  ok(show(st({})) === show(['dms_master_enabled=Off: nothing posts', 'engagement_alerts_enabled=Off', 'csm_task_summary_enabled=Off', 'day28_dm_enabled=Off']),
     'all 4 off (the live values): the master says nothing posts', show(st({})))
  ok(show(st({ engagement_alerts_enabled: 'true' }).slice(1, 2)) === show(['engagement_alerts_enabled=On, but nothing posts while the master switch is off']),
     'a switch on under a master that is off says it acts only when the master is on')
  ok(show(st({ dms_master_enabled: 'true', engagement_alerts_enabled: 'true' }).slice(0, 2)) === show(['dms_master_enabled=On', 'engagement_alerts_enabled=On']),
     'with the master on, a switch that is on is On')
  ok(show(st({ dms_master_enabled: 'TRUE', csm_task_summary_enabled: 'yes' }).slice(0, 3)) === show(['dms_master_enabled=Off: nothing posts', 'engagement_alerts_enabled=Off', 'csm_task_summary_enabled=Off']),
     'only the exact text "true" is on, as dm-toggles.ts reads it')
  const missing = DATA.switchViews({ ...LIVE_SETTINGS, day28_dm_enabled: null }).others.at(-1)
  ok(missing.on === null && missing.state === 'Not set up: no row in the database', 'a switch with no row says so, and has no button (on is null)')

  // The panel's word against the crons' reader, on the stand-in database, for every combination.
  let agree = 0
  const disagree = []
  for (const master of ['true', 'false', 'TRUE', '']) for (const sub of ['true', 'false', ' true']) {
    const values = { ...LIVE_SETTINGS, dms_master_enabled: master, engagement_alerts_enabled: sub }
    const db = new FakeDb({ admin_config: Object.entries(values).map(([key, value]) => ({ key, value })) })
    const cron = await readDmEnabled(fakeClient(db), 'engagement_alerts_enabled')
    const panel = DATA.switchViews(values).others[0].state === 'On'
    if (cron.enabled === panel) agree++
    else disagree.push(`${master}/${sub}`)
  }
  ok(disagree.length === 0, `the panel says "On" exactly when the crons' readDmEnabled posts (${agree} combinations of the master and a switch)`, disagree.join(', '))
  ok(DATA.masterTurnOnText(LIVE_SETTINGS) === 'Nothing posts yet: every switch below is off.'
       && DATA.masterTurnOnText({ ...LIVE_SETTINGS, engagement_alerts_enabled: 'true', csm_task_summary_enabled: 'true' })
          === 'These start posting right away: Disengagement alerts, Task summary.',
     'Turn on for the master asks once, naming what starts posting')
}

console.log('\n=== D6: the panel, rendered for each role ===')
{
  const props = { settings: { ok: true, values: LIVE_SETTINGS }, templates: ALL(), live: LIVE, onSave: async () => null }
  const founder = render(MessageSettings, { ...props, canEdit: true })
  const fw = words(founder)
  ok(fw.includes(W_DISCORD) && fw.includes(W_PROGRAM), 'a founder sees both warnings', fw.slice(0, 200))
  // The review's fix round: the panel opens folded for every role, its warnings above the fold, so the templates come first.
  ok(founder.includes('data-settings-open="no"') && !founder.includes('<input') && (founder.match(/>Show settings<svg/g) ?? []).length === 1,
     'with a warning standing, a founder still finds the panel folded: the warnings and one button, "Show settings"')
  const opened = render(SettingsBody, { ...props, canEdit: true })
  const ow = words(opened)
  ok((opened.match(/<input /g) ?? []).length === 2 && opened.includes('value="https://30-day-sprint-smkv.vercel.app/login"')
       && (opened.match(/>Save<\/button>/g) ?? []).length === 2,
     'opened: the 2 links in fields, each with Save')
  ok((opened.match(/>Turn on<\/button>/g) ?? []).length === 4 && ow.includes('Each switch below acts only while the master switch is on.')
       && ow.includes('Fills {programLink} in 9 messages.') && ow.includes('Fills {discordInvite} in 4 messages.'),
     'the 4 switches with Turn on, the line that they act only while the master is on, and how many messages each link fills')
  const csm = render(MessageSettings, { ...props, canEdit: false })
  const cw = words(csm)
  ok(!csm.includes('<input') && (csm.match(/<button/g) ?? []).length === 1 && csm.includes('>Show settings<svg') && csm.includes('data-settings-open="no"')
       && cw.includes(W_DISCORD) && cw.includes(W_PROGRAM) && (cw.match(/Only a founder or an admin can change them\./g) ?? []).length === 1,
     'a csm, who cannot fix them, gets the warnings and the one sentence that only a founder or an admin can change them; the panel folded, its one button "Show settings", no field', cw.slice(0, 200))
  const fixed = { ...LIVE_SETTINGS, discord_invite_link: 'https://discord.gg/example', program_login_link: 'https://sprint.ecomuniversity.com/login' }
  const settled = render(MessageSettings, { ...props, settings: { ok: true, values: fixed }, canEdit: true })
  ok(settled.includes('data-settings-open="no"') && !settled.includes('<input') && !words(settled).includes(W_DISCORD),
     'with nothing to fix, a founder finds the panel folded: the templates come first', words(settled).slice(0, 160))
  const unread = render(MessageSettings, { ...props, settings: { ok: false, error: 'permission denied for table admin_config' }, canEdit: true })
  const uw = words(unread)
  ok(uw.includes("Couldn't load the message settings. Press Refresh to try again.") && uw.includes("This account can't read the admin settings.")
       && unread.includes('<summary') && uw.includes('permission denied for table admin_config'),
     'settings that could not be read say so, why in plain words, the database\'s own words behind Details', uw)
}

console.log('\n=== D6: a change goes through PUT /api/admin/config (the real route and the real team check) ===')
// The routes, as fetch() reaches them from the transport.
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  // Node's Request takes no cache mode: the rest of the call as the page made it.
  const rest = { ...init }
  delete rest.cache
  const path = String(url)
  if (path === '/api/admin/config') return configRoute[rest.method](new NextRequest(`http://app${path}`, rest))
  const m = /^\/api\/admin\/templates\/([^/]+)$/.exec(path)
  if (m) return templateRoute[rest.method](new NextRequest(`http://app${path}`, rest), { params: Promise.resolve({ id: decodeURIComponent(m[1]) }) })
  throw new Error(`no route for ${rest.method} ${path}`)
}
{
  const db = pageDb()
  db.users = { 'tok-founder': 'tm-founder', 'tok-admin': 'tm-admin', 'tok-csm': 'tm-csm' }
  db.tables.team_members = [
    { id: 'tm-founder', email: 'f@example.com', full_name: 'F', role: 'founder' },
    { id: 'tm-admin', email: 'a@example.com', full_name: 'A', role: 'admin' },
    { id: 'tm-csm', email: 'c@example.com', full_name: 'C', role: 'csm' },
  ].map((r) => ({ created_at: STAMP, ...r }))
  installDb(db)
  const value = (k) => db.rows('admin_config').find((r) => r.key === k)?.value

  setBrowser({ db, token: 'tok-founder' })
  const a = await hush(() => templatesTransport.saveSetting('discord_invite_link', 'https://discord.gg/madeup'))
  ok(a.ok && show(a.data) === show({ key: 'discord_invite_link', value: 'https://discord.gg/madeup' }) && value('discord_invite_link') === 'https://discord.gg/madeup',
     'a founder saves the Discord link: the row holds it and the panel gets it back', show(a))
  setBrowser({ db, token: 'tok-admin' })
  const b = await hush(() => templatesTransport.saveSetting('dms_master_enabled', 'true'))
  ok(b.ok && value('dms_master_enabled') === 'true', 'an admin turns the master switch on', show(b))
  setBrowser({ db, token: 'tok-csm' })
  const c = await hush(() => templatesTransport.saveSetting('dms_master_enabled', 'false'))
  ok(!c.ok && c.status === 403 && c.error === "Your team account can't do this." && value('dms_master_enabled') === 'true',
     'a csm is refused by the route (403) and nothing changes; the panel shows them no button anyway', show(c))
  setBrowser({ db, token: 'tok-founder' })
  const d = await hush(() => templatesTransport.saveSetting('curriculum_reset_at', '2026-01-01T00:00:00Z'))
  ok(!d.ok && d.status === 400 && value('curriculum_reset_at') === RESET_AT, 'a key outside the 6 is refused by the route, whoever sends it', show(d))
  const e = await hush(() => templatesTransport.saveSetting('engagement_alerts_enabled', 'yes'))
  ok(!e.ok && e.error === 'A Discord switch is either "true" or "false".' && value('engagement_alerts_enabled') === 'false', 'a switch takes "true" or "false" only', show(e))
  setBrowser({ db, token: null })
  const f = await templatesTransport.saveSetting('discord_invite_link', '')
  ok(!f.ok && f.status === 401 && f.error === 'You are signed out. Sign in again to go on.', 'signed out: the call is not sent, and the panel says why', show(f))
  setBrowser({ db, token: 'tok-csm' })
  const read = await templatesTransport.load()
  ok(read.ok && read.data.settings.ok && read.data.settings.values.discord_invite_link === 'https://discord.gg/madeup',
     'every role reads the panel (the csm\'s client reads the values just saved)')
}

console.log('\n=== The preview fills the links from the live values ===')
{
  const body = 'Hey {firstName}!\nDiscord: {discordInvite}\nCourse: {programLink}\nDay {dayNumber}'
  const live = { ok: true, values: { ...LIVE_SETTINGS, program_login_link: 'https://sprint.ecomuniversity.com/login', discord_invite_link: 'https://discord.gg/madeup' } }
  const html = words(render(TemplatePreview, { body, settings: live }))
  ok(html.includes('Discord: https://discord.gg/madeup') && html.includes('Course: https://sprint.ecomuniversity.com/login') && html.includes('Hey Mike!'),
     'with both links set, the preview shows them as a task would copy them', html)
  const oldHost = words(render(TemplatePreview, { body, settings: { ok: true, values: LIVE_SETTINGS } }))
  ok(oldHost.includes('Course: https://30-day-sprint-smkv.vercel.app/login') && oldHost.includes('Discord: {discordInvite}')
       && oldHost.includes('{discordInvite} stays as written: the Discord link is empty. Set it in Message settings.'),
     'with the values of 20 October: the old host as it is (what students get), and the empty Discord link left as written, with why', oldHost)
  const unread = words(render(TemplatePreview, { body, settings: { ok: false, error: 'x' } }))
  ok(unread.includes('Course: {programLink}') && unread.includes('{programLink} shows as written: the message settings could not be read.'),
     'settings that could not be read: the placeholders stay as written, and it says why')
  ok(show(DATA.previewConfig(live)) === show({ program_login_link: 'https://sprint.ecomuniversity.com/login', discord_invite_link: 'https://discord.gg/madeup' })
       && show(DATA.previewConfig({ ok: false, error: 'x' })) === show({}),
     'its links come only from the settings read (previewConfig)')
  const sources = ['src/components/admin/templates/TemplateRow.tsx', 'src/components/admin/templates/TemplatesView.tsx', 'src/lib/admin/templates-data.ts']
  const hosts = sources.filter((f) => /vercel\.app|discord\.gg\/<server>|https?:\/\//.test(fromSrc(f).replace(/^\s*(\*|\/\/).*$/gm, '')))
  ok(hosts.length === 0, 'no web address is written in the preview\'s code (comments aside)', hosts.join(', '))
  const old = fromBase('src/app/admin/(authenticated)/templates/page.tsx')
  ok(old.includes('"https://30-day-sprint-smkv.vercel.app/login"') && old.includes('"https://discord.gg/<server>"'),
     `control: at ${BASE} the preview always showed the old host and a made-up Discord address`)
}

console.log('\n=== Delete: a custom template only ===')
{
  ok(DATA.canDelete({ is_custom: true }) && !DATA.canDelete({ is_custom: false }) && !DATA.canDelete({}), 'canDelete: custom yes, built-in no')
  const rowProps = (t, canEdit) => ({
    template: t, draft: DATA.draftOf(t), open: true, stat: undefined, live: LIVE,
    trigger: { catalog: { regions: [{ id: 'a1', label: 'Area 1' }], actionLessons: [{ id: 'a1l05', label: 'A (a1l05)' }], courseIsNew: true }, error: null },
    settings: { ok: true, values: LIVE_SETTINGS }, canEdit, busy: false,
    handlers: { onToggleOpen() {}, onDraft() {}, onSave: async () => null, onSetActive() {}, onDelete: async () => null },
  })
  const builtIn = builtIns().find((t) => t.scenario_id === 'stalled.whop.day3')
  const asFounder = render(TemplateRow, rowProps(builtIn, true))
  ok(!asFounder.includes('Delete template') && asFounder.includes('>Save<') && asFounder.includes('Show preview'),
     'a built-in, opened by a founder: Save and Show preview, and no Delete', words(asFounder).slice(0, 120))
  ok(render(TemplateRow, rowProps({ ...CUSTOM }, true)).includes('>Delete template</button>'), 'a custom template, opened by a founder: Delete template')
  ok(!render(TemplateRow, rowProps({ ...CUSTOM }, false)).includes('Delete template'), 'opened by a csm: no Delete, as no Save')

  const routeDb = () => new FakeDb({ templates: [...builtIns(), { ...CUSTOM }] })
  const del = async (route, db, id, role = 'founder') => {
    installDb(db)
    setTeam({ id: `team-${role}`, role })
    const res = await hush(() => route.DELETE(new Request(`http://app/api/admin/templates/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) }))
    return { status: res.status, body: await res.json() }
  }
  const db = routeDb()
  const refused = await del(templateRoute, db, 'tpl-stalled.whop.day3')
  ok(refused.status === 400 && refused.body.error === "A built-in template can't be deleted. Only a custom one can."
       && db.rows('templates').some((t) => t.id === 'tpl-stalled.whop.day3'),
     'DELETE on a built-in: 400 in plain words, and the template is still there', show(refused))
  const gone = await del(templateRoute, db, 'tpl-C-a1b2c3')
  ok(gone.status === 200 && !db.rows('templates').some((t) => t.id === 'tpl-C-a1b2c3') && db.rows('templates').length === 18,
     'DELETE on a custom template: 200, and only it is gone', show(gone))
  const none = await del(templateRoute, db, 'tpl-nope')
  ok(none.status === 404 && none.body.error === 'Template not found', 'DELETE on an id that does not exist: 404', show(none))
  const csm = await del(templateRoute, db, 'tpl-stalled.whop.day5', 'csm')
  ok(csm.status === 403 && db.rows('templates').length === 18, 'a csm: 403, nothing deleted')
  const deletes = db.calls('templates', 'delete')
  ok(deletes.every((c) => c.filters.includes('is_custom=true')), 'every delete the route sends is held to is_custom = true, so a built-in is never deleted', show(deletes.map((c) => c.filters)))
  const baseDb = routeDb()
  const before = await del(baseRoute, baseDb, 'tpl-stalled.whop.day3')
  ok(before.status === 200 && !baseDb.rows('templates').some((t) => t.id === 'tpl-stalled.whop.day3'),
     `control: at ${BASE} the route deleted the built-in, and no route can make it again`, show(before))
}

console.log('\n=== The row: Off where the switch works, and what it says when opened ===')
{
  const rowProps = (t, open = false) => ({
    template: t, draft: DATA.draftOf(t), open, stat: undefined, live: LIVE, trigger: { catalog: null, error: 'not read' },
    settings: { ok: true, values: LIVE_SETTINGS }, canEdit: true, busy: false,
    handlers: { onToggleOpen() {}, onDraft() {}, onSave: async () => null, onSetActive() {}, onDelete: async () => null },
  })
  const offCustom = render(TemplateRow, rowProps({ ...CUSTOM, is_active: false }))
  ok(offCustom.includes('pill-tone-warning">Off</span>') && offCustom.includes('aria-expanded="false"'),
     'a custom template that is off: an Off badge in its line, the editor closed')
  const nolessons = builtIns().find((t) => t.scenario_id === 'nolessons.day3')
  const closed = render(TemplateRow, rowProps({ ...nolessons, is_active: false }))
  const opened = words(render(TemplateRow, rowProps({ ...nolessons, is_active: false }, true)))
  ok(closed.includes('pill-tone-warning">Off</span>') && opened.includes('This template is off.') && opened.includes('Turn on')
       && !opened.includes('whether it is on or off'),
     'nolessons.day3 off: an Off badge (off stops its tasks since T-106), and opened, "This template is off." and Turn on')
  const stats = { created: 40, open: 4, sent: 32, dismissed: 4, replied: 6, no_reply: 20, success: 9, success_eligible: 22, success_label: 'x', graded_on_old_course: 8 }
  const line = words(render(TemplateRow, { ...rowProps(builtIns()[1]), stat: stats }))
  ok(line.includes('Cancel path · 32 sent · 41% success · 8 graded on the old course · 6 replied'),
     'its line: the bucket in words and its numbers', line.slice(0, 120))
  const dirty = render(TemplateRow, { ...rowProps(builtIns()[1]), draft: { ...DATA.draftOf(builtIns()[1]), body: 'changed' } })
  ok(dirty.includes('>Unsaved</span>'), 'an unsaved change shows on the line')
}

console.log('\n=== Save sends only what changed ===')
{
  const t = builtIns().find((x) => x.scenario_id === 'stalled.whop.day5')
  const d = DATA.draftOf(t)
  ok(show(DATA.changedFields(t, { ...d, body: 'New words {programLink}' })) === show({ body: 'New words {programLink}' }),
     'a new message on a built-in: { body } and nothing else (no bucket, no conditions)')
  ok(show(DATA.changedFields(t, d)) === show({}) && !DATA.isDirty(t, d), 'nothing changed: nothing to send, and the row is not dirty')
  const withRule = { ...CUSTOM }
  ok(show(DATA.changedFields(withRule, { ...DATA.draftOf(withRule), trigger_config: { all: [] } })) === show({ trigger_config: null }),
     'every condition removed: trigger_config null (no conditions), never {"all": []}')
  const add = { all: [{ metric: 'day_number', op: 'at_least', value: 3 }] }
  ok(show(DATA.changedFields(t, { ...d, trigger_config: add, bucket: 'at_risk' })) === show({ bucket: 'at_risk', trigger_config: add }),
     'a condition added and the bucket changed: both, as the route takes them')

  // Through the transport and the real PUT route: the stored conditions stay null.
  const db = new FakeDb({ templates: builtIns() })
  installDb(db)
  setTeam({ id: 'team-founder', role: 'founder' })
  setBrowser({ db, token: 'tok' })
  const saved = await hush(() => templatesTransport.saveTemplate(t.id, DATA.changedFields(t, { ...d, body: 'New words' })))
  const row = db.rows('templates').find((x) => x.id === t.id)
  ok(saved.ok && row.body === 'New words' && row.trigger_config === null && row.bucket === 'cancel_path',
     'a text save through PUT /api/admin/templates/:id leaves trigger_config null and the bucket as it was', show({ trigger_config: row.trigger_config }))
  // Why it matters: check-csm-tasks' auto-dismiss (path 2) evaluates any trigger_config it finds, and an empty list never matches.
  const csmRoute = fromSrc('src/app/api/cron/check-csm-tasks/route.ts')
  ok(/if \(tpl\?\.trigger_config\) \{\s*stillMatches = evaluateCustomTrigger\(/.test(csmRoute)
       && CSM.evaluateCustomTrigger({}, { all: [] }).match === false,
     'the reason: the cron reads {"all": []} as conditions that never match, which dismisses the open stalled.* tasks of a template saved that way')
  const old = fromBase('src/app/admin/(authenticated)/templates/page.tsx')
  ok(/payload\.trigger_config = draft\.trigger_config;/.test(old) && old.includes('trigger_config: t.trigger_config ?? EMPTY_TRIGGER'),
     `control: at ${BASE} every save sent the draft's conditions, {"all": []} for a built-in with none`)

  const active = await hush(() => templatesTransport.setActive('tpl-pace.day7', false))
  const pace = db.rows('templates').find((x) => x.id === 'tpl-pace.day7')
  ok(active.ok && pace.is_active === false && active.data.is_active === false && pace.body === 'Hey {firstName}, a nudge.',
     'Turn off sends { is_active: false } and nothing else; the page gets the row back', show(db.calls('templates', 'update').at(-1)?.values))
  setTeam({ id: 'team-csm', role: 'csm' })
  const refused = await hush(() => templatesTransport.setActive('tpl-pace.day7', true))
  ok(!refused.ok && refused.error === "Your team account can't do this." && pace.is_active === false,
     'a csm (shown no button) is refused by the route, and the page has a sentence to show', show(refused))
}

console.log('\n=== D12: "Membership status" in the trigger editor ===')
{
  const def = CSM.METRICS.membership_status
  ok(def.label === 'Membership status' && def.describe({ metric: 'membership_status', op: 'is', value: 'active' }) === 'Membership status is active'
       && def.describe({ metric: 'membership_status', op: 'is_not', value: 'canceled' }) === 'Membership status is not canceled',
     'the metric reads "Membership status" in the dropdown and in the sentence; its id (membership_status) stays for the templates that hold it')
  const html = words(render(TriggerBuilder, {
    value: CUSTOM.trigger_config, onChange() {}, catalog: { catalog: { regions: [], actionLessons: [], courseIsNew: true }, error: null },
  }))
  ok(html.includes('Membership status') && !/subscri/i.test(html), 'the editor, rendered with the custom template\'s conditions, says Membership status and never subscription', html.slice(0, 160))
  const files = ['src/components/admin/TriggerBuilder.tsx', 'src/components/admin/templates/TemplatesView.tsx', 'src/components/admin/templates/TemplateRow.tsx',
    'src/components/admin/templates/MessageSettings.tsx', 'src/components/admin/templates/NewTemplateDialog.tsx', 'src/lib/admin/templates-data.ts']
  ok(files.every((f) => !/subscription/i.test(fromSrc(f))), 'no "subscription" in the Templates page\'s files')
  ok(/label: "Subscription status"/.test(fromBase('src/lib/csm-triggers.ts')), `control: at ${BASE} it read "Subscription status"`)
}

console.log('\n=== The trigger editor takes its catalog from the page ===')
{
  const src = fromSrc('src/components/admin/TriggerBuilder.tsx')
  ok(!src.includes('supabase-browser') && !src.includes('createClient') && !src.includes('useEffect'),
     'TriggerBuilder.tsx reads nothing itself (one read for the page, and none from the dev page)')
  ok(/function useTriggerCatalog\(\)/.test(fromBase('src/components/admin/TriggerBuilder.tsx')), `control: at ${BASE} each open row read the catalog itself`)
  const html = words(render(TriggerBuilder, { value: { all: [{ metric: 'region_complete', region: 'a1', op: 'is' }] }, onChange() {}, catalog: { catalog: null, error: 'areas: timeout' } }))
  ok(html.includes('The areas and lessons could not be loaded, so their dropdowns are off: areas: timeout'), 'a catalog that could not be read: its reason, and the dropdowns off', html.slice(0, 200))
}

console.log('\n=== The words the team reads ===')
{
  const files = [
    'src/components/admin/templates/TemplatesView.tsx', 'src/components/admin/templates/TemplateRow.tsx', 'src/components/admin/templates/MessageSettings.tsx',
    'src/components/admin/templates/NewTemplateDialog.tsx', 'src/components/admin/templates/form-parts.tsx', 'src/components/admin/TriggerBuilder.tsx',
    'src/components/admin/TemplateOnOff.tsx', 'src/lib/admin/templates-data.ts', 'src/app/dev/admin/templates-fixtures.ts',
  ]
  const bad = files.filter((f) => /—|\bunlock|ecomtalent/i.test(fromSrc(f)))
  ok(bad.length === 0, 'no em dash, "unlock" or "EcomTalent" anywhere in the Templates page\'s files', bad.join(', '))
}

globalThis.fetch = realFetch
console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
