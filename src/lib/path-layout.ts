import type { Checkpoint, Task } from "@/types/database";

/**
 * One positioned node on the journey path.
 * x is offset from the container horizontal center (positive = right).
 * y is absolute vertical position from the top of the path container.
 */
export interface PathNode {
  kind: "checkpoint" | "lesson";
  id: string;
  x: number;
  y: number;
  indexInPath: number;
  checkpoint?: Checkpoint;
  task?: Task;
}

export interface PathLayout {
  nodes: PathNode[];
  totalHeight: number;
  spread: number;
  totalWidth: number;
}

export interface PathLayoutOptions {
  spread: number; // max horizontal offset in px
  checkpointHeight: number; // space used by a checkpoint node (leading + node)
  lessonHeight: number; // vertical spacing between lesson pills
  firstTopPadding: number; // padding at top of the first checkpoint
  bottomPadding: number;
  wavelength: number; // how many nodes complete one sine cycle
  mapMode: boolean; // wider 2D layout for the interactive map
}

export function defaultPathOptions(containerWidth: number, mapMode = false): PathLayoutOptions {
  if (mapMode) {
    // Map mode: wider spread for 2D map feel
    const spread =
      containerWidth < 480 ? 120 : containerWidth < 768 ? 200 : 300;
    return {
      spread,
      checkpointHeight: 220,
      lessonHeight: 85,
      firstTopPadding: 80,
      bottomPadding: 120,
      wavelength: 3.5, // tighter curves for more organic feel
      mapMode: true,
    };
  }

  // Original compact mode
  const spread =
    containerWidth < 480 ? 56 : containerWidth < 768 ? 96 : 140;
  return {
    spread,
    checkpointHeight: 180,
    lessonHeight: 72,
    firstTopPadding: 40,
    bottomPadding: 80,
    wavelength: 4.5,
    mapMode: false,
  };
}

/**
 * Compute (x, y) for every node on the path — checkpoints and lessons
 * interleaved, producing a smooth flowing snake. Used by both
 * `JourneyPath` (for absolute positioning of nodes/cards) and
 * `FlowingPath` (for the SVG bezier).
 */
export function computePathLayout(
  checkpoints: Checkpoint[],
  tasksByCheckpoint: Record<string, Task[]>,
  options: PathLayoutOptions
): PathLayout {
  const nodes: PathNode[] = [];
  let y = options.firstTopPadding;
  let index = 0;

  // Reserved vertical space for the discount gate card (rendered between
  // the gate checkpoint's last lesson and the next checkpoint node)
  const DISCOUNT_GATE_SPACE = 280;

  const xForIndex = (i: number) => {
    if (options.mapMode) {
      // More organic path: combine two sine waves for natural wandering
      const primary = Math.sin((i / options.wavelength) * Math.PI) * options.spread;
      const secondary = Math.sin((i / (options.wavelength * 2.3)) * Math.PI) * (options.spread * 0.3);
      return primary + secondary;
    }
    return Math.sin((i / options.wavelength) * Math.PI) * options.spread;
  };

  for (const cp of checkpoints) {
    nodes.push({
      kind: "checkpoint",
      id: cp.id,
      x: xForIndex(index),
      y,
      indexInPath: index,
      checkpoint: cp,
    });
    index++;
    y += options.checkpointHeight;

    const tasks = (tasksByCheckpoint[cp.id] ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order);

    for (const task of tasks) {
      nodes.push({
        kind: "lesson",
        id: task.id,
        x: xForIndex(index),
        y,
        indexInPath: index,
        task,
      });
      index++;
      y += options.lessonHeight;
    }

    // Add extra space after a gate checkpoint for the discount gate card
    if (cp.is_discount_gate) {
      y += DISCOUNT_GATE_SPACE;
    }
  }

  // Compute total width needed (for map container sizing)
  let minX = 0, maxX = 0;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
  }
  const totalWidth = maxX - minX + 300; // padding for nodes

  return {
    nodes,
    totalHeight: y + options.bottomPadding,
    spread: options.spread,
    totalWidth,
  };
}
