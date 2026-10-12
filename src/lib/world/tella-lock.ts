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
 * Tella serves the video more widely than the rule allows. Two findings leave
 * the status alone, because the video is still locked while they are true: an
 * expected site missing from the list (the lesson will not play there) and a
 * length that differs from the catalog's (the 95% rule measures the wrong
 * length). A verdict with no `open` or `missing` problem is `locked`, so a
 * `locked` verdict can still carry sentences.
 *
 * `localhost` is reported like any other unexpected host: any page on any
 * machine's localhost could embed the lesson. It is allowed only where the
 * caller lists it as expected, which no real lesson does.
 */
export function judgeLock(
  facts: TellaVideoFacts | null,
  expectedDomains: readonly string[],
  catalogDurationSeconds: number | null,
): LockVerdict {
  if (facts === null) {
    return { status: "missing", problems: ["Tella no longer has this video."] };
  }

  const problems: string[] = [];
  let open = false;

  if (facts.linkScope !== "embedonly") {
    open = true;
    problems.push(
      `Access is "${facts.linkScope ?? "unknown"}"; it must be Embed only.`,
    );
  }

  const listed = hostList(facts.allowedEmbedDomains);
  const expected = hostList(expectedDomains);

  if (listed.length === 0) {
    open = true;
    problems.push("No domain list: any site can embed it.");
  } else {
    for (const domain of listed) {
      if (!expected.includes(domain)) {
        open = true;
        problems.push(`"${domain}" is on its domain list and should not be.`);
      }
    }
    // Only with a list in place. With no list every site can embed the video,
    // so "it will not play there" would be untrue.
    for (const domain of expected) {
      if (!listed.includes(domain)) {
        problems.push(
          `"${domain}" is missing from its domain list, so it will not play there.`,
        );
      }
    }
  }

  if (facts.downloadsEnabled || facts.rawDownloadsEnabled) {
    open = true;
    problems.push("Downloads are switched on.");
  }

  if (
    known(catalogDurationSeconds) &&
    known(facts.durationSeconds) &&
    Math.abs(facts.durationSeconds - catalogDurationSeconds) >
      DURATION_TOLERANCE_SECONDS
  ) {
    problems.push(
      `The video is ${Math.round(facts.durationSeconds)} s long and the catalog says ${Math.round(catalogDurationSeconds)} s, so the 95% rule is measuring the wrong length.`,
    );
  }

  return { status: open ? "open" : "locked", problems };
}
