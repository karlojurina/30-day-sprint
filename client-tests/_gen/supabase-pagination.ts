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
 * v75.32: on error, returns `{ data: [], error }` instead of
 * `{ data: partial, error }`. The "return whatever we got" behavior
 * was footgun-shaped — every caller (v75.27 + v75.29) destructured
 * only `data` and silently rendered truncated state on mid-page
 * failure. Now a single batch error gives the caller an empty array
 * to render (clear visual signal "something went wrong") instead of
 * "looks complete but is actually missing rows."
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
    let result: { data: T[] | null; error: { message: string } | null };
    try {
      result = (await buildQuery().range(from, from + pageSize - 1)) as {
        data: T[] | null;
        error: { message: string } | null;
      };
    } catch (e) {
      // v75.32: catch thunk/builder throws too — the contract is
      // structured { data, error }, never propagate exceptions to
      // surprised callers.
      const msg = e instanceof Error ? e.message : String(e);
      return { data: [], error: new Error(msg) };
    }
    const { data, error } = result;
    if (error) {
      // v75.32: empty data on error, NOT the partial accumulated set.
      // Callers that forget to check `error` will at least render
      // an empty list (visible problem) instead of a silently-truncated
      // list (invisible problem).
      return { data: [], error: new Error(error.message) };
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return { data: all, error: null };
}

/**
 * Every row matching the query, page after page BY KEY instead of by offset:
 * each page asks for the rows after the last key it saw (`key > last`, in key
 * order, at most `pageSize` of them). Same answer and error contract as
 * fetchAllRowsPaginated.
 *
 * Why: pages read by offset are separate queries, and a row deleted (or one
 * that leaves the filter, a task closed or reopened, say) while they are read
 * shifts every later row up by one, so one row of the next page is never
 * read. By key, a row that goes is simply not there and nothing else moves.
 * A row added meanwhile is read if its key comes after the page it would
 * have been on, as a snapshot taken a moment later would read it.
 *
 * `key` must be unique (a primary key, or a view with one row per key), and
 * `buildQuery` must order on `key` alone: the pages follow that order. Every
 * row must carry `key` in its selected columns.
 */
export async function fetchAllRowsByKey<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: () => any,
  key: string,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<PaginatedResult<T>> {
  const all: T[] = [];
  let last: unknown = null;

  // The same runaway backstop as above: 100 pages.
  for (let page = 0; page < 100; page++) {
    let result: { data: T[] | null; error: { message: string } | null };
    try {
      const query = buildQuery();
      result = (await (last === null ? query : query.gt(key, last)).limit(pageSize)) as {
        data: T[] | null;
        error: { message: string } | null;
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { data: [], error: new Error(msg) };
    }
    const { data, error } = result;
    if (error) return { data: [], error: new Error(error.message) };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    last = (data[data.length - 1] as Record<string, unknown>)[key];
    if (last === null || last === undefined) {
      return { data: [], error: new Error(`a row came back without its ${key}, so the next page cannot be asked for`) };
    }
  }

  return { data: all, error: null };
}
