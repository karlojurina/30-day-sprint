/**
 * A lesson's written text: the `description` column of its row, read into
 * blocks and runs the lesson page draws as React elements
 * (src/components/world/LessonText.tsx). Nothing here touches the DOM, and no
 * HTML in the text is ever interpreted: every character arrives on the page as
 * text, a link or a bold run.
 *
 * THE FORMAT, as agreed with the loader that writes the column:
 *
 *   - Plain text with "\n" line ends, at most 8000 characters. Blocks are
 *     separated by one blank line.
 *   - A block whose every line starts with "- " is a bullet list. A block whose
 *     every line starts with "<number>. " is a numbered list, and the numbers
 *     are kept as written. Any other block is a paragraph, and a single "\n"
 *     inside it is a line break.
 *   - Inline: **bold**, and links written [label](https://...). Only an https
 *     address becomes a link; any other is shown as its label alone.
 *
 * WHAT IT DOES WITH TEXT OUTSIDE THE FORMAT. Windows ("\r\n") and old Mac
 * ("\r") line ends are read as "\n". A line of nothing but spaces counts as
 * blank, and several blank lines in a row are one separator. Past 8000
 * characters the text is cut. A "**" with no partner on its line, and a link
 * missing a bracket or a parenthesis, are shown as the characters they are.
 * Bold never runs past the end of a line.
 */

/** The longest text that is read. The loader writes no more than this; anything past it is cut. */
export const LESSON_TEXT_MAX = 8000;

/** A stretch of one line: plain text, or a link that is safe to open. Either can be bold. */
export type LessonInline =
  | { kind: "text"; text: string; bold: boolean }
  | { kind: "link"; text: string; href: string; bold: boolean };

export type LessonBlock =
  | { kind: "paragraph"; lines: LessonInline[][] }
  | { kind: "bullets"; items: LessonInline[][] }
  | { kind: "numbered"; items: { n: number; runs: LessonInline[] }[] };

const BULLET = /^- /;
/** Nine digits at most: a longer "number" is a paragraph, never a list item numbered past what a page can show. */
const NUMBERED = /^(\d{1,9})\. /;
/**
 * A link at one position (sticky). The label is one or more characters with no
 * "]" and no line end. The address has no space and no ")" except inside one
 * pair of parentheses, so "javascript:alert(1)" is read whole and refused whole.
 */
const LINK = /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/y;
const BOLD = "**";

/** The blocks of a lesson's text. Empty for null, for an empty text, and for one of nothing but blank lines. */
export function parseLessonText(text: string | null | undefined): LessonBlock[] {
  if (typeof text !== "string") return [];
  let s = text.replace(/\r\n?/g, "\n");
  if (s.length > LESSON_TEXT_MAX) {
    // Never cut a character in two: an emoji is two UTF-16 units.
    const last = s.charCodeAt(LESSON_TEXT_MAX - 1);
    s = s.slice(0, last >= 0xd800 && last <= 0xdbff ? LESSON_TEXT_MAX - 1 : LESSON_TEXT_MAX);
  }

  const blocks: LessonBlock[] = [];
  let lines: string[] = [];
  const close = () => {
    if (lines.length > 0) blocks.push(blockOf(lines));
    lines = [];
  };
  for (const line of s.split("\n")) {
    if (line.trim() === "") close();
    else lines.push(line);
  }
  close();
  return blocks;
}

function blockOf(lines: string[]): LessonBlock {
  if (lines.every((l) => BULLET.test(l))) {
    return { kind: "bullets", items: lines.map((l) => parseInline(l.slice(2))) };
  }
  const numbered = lines.map((l) => NUMBERED.exec(l));
  if (numbered.every((m) => m !== null)) {
    return {
      kind: "numbered",
      items: numbered.map((m, i) => ({
        n: Number(m![1]),
        runs: parseInline(lines[i].slice(m![0].length)),
      })),
    };
  }
  return { kind: "paragraph", lines: lines.map(parseInline) };
}

/**
 * The runs of one line. First the links are found, left to right. Then the
 * "**" in the text between them are paired in order, the first with the
 * second, the third with the fourth; a last one with no partner is shown as it
 * is. So a bold stretch can hold a link, and a link's label is shown as written.
 */
export function parseInline(line: string): LessonInline[] {
  type Piece = { text: string; href?: string | null };
  const pieces: Piece[] = [];
  let plain = "";
  for (let i = 0; i < line.length; ) {
    if (line[i] === "[") {
      LINK.lastIndex = i;
      const m = LINK.exec(line);
      if (m) {
        if (plain !== "") pieces.push({ text: plain });
        plain = "";
        pieces.push({ text: m[1], href: safeHref(m[2]) });
        i += m[0].length;
        continue;
      }
    }
    plain += line[i];
    i += 1;
  }
  if (plain !== "") pieces.push({ text: plain });

  let markers = 0;
  for (const p of pieces) if (p.href === undefined) markers += p.text.split(BOLD).length - 1;
  const paired = markers - (markers % 2);

  const runs: LessonInline[] = [];
  const addText = (text: string, bold: boolean) => {
    if (text === "") return;
    const prev = runs[runs.length - 1];
    if (prev && prev.kind === "text" && prev.bold === bold) prev.text += text;
    else runs.push({ kind: "text", text, bold });
  };
  let bold = false;
  let seen = 0;
  for (const p of pieces) {
    if (p.href === undefined) {
      const parts = p.text.split(BOLD);
      parts.forEach((part, k) => {
        if (k > 0) {
          if (seen < paired) bold = !bold;
          else addText(BOLD, bold);
          seen += 1;
        }
        addText(part, bold);
      });
    } else if (p.href === null) {
      addText(p.text, bold);
    } else {
      runs.push({ kind: "link", text: p.text, href: p.href, bold });
    }
  }
  return runs;
}

/**
 * The address a link may carry, or null when it may not have one. Only https,
 * with a host, as the URL parser reads it: javascript:, data:, http:, mailto:,
 * a relative path and anything that does not parse are all refused. The
 * parser's own form of the address is what is returned.
 */
export function safeHref(href: string): string | null {
  if (!/^https:\/\//i.test(href)) return null;
  try {
    const url = new URL(href);
    return url.protocol === "https:" && url.hostname !== "" ? url.href : null;
  } catch {
    return null;
  }
}
