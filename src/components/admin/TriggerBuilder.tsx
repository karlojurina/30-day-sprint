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
 */

import {
  ACTION_LESSONS,
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

const REGIONS: RegionId[] = ["r1", "r2", "r3", "r4"];

interface Props {
  value: TriggerConfig;
  onChange: (next: TriggerConfig) => void;
  disabled?: boolean;
}

export function TriggerBuilder({ value, onChange, disabled }: Props) {
  const conds = value.all ?? [];

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
  disabled,
  onChange,
  onRemove,
}: {
  cond: Condition;
  disabled?: boolean;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const def = METRICS[cond.metric];
  const inputType = def.input;

  // Change metric → reset to a sensible default for the new shape.
  const handleMetricChange = (newId: ConditionMetric) => {
    const newDef = METRICS[newId];
    if (newDef.input === "boolean") {
      if (newDef.param === "region") {
        onChange({ metric: newId, region: "r1", op: "is" } as Condition);
      } else if (newDef.param === "lesson") {
        onChange({
          metric: newId,
          lesson_id: "l018",
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
          region: "r1",
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
        {(Object.keys(METRICS) as ConditionMetric[]).map((m) => (
          <option key={m} value={m}>
            {METRICS[m].label}
          </option>
        ))}
      </select>

      {/* Sub-param: region */}
      {def.param === "region" && "region" in cond && (
        <select
          disabled={disabled}
          value={cond.region}
          onChange={(e) =>
            onChange({ ...cond, region: e.target.value as RegionId } as Condition)
          }
          style={selectStyle()}
        >
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {REGION_LABEL[r]}
            </option>
          ))}
        </select>
      )}

      {/* Sub-param: lesson */}
      {def.param === "lesson" && "lesson_id" in cond && (
        <select
          disabled={disabled}
          value={cond.lesson_id}
          onChange={(e) =>
            onChange({ ...cond, lesson_id: e.target.value } as Condition)
          }
          style={selectStyle()}
        >
          {ACTION_LESSONS.map((l) => (
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
