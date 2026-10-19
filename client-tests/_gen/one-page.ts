// Written by thirty-view.test.mjs for its control: a read that skips paging.
// One call and no .range(), so the stand-in's 1000-row cap cuts it short, as PostgREST would.
export async function fetchAllRowsPaginated(buildQuery: () => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  const r = await buildQuery()
  return r.error ? { data: [], error: new Error(r.error.message) } : { data: r.data ?? [], error: null }
}
