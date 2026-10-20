/**
 * Dates as the admin shows them: read in Croatia (Europe/Zagreb), where the
 * 30% rule's days begin and end (discount.ts), in the brand kit's short form.
 *
 *   dayLabel       "Fri 16 Oct"
 *   deadlineLabel  "Fri 23 Oct, 23:59 (Croatia time)"
 *   dayTimeLabel   "Fri 23 Oct, 23:59", where the line already says the
 *                  zone or needs to stay short (C4's 30% reasons)
 *   clockLabel     "09:41", for "Updated 09:41"
 *
 * In UTC the shared deadline, the end of 23 October in Croatia, falls at
 * 21:59 on the 23rd, and the first day of the offer (1 October) falls on the
 * evening of 30 September, so a date read in UTC would be a day off for
 * both. The day and month names come from the tables below rather than from
 * Intl: Intl's short English month for September is "Sept" in one locale and
 * "Sep" in another, and the server and each browser may differ. Intl is asked
 * only for the numbers of the Croatian calendar date and clock.
 */

const ZONE = "Europe/Zagreb";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const NUMBERS = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/** The Croatian calendar date and clock of a moment, or null for no date or one that does not parse. */
function inCroatia(iso: string | null | undefined): { year: number; month: number; day: number; hour: number; minute: number } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const n: Record<string, number> = {};
  for (const p of NUMBERS.formatToParts(new Date(t))) {
    if (p.type !== "literal") n[p.type] = Number(p.value);
  }
  // Some engines write midnight as 24 even with h23; it is the start of the same day.
  return { year: n.year, month: n.month, day: n.day, hour: n.hour % 24, minute: n.minute };
}

const two = (n: number) => String(n).padStart(2, "0");

/** "Fri 16 Oct": the day in Croatia. An empty string for no date or one that does not parse. */
export function dayLabel(iso: string | null | undefined): string {
  const c = inCroatia(iso);
  if (!c) return "";
  const weekday = DAYS[new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay()];
  return `${weekday} ${c.day} ${MONTHS[c.month - 1]}`;
}

/** "Fri 23 Oct, 23:59 (Croatia time)": a deadline, to the minute, in Croatia. An empty string for no date or one that does not parse. */
export function deadlineLabel(iso: string | null | undefined): string {
  const c = inCroatia(iso);
  if (!c) return "";
  return `${dayLabel(iso)}, ${two(c.hour)}:${two(c.minute)} (Croatia time)`;
}

/** "Fri 23 Oct, 23:59": deadlineLabel without the zone. An empty string for no date or one that does not parse. */
export function dayTimeLabel(iso: string | null | undefined): string {
  const c = inCroatia(iso);
  if (!c) return "";
  return `${dayLabel(iso)}, ${two(c.hour)}:${two(c.minute)}`;
}

/** "09:41": the time of day in Croatia. An empty string for no date or one that does not parse. */
export function clockLabel(iso: string | null | undefined): string {
  const c = inCroatia(iso);
  if (!c) return "";
  return `${two(c.hour)}:${two(c.minute)}`;
}
