// lesson-text.ts: a lesson's written text, read into blocks and runs. Every
// rule of the format agreed with the loader, and every way a text can fall
// outside it. The module is the real source (build.mjs copies it untouched).
import { LESSON_TEXT_MAX, parseInline, parseLessonText, safeHref } from './_gen/lesson-text.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const show = (v) => JSON.stringify(v)
const T = (text, bold = false) => ({ kind: 'text', text, bold })
const A = (text, href, bold = false) => ({ kind: 'link', text, href, bold })
/** Every link anywhere in a parse. */
const linksOf = (blocks) => blocks.flatMap((b) =>
  (b.kind === 'paragraph' ? b.lines : b.kind === 'bullets' ? b.items : b.items.map((i) => i.runs)).flat(),
).filter((r) => r.kind === 'link')

console.log('\n=== Nothing to show ===')
ok(same(parseLessonText(''), []), 'an empty text has no blocks')
ok(same(parseLessonText(null), []), 'null has no blocks')
ok(same(parseLessonText(undefined), []), 'undefined has no blocks')
ok(same(parseLessonText('\n\n   \n\t\n'), []), 'a text of nothing but blank lines has no blocks')
ok(same(parseLessonText(42), []), 'a value that is not a string has no blocks')

console.log('\n=== Blocks ===')
{
  const b = parseLessonText('First paragraph.\n\nSecond paragraph.')
  ok(same(b, [{ kind: 'paragraph', lines: [[T('First paragraph.')]] }, { kind: 'paragraph', lines: [[T('Second paragraph.')]] }]),
     'one blank line separates two blocks', show(b))
}
{
  const b = parseLessonText('\n\nOne.\n\n\n\n   \nTwo.\n\n')
  ok(b.length === 2 && b.every((x) => x.kind === 'paragraph'), 'blank lines at the ends are dropped, and several blank lines (spaces only counts as blank) are one separator', show(b))
}
{
  const b = parseLessonText('Line one\nline two')
  ok(same(b, [{ kind: 'paragraph', lines: [[T('Line one')], [T('line two')]] }]), 'a single \\n inside a paragraph is a line break: one block, two lines', show(b))
}

console.log('\n=== Bullet lists ===')
{
  const b = parseLessonText('- one\n- **two**\n- three')
  ok(same(b, [{ kind: 'bullets', items: [[T('one')], [T('two', true)], [T('three')]] }]), 'every line starts with "- ": a bullet list, inline marks read inside each item', show(b))
}
{
  const b = parseLessonText('- one\nnot an item')
  ok(b.length === 1 && b[0].kind === 'paragraph' && b[0].lines.length === 2 && b[0].lines[0][0].text === '- one',
     'one line that does not start with "- " makes the whole block a paragraph, written as it is', show(b))
}
ok(parseLessonText('-one\n-two')[0].kind === 'paragraph', 'a dash with no space after it is not a bullet')
ok(parseLessonText('  - indented')[0].kind === 'paragraph', 'an indented dash is not a bullet: the line must start with "- "')
ok(parseLessonText('* star')[0].kind === 'paragraph', 'a star is not a bullet')

console.log('\n=== Numbered lists ===')
{
  const b = parseLessonText('3. Three\n4. Four\n5. **Five**')
  ok(same(b, [{ kind: 'numbered', items: [{ n: 3, runs: [T('Three')] }, { n: 4, runs: [T('Four')] }, { n: 5, runs: [T('Five', true)] }] }]),
     'every line starts with "<number>. ": a numbered list that starts at 3', show(b))
}
{
  const b = parseLessonText('1. One\n7. Seven\n2. Two')
  ok(same(b[0].items?.map((i) => i.n), [1, 7, 2]), 'the numbers are kept as written, out of order included', show(b[0].items?.map((i) => i.n)))
}
ok(parseLessonText('1. One\nTwo')[0].kind === 'paragraph', 'one line without a number makes the block a paragraph')
ok(parseLessonText('1.One')[0].kind === 'paragraph', 'a number with no space after its dot is not a list item')
ok(parseLessonText('1) One')[0].kind === 'paragraph', 'a number with a parenthesis is not a list item')
ok(parseLessonText('1234567890. Too long')[0].kind === 'paragraph', 'a number of ten digits is not a list item')
ok(parseLessonText('- a\n1. b')[0].kind === 'paragraph', 'a bullet and a numbered line in one block: a paragraph')
{
  const b = parseLessonText('Intro line.\n\n- a\n- b\n\n3. c\n4. d\n\nOutro.')
  ok(same(b.map((x) => x.kind), ['paragraph', 'bullets', 'numbered', 'paragraph']), 'blocks of every kind, in their order', show(b.map((x) => x.kind)))
}

console.log('\n=== Bold ===')
ok(same(parseInline('a **b** c'), [T('a '), T('b', true), T(' c')]), '**b** is bold')
ok(same(parseInline('**a** and **b**'), [T('a', true), T(' and '), T('b', true)]), 'two bold stretches on one line')
ok(same(parseInline('an **unclosed mark'), [T('an **unclosed mark')]), 'an unclosed ** is shown as two stars, and nothing after it is bold', show(parseInline('an **unclosed mark')))
ok(same(parseInline('**a** then **b'), [T('a', true), T(' then **b')]), 'three marks: the first two pair, the third is shown as it is', show(parseInline('**a** then **b')))
{
  const b = parseLessonText('**starts here\nand ends here**')
  ok(same(b[0].lines, [[T('**starts here')], [T('and ends here**')]]), 'bold never runs past the end of a line: a mark on each of two lines pairs with nothing', show(b[0].lines))
}
ok(same(parseInline('****'), []), 'an empty bold stretch draws nothing')
ok(same(parseInline('a * b'), [T('a * b')]), 'a single star is a star')

console.log('\n=== Links ===')
ok(same(parseInline('see [the brief](https://example.com/brief) now'), [T('see '), A('the brief', 'https://example.com/brief'), T(' now')]),
   'an https link becomes a link with its label', show(parseInline('see [the brief](https://example.com/brief) now')))
ok(same(parseInline('[x](HTTPS://Example.com/A)'), [A('x', 'https://example.com/A')]), 'the address is the URL parser\'s own form (scheme and host lower case)', show(parseInline('[x](HTTPS://Example.com/A)')))
ok(same(parseInline('[run this](javascript:alert(1))'), [T('run this')]), 'javascript: is shown as its label alone, the parentheses inside it included', show(parseInline('[run this](javascript:alert(1))')))
ok(same(parseInline('[run](JavaScript:alert(document.cookie))'), [T('run')]), 'JavaScript: in mixed case is refused too')
ok(same(parseInline('[pic](data:text/html;base64,PHNjcmlwdD4=)'), [T('pic')]), 'data: is shown as its label alone')
ok(same(parseInline('[old](http://example.com)'), [T('old')]), 'http: is shown as its label alone')
ok(same(parseInline('[mail](mailto:a@example.com)'), [T('mail')]), 'mailto: is shown as its label alone')
ok(same(parseInline('[here](/dashboard)'), [T('here')]), 'a relative address is shown as its label alone')
ok(same(parseInline('[x](https://)'), [T('x')]), 'https:// with no host is refused')
ok(same(parseInline('[x](https:example.com)'), [T('x')]), 'https: without the two slashes is refused')
ok(same(parseInline('[label(https://example.com)'), [T('[label(https://example.com)')]), 'a missing closing bracket: the characters as they are, no link', show(parseInline('[label(https://example.com)')))
ok(same(parseInline('[label](https://example.com'), [T('[label](https://example.com')]), 'a missing closing parenthesis: the characters as they are, no link', show(parseInline('[label](https://example.com')))
ok(same(parseInline('[](https://example.com)'), [T('[](https://example.com)')]), 'an empty label is not a link')
ok(same(parseInline('[a b](https://example.com/x y)'), [T('[a b](https://example.com/x y)')]), 'an address with a space in it is not a link')
ok(same(parseInline('[a](https://en.wikipedia.org/wiki/Ad_(disambiguation))'), [A('a', 'https://en.wikipedia.org/wiki/Ad_(disambiguation)')]), 'one pair of parentheses inside an https address is kept')
ok(same(parseInline('[one](https://a.example) and [two](https://b.example)'), [A('one', 'https://a.example/'), T(' and '), A('two', 'https://b.example/')]), 'two links on one line')
ok(same(parseInline('**see [docs](https://example.com) now**'), [T('see ', true), A('docs', 'https://example.com/', true), T(' now', true)]), 'a link inside a bold stretch is a bold link')
ok(same(parseInline('**see [bad](javascript:x) now**'), [T('see bad now', true)]), 'a refused link inside bold is bold text')
ok(same(parseInline('[**x**](https://example.com)'), [A('**x**', 'https://example.com/')]), 'a link\'s label is shown as written, its stars included')
ok(same(parseInline('https://example.com'), [T('https://example.com')]), 'a bare address is text: only [label](address) makes a link')

console.log('\n=== safeHref ===')
ok(safeHref('https://example.com/a?b=1#c') === 'https://example.com/a?b=1#c', 'a plain https address is returned whole')
ok(['javascript:alert(1)', 'data:text/html,x', 'http://example.com', 'ftp://example.com', '//example.com', ' https://example.com', 'https://exa mple.com'].every((h) => safeHref(h) === null),
   'javascript:, data:, http:, ftp:, protocol-relative, a leading space and a host with a space are refused')

console.log('\n=== No HTML is interpreted ===')
{
  const b = parseLessonText('<script>alert(1)</script>\n<b>not bold</b> <a href="javascript:x">y</a>')
  ok(same(b, [{ kind: 'paragraph', lines: [[T('<script>alert(1)</script>')], [T('<b>not bold</b> <a href="javascript:x">y</a>')]] }]), 'HTML tags are text, character for character', show(b))
  ok(linksOf(b).length === 0, 'and an <a> written in the text is no link')
}

console.log('\n=== Windows line ends ===')
{
  const unix = 'Para one\nline two\n\n- a\n- b\n\n3. c\n4. d'
  const win = unix.replace(/\n/g, '\r\n')
  const mac = unix.replace(/\n/g, '\r')
  ok(same(parseLessonText(win), parseLessonText(unix)), '\\r\\n reads exactly as \\n', show(parseLessonText(win).map((x) => x.kind)))
  ok(same(parseLessonText(mac), parseLessonText(unix)), 'a lone \\r reads as \\n too')
  ok(!JSON.stringify(parseLessonText(win)).includes('\\r'), 'no \\r is left in any run')
}

console.log('\n=== 8000 characters ===')
ok(LESSON_TEXT_MAX === 8000, 'the limit is 8000')
{
  const exact = 'x'.repeat(8000)
  const b = parseLessonText(exact)
  ok(b.length === 1 && b[0].lines[0][0].text.length === 8000, 'exactly 8000 characters are all read', `${b[0]?.lines[0][0].text.length}`)
}
{
  const long = 'y'.repeat(7990) + ' tail that runs past the limit'
  const t = parseLessonText(long)[0].lines[0][0].text
  ok(t === 'y'.repeat(7990) + ' tail that', 'a longer text is cut at 8000 characters', `${t.length} characters, ending "${t.slice(-12)}"`)
  ok(!t.includes('runs past the limit'), 'and nothing after the cut is shown')
}
{
  // 12 characters a line with its \n: 666 whole items, and the cut lands 8 characters into the 667th ("- item 0").
  const many = Array.from({ length: 2000 }, (_, i) => `- item ${String(i).padStart(4, '0')}`).join('\n')
  const b = parseLessonText(many)
  const items = b[0]?.items ?? []
  ok(many.length > 8000 && b.length === 1 && b[0].kind === 'bullets' && items.length === 667 && items[666][0].text === 'item 0',
     'a list longer than 8000 characters keeps the items that fit, the last one cut short', `${items.length} items of 2000, the last "${items.at(-1)?.[0]?.text}"`)
}
{
  // The 8000th unit is the first half of an emoji: it goes too, so no half character reaches the page.
  const s = 'z'.repeat(7999) + '\u{1F600}' + 'more'
  const t = parseLessonText(s)[0].lines[0][0].text
  ok(t.length === 7999 && !/[\uD800-\uDBFF]$/.test(t), 'a cut never splits a character in two', `${t.length} units`)
}
{
  // \r\n counts as one character, so a Windows text is not cut sooner than the same text with \n.
  const unix = Array.from({ length: 1200 }, () => 'abcde').join('\n')
  const win = unix.replace(/\n/g, '\r\n')
  ok(win.length > 8000 && unix.length < 8000 && same(parseLessonText(win), parseLessonText(unix)), 'the limit counts the text after its line ends are read: \\r\\n is one', `${unix.length} with \\n, ${win.length} with \\r\\n`)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
