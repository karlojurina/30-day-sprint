/**
 * Is this lesson video still locked?
 *
 * Pure: no imports, no network. `tella-api.ts` asks Tella for a video's
 * settings, this file judges them, and the lock check
 * (api/cron/check-lesson-videos) writes the verdict on the `lesson_videos`
 * row and tells the team.
 *
 * WHY A CHECK AT ALL. A Tella id is the video's address. What keeps a lesson
 * inside the app is two settings on the video itself: access "Embed only",
 * and a list of the sites allowed to embed it. Both can be lost without
 * anyone touching our code: a copy of a video is born public with no list
 * (measured 2026-10-12), and anyone with the workspace login can edit either.
 *
 * THE CATALOG IS JUDGED IN THE SAME PASS (2026-10-12). Two faults in the
 * catalog make a lesson impossible to finish however well its video is
 * locked: the lesson has no length, so 95% of it is never reached, or the
 * video's row points at an id no watch lesson has. Neither changes the lock
 * status. Both add a sentence, which is what gets the lesson reported.
 *
 * Every problem is one plain sentence, because the sentences are what lands
 * in `lesson_videos.lock_detail` and in the team's Discord channel.
 */

export type LockStatus = "locked" | "open" | "missing" | "error";

export interface TellaVideoFacts {
  linkScope: string | null;
  allowedEmbedDomains: string[];
  downloadsEnabled: boolean;
  rawDownloadsEnabled: boolean;
  durationSeconds: number | null;
}

export interface LockVerdict {
  status: LockStatus;
  problems: string[];
}

/**
 * What the catalog says about the lesson a video row points at.
 *   "watch"   a watch lesson has this id. Its length is passed beside this,
 *             null when the catalog has none.
 *   "none"    no watch lesson has this id: it is in neither catalog table, or
 *             the lesson with this id is not a watch lesson.
 *   "unread"  the catalog could not be read, so nothing is said about it.
 *             Without this a failed read would accuse every lesson.
 */
export type CatalogLesson = "watch" | "none" | "unread";

/** One row of `lessons` or `lessons_next`: the three columns the check reads. */
export interface CatalogLessonRow {
  id: string;
  type: string | null;
  duration_seconds: number | string | null;
}

/**
 * The length of every WATCH lesson, by id, from the catalog tables in the
 * order given. An id with no entry has no watch lesson: either no table has
 * it, or the lesson is a setup or action lesson, which no video can complete.
 * An entry holding null is a watch lesson the catalog has no length for.
 *
 * A later table wins an id that two tables share. The caller passes the live
 * table last, because that is the one the heartbeat function measures 95%
 * against.
 */
export function watchLessonSeconds(
  tables: readonly (readonly CatalogLessonRow[])[],
): Map<string, number | null> {
  const seconds = new Map<string, number | null>();
  for (const rows of tables) {
    for (const row of rows) {
      if (row.type !== "watch") continue;
      // Number(): PostgREST can hand a numeric column back as a string.
      const n = row.duration_seconds == null ? NaN : Number(row.duration_seconds);
      seconds.set(row.id, isFinite(n) && n > 0 ? n : null);
    }
  }
  return seconds;
}

/** The catalog's length and Tella's may differ by this much before it is reported. */
const DURATION_TOLERANCE_SECONDS = 2;

/** Hosts compare without case, and a stray space in an env value must not count as a different host. */
function hostList(domains: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const d of domains) {
    const host = d.trim().toLowerCase();
    if (host) seen.add(host);
  }
  return [...seen];
}

function known(n: number | null): n is number {
  return typeof n === "number" && isFinite(n);
}

/**
 * facts === null means Tella answered 404.
 *
 * The rules run in a fixed order and each adds one sentence. `open` means
 * Tella serves the video more widely than the rule allows. Some findings
 * leave the status alone, because the video is still locked while they are
 * true: an expected site missing from the list (the lesson will not play
 * there) and everything the catalog rules find. A verdict with no `open` or
 * `missing` problem is `locked`, so a `locked` verdict can still carry
 * sentences.
 *
 * The catalog rules come last and run whatever Tella answered, a 404
 * included. They are about the row, and one run should say everything that
 * is wrong with it:
 *   - `catalogLesson` "none": no watch lesson has this id. The length is not
 *     looked at.
 *   - "watch" with no length (null, or not above zero): the lesson can never
 *     be counted.
 *   - "watch" with a length that differs from Tella's by more than 2 s: the
 *     95% rule measures the wrong length.
 *   - "unread": nothing is said.
 *
 * `localhost` is reported like any other unexpected host: any page on any
 * machine's localhost could embed the lesson. It is allowed only where the
 * caller lists it as expected, which no real lesson does.
 */
export function judgeLock(
  facts: TellaVideoFacts | null,
  expectedDomains: readonly string[],
  catalogDurationSeconds: number | null,
  catalogLesson: CatalogLesson = "watch",
): LockVerdict {
  const problems: string[] = [];
  let status: LockStatus = "locked";

  if (facts === null) {
    status = "missing";
    problems.push("Tella no longer has this video.");
  } else {
    if (facts.linkScope !== "embedonly") {
      status = "open";
      problems.push(
        `Access is "${facts.linkScope ?? "unknown"}"; it must be Embed only.`,
      );
    }

    const listed = hostList(facts.allowedEmbedDomains);
    const expected = hostList(expectedDomains);

    if (listed.length === 0) {
      status = "open";
      problems.push("No domain list: any site can embed it.");
    } else {
      for (const domain of listed) {
        if (!expected.includes(domain)) {
          status = "open";
          problems.push(`"${domain}" is on its domain list and should not be.`);
        }
      }
      // Only with a list in place. With no list every site can embed the
      // video, so "it will not play there" would be untrue.
      for (const domain of expected) {
        if (!listed.includes(domain)) {
          problems.push(
            `"${domain}" is missing from its domain list, so it will not play there.`,
          );
        }
      }
    }

    if (facts.downloadsEnabled || facts.rawDownloadsEnabled) {
      status = "open";
      problems.push("Downloads are switched on.");
    }
  }

  if (catalogLesson === "none") {
    problems.push("No watch lesson has this id.");
  } else if (catalogLesson === "watch") {
    if (!known(catalogDurationSeconds) || catalogDurationSeconds <= 0) {
      problems.push(
        "The catalog has no length for this lesson, so it can never be counted.",
      );
    } else if (
      facts !== null &&
      known(facts.durationSeconds) &&
      Math.abs(facts.durationSeconds - catalogDurationSeconds) >
        DURATION_TOLERANCE_SECONDS
    ) {
      problems.push(
        `The video is ${Math.round(facts.durationSeconds)} s long and the catalog says ${Math.round(catalogDurationSeconds)} s, so the 95% rule is measuring the wrong length.`,
      );
    }
  }

  return { status, problems };
}
