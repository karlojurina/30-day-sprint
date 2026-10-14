// The discount application's questions (src/lib/discount-feedback.ts): what an
// unanswered question holds, when the student may go on, and the answers as
// /api/discounts/submit-feedback takes them. Both forms read these rules, the
// old dashboard's modal and the map's, and neither keeps its own copy.
import fs from 'node:fs'

const F = await import('./_gen/discount-feedback.ts')
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const same = (a, b) => show(a) === show(b)

const q = (id, order, type, required, extra = {}) => ({
  id, order_num: order, question_text: id, question_type: type,
  options: null, scale_min: null, scale_max: null, is_required: required, is_active: true, created_at: '', ...extra,
})
const SCALE = q('scale', 1, 'scale', true, { scale_min: 1, scale_max: 10 })
const CHOICE = q('choice', 2, 'multi_choice', true, { options: ['A', 'B'] })
const TEXT = q('text', 3, 'open_text', false)
const MUST_TYPE = q('must', 4, 'open_text', true)

console.log('\nAn unanswered question')
ok(same(F.defaultValue(SCALE), { kind: 'scale', value: null }), 'a scale: no number')
ok(same(F.defaultValue(CHOICE), { kind: 'choice', value: null }), 'a choice: none chosen')
ok(same(F.defaultValue(TEXT), { kind: 'text', value: '' }), 'a text: empty')

console.log('\nWhen the student may go on')
ok(F.isAnswered(TEXT, { kind: 'text', value: '' }) === true, 'an optional question, left empty: yes')
ok(F.isAnswered(SCALE, { kind: 'scale', value: null }) === false && F.isAnswered(SCALE, { kind: 'scale', value: 7 }) === true, 'a required scale: once a number is picked')
ok(F.isAnswered(CHOICE, { kind: 'choice', value: null }) === false && F.isAnswered(CHOICE, { kind: 'choice', value: '' }) === false &&
   F.isAnswered(CHOICE, { kind: 'choice', value: 'B' }) === true, 'a required choice: once one is picked')
ok(F.isAnswered(MUST_TYPE, { kind: 'text', value: '   ' }) === false && F.isAnswered(MUST_TYPE, { kind: 'text', value: 'ok' }) === true,
   'a required text: spaces are no answer')

console.log('\nThe order and the answers sent')
const shuffled = [TEXT, SCALE, MUST_TYPE, CHOICE]
const sorted = F.sortQuestions(shuffled)
ok(same(sorted.map((x) => x.id), ['scale', 'choice', 'text', 'must']) && shuffled[0] === TEXT, 'by order_num, the list handed in untouched')
const sent = F.toAnswers(sorted, { scale: { kind: 'scale', value: 9 }, choice: { kind: 'choice', value: 'A' }, must: { kind: 'text', value: 'more calls' } })
ok(same(sent, [
  { question_id: 'scale', answer_scale: 9, answer_choice: null, answer_text: null },
  { question_id: 'choice', answer_scale: null, answer_choice: 'A', answer_text: null },
  { question_id: 'text', answer_scale: null, answer_choice: null, answer_text: '' },
  { question_id: 'must', answer_scale: null, answer_choice: null, answer_text: 'more calls' },
]), 'one answer per question in order; one left alone sends its empty answer', show(sent))

console.log('\nBoth forms read these rules')
const modal = read('../src/components/map/DiscountFeedbackModal.tsx')
const map = read('../src/components/world/WorldDiscountForm.tsx')
for (const [name, src] of [['the dashboard modal', modal], ['the map form', map]]) {
  ok(src.includes('from "@/lib/discount-feedback"') && !/function (isAnswered|defaultValue)\b/.test(src),
     `${name} imports them and defines none of its own`)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
