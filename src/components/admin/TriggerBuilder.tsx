"use client";

/**
 * Plain-English condition builder for custom CSM templates.
 *
 * The builder is intentionally jargon-light:
 *   - "When ALL of these are true:" header
 *   - Each row: [Metric ▼] [Sub-param ▼ if applicable] [Op ▼] [Value]
 *   - Operators are phrases ("is at least", "is more than", "is not") —
 *     never raw symbols. Karlo doesn't program; this should read like
 *     a sentence.
 *   - Boolean metrics ("Region 1 is complete") collapse the value
 *     input — only "is" / "is not".
 *   - Live preview at the bottom shows the rendered sentence.
 *
 * The component is fully controlled: parent owns the TriggerConfig
 * state and passes it down. The builder only emits onChange events.
 *
 * The areas and the action lessons it offers come from the live catalog
 * (`regions`, `lessons where requires_action`), so the editor offers r1..r4
 * before the course switch and a1..a8 after it. Once the switch has run
 * (admin_config.curriculum_reset_at), the three metrics that measure pace
 * against the old 30-day clock are not offered: on the new course they
 * never match (cutover PRD, C5).
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { getCurriculumResetAt } from "@/lib/curriculum-reset";
import {
  METRICS,
  REGION_LABEL,
} from "@/lib/csm-triggers";
import type {
  Condition,
  ConditionMetric,
  ConditionOp,
  RegionId,
  TriggerConfig,
} from "@/types/database";

const NUMERIC_OPS: Array<{ value: ConditionOp; label: string }> = [
  { value: "is", label: "is" },
  { value: "is_not", label: "is not" },
  { value: "at_least", label: "is at least" },
  { value: "more_than", label: "is more than" },
  { value: "at_most", label: "is at most" },
  { value: "less_than", label: "is less than" },
];

const BINARY_OPS: Array<{ value: ConditionOp; label: string }> = [
  { value: "is", label: "is" },
  { value: "is_not", label: "is not" },
];

/** The metrics that measure pace against the old course's 30-day clock. */
const CLOCK_METRICS = new Set<ConditionMetric>([
  "progress_ratio",
  "progress_label",
  "region_pace",
]);

interface Option {
  id: string;
  label: string;
}

/** What the dropdowns offer, read from the live catalog. */
interface Catalog {
  /** Areas in order_num order. */
  regions: Option[];
  /** Lessons with an action item, in course order. */
  actionLessons: Option[];
  /** True once the course switch has run. */
  courseIsNew: boolean;
}

/**
 * Reads the areas, the action lessons and the reset key. `catalog` stays
 * null while loading and after a failed read, and `error` says why; the
 * dropdowns that need the catalog are disabled until it arrives, so a
 * condition is never given a default that was guessed.
 */
function useTriggerCatalog(): { catalog: Catalog | null; error: string | null } {
  const [state, setState] = useState<{
    catalog: Catalog | null;
    error: string | null;
  }>({ catalog: null, error: null });

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      try {
        const [resetAt, regionsRes, lessonsRes] = await Promise.all([
          getCurriculumResetAt(supabase),
          supabase.from("regions").select("id, name, order_num").order("order_num"),
          supabase
            .from("lessons")
            .select("id, title, region_id, day, sort_order")
            .eq("requires_action", true),
        ]);
        if (regionsRes.error) throw new Error(`areas: ${regionsRes.error.message}`);
        if (lessonsRes.error) throw new Error(`lessons: ${lessonsRes.error.message}`);
        const regions = (regionsRes.data ?? []) as Array<{
          id: string;
          name: string;
          order_num: number;
        }>;
        const order = new Map(regions.map((r) => [r.id, r.order_num]));
        const lessons = [
          ...((lessonsRes.data ?? []) as Array<{
            id: string;
            title: string;
            region_id: string;
            day: number | null;
            sort_order: number;
          }>),
        ].sort(
          (a, b) =>
            (order.get(a.region_id) ?? 0) - (order.get(b.region_id) ?? 0) ||
            (a.day ?? 0) - (b.day ?? 0) ||
            a.sort_order - b.sort_order,
        );
        if (cancelled) return;
        setState({
          catalog: {
            regions: regions.map((r) => ({
              id: r.id,
              label: REGION_LABEL[r.id] ?? `Area ${r.order_num} (${r.name})`,
            })),
            actionLessons: lessons.map((l) => ({
              id: l.id,
              label: `${l.title} (${l.id})`,
            })),
            courseIsNew: resetAt != null,
          },
          error: null,
        });
      } catch (e) {
        if (cancelled) return;
        setState({
          catalog: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/**
 * The options for one dropdown, with the condition's current value kept
 * in the list even when the catalog no longer has it (a template written
 * for the old course), so the select never shows a different value from
 * the one saved.
 */
function withCurrent(options: Option[], current: string, loaded: boolean): Option[] {
  if (options.some((o) => o.id === current)) return options;
  // An old area keeps its old label; a lesson id stands for itself.
  const label = REGION_LABEL[current] ?? current;
  return [
    { id: current, label: loaded ? `${label} (not in the course)` : label },
    ...options,
  ];
}

interface Props {
  value: TriggerConfig;
  onChange: (next: TriggerConfig) => void;
  disabled?: boolean;
}

export function TriggerBuilder({ value, onChange, disabled }: Props) {
  const conds = value.all ?? [];
  const { catalog, error } = useTriggerCatalog();

  const updateRow = (idx: number, next: Condition) => {
    onChange({ all: conds.map((c, i) => (i === idx ? next : c)) });
  };
  const removeRow = (idx: number) => {
    onChange({ all: conds.filter((_, i) => i !== idx) });
  };
  const addRow = () => {
    onChange({
      all: [...conds, { metric: "day_number", op: "at_least", value: 1 }],
    });
  };

  return (
    <div
      style={{
        background: "var(--color-fill-secondary)",
        borderRadius: 8,
        padding: 14,
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-text-tertiary)",
          marginBottom: 4,
        }}
      >
        When to fire this DM
      </p>
      <p
        style={{
          fontSize: 12,
          color: "var(--color-text-secondary)",
          marginBottom: 10,
        }}
      >
        Send this DM when <strong>ALL</strong> of these are true. To
        cover multiple OR cases, make separate templates.
      </p>

      {error && (
        <p
          style={{
            fontSize: 12,
            color: "var(--color-danger)",
            marginBottom: 10,
          }}
        >
          The areas and lessons could not be loaded, so their dropdowns are
          off: {error}
        </p>
      )}

      {conds.length === 0 && (
        <p
          style={{
            fontSize: 12,
            color: "var(--color-text-tertiary)",
            fontStyle: "italic",
            padding: "8px 0",
          }}
        >
          No conditions yet — add one below.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {conds.map((cond, i) => (
          <ConditionRow
            key={i}
            cond={cond}
            catalog={catalog}
            disabled={disabled}
            onChange={(c) => updateRow(i, c)}
            onRemove={() => removeRow(i)}
          />
        ))}
      </div>

      {!disabled && (
        <button
          type="button"
          onClick={addRow}
          style={{
            marginTop: 10,
            padding: "6px 12px",
            fontSize: 12,
            background: "transparent",
            border: "1px dashed var(--color-border-hover)",
            borderRadius: 6,
            color: "var(--color-text-secondary)",
            cursor: "pointer",
          }}
        >
          + Add another condition
        </button>
      )}

      {conds.length > 0 && (
        <div
          style={{
            marginTop: 14,
            padding: 10,
            borderRadius: 6,
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border)",
          }}
        >
          <p
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-text-tertiary)",
              marginBottom: 4,
            }}
          >
            Reads as
          </p>
          <p
            style={{
              fontSize: 13,
              color: "var(--color-text-primary)",
              lineHeight: 1.55,
            }}
          >
            Fire when{" "}
            {conds.map((c, i) => {
              const def = METRICS[c.metric];
              const text = def.describe(c);
              return (
                <span key={i}>
                  {i > 0 && (
                    <span
                      style={{
                        color: "var(--color-accent-dark)",
                        fontWeight: 600,
                      }}
                    >
                      {" "}
                      AND{" "}
                    </span>
                  )}
                  {text}
                </span>
              );
            })}
            .
          </p>
        </div>
      )}
    </div>
  );
}

function ConditionRow({
  cond,
  catalog,
  disabled,
  onChange,
  onRemove,
}: {
  cond: Condition;
  /** Null while loading or after a failed read. */
  catalog: Catalog | null;
  disabled?: boolean;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const def = METRICS[cond.metric];
  const inputType = def.input;
  // The first area and the first action lesson of the live catalog are the
  // defaults; without the catalog, metrics that need one cannot be picked.
  const firstRegion = catalog?.regions[0]?.id ?? null;
  const firstLesson = catalog?.actionLessons[0]?.id ?? null;
  const metricOptions = (Object.keys(METRICS) as ConditionMetric[]).filter(
    (m) =>
      m === cond.metric ||
      (!(catalog?.courseIsNew && CLOCK_METRICS.has(m)) &&
        !(METRICS[m].param === "region" && !firstRegion) &&
        !(METRICS[m].param === "lesson" && !firstLesson)),
  );

  // Change metric → reset to a sensible default for the new shape.
  const handleMetricChange = (newId: ConditionMetric) => {
    const newDef = METRICS[newId];
    if (newDef.input === "boolean") {
      if (newDef.param === "region") {
        onChange({ metric: newId, region: firstRegion, op: "is" } as Condition);
      } else if (newDef.param === "lesson") {
        onChange({
          metric: newId,
          lesson_id: firstLesson,
          op: "is",
        } as Condition);
      } else {
        // Plain boolean (no param) — has_logged_into_app and similar.
        onChange({ metric: newId, op: "is" } as Condition);
      }
    } else if (newDef.input === "enum") {
      onChange({
        metric: newId,
        op: "is",
        value: newDef.enumValues?.[0] ?? "active",
      } as Condition);
    } else {
      // numeric
      if (newDef.param === "region") {
        onChange({
          metric: newId,
          region: firstRegion,
          op: "at_least",
          value: 0,
        } as Condition);
      } else {
        onChange({ metric: newId, op: "at_least", value: 0 } as Condition);
      }
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      style={{
        padding: 8,
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
      }}
    >
      {/* Metric */}
      <select
        disabled={disabled}
        value={cond.metric}
        onChange={(e) => handleMetricChange(e.target.value as ConditionMetric)}
        style={selectStyle()}
      >
        {metricOptions.map((m) => (
          <option key={m} value={m}>
            {catalog?.courseIsNew && CLOCK_METRICS.has(m)
              ? `${METRICS[m].label} (never matches on the new course)`
              : METRICS[m].label}
          </option>
        ))}
      </select>

      {/* Sub-param: region */}
      {def.param === "region" && "region" in cond && (
        <select
          disabled={disabled || !catalog}
          value={cond.region}
          onChange={(e) =>
            onChange({ ...cond, region: e.target.value as RegionId } as Condition)
          }
          style={selectStyle()}
        >
          {withCurrent(catalog?.regions ?? [], cond.region, catalog != null).map(
            (r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ),
          )}
        </select>
      )}

      {/* Sub-param: lesson */}
      {def.param === "lesson" && "lesson_id" in cond && (
        <select
          disabled={disabled || !catalog}
          value={cond.lesson_id}
          onChange={(e) =>
            onChange({ ...cond, lesson_id: e.target.value } as Condition)
          }
          style={selectStyle()}
        >
          {withCurrent(
            catalog?.actionLessons ?? [],
            cond.lesson_id,
            catalog != null,
          ).map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      )}

      {/* Operator */}
      <select
        disabled={disabled}
        value={cond.op}
        onChange={(e) =>
          onChange({ ...cond, op: e.target.value as ConditionOp } as Condition)
        }
        style={selectStyle()}
      >
        {(inputType === "number" ? NUMERIC_OPS : BINARY_OPS).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Value */}
      {inputType === "number" && "value" in cond && typeof cond.value === "number" && (
        <input
          type="number"
          disabled={disabled}
          value={cond.value}
          onChange={(e) =>
            onChange({
              ...cond,
              value: Number(e.target.value) || 0,
            } as Condition)
          }
          style={{ ...selectStyle(), width: 84 }}
        />
      )}
      {inputType === "number" && def.unit && (
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
          {def.unit}
        </span>
      )}
      {inputType === "enum" && "value" in cond && typeof cond.value === "string" && (
        <select
          disabled={disabled}
          value={cond.value}
          onChange={(e) =>
            onChange({ ...cond, value: e.target.value } as Condition)
          }
          style={selectStyle()}
        >
          {(def.enumValues ?? []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      )}

      <div className="flex-1" />

      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove condition"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-text-tertiary)",
            fontSize: 18,
            cursor: "pointer",
            padding: "0 6px",
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function selectStyle(): React.CSSProperties {
  return {
    padding: "6px 8px",
    fontSize: 13,
    background: "var(--color-bg-primary)",
    border: "1px solid var(--color-border)",
    borderRadius: 5,
    color: "var(--color-text-primary)",
  };
}
