/**
 * Which catalog the app reads.
 *
 * Two catalogs coexist until cutover day. The live `/dashboard`, five crons,
 * every admin page, the achievements engine and both discount routes read
 * `lessons` and `regions` unfiltered — so the ~145 placeholder rows for the
 * rebuilt course live in `lessons_next` / `regions_next`, invisible to all of
 * them. The new `/world` code reads whichever pair this constant names.
 *
 * At cutover the rows are COPIED from `_next` into the real tables (so those
 * keep their views, policies and FK identities) and this flips back to "".
 *
 * Set `CATALOG_TABLE_SUFFIX=_next` on the preview deployment; leave it unset
 * in production until the day.
 */
const RAW = (process.env.CATALOG_TABLE_SUFFIX ?? "").trim();

const ALLOWED = ["", "_next"] as const;
type Suffix = (typeof ALLOWED)[number];

/**
 * Fail loudly at module load rather than let a typo through.
 *
 * A misspelled suffix would point every catalog query at a table that does
 * not exist. Supabase returns an error, `data` is null, the route falls back
 * to `?? []`, and the student gets an empty world with no error anywhere —
 * a believable wrong result, which is this project's documented failure mode.
 * A 500 on every request is the better outcome: someone notices in minutes.
 */
if (!(ALLOWED as readonly string[]).includes(RAW)) {
  throw new Error(
    `CATALOG_TABLE_SUFFIX must be "" or "_next", got ${JSON.stringify(RAW)}. ` +
      `A wrong value silently empties the catalog instead of erroring.`,
  );
}

export const CATALOG_TABLE_SUFFIX = RAW as Suffix;

/** True while the app is reading the staging catalog for the rebuilt course. */
export const IS_STAGING_CATALOG = CATALOG_TABLE_SUFFIX === "_next";

export const REGIONS_TABLE = `regions${CATALOG_TABLE_SUFFIX}` as
  | "regions"
  | "regions_next";

export const LESSONS_TABLE = `lessons${CATALOG_TABLE_SUFFIX}` as
  | "lessons"
  | "lessons_next";
