"use client";

import { useRef, useState } from "react";

type RegionId = "r1" | "r2" | "r3" | "r4";
const REGION_IDS: RegionId[] = ["r1", "r2", "r3", "r4"];

type ToolId = "regions" | "path-r1" | "path-r2" | "path-r3" | "path-r4";

const REGION_META: Record<RegionId, { label: string; color: string }> = {
  r1: { label: "R1 — Harbor / Base Camp",       color: "#F0D595" },
  r2: { label: "R2 — Valley / Creative Lab",    color: "#4DCEC4" },
  r3: { label: "R3 — Waterfall / Test Track",   color: "#4DA0D8" },
  r4: { label: "R4 — Summit / The Market",      color: "#C44A54" },
};

interface ToolMeta {
  label: string;
  /** Background image to trace on */
  image: string;
  /** Closed polygon (auto-closes last→first) or open polyline */
  shape: "polygon" | "polyline";
}
const TOOL_META: Record<ToolId, ToolMeta> = {
  "regions": { label: "Region outlines (main_image)",   image: "/regions/main_image.png",      shape: "polygon" },
  "path-r1": { label: "R1 path (first_location)",       image: "/regions/first_location.png",  shape: "polyline" },
  "path-r2": { label: "R2 path (second_location)",      image: "/regions/second_location.png", shape: "polyline" },
  "path-r3": { label: "R3 path (third_location)",       image: "/regions/third_location.png",  shape: "polyline" },
  "path-r4": { label: "R4 path (fourth_location)",      image: "/regions/fourth_location.png", shape: "polyline" },
};

// Map coordinate space (matches MapMockup's viewBox)
const MAP_W = 3200;
const MAP_H = 1400;

type Point = { x: number; y: number };
type Points = Record<RegionId, Point[]>;

const emptyPoints: Points = { r1: [], r2: [], r3: [], r4: [] };

function centroid(pts: Point[]): Point | null {
  if (pts.length === 0) return null;
  const sum = pts.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 }
  );
  return { x: Math.round(sum.x / pts.length), y: Math.round(sum.y / pts.length) };
}

/**
 * Coordinate picker — supports two shape kinds:
 *
 *   Tool "regions"  — closed polygons over main_image.png. Tabs let you
 *                     switch between R1/R2/R3/R4. Output is the full
 *                     REGION_ZONES TypeScript ready for MapMockup.tsx.
 *
 *   Tool "path-rN"  — open polylines over a per-region location scene.
 *                     Just one trace; click points in walking order.
 *                     Output is a `waypoints: [...]` array ready for
 *                     SCENES[rN].waypoints in MapMockup.tsx.
 *
 * All coordinates are in 3200×1400 SVG user-space, the same coord system
 * MapMockup renders into. Click any point on the image to add it to the
 * active trace; lines connect points in click order.
 */
export default function EditRegionsPage() {
  const [tool, setTool] = useState<ToolId>("regions");
  const [activeRegion, setActiveRegion] = useState<RegionId>("r1");

  // Region polygon points (used when tool === "regions")
  const [regionPoints, setRegionPoints] = useState<Points>(emptyPoints);
  // Per-scene path points (used when tool === "path-rN")
  const [pathPoints, setPathPoints] = useState<Points>(emptyPoints);

  const [copied, setCopied] = useState(false);
  const [cursor, setCursor] = useState<Point | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const toolMeta = TOOL_META[tool];
  const isPathTool = tool !== "regions";
  // The "active" trace key — for region tool, that's whichever region tab
  // is selected; for a path tool, it's whichever region's path we're on.
  const traceKey: RegionId = isPathTool
    ? (tool.replace("path-", "") as RegionId)
    : activeRegion;
  const currentPoints = isPathTool ? pathPoints[traceKey] : regionPoints[traceKey];

  const toSvgCoord = (clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const sp = pt.matrixTransform(ctm.inverse());
    if (sp.x < 0 || sp.x > MAP_W || sp.y < 0 || sp.y > MAP_H) return null;
    return { x: Math.round(sp.x), y: Math.round(sp.y) };
  };

  const addPoint = (e: React.MouseEvent<SVGSVGElement>) => {
    const p = toSvgCoord(e.clientX, e.clientY);
    if (!p) return;
    if (isPathTool) {
      setPathPoints((prev) => ({
        ...prev,
        [traceKey]: [...prev[traceKey], p],
      }));
    } else {
      setRegionPoints((prev) => ({
        ...prev,
        [traceKey]: [...prev[traceKey], p],
      }));
    }
  };

  const undo = () => {
    if (isPathTool) {
      setPathPoints((prev) => ({
        ...prev,
        [traceKey]: prev[traceKey].slice(0, -1),
      }));
    } else {
      setRegionPoints((prev) => ({
        ...prev,
        [traceKey]: prev[traceKey].slice(0, -1),
      }));
    }
  };
  const clearActive = () => {
    if (isPathTool) {
      setPathPoints((prev) => ({ ...prev, [traceKey]: [] }));
    } else {
      setRegionPoints((prev) => ({ ...prev, [traceKey]: [] }));
    }
  };

  // Output TypeScript for the active tool. For "regions" → full
  // REGION_ZONES block. For a path → just the waypoints array.
  const tsCode = (() => {
    if (isPathTool) {
      const pts = pathPoints[traceKey];
      const lines = [`waypoints: [`];
      if (pts.length === 0) {
        lines.push(`  // empty — trace this path in the picker`);
      } else {
        for (const p of pts) {
          lines.push(`  { x: ${p.x}, y: ${p.y} },`);
        }
      }
      lines.push(`],`);
      return lines.join("\n");
    }
    const lines: string[] = ["const REGION_ZONES: Record<RegionId, RegionZone> = {"];
    for (const rid of REGION_IDS) {
      const pts = regionPoints[rid];
      const c = centroid(pts);
      lines.push(`  ${rid}: {`);
      lines.push(`    polygon: [`);
      if (pts.length === 0) {
        lines.push(`      // empty — trace this region in the picker`);
      } else {
        for (const p of pts) {
          lines.push(`      { x: ${p.x}, y: ${p.y} },`);
        }
      }
      lines.push(`    ],`);
      lines.push(`    labelX: ${c?.x ?? 0}, labelY: ${c?.y ?? 0},`);
      lines.push(`  },`);
    }
    lines.push("};");
    return lines.join("\n");
  })();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tsCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#060C1A",
        display: "flex",
        color: "#E6DCC8",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* Main canvas */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          preserveAspectRatio="xMidYMid slice"
          onClick={addPoint}
          onMouseMove={(e) => setCursor(toSvgCoord(e.clientX, e.clientY))}
          onMouseLeave={() => setCursor(null)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            cursor: "crosshair",
          }}
        >
          {/* Image swaps with selected tool. key forces a fresh load when
              switching scenes so we don't see the previous image bleed. */}
          <image
            key={toolMeta.image}
            href={toolMeta.image}
            x={0}
            y={0}
            width={MAP_W}
            height={MAP_H}
            preserveAspectRatio="xMidYMid slice"
          />

          {isPathTool ? (
            // Path mode — single open polyline for this scene
            <PathTrace
              points={pathPoints[traceKey]}
              color={REGION_META[traceKey].color}
            />
          ) : (
            // Region mode — all 4 region polygons (active bright, dimmed others)
            REGION_IDS.map((rid) => (
              <RegionTrace
                key={rid}
                points={regionPoints[rid]}
                color={REGION_META[rid].color}
                active={rid === activeRegion}
              />
            ))
          )}
        </svg>

        {cursor && (
          <div
            style={{
              position: "absolute",
              left: 12,
              bottom: 12,
              padding: "6px 10px",
              background: "rgba(6,12,26,0.85)",
              border: "1px solid rgba(230,192,122,0.3)",
              borderRadius: 4,
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
              fontSize: 12,
              color: "#E6C07A",
              letterSpacing: "0.08em",
              pointerEvents: "none",
            }}
          >
            ({cursor.x}, {cursor.y})
          </div>
        )}
      </div>

      {/* Sidebar */}
      <aside
        style={{
          width: 380,
          display: "flex",
          flexDirection: "column",
          background:
            "linear-gradient(180deg, rgba(6,12,26,0.98) 0%, rgba(10,20,40,0.98) 100%)",
          borderLeft: "1px solid rgba(230,192,122,0.25)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid rgba(230,192,122,0.14)",
          }}
        >
          <h1
            style={{
              fontFamily: "Cormorant Garamond, serif",
              fontStyle: "italic",
              fontSize: 24,
              fontWeight: 500,
              margin: 0,
              marginBottom: 4,
            }}
          >
            Coordinate picker
          </h1>
          <p
            style={{
              fontSize: 12,
              color: "rgba(230,220,200,0.6)",
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            Click points on the image to trace. Coords are in map space
            (3200×1400) regardless of viewport.
          </p>
        </div>

        {/* Tool selector */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid rgba(230,192,122,0.14)",
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: 10,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "rgba(230,220,200,0.55)",
              marginBottom: 6,
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
            }}
          >
            Tool
          </label>
          <select
            value={tool}
            onChange={(e) => setTool(e.target.value as ToolId)}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 5,
              background: "rgba(6,12,26,0.85)",
              border: "1px solid rgba(230,192,122,0.3)",
              color: "#E6DCC8",
              fontFamily: "inherit",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {(Object.keys(TOOL_META) as ToolId[]).map((id) => (
              <option key={id} value={id} style={{ background: "#0A1428" }}>
                {TOOL_META[id].label}
              </option>
            ))}
          </select>
          <p
            style={{
              fontSize: 11,
              color: "rgba(230,220,200,0.45)",
              marginTop: 6,
              lineHeight: 1.4,
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
            }}
          >
            {toolMeta.shape === "polygon"
              ? "Closed polygon — last point auto-connects to first"
              : "Open polyline — points in walking order, no auto-close"}
          </p>
        </div>

        {/* Region tabs (only for region mode) */}
        {!isPathTool && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              padding: "12px 16px",
              borderBottom: "1px solid rgba(230,192,122,0.14)",
            }}
          >
            {REGION_IDS.map((rid) => {
              const { label, color } = REGION_META[rid];
              const count = regionPoints[rid].length;
              const isActive = rid === activeRegion;
              return (
                <button
                  key={rid}
                  onClick={() => setActiveRegion(rid)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: isActive ? `${color}22` : "rgba(6,12,26,0.5)",
                    border: `1.5px solid ${isActive ? color : "rgba(230,192,122,0.15)"}`,
                    color: isActive ? color : "rgba(230,220,200,0.75)",
                    textAlign: "left",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.2s",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.2em",
                      textTransform: "uppercase",
                      fontFamily: "JetBrains Mono, ui-monospace, monospace",
                      marginBottom: 2,
                      opacity: 0.8,
                    }}
                  >
                    {rid.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>
                    {label.split(" — ")[1]}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      marginTop: 2,
                      opacity: 0.65,
                      fontFamily: "JetBrains Mono, ui-monospace, monospace",
                    }}
                  >
                    {count} pt{count === 1 ? "" : "s"}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "10px 16px",
            borderBottom: "1px solid rgba(230,192,122,0.14)",
          }}
        >
          <ToolButton onClick={undo} disabled={currentPoints.length === 0}>
            Undo
          </ToolButton>
          <ToolButton onClick={clearActive} disabled={currentPoints.length === 0}>
            Clear {traceKey.toUpperCase()}
          </ToolButton>
        </div>

        {/* Point list */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "12px 16px",
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "rgba(230,220,200,0.55)",
              marginBottom: 8,
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
            }}
          >
            {isPathTool ? `${traceKey.toUpperCase()} path` : `${traceKey.toUpperCase()} polygon`} · {currentPoints.length} pts
          </div>
          {currentPoints.length === 0 ? (
            <div
              style={{
                fontSize: 13,
                color: "rgba(230,220,200,0.5)",
                fontStyle: "italic",
              }}
            >
              {isPathTool
                ? "Click along the path in walking order."
                : "Click along the region border to add points."}
            </div>
          ) : (
            <ol
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                fontSize: 12,
                fontFamily: "JetBrains Mono, ui-monospace, monospace",
              }}
            >
              {currentPoints.map((p, i) => (
                <li
                  key={i}
                  style={{
                    padding: "3px 0",
                    color: "rgba(230,220,200,0.8)",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ color: "rgba(230,220,200,0.45)" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    ({p.x}, {p.y})
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Copy bar */}
        <div
          style={{
            padding: 16,
            borderTop: "1px solid rgba(230,192,122,0.25)",
            background: "rgba(6,12,26,0.6)",
          }}
        >
          <button
            onClick={copy}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 6,
              background: copied ? "#4DCEC4" : "#E6C07A",
              color: "#060C1A",
              border: "none",
              cursor: "pointer",
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              transition: "background 0.2s",
            }}
          >
            {copied
              ? "Copied ✓"
              : isPathTool
                ? `Copy ${traceKey.toUpperCase()} waypoints`
                : "Copy REGION_ZONES"}
          </button>
          <p
            style={{
              fontSize: 11,
              color: "rgba(230,220,200,0.5)",
              marginTop: 8,
              lineHeight: 1.4,
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
            }}
          >
            {isPathTool
              ? `Paste into SCENES[${traceKey}].waypoints in MapMockup.tsx`
              : "Paste over the existing REGION_ZONES in MapMockup.tsx"}
          </p>
        </div>
      </aside>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────

function RegionTrace({
  points,
  color,
  active,
}: {
  points: Point[];
  color: string;
  active: boolean;
}) {
  if (points.length === 0) return null;
  const pointsStr = points.map((p) => `${p.x},${p.y}`).join(" ");
  const last = points[points.length - 1];
  return (
    <g opacity={active ? 1 : 0.4}>
      {points.length >= 3 && (
        <polygon
          points={pointsStr}
          fill={color}
          fillOpacity={active ? 0.18 : 0.08}
          stroke="none"
        />
      )}
      <polyline
        points={pointsStr}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
      {points.length >= 3 && (
        <line
          x1={last.x}
          y1={last.y}
          x2={points[0].x}
          y2={points[0].y}
          stroke={color}
          strokeWidth={2}
          strokeDasharray="10 6"
          opacity={0.55}
        />
      )}
      {points.map((p, i) => (
        <g key={i} transform={`translate(${p.x} ${p.y})`}>
          <circle
            r={active ? 10 : 6}
            fill="#060C1A"
            stroke={color}
            strokeWidth={2}
          />
          {active && (
            <text
              y={4}
              textAnchor="middle"
              style={{
                fontFamily: "JetBrains Mono, ui-monospace, monospace",
                fontSize: 11,
                fontWeight: 700,
                fill: color,
              }}
            >
              {i + 1}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

function PathTrace({ points, color }: { points: Point[]; color: string }) {
  if (points.length === 0) return null;
  const pointsStr = points.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <g>
      {/* Dark underlay so the line is legible on bright scene art */}
      <polyline
        points={pointsStr}
        fill="none"
        stroke="rgba(6,12,26,0.65)"
        strokeWidth={10}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={pointsStr}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.95}
      />
      {points.map((p, i) => (
        <g key={i} transform={`translate(${p.x} ${p.y})`}>
          <circle
            r={11}
            fill="#060C1A"
            stroke={color}
            strokeWidth={2.5}
          />
          <text
            y={4}
            textAnchor="middle"
            style={{
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
              fontSize: 11,
              fontWeight: 700,
              fill: color,
            }}
          >
            {i + 1}
          </text>
        </g>
      ))}
    </g>
  );
}

function ToolButton({
  children,
  onClick,
  disabled,
  variant,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "danger";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: "8px 10px",
        borderRadius: 5,
        background: "transparent",
        border: `1px solid ${
          variant === "danger"
            ? "rgba(196,74,84,0.4)"
            : "rgba(230,192,122,0.3)"
        }`,
        color:
          variant === "danger"
            ? "#E89099"
            : disabled
              ? "rgba(230,220,200,0.35)"
              : "#E6C07A",
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        fontSize: 10,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 0.2s",
      }}
    >
      {children}
    </button>
  );
}
