"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AdminPage,
  PageHeader,
  Section,
  Card,
  Pill,
  Tabs,
  Button,
  EmptyState,
  T,
} from "@/components/admin/ui";
import { createClient, getSharedSession } from "@/lib/supabase-browser";
import {
  WHOP_METRICS,
  WHOP_METRIC_NAMES,
  formatMetric,
  WHOP_PICKABLE_METRICS,
  WHOP_WITHHELD_METRICS,
  WHOP_PRODUCTS,
} from "@/lib/whop-stats-catalog";
import { STATS_RANGES, WHOP_HISTORY_START, type TileResult } from "@/lib/whop-stats";
import { MetricCard } from "./MetricCard";
import { DateRangePicker } from "./DateRangePicker";

/**
 * /admin/stats — the client shell.
 *
 * Holds no revenue of its own: every number comes from
 * GET /api/admin/stats, which is independently gated. This component
 * owns the controls, the tile grid, and saved layouts.
 */

type Granularity = "day" | "week" | "month";

type StatsResponse = {
  range: {
    key: string;
    from: string;
    to: string;
    previous: { from: string; to: string };
    trailingPartial: boolean;
  };
  granularity: Granularity;
  granularityCoerced: boolean;
  product: string | null;
  tiles: Record<string, TileResult>;
  reconciliation: {
    ok: boolean;
    account: number | null;
    productSum: number | null;
    difference: number | null;
    productCount: number;
  } | null;
  credentialFailure: string | null;
  available: string[];
  computed_at: string;
};

type SavedView = {
  id: string;
  name: string;
  layout: {
    metrics: { key: string; product: string | null }[];
    granularity: Granularity;
    range: string;
    from?: string;
    to?: string;
  } | null;
  invalid: string | null;
};

const DEFAULT_METRICS = [
  "gross_revenue",
  "net_revenue",
  "monthly_recurring_revenue",
  "annual_recurring_revenue",
  "paid_active_members",
  "product_new_users",
];

const RANGE_LABELS: Record<string, string> = {
  today: "Today",
  last_7d: "Last 7 days",
  last_30d: "Last 30 days",
  last_90d: "Last 90 days",
  this_month: "This month",
  last_month: "Last month",
  last_12m: "Last 12 months",
  all_time: "All time",
  custom: "Custom range…",
};

const PRODUCT_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: "All products" },
  { value: WHOP_PRODUCTS.ecomtalent, label: "ecomtalent" },
  { value: WHOP_PRODUCTS.et_brands, label: "ecomtalent for brands" },
  { value: WHOP_PRODUCTS.apex_free, label: "Apex (free)" },
];

const selectStyle: React.CSSProperties = {
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-control)",
  height: 34, // matches DateRangePicker's trigger so the row aligns
  paddingInline: 10,
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: "var(--track-subhead)",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

export function StatsClient() {
  const supabase = useMemo(() => createClient(), []);

  const [range, setRange] = useState<string>("last_30d");
  // Calendar-date STRINGS ("YYYY-MM-DD"), emitted by DateRangePicker.
  // Deliberately never parsed into a Date here — that is what keeps the
  // window timezone-proof for a UTC+2 user between 00:00 and 02:00 local.
  // The server re-validates and rejects rather than clamping
  // (resolveCustomRange in src/lib/whop-stats.ts).
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [product, setProduct] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<string[]>(DEFAULT_METRICS);

  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // Table view. Not decoration: a value must never be reachable ONLY by
  // hovering a chart, and a table of daily figures is also the most
  // directly comparable form against Whop's own dashboard.
  const [asTable, setAsTable] = useState(false);

  const [views, setViews] = useState<SavedView[]>([]);
  const [viewsError, setViewsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Guards against an out-of-order response overwriting a newer one when the
  // founder changes the range twice quickly.
  const seqRef = useRef(0);

  const token = useCallback(async () => {
    const session = await getSharedSession(supabase);
    return session?.access_token ?? null;
  }, [supabase]);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const t = await token();
      if (!t) {
        setError("Your session expired. Reload the page.");
        return;
      }
      if (range === "custom" && (!customFrom || !customTo)) {
        setLoading(false);
        return; // wait for both dates rather than firing a half-built window
      }
      const params = new URLSearchParams({
        range,
        granularity,
        metrics: metrics.join(","),
      });
      if (range === "custom") {
        params.set("from", customFrom);
        params.set("to", customTo);
      }
      if (product) params.set("product", product);

      const res = await fetch(`/api/admin/stats?${params}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      const json = await res.json().catch(() => null);
      if (seq !== seqRef.current) return; // a newer request already landed
      if (!res.ok) {
        setError(json?.error ?? `Request failed (${res.status})`);
        return;
      }
      setData(json as StatsResponse);
    } catch {
      if (seq === seqRef.current) setError("Could not reach the server.");
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [range, granularity, metrics, product, customFrom, customTo, token]);

  const loadViews = useCallback(async () => {
    try {
      const t = await token();
      if (!t) return;
      const res = await fetch("/api/admin/stats/views", {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) {
        // A missing table (migration not applied yet) must not break the
        // page — the tiles are independent of saved views.
        setViewsError("Saved views unavailable.");
        return;
      }
      const json = await res.json();
      setViews(json.views ?? []);
      setViewsError(null);
    } catch {
      setViewsError("Saved views unavailable.");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadViews();
  }, [loadViews]);

  const saveView = async () => {
    const name = window.prompt("Name this view");
    if (!name) return;
    setSaving(true);
    try {
      const t = await token();
      if (!t) return;
      const res = await fetch("/api/admin/stats/views", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${t}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          layout: {
            metrics: metrics.map((k) => ({
              key: k,
              product: WHOP_METRICS[k]?.product ? product : null,
            })),
            granularity,
            range,
            ...(range === "custom" ? { from: customFrom, to: customTo } : {}),
          },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setViewsError(j?.error ?? "Could not save view.");
        return;
      }
      await loadViews();
    } finally {
      setSaving(false);
    }
  };

  const applyView = (v: SavedView) => {
    if (!v.layout) return;
    setMetrics(v.layout.metrics.map((m) => m.key));
    setGranularity(v.layout.granularity);
    if (v.layout.range === "custom" && v.layout.from && v.layout.to) {
      setCustomFrom(v.layout.from);
      setCustomTo(v.layout.to);
    }
    setRange(v.layout.range);
    const firstProduct = v.layout.metrics.find((m) => m.product)?.product ?? null;
    setProduct(firstProduct);
  };

  const archiveView = async (id: string) => {
    const t = await token();
    if (!t) return;
    await fetch(`/api/admin/stats/views?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${t}` },
    });
    await loadViews();
  };

  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const currentLabel = data
    ? `${shortDate(data.range.from)} – ${shortDate(data.range.to)}`
    : "Current";
  const previousLabel = data
    ? `${shortDate(data.range.previous.from)} – ${shortDate(data.range.previous.to)}`
    : "Previous";

  const productLabel =
    PRODUCT_OPTIONS.find((p) => p.value === product)?.label ?? "All products";

  return (
    <AdminPage>
      <PageHeader
        title="Stats"
        description="Whop revenue, split by product. Whop removed this from their own dashboard; these figures come straight from their ledger."
        meta={
          data
            ? `${data.range.from} → ${data.range.to} · vs ${data.range.previous.from} → ${data.range.previous.to} · ${productLabel} · UTC`
            : undefined
        }
        actions={
          <div className="flex items-center" style={{ gap: 8, flexWrap: "wrap" }}>
            <DateRangePicker
              range={range}
              presets={STATS_RANGES.map((r) => ({
                value: r,
                label: RANGE_LABELS[r] ?? r,
              }))}
              customFrom={customFrom}
              customTo={customTo}
              resolvedFrom={data?.range.from}
              resolvedTo={data?.range.to}
              historyStart={WHOP_HISTORY_START}
              onPreset={(v) => setRange(v)}
              onCustom={(f, t) => {
                setCustomFrom(f);
                setCustomTo(t);
                setRange("custom");
              }}
            />
            <select
              aria-label="Product"
              value={product ?? ""}
              onChange={(e) => setProduct(e.target.value || null)}
              style={selectStyle}
            >
              {PRODUCT_OPTIONS.map((p) => (
                <option key={p.label} value={p.value ?? ""}>
                  {p.label}
                </option>
              ))}
            </select>
            <Tabs<Granularity>
              tabs={[
                { value: "day", label: "Daily" },
                { value: "week", label: "Weekly" },
                { value: "month", label: "Monthly" },
              ]}
              value={granularity}
              onChange={setGranularity}
            />
            <Tabs<"chart" | "table">
              tabs={[
                { value: "chart", label: "Charts" },
                { value: "table", label: "Table" },
              ]}
              value={asTable ? "table" : "chart"}
              onChange={(v) => setAsTable(v === "table")}
            />
            <Button onClick={() => setPicking((v) => !v)}>
              {picking ? "Done" : "Add metric"}
            </Button>
          </div>
        }
      />

      {/* One banner instead of twelve identical "unavailable" tiles when the
          credential itself is the problem. */}
      {data?.credentialFailure && (
        <Card padding={14} style={{ marginBottom: 20 }}>
          <div className="flex items-center" style={{ gap: 10 }}>
            <Pill tone="danger">every metric failed</Pill>
            <span style={T.body}>
              {data.credentialFailure === "scope"
                ? "The Whop API key is missing the stats:read scope."
                : "Whop rejected the API key. It may have been rotated."}
            </span>
          </div>
        </Card>
      )}

      {/* SELF-CHECK BANNER. Silent only when the invariant holds — a check
          nobody sees is not a check. When it fails, the per-product tiles are
          under-reporting and the difference is the size of the omission. */}
      {data?.reconciliation && !data.reconciliation.ok && (
        <Card padding={14} style={{ marginBottom: 20 }}>
          <div className="flex items-center" style={{ gap: 10, flexWrap: "wrap" }}>
            <Pill tone="danger">self-check failed</Pill>
            <span style={T.body}>
              {data.reconciliation.difference == null
                ? "Could not verify the per-product split against the account total (a request failed). Treat per-product figures as unconfirmed."
                : `Per-product gross revenue does not add up to the account total — off by ${data.reconciliation.difference.toLocaleString(
                    "en-US",
                    { style: "currency", currency: "USD" },
                  )} across ${data.reconciliation.productCount} known products. Whop most likely has a product this page does not know about, so the per-product view is under-reporting by that amount. The account-level figures are still correct.`}
            </span>
          </div>
        </Card>
      )}

      {data?.granularityCoerced && (
        <Card padding={12} style={{ marginBottom: 20 }}>
          <span style={T.meta}>
            Range too long for daily points — showing {data.granularity}ly
            buckets.
          </span>
        </Card>
      )}

      {error && (
        <Card padding={14} style={{ marginBottom: 20 }}>
          <div className="flex items-center" style={{ gap: 10 }}>
            <Pill tone="danger">error</Pill>
            <span style={T.body}>{error}</span>
            <Button onClick={() => void load()}>Retry</Button>
          </div>
        </Card>
      )}

      {picking && (
        <Section eyebrow="Add a metric" count={WHOP_PICKABLE_METRICS.length}>
          <Card padding={14}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
                gap: 6,
              }}
            >
              {WHOP_PICKABLE_METRICS.map((k) => {
                const on = metrics.includes(k);
                const spec = WHOP_METRICS[k];
                return (
                  <button
                    key={k}
                    onClick={() =>
                      setMetrics((cur) =>
                        cur.includes(k)
                          ? cur.filter((x) => x !== k)
                          : cur.length >= 12
                            ? cur
                            : [...cur, k],
                      )
                    }
                    style={{
                      textAlign: "left",
                      background: on
                        ? "var(--color-fill-secondary)"
                        : "transparent",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-chip)",
                      padding: "8px 10px",
                      cursor: "pointer",
                      fontSize: 12,
                      color: "var(--color-text-primary)",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        display: "inline-flex",
                        width: 12,
                        marginRight: 6,
                        verticalAlign: "-1px",
                        color: "var(--color-accent-dark)",
                      }}
                    >
                      {on && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth={2.5}
                             strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </span>
                    {WHOP_METRIC_NAMES[k] ?? k}
                    {!spec?.product && (
                      <span style={{ ...T.meta, marginLeft: 6 }}>
                        account only
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div style={{ ...T.meta, marginTop: 12, lineHeight: 1.5 }}>
              Max 12 tiles. {WHOP_WITHHELD_METRICS.length} of Whop&apos;s 64
              metrics are withheld — either not revenue-related, or not
              reproducible (e.g. <code>churned_revenue</code> returns different
              values for the same day depending on the window asked for).
            </div>
          </Card>
        </Section>
      )}

      <Section
        eyebrow={loading ? "Loading" : "Metrics"}
        count={metrics.length}
        action={
          <div className="flex items-center" style={{ gap: 8 }}>
            <Button onClick={() => void saveView()} disabled={saving}>
              Save this view
            </Button>
          </div>
        }
      >
        {range === "custom" && (!customFrom || !customTo) ? (
          <EmptyState
            title="Pick both dates"
            description="Whop's ranges include both endpoints, so 1-30 November is the whole month."
          />
        ) : metrics.length === 0 ? (
          <EmptyState
            title="No metrics selected"
            description="Use “Add metric” to choose from Whop's catalogue."
          />
        ) : asTable ? (
          /* TABLE VIEW — the WCAG-clean twin of the charts. Every value the
             charts encode visually is here as text, aligned with
             tabular-nums (the one place equal-width digits belong). */
          <Card padding={0} style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <caption
                style={{
                  ...T.meta,
                  captionSide: "top",
                  textAlign: "left",
                  padding: "12px 14px 8px",
                }}
              >
                {currentLabel} · {data?.granularity ?? granularity} buckets · UTC
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    style={{
                      ...T.eyebrow,
                      textAlign: "left",
                      padding: "8px 14px",
                      borderBottom: "1px solid var(--color-border)",
                      position: "sticky",
                      left: 0,
                      background: "var(--color-bg-card)",
                    }}
                  >
                    Date
                  </th>
                  {metrics.map((k) => (
                    <th
                      key={k}
                      scope="col"
                      style={{
                        ...T.eyebrow,
                        textAlign: "right",
                        padding: "8px 14px",
                        borderBottom: "1px solid var(--color-border)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {WHOP_METRIC_NAMES[k] ?? k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const first = metrics
                    .map((k) => data?.tiles[k])
                    .find((t) => t?.status === "ok") as
                    | Extract<TileResult, { status: "ok" }>
                    | undefined;
                  if (!first) return null;
                  return first.points.map((p, i) => (
                    <tr key={p.t}>
                      <th
                        scope="row"
                        style={{
                          textAlign: "left",
                          padding: "6px 14px",
                          fontWeight: 500,
                          color: "var(--color-text-secondary)",
                          borderBottom: "1px solid var(--color-border)",
                          whiteSpace: "nowrap",
                          position: "sticky",
                          left: 0,
                          background: "var(--color-bg-card)",
                        }}
                      >
                        {new Date(p.t * 1000).toISOString().slice(0, 10)}
                      </th>
                      {metrics.map((k) => {
                        const t = data?.tiles[k];
                        const v =
                          t?.status === "ok" ? (t.points[i]?.v ?? null) : null;
                        return (
                          <td
                            key={k}
                            style={{
                              textAlign: "right",
                              padding: "6px 14px",
                              color:
                                v == null
                                  ? "var(--color-text-tertiary)"
                                  : "var(--color-text-primary)",
                              borderBottom: "1px solid var(--color-border)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {t?.status !== "ok"
                              ? "—"
                              : v == null
                                ? "no data"
                                : formatMetric(k, v)}
                          </td>
                        );
                      })}
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </Card>
        ) : (
          <div
            style={{
              display: "grid",
              // 2-across. Charts with real axes need width; three narrow
              // columns is what made these read as sparklines.
              gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))",
              gap: 14,
              opacity: loading ? 0.55 : 1,
              transition: "opacity var(--duration-quick) var(--ease-default)",
            }}
          >
            {metrics.map((k) => (
              <MetricCard
                key={k}
                metricKey={k}
                tile={
                  data?.tiles[k] ?? { status: "error", reason: "timeout" }
                }
                granularity={data?.granularity ?? granularity}
                currentLabel={currentLabel}
                previousLabel={previousLabel}
                onRemove={() =>
                  setMetrics((cur) => cur.filter((x) => x !== k))
                }
              />
            ))}
          </div>
        )}
      </Section>

      <Section eyebrow="Saved views" count={views.length}>
        {viewsError && (
          <div style={{ ...T.meta, marginBottom: 8 }}>{viewsError}</div>
        )}
        {views.length === 0 && !viewsError ? (
          <EmptyState
            title="No saved views yet"
            description="Arrange the tiles you want, then “Save this view”."
          />
        ) : (
          <div className="flex" style={{ gap: 8, flexWrap: "wrap" }}>
            {views.map((v) => (
              <Card key={v.id} padding={12}>
                <div className="flex items-center" style={{ gap: 10 }}>
                  <button
                    onClick={() => applyView(v)}
                    disabled={!v.layout}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: v.layout ? "pointer" : "not-allowed",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-text-primary)",
                      padding: 0,
                    }}
                  >
                    {v.name}
                  </button>
                  {v.invalid && <Pill tone="warning">needs attention</Pill>}
                  <button
                    onClick={() => void archiveView(v.id)}
                    aria-label={`Archive ${v.name}`}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--color-text-tertiary)",
                      fontSize: 13,
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
                {v.invalid && (
                  <div style={{ ...T.meta, marginTop: 4 }}>{v.invalid}</div>
                )}
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section eyebrow="How these are calculated">
        <Card padding={14}>
          <details>
            <summary
              style={{
                cursor: "pointer",
                ...T.bodyDim,
                marginBottom: 8,
              }}
            >
              Where the numbers come from, and what they do not mean
            </summary>
            <div style={{ ...T.meta, lineHeight: 1.7 }}>
              <p>
                Every figure is read live from Whop&apos;s Stats API for
                account <code>biz_sijEdQzBJ7eVv2</code>. Nothing is stored, so
                nothing can drift out of date.
              </p>
              <p style={{ marginTop: 8 }}>
                <strong>We only ever ask Whop for daily points</strong> and do
                the weekly/monthly rollup here. Whop&apos;s own coarse buckets
                are unreliable in five separately verified ways — most
                dangerously, a partial period is labelled as a whole one
                (10-20 August at monthly returns $49,447 stamped &ldquo;1
                August&rdquo;, when August was $136,964).
              </p>
              <p style={{ marginTop: 8 }}>
                <strong>MRR and ARR are levels, not totals.</strong> They show
                the latest day in range, never a sum. They also restate
                retroactively as refunds and disputes land, so a past
                month&apos;s MRR can move; gross revenue does not.
              </p>
              <p style={{ marginTop: 8 }}>
                <strong>Blank is not zero.</strong> A tile shows a number, or
                &ldquo;no data in this window&rdquo;, or &ldquo;unavailable&rdquo;
                with a reason. A failed request can never render as $0, and a
                missing day is drawn as a gap in the line.
              </p>
              <p style={{ marginTop: 8 }}>
                <strong>Scope.</strong> These are whole-account figures across
                every payer and every product, with no launch-cohort filter — so
                &ldquo;paid active members&rdquo; here will be higher than the
                same words elsewhere in /admin, which counts only launch-cohort
                students. Percentages arrive pre-scaled from Whop and are shown
                exactly as given.
              </p>
              <p style={{ marginTop: 8 }}>
                <strong>Self-check.</strong> Whenever gross revenue is on
                screen with no product filter, this page also fetches each
                product separately and confirms the parts still add up to the
                account total. They matched to the cent on 2026-09-03. If they
                ever stop matching, a red banner appears at the top — that is
                the signal a product exists in Whop that this page has never
                heard of, which would otherwise make the per-product split
                quietly under-report.
              </p>
              <p style={{ marginTop: 8 }}>
                All dates are UTC. Whop&apos;s ranges include both endpoints.
              </p>
            </div>
          </details>
        </Card>
      </Section>
    </AdminPage>
  );
}
