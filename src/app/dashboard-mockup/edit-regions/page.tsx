"use client";

import { useRef, useState } from "react";

type RegionId = "r1" | "r2" | "r3" | "r4";
const REGION_IDS: RegionId[] = ["r1", "r2", "r3", "r4"];

const REGION_META: Record<RegionId, { label: string; color: string }> = {
  r1: { label: "R1 — Harbor / Base Camp",       color: "#F0D595" },
  r2: { label: "R2 — Valley / Creative Lab",    color: "#4DCEC4" },
  r3: { label: "R3 — Waterfall / Test Track",   color: "#4DA0D8" },
  r4: { label: "R4 — Summit / The Market",      color: "#C44A54" },
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
 * Region outline picker.
 *
 * Flow:
 *   1. Select a region (R1/R2/R3/R4) via the tab bar
 *   2. Click along its border on the image to add vertices
 *   3. Polygon fills in live — all 4 regions visible at once so you can
 *      verify relative placement
 *   4. "Copy" emits TypeScript that plugs into MapMockup's REGION_ZONES
 *
 * Coordinates are in the 3200×1400 map space (SVG user units), regardless
 * of viewport size — same coord system MapMockup uses for rendering.
 */
export default function EditRegionsPage() {
  const [active, setActive] = useState<RegionId>("r1");
  const [points, setPoints] = useState<Points>(emptyPoints);
  const [copied, setCopied] = useState(false);
  const [cursor, setCursor] = useState<Point | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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
    setPoints((prev) => ({
      ...prev,
      [active]: [...prev[active], p],
    }));
  };

  const undo = () => {
    setPoints((prev) => ({
      ...prev,
      [active]: prev[active].slice(0, -1),
    }));
  };
  const clearActive = () => {
    setPoints((prev) => ({ ...prev, [active]: [] }));
  };
  const clearAll = () => setPoints(emptyPoints);

  const tsCode = (() => {
    const lines: string[] = ["const REGION_ZONES: Record<RegionId, RegionZone> = {"];
    for (const rid of REGION_IDS) {
      const pts = points[rid];
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
      // Clipboard API may be unavailable — fall back to showing the code
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
      {/* Main canvas — SVG with main_image as the base */}
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
          <image
            href="/regions/main_image.png"
            x={0}
            y={0}
            width={MAP_W}
            height={MAP_H}
            preserveAspectRatio="xMidYMid slice"
          />

          {/* All 4 region polygons — active one bright, others dimmed */}
          {REGION_IDS.map((rid) => {
            const pts = points[rid];
            const { color } = REGION_META[rid];
            const isActive = rid === active;
            if (pts.length === 0) return null;
            const pointsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
            return (
              <g key={rid} opacity={isActive ? 1 : 0.4}>
                {/* Filled polygon (only if 3+ points) */}
                {pts.length >= 3 && (
                  <polygon
                    points={pointsStr}
                    fill={color}
                    fillOpacity={isActive ? 0.18 : 0.08}
                    stroke="none"
                  />
                )}
                {/* Open polyline connecting the points */}
                <polyline
                  points={pointsStr}
                  fill="none"
                  stroke={color}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.9}
                />
                {/* Close segment — dashed (only when 3+ points) */}
                {pts.length >= 3 && (
                  <line
                    x1={pts[pts.length - 1].x}
                    y1={pts[pts.length - 1].y}
                    x2={pts[0].x}
                    y2={pts[0].y}
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray="10 6"
                    opacity={0.55}
                  />
                )}
                {/* Vertex dots */}
                {pts.map((p, i) => (
                  <g key={i} transform={`translate(${p.x} ${p.y})`}>
                    <circle
                      r={isActive ? 10 : 6}
                      fill="#060C1A"
                      stroke={color}
                      strokeWidth={2}
                    />
                    {isActive && (
                      <text
                        y={4}
                        textAnchor="middle"
                        style={{
                          fontFamily:
                            "JetBrains Mono, ui-monospace, monospace",
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
          })}
        </svg>

        {/* Crosshair coord readout on hover */}
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
            padding: "18px 20px",
            borderBottom: "1px solid rgba(230,192,122,0.14)",
          }}
        >
          <h1
            style={{
              fontFamily: "Cormorant Garamond, serif",
              fontStyle: "italic",
              fontSize: 26,
              fontWeight: 500,
              margin: 0,
              marginBottom: 4,
            }}
          >
            Region outline picker
          </h1>
          <p
            style={{
              fontSize: 12,
              color: "rgba(230,220,200,0.6)",
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            Select a region, then click along its border to trace the outline.
            Coords are in map space (3200×1400).
          </p>
        </div>

        {/* Region tabs */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 6,
            padding: "14px 16px",
            borderBottom: "1px solid rgba(230,192,122,0.14)",
          }}
        >
          {REGION_IDS.map((rid) => {
            const { label, color } = REGION_META[rid];
            const count = points[rid].length;
            const isActive = rid === active;
            return (
              <button
                key={rid}
                onClick={() => setActive(rid)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  background: isActive
                    ? `${color}22`
                    : "rgba(6,12,26,0.5)",
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
                    marginBottom: 3,
                    opacity: 0.8,
                  }}
                >
                  {rid.toUpperCase()}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  {label.split(" — ")[1]}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    marginTop: 4,
                    opacity: 0.65,
                    fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  }}
                >
                  {count} point{count === 1 ? "" : "s"}
                </div>
              </button>
            );
          })}
        </div>

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "12px 16px",
            borderBottom: "1px solid rgba(230,192,122,0.14)",
          }}
        >
          <ToolButton onClick={undo} disabled={points[active].length === 0}>
            Undo
          </ToolButton>
          <ToolButton onClick={clearActive} disabled={points[active].length === 0}>
            Clear {active.toUpperCase()}
          </ToolButton>
          <ToolButton
            onClick={clearAll}
            disabled={REGION_IDS.every((r) => points[r].length === 0)}
            variant="danger"
          >
            Clear all
          </ToolButton>
        </div>

        {/* Point list for active region */}
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
            {active.toUpperCase()} points
          </div>
          {points[active].length === 0 ? (
            <div
              style={{
                fontSize: 13,
                color: "rgba(230,220,200,0.5)",
                fontStyle: "italic",
              }}
            >
              Click along the region border to add points.
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
              {points[active].map((p, i) => (
                <li
                  key={i}
                  style={{
                    padding: "4px 0",
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
            {copied ? "Copied ✓" : "Copy REGION_ZONES"}
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
            Paste the output into{" "}
            <code style={{ color: "#E6C07A" }}>MapMockup.tsx</code> to replace
            the placeholder REGION_ZONES.
          </p>
        </div>
      </aside>
    </div>
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

