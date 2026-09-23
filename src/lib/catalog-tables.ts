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

/**
 * Which SHAPE the live catalog has — which is not the same question as which
 * TABLE it lives in, and conflating them is a silent, total failure.
 *
 * The v1 catalog orders by (day, sort_order): `sort_order` there means "order
 * within a day". The v2 catalog has no `day` column at all — the new course
 * has no clock — and its `sort_order` is global 1..N.
 *
 * At cutover the v2 rows are copied INTO `lessons`, so CATALOG_TABLE_SUFFIX
 * goes back to "" while the shape stays v2. A query that keyed its ordering on
 * the table name would then order by `day`, and once v99 drops that column
 * PostgREST returns an error, the route's `?? []` swallows it, and every
 * student gets an empty course with nothing logged anywhere. That is the exact
 * believable-nothing failure this project keeps hitting, so the two facts are
 * tracked separately.
 *
 * Set CATALOG_SHAPE=v2 in the same Vercel change that clears
 * CATALOG_TABLE_SUFFIX on cutover night.
 */
const RAW_SHAPE = (process.env.CATALOG_SHAPE ?? "").trim();

if (!["", "v1", "v2"].includes(RAW_SHAPE)) {
  throw new Error(
    `CATALOG_SHAPE must be "", "v1" or "v2", got ${JSON.stringify(RAW_SHAPE)}.`,
  );
}

/**
 * True when the catalog has the v2 shape. The staging tables are always v2;
 * after cutover the real tables are too, and CATALOG_SHAPE says so.
 */
export const CATALOG_IS_V2 = IS_STAGING_CATALOG || RAW_SHAPE === "v2";
