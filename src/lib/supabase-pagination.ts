/**
 * Paginated fetch helper for Supabase queries that need to return
 * MORE than the PostgREST max-rows server-side cap (~1000 rows on
 * most Supabase projects).
 *
 * Plain `.select(...)` with `.limit(100000)` does NOT work — the
 * server cap silently truncates at whatever max-rows is set to. The
 * only reliable way to fetch a full table is via repeated `.range()`
 * calls until a page returns fewer rows than the page size.
 *
 * Verified empirically by the v75.23-v75.25 thrash: even with
 * `.limit(100000)` the cron's bulk completions fetch was capped at
 * ~1000 rows, silently dropping ~7000 students' progress.
 *
 * Usage:
 *
 *   const buildQuery = () =>
 *     supabase.from("students").select("*").eq("membership_status", "active");
 *   const { data, error } = await fetchAllRowsPaginated(buildQuery);
 *
 * `buildQuery` is a THUNK that returns a fresh PostgrestFilterBuilder
 * each call. We call it once per page because Supabase builders are
 * single-use — `.range()` mutates the builder and re-using it gives
 * incorrect results.
 */

interface PaginatedResult<T> {
  data: T[];
  error: Error | null;
}

const DEFAULT_PAGE_SIZE = 1000;

/**
 * Fetch every row matching the query, paginated to bypass PostgREST's
 * server-side max-rows cap. Returns the merged result.
 *
 * @param buildQuery Thunk that constructs the query — called once per
 *   page. Must return a query builder, NOT an already-awaited result.
 *   We type this as `any` because Supabase's PostgrestFilterBuilder
 *   has 7 generic params that shift across versions; tying the helper
 *   to those internals creates more pain than the type safety is worth.
 * @param pageSize How many rows to request per page. Defaults to 1000.
 */
export async function fetchAllRowsPaginated<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: () => any,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<PaginatedResult<T>> {
  const all: T[] = [];
  let from = 0;

  // Hard cap on iterations as a runaway-loop backstop. 100 pages ×
  // 1000 rows = 100k rows max. Far above any realistic admin surface.
  for (let page = 0; page < 100; page++) {
    const { data, error } = (await buildQuery().range(
      from,
      from + pageSize - 1,
    )) as { data: T[] | null; error: { message: string } | null };
    if (error) {
      return { data: all, error: new Error(error.message) };
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return { data: all, error: null };
}
