"use client";

import type { PathNode } from "@/lib/path-layout";
import type { CheckpointProgress } from "@/contexts/StudentContext";

interface FogOverlayProps {
  nodes: PathNode[];
  containerWidth: number;
  totalHeight: number;
  checkpointProgress: Record<string, CheckpointProgress>;
  currentCheckpointId: string | null;
  discountGateCheckpointId: string | null;
}

/**
 * CSS mask overlay that creates a fog-of-war effect.
 * Completed and current checkpoint regions are revealed;
 * future regions are fogged (desaturated, reduced opacity).
 * The discount gate checkpoint glows through the fog.
 */
export function FogOverlay({
  nodes,
  containerWidth,
  totalHeight,
  checkpointProgress,
  currentCheckpointId,
  discountGateCheckpointId,
}: FogOverlayProps) {
  const centerX = containerWidth / 2;

  // Build radial gradient masks for revealed areas
  const revealGradients: string[] = [];

  for (const node of nodes) {
    if (node.kind !== "checkpoint" || !node.checkpoint) continue;

    const cpId = node.checkpoint.id;
    const isComplete = checkpointProgress[cpId]?.isComplete;
    const isCurrent = cpId === currentCheckpointId;

    if (isComplete || isCurrent) {
      const cx = centerX + node.x;
      const cy = node.y + 60; // center of checkpoint node
      const radius = isCurrent ? 280 : 220;
      revealGradients.push(
        `radial-gradient(circle ${radius}px at ${cx}px ${cy}px, black 0%, transparent 100%)`
      );
    }
  }

  // If nothing is revealed yet (brand new user), reveal the first checkpoint area
  if (revealGradients.length === 0 && nodes.length > 0) {
    const first = nodes[0];
    const cx = centerX + first.x;
    const cy = first.y + 60;
    revealGradients.push(
      `radial-gradient(circle 280px at ${cx}px ${cy}px, black 0%, transparent 100%)`
    );
  }

  const maskImage = revealGradients.length > 0
    ? revealGradients.join(", ")
    : "none";

  return (
    <>
      {/* Fog layer — covers unvisited areas */}
      <div
        className="absolute inset-0 pointer-events-none z-[3]"
        style={{
          height: totalHeight,
          background: "var(--color-bg-primary)",
          opacity: 0.75,
          // mask-composite: add makes multiple radial gradients combine
          WebkitMaskImage: maskImage,
          maskImage: maskImage,
          WebkitMaskComposite: "destination-out",
          maskComposite: "exclude",
        }}
      />

      {/* Discount gate glow through fog */}
      {discountGateCheckpointId && (() => {
        const gateNode = nodes.find(
          (n) => n.kind === "checkpoint" && n.checkpoint?.id === discountGateCheckpointId
        );
        if (!gateNode) return null;
        const isRevealed = checkpointProgress[discountGateCheckpointId]?.isComplete ||
          discountGateCheckpointId === currentCheckpointId;
        if (isRevealed) return null;

        const cx = centerX + gateNode.x;
        const cy = gateNode.y + 60;

        return (
          <div
            className="absolute pointer-events-none z-[4] animate-pulse"
            style={{
              left: cx - 100,
              top: cy - 100,
              width: 200,
              height: 200,
              borderRadius: "50%",
              background: `radial-gradient(circle, var(--color-accent-glow) 0%, transparent 70%)`,
              opacity: 0.5,
            }}
          />
        );
      })()}
    </>
  );
}
